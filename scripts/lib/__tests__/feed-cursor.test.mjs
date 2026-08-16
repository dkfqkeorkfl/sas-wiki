// @vitest-environment node
//
// v3 P2 · Task 4·5 — 커서 3단 검증 + 커서 기반 배치 워크 — tdd §3.1(CR1~CR6) · §3.2(WA1~WA3·WA9·WA11)
//
// ── 이 파일이 확정하는 seam (GREEN 이 C3 에서 신설한다) ──────────────────────────────────────
//   `scripts/lib/feed-cursor.mjs`
//     export function isCursorFormat(value): boolean
//         D10 ① — `/^[0-9a-f]{12}$/`. **git 을 부르기 전에** 판정한다(그래서 boolean 이다).
//     export function resolveCursorCommit(cursor, { runGit }): string | null
//         D10 ②③ + D11 — `git rev-parse --verify --quiet --end-of-options "<hash>^{commit}"` 를
//         주입 러너로 부르고, stdout 이 입력으로 `startsWith` 할 때만 **전체 객체명**을 돌려준다.
//         거부는 **`null`** 이다(throw 아님 — 세 단계가 같은 거부 경로를 공유해야 CR4 가 성립한다).
//         `cursor === undefined` 는 거부가 아니라 **`HEAD` 해석**이다(N4 · `prd.md:498`).
//
// ★ **워크 함수의 이름은 고정하지 않는다.** tdd §3.1 CR1 은 _"검증 함수·워크 함수가 함수다"_ 라
//   적었지만, 워크는 **git 이 실제로 받은 argv**(프로세스층)로 관측하는 편이 강하고 GREEN 의 내부
//   분해에 결속하지 않는다 — 규범 A 의 취지(구현에서 기대를 유도하지 않는다)에 더 맞는다. 그래서
//   WA1~WA3·WA9 는 `helpers/runtime-load.mjs`(PATH shim)로 **argv 를 직접** 센다. 이 이탈은
//   위임 패키지에 사유와 함께 기록돼 있다.
//
// ── RED 사유 ────────────────────────────────────────────────────────────────────────────────
//   · CR1~CR6 — 🔴RED. `scripts/lib/feed-cursor.mjs` 가 **아직 없다**(C3 이 만든다).
//   · WA1~WA3·WA9 — 🔴RED. 조회 경로가 아티팩트를 읽을 뿐 **git 을 한 번도 부르지 않는다**
//     (`feeds.mjs:31-54` · PU4 가 그 사실을 계약으로 갖고 있다). `rev-list` 배치가 0회다.
//   · WA11 — 🔴RED. 같은 이유로 **git spawn 자체가 없어** 타임아웃(D23)이 발동할 자리가 없다.
//
// 규범 A: 커서 리터럴·거부 입력 9종·오버샘플 하한/배수는 **전부 본문 리터럴**이다. 프로덕션 상수를
//   import 하면 구현이 어떤 배수를 쓰든 통과한다(CX6 이 그 자기참조를 검출한다).
// 규범 B: 부재 단언(`--` 가 없다 · `--author-date-order` 가 없다) 앞에 **실재 축**을 짝으로 둔다.
// 규범 C10: 신설 seam 은 `await import` 로 붙든다 — collection error 는 `rtk` 가 PASS 로 오보고한다.
// 규범 E: 벽시계를 게이트로 걸지 않는다. WA11 은 타임아웃 **값**이 아니라 **동작**을 문다.
// 규범 F: 실 vault 를 건드리지 않는다 — 전부 tmp git vault 다.
import { existsSync } from 'node:fs'
import path from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'

import { cleanup } from '../../__tests__/helpers/tmp-git-vault.mjs'
import { runCliWithLoadLog } from '../../__tests__/helpers/runtime-load.mjs'
import {
  initTinyRepo,
  makeRealGitRunner,
  makeSlowGitShim,
  runFeedsCli,
  seedFeedVault,
} from '../../__tests__/helpers/cursor-vault.mjs'

// ── 계약 리터럴 (규범 A) ─────────────────────────────────────────────────────────────────────
/** 정상 커서 — 12-hex 소문자. */
const GOOD_CURSOR = '65fc53636938'
/** 형식 검증이 **거부**해야 하는 9종. 본문에 그대로 보인다(DAMP). */
const BAD_CURSORS = [
  'main',
  'HEAD~1',
  '--all',
  '--output=/tmp/x',
  '65FC53636938',
  '65fc5363693',
  '65fc536369388',
  '',
  '  ',
]

