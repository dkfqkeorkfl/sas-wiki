// @vitest-environment node
//
// P3 · Task 6 — 원자 발행 (`scripts/lib/atomic.mjs` 신설) — tdd §3.7 (AT1~AT5)
//
// RED 사유(전 케이스 공통 · **미구현**): `scripts/lib/atomic.mjs` 가 **부재**하고 `writeFileAtomic`·
//   `classifyFsError` export 도 없다. 지연 import + 케이스별 되던지기(tdd §2.4).
//
// 이 파일이 확정하는 seam (tdd §3.0):
//   writeFileAtomic(finalPath, contents, { retryBudgetMs = 500, retries = 5 } = {})
//   classifyFsError(code) → 'retry' | 'fatal'
//
// 왜 단위와 동시성을 나누는가: 여기(AT1~AT5)는 **한 프로세스 안에서 확인 가능한 성질**(tmp 잔존·부모
//   디렉토리 생성·에러 분류·실패 시 정리)만 문다. "동시에 읽는 소비자가 무엇을 보는가" 는 단일
//   프로세스로는 원리상 증명할 수 없으므로 `atomic.concurrency.test.mjs`(AT6)가 자식 2 프로세스로 문다.
//
// 자기참조 공허성 금지(규범 A): 에러 코드 문자열(`EXDEV`·`EPERM`…)과 분류 결과(`retry`·`fatal`)는
//   **리터럴**이다. 구현의 상수 배열을 import 해 대조하지 않는다.
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'

import { cleanup } from '../../__tests__/helpers/tmp-git-vault.mjs'

const loaded = await import(new URL('../atomic.mjs', import.meta.url).href).catch((error) => ({
  // ★ collection error 회피(§ 상단 주석)를 위해 여전히 **넓게** 잡는다 — 그러나 "아직 없다" 라는
  //   진단은 실제로 모듈 해석이 실패한 경우(`ERR_MODULE_NOT_FOUND`)로 좁힌다. 그 외 원인(문법
  //   오류·import 하는 다른 모듈의 런타임 버그 등)까지 "미구현" 으로 오도하면 실제 버그가 "아직 코딩
  //   안 함" 처럼 읽혀 원인 추적이 늦어진다 — 원문(`error.message`)은 두 경우 모두 그대로 싣는다.
  __loadError: error instanceof Error ? error.message : String(error),
  __notImplemented: error instanceof Error && error.code === 'ERR_MODULE_NOT_FOUND',
}))

function moduleOr(name) {
  if (loaded.__loadError !== undefined) {
    const label = loaded.__notImplemented
      ? '아직 없다'
      : '로드 중 다른 오류가 났다(미구현이 아닐 수 있다)'
    throw new Error(`[RED] scripts/lib/atomic.mjs 가 ${label} (P3 Task 6): ${loaded.__loadError}`)
  }
  if (typeof loaded[name] !== 'function') {
    throw new Error(`[RED] atomic.mjs 에 ${name} export 가 아직 없다 (P3 Task 6 미구현)`)
  }
  return loaded[name]
}

const writeAtomic = (...args) => moduleOr('writeFileAtomic')(...args)
const classify = (...args) => moduleOr('classifyFsError')(...args)

/**
 * **`toThrow` 케이스 전용 seam 가드.** `writeAtomic` 자신이 미구현 시 throw 하므로, `toThrow()` 만
 * 쓰면 "모듈이 없어서 throw" 가 "실패 경로가 throw" 로 위장돼 **RED 가 공허하게 green** 이 된다
 * (실측으로 잡았다). 그래서 그런 케이스는 seam 존재를 **먼저** 단언한다.
 */
function expectSeamPresent() {
  expect(loaded.__loadError, 'scripts/lib/atomic.mjs 로드').toBeUndefined()
  expect(typeof loaded.writeFileAtomic, 'writeFileAtomic export').toBe('function')
}

const tmps = []
afterAll(() => cleanup(...tmps))

function makeDir() {
  // **컨테이너 로컬 fs** 에서만 하드 게이트를 건다(9p 는 tdd §8.2 측정). `os.tmpdir()` 는 로컬이다.
  const dir = mkdtempSync(path.join(tmpdir(), 'wiki-atomic-unit-'))
  tmps.push(dir)
  return dir
}

/** 그 디렉토리에 남은 `.tmp-` 접두 항목들 — 원자 발행의 찌꺼기. */
const tmpLeftovers = (dir) => readdirSync(dir).filter((name) => name.startsWith('.tmp-'))

