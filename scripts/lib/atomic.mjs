import fs from 'node:fs'
import path from 'node:path'

export function classifyFsError(code) {
  const retryable = new Set(['EPERM', 'EACCES', 'EBUSY'])
  return retryable.has(code) ? 'retry' : 'fatal'
}

/**
 * 원자적 쓰기 — write → **fsync(fd)** → close → rename → **fsync(dir)**. P5 FIX-NOW `atomic.mjs:20`
 * (G-durability) — 이전 형태는 `fsyncSync` 가 한 번도 없어 write→close→rename 만 했다.
 *
 * ★ 이 두 fsync 가 없으면 왜 위험한가(POSIX `rename(2)` 요지 · Linux man-pages 프로젝트
 * `rename(2)` NOTES 절의 통설을 정리한 것 — 자구 그대로의 인용은 아니다): `rename()` 자체는 그
 * 시스템이 살아 있는 동안 호출자에게 **원자적 치환처럼 보이는 것**만 보장한다. 새 내용이 실제로
 * 안정적 저장소(디스크)에 있다는 보장은 별개다 — 커널은 write 된 데이터도, rename 이 바꾼 디렉토리
 * 엔트리도 한동안 페이지 캐시에만 두고 지연 기록할 수 있다. 그 사이 크래시(전원 손실·커널 패닉)가
 * 나면 ① 파일 데이터가 일부만 디스크에 있거나(데이터 fsync 로 방지) ② rename 자체가 디스크에
 * 반영되지 않아 옛 파일이 되살아날 수 있다(디렉토리 fsync 로 방지) — 이 두 가지가 이 함수가
 * write-fsync-rename-fsync(dir) 전체를 지키는 이유다.
 *
 * ★ red/green 사이클을 주장하지 않는다(§3.4·§4.6) — 크래시 durability 는 vitest 프로세스 안에서
 * 원리적으로 관측 불가능하다(커널 페이지 캐시가 살아 있는 한 fsync 유무는 같은 프로세스에서
 * 정상으로 보인다). 완료 증거는 이 주석의 코드-표준 대조와 대상 단독·전 스위트 green 뿐이다.
 *
 * ★ 성능 부작용 — `fsync` 는 호출마다 디스크 동기화를 강제해 비용이 있다. 이 함수의 실 호출부는
 * `cache/*.json`·`logs/*` 빌드 산출물(`generator.mjs`)뿐이라 호출 빈도가 낮다(요청마다가 아니라
 * 빌드 1회당 소수 회) — 핫 패스가 아니므로 이 비용을 durability 와 맞바꾼다.
 */
export function writeFileAtomic(finalPath, contents, { retryBudgetMs = 500, retries = 5 } = {}) {
  const dir = path.dirname(finalPath)
  fs.mkdirSync(dir, { recursive: true })
  const tmp = path.join(
    dir,
    `.tmp-${path.basename(finalPath)}-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  )

  let fd
  try {
    fd = fs.openSync(tmp, 'wx')
    fs.writeFileSync(fd, contents)
    fs.fsyncSync(fd)
    fs.closeSync(fd)
    fd = undefined
    renameWithRetry(tmp, finalPath, { retryBudgetMs, retries })
    fsyncDirSync(dir)
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd)
      } catch {
        // Best-effort cleanup after a failing write path.
      }
    }
    try {
      fs.rmSync(tmp, { force: true })
    } catch {
      // Best-effort cleanup; the original write/rename error is more useful.
    }
  }
}

/** rename 이 바꾼 디렉토리 엔트리 자체를 fsync 한다 — 파일 fsync 만으로는 그 변경이 진다(위 참조). */
function fsyncDirSync(dir) {
  const dirFd = fs.openSync(dir, 'r')
  try {
    fs.fsyncSync(dirFd)
  } finally {
    fs.closeSync(dirFd)
  }
}

function renameWithRetry(tmp, finalPath, { retryBudgetMs, retries }) {
  const start = Date.now()
  let attempt = 0
  for (;;) {
    try {
      fs.renameSync(tmp, finalPath)
      return
    } catch (error) {
      const action = classifyFsError(error?.code)
      if (action === 'fatal' || attempt >= retries || Date.now() - start >= retryBudgetMs) {
        throw error
      }
      sleep(Math.min(25 * 2 ** attempt, Math.max(1, retryBudgetMs - (Date.now() - start))))
      attempt += 1
    }
  }
}

/**
 * 동기 대기 — **busy-wait 가 아니라** `Atomics.wait` 로 커널에 넘긴다(F-19).
 *
 * CPU 를 태우지 않고 재시도 사이를 재운다. `Atomics.wait` 는 내장(node:lang 수준)이라 "의존성 0
 * 유지" 원칙을 어기지 않는다 — 아무도 `Atomics.notify` 를 부르지 않으므로 항상 `ms` 만큼 기다린 뒤
 * `'timed-out'` 으로 돌아온다(그 반환값은 쓰지 않는다 — 대기 자체가 목적이다).
 */
function sleep(ms) {
  // `NaN` 을 걸러야 한다 — `Atomics.wait(…, NaN)` 은 스펙상 즉시 timeout 이 아니라 **무한 대기**다
  //   (실측: 5초 강제종료까지 반환 없음). 지금은 산술상 NaN 이 될 호출부가 없지만, 예산·재시도 수가
  //   나중에 CLI 플래그로 열리면 그 순간 조용한 프로세스 hang 이 된다.
  if (!(ms > 0)) return
  const view = new Int32Array(new SharedArrayBuffer(4))
  Atomics.wait(view, 0, 0, ms)
}