const tmps = []
afterAll(() => cleanup(...tmps))

const cursorModule = await import(new URL('../feed-cursor.mjs', import.meta.url).href).then(
  (module) => module,
  (error) => ({ __loadError: error instanceof Error ? error.message : String(error) }),
)

/** 규범 C10 — seam 부재를 **케이스 실패**로 만든다(파일 통째 collection error 금지). */
function seam() {
  expect(
    cursorModule.__loadError,
    'scripts/lib/feed-cursor.mjs 로드 (C3 신설 대상)',
  ).toBeUndefined()
  expect(typeof cursorModule.isCursorFormat, 'isCursorFormat export').toBe('function')
  expect(typeof cursorModule.resolveCursorCommit, 'resolveCursorCommit export').toBe('function')
  return cursorModule
}

/** argv 를 기록하면서 지정한 stdout 을 돌려주는 러너(주입 seam). 판정하지 않는다. */
function recordingRunner(stdout = `${GOOD_CURSOR}${'0'.repeat(28)}`) {
  const calls = []
  const run = (args) => {
    calls.push([...args])
    return stdout
  }
  run.calls = calls
  return run
}

/** `execFileSync` 처럼 **비0 종료를 throw** 로 표현하는 실패 러너. `status` 를 실어 층을 가른다. */
function failingRunner(status) {
  return () => {
    const error = new Error(`Command failed with exit code ${status}`)
    error.status = status
    throw error
  }
}

// ────────────────────────────────────────────────────────────────────────────
// CR — 커서 계약 + 3단 검증 (tdd §3.1)
// ────────────────────────────────────────────────────────────────────────────