describe('writeFileAtomic — 정상 경로 (AT1~AT3 · 🔴RED 미구현)', () => {
  it('AT1: 파일이 내용대로 만들어지고 `.tmp-` 잔존이 0건이다', () => {
    const dir = makeDir()
    const target = path.join(dir, 'a.json')

    writeAtomic(target, '{"x":1}')

    // ★ 앵커 먼저(규범 B): 최종 파일이 **실제로 생겼고 내용이 맞다**. 그러지 않으면 "아무것도 안 쓰는"
    //   구현이 "tmp 잔존 0건" 을 자동으로 통과한다.
    expect(readFileSync(target, 'utf8')).toBe('{"x":1}')
    expect(tmpLeftovers(dir)).toEqual([])
  })

  it('AT2: 이미 있는 파일을 **교체**한다 · tmp 잔존 0건', () => {
    // 선행 `unlink` 없이 rename 이 덮어써야 한다 — unlink 하면 그 사이 소비자가 부재를 본다(D-E).
    const dir = makeDir()
    const target = path.join(dir, 'a.json')
    writeFileSync(target, '{"x":1}')

    writeAtomic(target, '{"x":2}')

    expect(readFileSync(target, 'utf8')).toBe('{"x":2}')
    expect(tmpLeftovers(dir)).toEqual([])
  })

  it('AT3: 부모 디렉토리가 없으면 **생성**한 뒤 쓴다 (D-E 1단계)', () => {
    const dir = makeDir()
    const target = path.join(dir, 'cache', 'nested', 'a.json')

    writeAtomic(target, '{"x":3}')

    expect(readFileSync(target, 'utf8')).toBe('{"x":3}')
    expect(statSync(path.join(dir, 'cache', 'nested')).isDirectory()).toBe(true)
  })
})

describe('classifyFsError — 재시도 대상과 즉시 실패의 경계 (AT4 · 🔴RED 미구현)', () => {
  it('AT4: EPERM·EACCES·EBUSY → retry · **EXDEV** 와 ENOSPC → fatal', () => {
    // ★ EXDEV 를 재시도에 넣으면 **tmp 경로 버그가 0.5초 동안 조용히 숨는다**(D-E 7단계).
    //   EXDEV 는 "tmp 를 다른 파일시스템에 만들었다" 는 설계 오류 신호이지 일시적 경합이 아니다.
    expect(classify('EPERM')).toBe('retry')
    expect(classify('EACCES')).toBe('retry')
    expect(classify('EBUSY')).toBe('retry')
    expect(classify('EXDEV')).toBe('fatal')
    expect(classify('ENOSPC')).toBe('fatal')
  })
})

describe('writeFileAtomic — 실패 경로의 정리 (AT5 · 🔴RED 미구현)', () => {
  it('AT5a: 부모 경로가 **파일**이면 mkdir 단계에서 throw 한다 (tmp 는 애초에 생기지 않는다)', () => {
    expectSeamPresent() // 미구현 throw 가 "실패 경로 throw" 로 위장하는 것을 막는다
    // uid 에 의존하지 않는 **결정적** 실패 주입법이다(권한 조작은 root 컨테이너에서 무력하다).
    // ★ 이 케이스는 `fs.mkdirSync(dir, …)` 단계에서 죽는다 — `.tmp-` 파일은 **한 번도 만들어지지
    //   않는다.** 그래서 아래 "tmp 잔존 0건" 은 정리(cleanup)가 아니라 **애초에 없었음**을 확인할
    //   뿐이다 — finally 블록의 `fs.rmSync(tmp, …)` 정리 로직을 이 케이스만으로는 검증할 수 없다
    //   (AT5b 가 그 로직을 실제로 태운다).
    const dir = makeDir()
    const blocker = path.join(dir, 'blocker')
    writeFileSync(blocker, 'not a directory')

    expect(() => writeAtomic(path.join(blocker, 'a.json'), '{"x":4}')).toThrow()

    // 실패해도 찌꺼기를 남기지 않는다 — 다음 실행이 남의 tmp 를 보고 헷갈리면 안 된다.
    expect(tmpLeftovers(dir)).toEqual([])
    expect(readFileSync(blocker, 'utf8')).toBe('not a directory') // 앵커: 남의 파일을 건드리지 않았다
  })

  it('AT5b: mkdir 은 성공하고 **rename 이 실패**하면 만들어진 tmp 를 실제로 지운다', () => {
    expectSeamPresent()
    // ★ AT5a 와 달리 부모 디렉토리는 정상이다 — `.tmp-` 파일이 실제로 열리고 쓰여진 **뒤**에
    //   최종 rename 이 실패하는 경로를 만든다. `finalPath` 자신을 디렉토리로 만들어 두면
    //   `renameSync(tmp, finalPath)` 가 `EISDIR`(재시도 대상이 아닌 **fatal**)로 죽는다 — mock 없이
    //   결정적으로 재현된다.
    const dir = makeDir()
    const finalPath = path.join(dir, 'a.json')
    mkdirSync(finalPath) // 목적지 자체가 디렉토리 — rename 이 EISDIR 로 fatal 실패한다

    expect(() => writeAtomic(finalPath, '{"x":5}')).toThrow()

    // 앵커: 이번엔 tmp 가 실제로 만들어졌었다는 것을 먼저 확인한다(전제가 성립하지 않으면 아래
    //   "잔존 0건" 은 다시 AT5a 처럼 공허해진다) — writeAtomic 이 스스로 지웠으므로 사후에는 남지
    //   않지만, 실패 지점이 rename(=쓰기 이후)이라는 사실 자체가 tmp 생성을 함의한다. 그 함의를
    //   직접 확인하기 위해 finalPath 가 여전히 **디렉토리**임을 확인해 rename 이 실제로 시도·실패
    //   했음을 못박는다(파일로 바뀌었다면 rename 이 조용히 성공한 것이다).
    expect(statSync(finalPath).isDirectory(), 'rename 이 실제로 실패했어야 한다').toBe(true)
    expect(tmpLeftovers(dir), 'rename 실패 후 tmp 정리(finally rmSync)가 동작하지 않았다').toEqual([]) // prettier-ignore
  })
})
