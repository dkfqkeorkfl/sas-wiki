import fs from 'node:fs'
import path from 'node:path'

export function classifyFsError(code) {
  const retryable = new Set(['EPERM', 'EACCES', 'EBUSY'])
  return retryable.has(code) ? 'retry' : 'fatal'
}

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
    fs.closeSync(fd)
    fd = undefined
    renameWithRetry(tmp, finalPath, { retryBudgetMs, retries })
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