describe('커서 3단 검증 (CR1~CR6 · 🔴RED 모듈 부재)', () => {
  it('CR1: `lib/feed-cursor.mjs` 가 resolve 하고 검증 함수가 **함수**다', async () => {
    // 앵커: 같은 방식으로 `git-walk.mjs` 는 **resolve 한다** — 동적 import 자체가 죽은 것을 배제한다
    //   (경로 오타·러너 설정 문제로 red 가 나는 것과 "모듈이 없다" 를 가른다).
    const anchor = await import(new URL('../git-walk.mjs', import.meta.url).href)
    expect(typeof anchor.collectFeedItems, 'git-walk.mjs 앵커').toBe('function')

    seam()
  })

  it('CR2: 형식 검증이 9종을 거부하고 정상 12-hex 는 통과시킨다 (pair)', () => {
    const { isCursorFormat } = seam()

    // ★ pair 앵커가 **먼저**다 — "전부 거부" 하는 구현이면 이 줄에서 죽는다.
    expect(isCursorFormat(GOOD_CURSOR), GOOD_CURSOR).toBe(true)

    for (const bad of BAD_CURSORS) {
      expect(isCursorFormat(bad), `거부 대상: ${JSON.stringify(bad)}`).toBe(false)
    }
  })

  it('CR2b: 형식 거부는 실제로 git 호출을 **차단**한다 (isCursorFormat 을 부르는 게 아니라 지키는지)', () => {
    // ★ CR2 는 `isCursorFormat` 을 고립시켜 부른다 — `resolveCursorCommit` 이 그 반환값을 실제로
    //   **소비**해 git 호출 앞에서 멈추는지는 CR2 로는 결코 관측되지 않는다(호출 자체가 없으므로).
    //   그래서 resolveCursorCommit(불량 커서, …) 를 직접 불러 러너가 **한 번도 안 불렸는지** 를 문다.
    const { resolveCursorCommit } = seam()
    const runner = recordingRunner()

    for (const bad of BAD_CURSORS) {
      const result = resolveCursorCommit(bad, { runGit: runner })
      expect(result, `거부 대상이 통과했다: ${JSON.stringify(bad)}`).toBeNull()
    }

    expect(runner.calls, `형식 거부 대상인데 git 이 불렸다: ${JSON.stringify(runner.calls)}`).toEqual([]) // prettier-ignore
  })

  it('CR3: `after` 미지정은 거부가 아니라 **HEAD 해석**이다 (N4)', () => {
    const { resolveCursorCommit } = seam()
    const tiny = initTinyRepo()
    tmps.push(tiny.repo)

    const resolved = resolveCursorCommit(undefined, { runGit: makeRealGitRunner(tiny.repo) })

    // 앵커: 그 해석 결과가 실제 `git rev-parse HEAD` 와 같다(무엇이든 돌려주는 구현 배제).
    expect(tiny.second, 'tmp 리포 HEAD 앵커').toMatch(/^[0-9a-f]{40}$/u)
    expect(resolved).toBe(tiny.second)
  })

  it('CR4: ② 단계는 **exit 0/비0 으로만** 판정한다 — 1 이든 128 이든 같은 거부 경로', () => {
    // ★ 숫자를 단언하지 않는다(C9 — 문서 보증은 _"non-zero"_ 까지다 · `--quiet` 유무로 1↔128 이 갈린다).
    //   두 arm 이 **같은 결과**를 낸다는 것으로 문다.
    const { resolveCursorCommit } = seam()

    const one = resolveCursorCommit(GOOD_CURSOR, { runGit: failingRunner(1) })
    const oneTwentyEight = resolveCursorCommit(GOOD_CURSOR, { runGit: failingRunner(128) })

    expect(one).toBeNull()
    expect(oneTwentyEight).toBeNull()
    expect(one).toEqual(oneTwentyEight)
  })

  it('CR5: git argv 에서 커서가 `--end-of-options` 뒤에 오고 `--` 는 **없다** (D11)', () => {
    const { resolveCursorCommit } = seam()
    const runner = recordingRunner()

    resolveCursorCommit(GOOD_CURSOR, { runGit: runner })

    expect(runner.calls, 'git 호출이 한 번도 없었다').toHaveLength(1)
    const argv = runner.calls[0]

    // ★ 실재 앵커 — 부재 단언(`--` 0건) 앞에 둔다. 수집기가 죽어 빈 배열인 상태를 배제한다.
    expect(argv).toContain('rev-parse')
    expect(argv).toContain('--verify')
    expect(argv).toContain('--quiet')
    expect(argv).toContain('--end-of-options')

    const endOfOptions = argv.indexOf('--end-of-options')
    const cursorAt = argv.findIndex((token) => token.includes(GOOD_CURSOR))
    expect(cursorAt, `커서가 argv 에 없다: ${JSON.stringify(argv)}`).toBeGreaterThan(-1)
    expect(cursorAt).toBeGreaterThan(endOfOptions)

    // C4·C5: `--` 는 revision/pathspec 구분자다 — 쓰면 exit 0 + 빈 결과("피드 끝" 오진)가 된다.
    expect(argv, `argv 에 '--' 가 있다: ${JSON.stringify(argv)}`).not.toContain('--')
  })

  it('CR6: ③ `startsWith` — 다른 객체명은 거부, 40자든 64자든 접두 일치면 통과', () => {
    // ★ 근거는 "항상 40자" 가 아니라 **"전체 객체명을 낸다"** 다 — SHA-256 저장소는 64자다.
    const { resolveCursorCommit } = seam()

    const fortyMatching = `${GOOD_CURSOR}${'0'.repeat(28)}`
    const sixtyFourMatching = `${GOOD_CURSOR}${'0'.repeat(52)}`
    const shadow = `f${'1'.repeat(39)}`

    // 앵커(pair): 접두가 일치하면 **통과**한다 — "전부 거부" 구현 배제.
    expect(resolveCursorCommit(GOOD_CURSOR, { runGit: recordingRunner(fortyMatching) })).toBe(fortyMatching) // prettier-ignore
    expect(resolveCursorCommit(GOOD_CURSOR, { runGit: recordingRunner(sixtyFourMatching) })).toBe(sixtyFourMatching) // prettier-ignore

    expect(resolveCursorCommit(GOOD_CURSOR, { runGit: recordingRunner(shadow) })).toBeNull()
    // 개행이 붙어 와도 판정이 흔들리지 않는다(git stdout 은 개행으로 끝난다).
    expect(resolveCursorCommit(GOOD_CURSOR, { runGit: recordingRunner(`${fortyMatching}\n`) })).toBe(fortyMatching) // prettier-ignore
  })
})

// ────────────────────────────────────────────────────────────────────────────
// CX — count 방어 (P5 FIX-NOW `feed-cursor.mjs:196` · S-prod · walkCursorPage 모듈 직접 호출)
// ────────────────────────────────────────────────────────────────────────────
//
// ★ `feeds()`(`scripts/feeds.mjs`)는 이미 count 를 검증하지만, 그 검증은 **CLI/모듈 진입점 하나만**
//   지킨다 — `walkCursorPage` 자신은 생성기(`generator.mjs`)를 포함해 여러 호출자가 직접 부르는
//   export 다. 이 describe 는 그 진입점을 우회해 함수를 **직접** 호출한다(CLI 검증이 없다고 가정).
//   feed 생존 판정은 이 축과 무관하므로 `resolveItems` 는 sha 를 그대로 되돌리는 최소 stub 을 쓴다.

/** count 축만 겨냥한 최소 resolveItems — sha 를 feed item 으로 그대로 접는다(생존 판정 무관). */
const echoResolver = (shas) => shas.map((sha) => ({ id: sha.slice(0, 12) }))

describe('walkCursorPage — count 방어 (CX · walkCursorPage 모듈 직접 호출)', () => {
  it('CX1: count:0 을 커밋 있는 vault 에서 직접 주면 TypeError 대신 명확한 오류로 거부한다', () => {
    // ★ 수정 전 재현: maxCount 가 1로 하한되어 배치가 최소 1건을 모으지만, 마지막에
    //   `collected.slice(0, 0)` 로 items 를 비운 뒤 `nextCursorFor` 가 `items.at(-1).id` 에
    //   접근해 TypeError 로 죽는다 — 호출자에게 "count 가 잘못됐다"는 사유를 전혀 말하지 않는다.
    const { vault } = seedFeedVault({ feedCount: 2 })
    tmps.push(vault)
    const { walkCursorPage } = seam()

    expect(() =>
      walkCursorPage(vault, {
        count: 0,
        resolveItems: echoResolver,
        runGit: makeRealGitRunner(vault),
      }),
    ).toThrow(/count/u)
  })

  it('CX2: count 가 1 이상이면 계속 정상 동작한다 (회귀 방지 — 과잉 거부가 아니다)', () => {
    const { vault } = seedFeedVault({ feedCount: 2 })
    tmps.push(vault)
    const { walkCursorPage } = seam()

    const { items, nextCursor } = walkCursorPage(vault, {
      count: 1,
      resolveItems: echoResolver,
      runGit: makeRealGitRunner(vault),
    })

    expect(items.length).toBeGreaterThan(0)
    expect(typeof nextCursor === 'string' || nextCursor === null).toBe(true)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// CY — HEAD 해석 실패 전파 (P5 FIX-NOW `feed-cursor.mjs:306` · D-8 PARTIAL → S-prod)
// ────────────────────────────────────────────────────────────────────────────
//
// ★ 좁힌 대안(plan.md D-8 · tdd §3.5·§4.7) — 감사 원안(신규 fail-closed 기계장치)이 아니라 같은
//   파일의 `revListBatch`(위)가 이미 쓰는 `isEmptyHistory` 패턴을 `revParseCommit` 의 HEAD 해석
//   갈래에도 그대로 복제했다. **`resolveCursorCommit` 의 커서 검증 갈래(CR2b~CR6)는 손대지 않는다**
//   — "비0 종료는 전부 거부" 계약은 그대로다. 좁히는 것은 `after` 가 없어 HEAD 를 구할 때뿐이다.

/** `isEmptyHistory` 매치 여부를 자유로이 고르는 실패 러너 — stderr 로 매치를 통제한다. */
function stderrFailingRunner(stderr) {
  return () => {
    // execFileSync 실측 형태를 흉내낸다 — stderr 가 있으면 message 에도 그대로 실린다
    // ("Command failed: <cmd>\n<stderr>", 위 파일 CY 절 실측).
    const error = new Error(`Command failed: git rev-parse\n${stderr}`)
    error.status = 128
    error.stderr = stderr
    throw error
  }
}

describe('walkCursorPage — HEAD 해석 실패 전파 (CY · walkCursorPage 모듈 직접 호출)', () => {
  it('CY1: 빈 저장소가 아닌 실패(권한 등)로 HEAD 해석이 죽으면 조용한 빈 페이지로 접지 않고 전파한다', () => {
    // ★ 수정 전 재현: revParseCommit 의 blanket catch 가 이 실패도 null 로 접어, walkCursorPage 가
    //   after 미지정 경로("커밋 0건 vault" 로 간주)를 타 조용히 { items: [], nextCursor: null } 을
    //   낸다 — 권한 오류가 "정상적으로 비어 있는 저장소" 로 오번역된다.
    const runGit = stderrFailingRunner("fatal: unable to access '.git': Permission denied")
    const { walkCursorPage } = seam()

    expect(() => walkCursorPage('/hermetic/무관', { resolveItems: echoResolver, runGit })).toThrow(
      /Permission denied/u,
    )
  })

  it('CY2: 진짜 빈 저장소(커밋 0건)는 여전히 조용한 빈 페이지다 (회귀 방지 — 과잉 전파가 아니다)', () => {
    const runGit = stderrFailingRunner('fatal: your current branch does not have any commits yet')
    const { walkCursorPage } = seam()

    const result = walkCursorPage('/hermetic/무관', { resolveItems: echoResolver, runGit })

    expect(result).toEqual({ items: [], nextCursor: null })
  })
})

// ────────────────────────────────────────────────────────────────────────────
// WA — 커서 기반 배치 워크의 **argv·프로세스 관측** (tdd §3.2)
//   조회 CLI 를 자식으로 띄우고 git 이 실제로 받은 argv 를 센다(runtime-load 의 PATH shim).
// ────────────────────────────────────────────────────────────────────────────

/** git 이 받은 argv 중 **배치 워크**만 — `rev-list` + `--max-count=` 를 함께 가진 호출. */
function batchCalls(gitCalls) {
  return gitCalls.filter(
    (argv) => argv.includes('rev-list') && argv.some((token) => token.startsWith('--max-count=')),
  )
}

/** `--max-count=<n>` 의 n. 없으면 `null`(사실 보고). */
function maxCountOf(argv) {
  const token = argv.find((value) => value.startsWith('--max-count='))
  return token === undefined ? null : Number(token.slice('--max-count='.length))
}

/**
 * WA1~WA3·WA9 공유 — git argv 관측만으로는 "예상한 batch 호출은 났지만 CLI 자체는 exit≠0 이거나
 * stdout 이 깨졌다" 를 놓친다(SILENT_PASS — argv 단언은 exitCode/stdout 을 전혀 보지 않는다).
 * git 호출 **이후**에 CLI 가 실제로 건강하게 끝났는지를 짝으로 확인한다.
 */
function expectHealthyCliRun(run) {
  expect(run.exitCode, `CLI 가 비정상 종료했다(exit=${run.exitCode})\n${run.stderr}`).toBe(0)
  expect(
    () => JSON.parse(run.stdout),
    `stdout 이 유효 JSON 이 아니다: ${String(run.stdout).slice(0, 200)}`,
  ).not.toThrow()
}

/** 워크 argv 관측 1회 — tmp vault 를 시딩해 조회 CLI 를 띄운다. */
function observeWalk({ count, feedCount }) {
  const seeded = seedFeedVault({ feedCount })
  tmps.push(seeded.vault)
  const run = runCliWithLoadLog('feeds.mjs', ['--env', 'dev', `--count=${count}`], {
    vault: seeded.vault,
  })
  return { ...run, batches: batchCalls(run.gitCalls), seeded }
}

describe('커서 워크 argv (WA1~WA3·WA9 · 🔴RED 조회 경로가 git 을 안 부른다)', () => {
  it(
    'WA1: 1차 배치가 `rev-list`·`--max-count=`·`--skip=1`·`--end-of-options`·커서를 이 순서로 담는다',
    { timeout: 300_000 },
    () => {
      // prettier-ignore
      const seeded = seedFeedVault({ feedCount: 4 })
      tmps.push(seeded.vault)
      const cursor = seeded.feedIds[0]

      const run = runCliWithLoadLog(
        'feeds.mjs',
        ['--env', 'dev', '--count=2', `--after=${cursor}`],
        {
          vault: seeded.vault,
        },
      )
      const batches = batchCalls(run.gitCalls)

      // ★ 실재 앵커 — 부재 단언(`--author-date-order` 0건) 앞에 둔다.
      expect(run.gitCalls.length, `git 호출이 0건이다 (exit=${run.exitCode})\n${run.stderr}`).toBeGreaterThan(0) // prettier-ignore
      expect(batches.length, `배치 워크(rev-list + --max-count=)가 0건이다\n${run.stderr}`).toBeGreaterThan(0) // prettier-ignore

      const argv = batches[0]
      expect(argv).toContain('--skip=1')
      expect(argv).toContain('--end-of-options')

      const endOfOptions = argv.indexOf('--end-of-options')
      const revAt = argv.findIndex((token) => token.includes(cursor))
      expect(revAt, `커서가 배치 argv 에 없다: ${JSON.stringify(argv)}`).toBeGreaterThan(-1)
      expect(revAt).toBeGreaterThan(endOfOptions)
      const maxCountAt = argv.findIndex((token) => token.startsWith('--max-count='))
      expect(maxCountAt).toBeGreaterThan(-1)
      expect(maxCountAt, '옵션은 `--end-of-options` **앞**에 와야 한다').toBeLessThan(endOfOptions)

      // ★ 정렬 권위 이전이 계약이다(D39 · OQ-P2-2 (a)) — D12 형태에 정렬 플래그가 없다.
      //   선형에서는 무영향이지만 **병합 토폴로지에서는 페이지 집합 자체가 달라진다**(tdd §2.5-①).
      expect(argv, `배치 argv 에 --author-date-order 가 있다: ${JSON.stringify(argv)}`).not.toContain('--author-date-order') // prettier-ignore

      expectHealthyCliRun(run)
    },
  )

  it(
    'WA2: 1차 `--max-count` 이 count 의 2~3배 · 채워지지 않으면 2차가 ×4 다 (D23)',
    { timeout: 300_000 },
    () => {
      // prettier-ignore
      // ★ 배수를 상수 import 로 만들지 않는다 — **리터럴 count 두 값**에 대해 비례를 관측한다.
      //   상수를 import 하면 CX6(배수를 1 로 되돌리는 변이)이 red 를 못 낸다(규범 A 자기참조 검출).
      const small = observeWalk({ count: 2, feedCount: 3 })
      expect(small.batches.length, `배치 0건 (exit=${small.exitCode})\n${small.stderr}`).toBeGreaterThan(0) // prettier-ignore
      expect(maxCountOf(small.batches[0])).toBeGreaterThanOrEqual(4)
      expect(maxCountOf(small.batches[0])).toBeLessThanOrEqual(6)
      expectHealthyCliRun(small)

      const large = observeWalk({ count: 5, feedCount: 3 })
      expect(large.batches.length, `배치 0건 (exit=${large.exitCode})\n${large.stderr}`).toBeGreaterThan(0) // prettier-ignore
      expect(maxCountOf(large.batches[0])).toBeGreaterThanOrEqual(10)
      expect(maxCountOf(large.batches[0])).toBeLessThanOrEqual(15)

      // 채워지지 않는 구간(피드 3건 < count 5)이므로 2차 배치가 실재하고 그것이 ×4 다.
      expect(large.batches.length, '2차 배치가 없다 — 채워지지 않았는데 한 번만 훑었다').toBeGreaterThanOrEqual(2) // prettier-ignore
      expect(maxCountOf(large.batches[1])).toBe(20)
      expectHealthyCliRun(large)
    },
  )

  it(
    'WA3: 배치는 **최대 2회**다 — 채워지지 않아도 3회째가 없다 (D23)',
    { timeout: 300_000 },
    () => {
      const observed = observeWalk({ count: 5, feedCount: 3 })

      // 앵커: 0회·1회로 통과하는 것을 배제한다 — **정확히 2회**를 문다.
      expect(observed.batches.length, `배치 횟수 (exit=${observed.exitCode})\n${observed.stderr}`).toBe(2) // prettier-ignore
      expectHealthyCliRun(observed)
    },
  )

  it('WA9: git 에 넘어간 `--max-count` 이 **항상 ≥ 1** 이다 (M8)', { timeout: 300_000 }, () => {
    // ★ `--max-count=0` 은 exit 0 + 0줄이라 D13(stdout 줄 수) 판정에서 **「히스토리 끝」과 구분
    //   불가**하다(tdd §2.5-① 실측). CLI 층 검증(CQ2)만으로는 **내부 계산 경로**가 0 을 만드는 변이를
    //   못 잡는다 — 하한 **1** 은 리터럴이다.
    const observed = observeWalk({ count: 1, feedCount: 3 })

    expect(observed.batches.length, `배치 0건 (exit=${observed.exitCode})\n${observed.stderr}`).toBeGreaterThan(0) // prettier-ignore
    for (const argv of observed.batches) {
      expect(maxCountOf(argv), JSON.stringify(argv)).toBeGreaterThanOrEqual(1)
    }
    expectHealthyCliRun(observed)
  })
})

describe('spawn 타임아웃 (WA11 · 🔴RED git spawn 자체가 없다)', () => {
  it(
    'WA11: 느린 git 에서 워크가 **스스로** 유한 시간에 실패하고 stdout 을 흘리지 않는다',
    { timeout: 180_000 },
    () => {
      // prettier-ignore
      // ★ 규범 E — 벽시계를 게이트로 걸지 않는다. 재는 것은 "몇 초냐" 가 아니라 **누가 끝냈느냐**다:
      //   자식이 스스로 끝나면 `error === undefined`, 하네스가 죽여야 했으면 `error.code==='ETIMEDOUT'`.
      //   D23 값은 `SCRIPT_TIMEOUT_MS`(30초) 미만이어야 하므로(§8-②) 하네스 상한 35초면 충분하다.
      const seeded = seedFeedVault({ feedCount: 3 })
      tmps.push(seeded.vault)
      // ★ 캐시를 미리 굽는 이유는 **오늘의 baseline 을 살려 두기 위해서다** — 없으면 slow arm 이
      //   "아티팩트가 없어 exit 1" 로 **공허하게 통과**한다. C4 이후 조회는 아티팩트를 읽지 않으므로
      //   이 Arrange 는 무해한 잔재가 된다(그 계약은 아래 `WA11-전제` 가 따로 문다).
      const prebuild = runFeedsCli(seeded.vault, { count: 200, out: 'cache/feeds.dev.json' })
      expect(prebuild.status, `Arrange 실패: ${prebuild.stderr}`).toBe(0)

      // 앵커: 정상 git 에서는 exit 0 + 파싱 가능 JSON 이다(환경이 통째로 죽은 것을 배제).
      const healthy = runFeedsCli(seeded.vault, { count: 2 })
      expect(healthy.status, healthy.stderr).toBe(0)
      expect(() => JSON.parse(healthy.stdout)).not.toThrow()

      const slow = makeSlowGitShim(45)
      tmps.push(slow.root)
      const result = runFeedsCli(seeded.vault, {
        count: 2,
        spawnEnv: slow.env(),
        timeoutMs: 35_000,
      })

      expect(result.error?.code, '하네스가 죽여야 했다 = 스크립트에 spawn 타임아웃이 없다').toBeUndefined() // prettier-ignore
      expect(result.status, '느린 git 에서 exit 0 이 났다').not.toBe(0)
      expect(result.stdout, '타임아웃인데 페이지를 흘렸다').toBe('')
      // ★ "exit≠0" 만 물으면 **다른 사유**의 비정상 종료(임의 크래시·검증 실패 등)도 통과한다 —
      //   D23 의 실제 타임아웃 시그니처를 물어야 한다. `execFileSync` 가 `timeout` 으로 죽으면 그
      //   Error 의 `.message` 가 `ETIMEDOUT` 을 담고(node:child_process 실측), `checkGitAvailable`
      //   등 이 리포의 러너 래퍼들도 원문 메시지를 이어붙여 던지므로 stderr 에 그대로 남는다.
      expect(result.stderr, `타임아웃 시그니처가 없다: ${result.stderr}`).toMatch(/ETIMEDOUT/u)
    },
  )

  it(
    'WA11-전제: 조회는 아티팩트 파일 **없이도** exit 0 이다 (라이브 워크 계약)',
    { timeout: 300_000 },
    () => {
      // prettier-ignore
      // 해석 A 의 귀결 — 조회 경로가 아티팩트 읽기에서 커서 워크로 **교체**된다. 이 계약이 서면 위
      //   WA11 의 prebuild Arrange 는 잔재가 되고, 서지 않으면 WA11 이 공허하게 통과할 수 있다.
      const seeded = seedFeedVault({ feedCount: 3 })
      tmps.push(seeded.vault)

      expect(existsSync(path.join(seeded.vault, 'cache', 'feeds.dev.json')), '전제: 캐시가 없다').toBe(false) // prettier-ignore
      const result = runFeedsCli(seeded.vault, { count: 2 })

      expect(result.status, result.stderr).toBe(0)
      expect(JSON.parse(result.stdout).items.length).toBeGreaterThan(0)
    },
  )
})
