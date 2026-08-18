// @vitest-environment node
//
// v3 P2 · Task 2·4 — 옵션 주입 차단(CR7~CR9) + `--count` 계약(CQ1~CQ6) — tdd §3.1·§3.3
//
// 관측 층은 **프로세스**다: exit code · stdout · **stderr 어휘** · 파일 부재. 규범 P 가 지배한다 —
//   이 phase 이후 `feeds.mjs` 는 **세 사유로** 비정상 종료하고 그중 둘이 exit 2 를 공유하므로,
//   종료 코드만 단언하는 케이스는 **엉뚱한 사유로 green** 이 된다. 모든 종료 단언에 어휘 축을 붙인다.
//
// ── ★ 인자 형태가 층을 가른다 (tdd §2.5-③ 실측 · 이 phase 최대의 공허 함정) ──────────────────
//   `["--after=--output=/tmp/x"]`  → parseArgs 통과 → **우리 방어(D10 ①)** 에 도달 → 목표 exit 2
//   `["--after","--output=/tmp/x"]`→ `ERR_PARSE_ARGS_INVALID_OPTION_VALUE` 로 **먼저 throw** → exit 1
//   ⇒ 공백 형태는 커서 검증이 **0줄이어도 통과**한다. 두 형태를 **짝**으로 두되 공백 형태에
//     **exit 2 를 요구하지 않는다**. 같은 갈림이 `--count -5`(exit 1) ↔ `--count=-5`(exit 2)에도 있다.
//
// ── RED 사유 ────────────────────────────────────────────────────────────────────────────────
//   · CR7·CR8 — 🔴RED. 오늘 exit≠0 은 나지만 사유가 **`JSON.parse` 실패**다(`feeds.mjs:115`) —
//     stderr 가 커서 어휘를 한 글자도 담지 않는다(실측: _"No number after minus sign in JSON…"_).
//     pair 앵커(정상 12-hex 커서 → exit 0)도 red 다 — 오늘은 12-hex 가 유효 JSON 이 아니다.
//   · CR9 — 🔴RED. `lib/feed-cursor.mjs` 가 없다(C3 신설).
//   · CQ1·CQ2 — 🔴RED. 오늘 누락·`abc`·`0`·`-5`·`1.9`·`5e2`·`" 7"`·`0x10`·`""`·`Infinity` 가
//     **전부 exit 0** 이고 조용히 50건으로 흡수된다(`git-walk.mjs:80`).
//   · CQ3 — 🔴RED. `DEFAULT_FEED_LIMIT` 이 아직 프로덕션에 산다.
//   · CQ4 — 🔴RED(flip). `package.json` 의 `"feeds"` 가 아직 `--count` 를 안 싣는다.
//   · CQ5 — 🔴RED. `--from`/`--to` 가 프로덕션 argv 층에 그대로 있다.
//   · CQ6 — 🔴RED. `--count` 무효가 아무 말도 하지 않으므로 두 사유의 어휘를 가를 수 없다.
//
// 규범 A: 커서·count 입력·기대 exit code 는 **전부 본문 리터럴**이다.
// 규범 B: 부재 단언(파일 미생성 · `--from`/`--to` 0건) 앞에 **위험 실재 앵커**를 짝으로 둔다.
// 규범 F: 실 vault 를 건드리지 않는다 — 태그 생성은 **tmp 리포에서만**(12-hex 태그는 그 리포의 모든
//   축약 해석을 오염시킨다 · tdd §2.5-②).
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { cleanup, initVault, makeOut } from './helpers/tmp-git-vault.mjs'
import { listTracked, scanTracked } from './helpers/tracked-scan.mjs'
import {
  initTinyRepo,
  makeRealGitRunner,
  readFeedPage,
  runFeedsCli,
  seedFeedVault,
} from './helpers/cursor-vault.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SCRIPTS_DIR = path.resolve(HERE, '..')
const REPO_ROOT = path.resolve(SCRIPTS_DIR, '..')

// ── 계약 리터럴 (규범 A) ─────────────────────────────────────────────────────────────────────
/**
 * 커서 사유 축 — stderr 가 이 어휘로 말해야 한다(규범 P).
 *
 * ★★ **맨단어 `after` 를 토큰으로 쓰지 마라.** 첫 판(`/after|cursor|커서/i`)은 오늘의
 *   `JSON.parse` 실패 메시지 _"No number **after** minus sign in JSON…"_ 에 걸려 **CR7 이 공허하게
 *   green** 이었다(실측). 판정 토큰은 **플래그 형태(`--after`)** 이거나 커서 어휘여야 한다 —
 *   plan Task 1 GOTCHA(맨단어 `from`/`to` 금지)와 같은 함정이 사유 축에도 있다.
 * ⇒ **GREEN 계약**: 커서 거부 stderr 는 `--after` 또는 `cursor`/`커서` 를 담는다.
 */
const CURSOR_VOCAB = /--after|cursor|커서/iu
/** count 사유 축 — 위와 **서로 다른 어휘**여야 규범 P 가 성립한다. */
const COUNT_VOCAB = /count/iu
/** env 열거 사유 축 — 현행 `lib/cli-env.mjs` 가 제시하는 두 값. */
const ENV_VOCAB = /dev\|prod|dev\b.*prod/iu
/** 12-hex 커서 정규식 — 리터럴. */
const HEX12 = /^[0-9a-f]{12}$/u

/**
 * `runFeedsCli` 의 `spawnSync` 상한(ms) — 이 파일의 모든 호출에 일괄 적용한다.
 *
 * `runFeedsCli`(`helpers/cursor-vault.mjs`)는 `timeoutMs` 를 받으면 `spawnSync` 의 `timeout` 옵션으로
 * 그대로 넘긴다. 이 값을 안 주면 이 파일의 `it()` 케이스 상한(300초·CQ2 는 600초)이 있어도 자식이
 * 행(hang)하는 것을 못 끊는다 — `spawnSync` 는 완전히 동기라 vitest 의 비동기 타이머로는 끼어들
 * 수 없기 때문이다. 이 파일의 케이스 상한(300_000)과 같은 값을 재사용한다(새 매직넘버를 만들지
 * 않는다) — 개별 spawn 은 실측상 수 초~수십 초라 여유가 크다.
 */
const CLI_TIMEOUT_MS = 300_000

/** `--count` 값 검증 대상 **9종**. plan·PRD 의 4종으로는 부족하다(tdd §2.5-④ `parseInt` 실측). */
const BAD_COUNTS = ['abc', '0', '-5', '1.9', '5e2', ' 7', '0x10', '', 'Infinity']
/** pair 앵커 — 정상값은 통과해야 한다("전부 거부" 구현 배제). */
const GOOD_COUNTS = ['1', '5', '200']

const tmps = []
afterAll(() => cleanup(...tmps))

/** 공용 vault — feed 커밋 4건. 케이스마다 다시 시딩하면 파일 전체가 분 단위로 늘어난다. */
let base
beforeAll(() => {
  base = seedFeedVault({ feedCount: 4 })
  tmps.push(base.vault)
  // ★ 캐시를 미리 굽는다 — **오늘의 baseline 을 살려 두기 위해서다**. 없으면 이 파일의 모든 arm 이
  //   "아티팩트를 읽을 수 없다(exit 1)" 라는 **한 가지 사유**로 red 가 되어, D15·D16·D10 의 구멍이
  //   관측되지 않는다(공허한 red 는 공허한 green 만큼 나쁘다). C4 이후 조회는 이 파일을 읽지 않으므로
  //   이 Arrange 는 무해한 잔재가 된다 — 라이브 워크 계약 자체는 `feed-cursor.test.mjs` WA11-전제가 문다.
  const prebuilt = runFeedsCli(base.vault, { count: 200, out: 'cache/feeds.dev.json', timeoutMs: CLI_TIMEOUT_MS }) // prettier-ignore
  if (prebuilt.status !== 0) {
    throw new Error(`[Arrange] feeds --out 실패 exit=${prebuilt.status}\n${prebuilt.stderr}`)
  }
}, 300_000)

// ────────────────────────────────────────────────────────────────────────────
// CR7~CR9 — 옵션 주입 차단 (tdd §3.9 CJ1·CJ4)
// ────────────────────────────────────────────────────────────────────────────

describe('옵션 주입 차단 (CR7·CR8 · 🔴RED 사유가 커서 검증이 아니다)', () => {
  it(
    'CR7: `--after=--output=<tmp>/pwned` 가 exit≠0 이고 **그 경로에 파일이 없다** (CJ1)',
    { timeout: 300_000 },
    () => {
      // prettier-ignore
      const target = path.join(base.vault, 'pwned')

      // ★★ 위험 실재 앵커 — **먼저 실행한다**. 방어 없이 넘어가면 git 이 그 파일을 **실제로 만든다**.
      //   우리 CLI 로는 "방어 없음" 상태를 재현할 수 없으므로 앵커는 **git 직접 호출**이어야 한다.
      execFileSync('git', ['rev-list', '--max-count=1', `--output=${target}`, 'HEAD'], {
        cwd: base.vault,
        encoding: 'utf8',
        // `'*'`(전 경로 허용) 대신 이 호출이 실제로 향하는 대상(base.vault)으로 좁힌다 —
        //   `helpers/tracked-scan.mjs` 의 `gitEnv(root)` 와 같은 형태(git-config(1): 값은 실재
        //   경로로 정규화되므로 존재하지 않는 경로는 신뢰되지 않는다).
        env: { ...process.env, GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'safe.directory', GIT_CONFIG_VALUE_0: base.vault }, // prettier-ignore
      })
      expect(existsSync(target), '앵커: 방어 없이 넘기면 파일이 실제로 생긴다').toBe(true)
      rmSync(target, { force: true })

      const result = runFeedsCli(base.vault, { after: `--output=${target}`, count: 5, timeoutMs: CLI_TIMEOUT_MS }) // prettier-ignore

      // 숫자를 요구하지 않는다(규범 P·C9 — 문서 보증은 _"non-zero"_ 까지다).
      expect(result.status, `stdout=${result.stdout}`).not.toBe(0)
      // ★ 이 줄이 이 케이스의 존재 이유다.
      expect(existsSync(target), '주입된 `--output=` 이 파일을 만들었다').toBe(false)
      expect(result.stdout).toBe('')
      // ★ 사유 축(규범 P) — 오늘은 `JSON.parse` 실패라 이 어휘가 없다.
      expect(result.stderr, `stderr 가 커서 사유를 말하지 않는다: ${result.stderr}`).toMatch(CURSOR_VOCAB) // prettier-ignore
    },
  )

  it(
    'CR7-짝(pair): **공백 형태**는 `parseArgs` 층에서 죽는다 — 층이 다르다',
    { timeout: 300_000 },
    () => {
      // prettier-ignore
      // ★ 여기서 **exit 2 를 요구하지 않는다**. 이 arm 이 무는 것은 "우리 방어" 가 아니라
      //   "그 형태로는 우리 방어에 도달조차 못 한다" 는 사실이다(tdd §2.5-③). 두 arm 을 한 케이스로
      //   합치면 층이 뭉개지고, PRD `:512` 축자를 그대로 옮긴 케이스가 **방어 0줄에도 통과**한다.
      const target = path.join(base.vault, 'pwned-spaced')
      const result = runFeedsCli(base.vault, {
        count: 5,
        extraArgs: ['--after', `--output=${target}`],
        timeoutMs: CLI_TIMEOUT_MS,
      })

      expect(result.status).not.toBe(0)
      expect(existsSync(target)).toBe(false)
      expect(result.stdout).toBe('')
    },
  )

  it(
    'CR8: `--after=--all` · `--after=main` 이 exit≠0 이고 정상 커서는 exit 0 이다 (pair)',
    { timeout: 300_000 },
    () => {
      // prettier-ignore
      // ★ 앵커 ① (pair): 정상 12-hex 커서는 **exit 0 + 파싱 가능 JSON** 이다 — "전부 거부" 구현 배제.
      //   동시에 이것이 **M3 방어**다: `--` 로 "막았다" 는 구현은 exit 0 + 빈 결과를 내므로 항목 수 0 이
      //   「피드 끝」으로 오인된다. 정상 arm 이 **items 를 실제로 낸다**는 것으로 그 형태를 가른다.
      const healthy = runFeedsCli(base.vault, { after: base.feedIds[0], count: 2, timeoutMs: CLI_TIMEOUT_MS }) // prettier-ignore
      expect(healthy.status, healthy.stderr).toBe(0)
      const page = JSON.parse(healthy.stdout)
      expect(Array.isArray(page.items)).toBe(true)
      expect(page.items.length, '정상 커서인데 0건이다 — 「끝」과 구분되지 않는다').toBeGreaterThan(
        0,
      )

      for (const bad of ['--all', 'main']) {
        const result = runFeedsCli(base.vault, { after: bad, count: 5, timeoutMs: CLI_TIMEOUT_MS })
        expect(result.status, `${bad}: stdout=${result.stdout}`).not.toBe(0)
        expect(result.stdout, bad).toBe('')
        expect(result.stderr, `${bad}: ${result.stderr}`).toMatch(CURSOR_VOCAB)
      }
    },
  )
})

describe('refname 그림자 (CR9 · 🔴RED 모듈 부재 · CJ4)', () => {
  it(
    'CR9: 12-hex 와 **동명의 태그**가 있으면 ③ 이 잡는다 — ①② 는 통과한다',
    { timeout: 300_000 },
    async () => {
      // prettier-ignore
      // ★★ **실 vault 변형 절대 금지.** 12-hex 태그는 그 리포의 모든 축약 해석을 오염시킨다
      //   (실측: `rev-list` 가 _"refname is ambiguous"_ 경고와 함께 **태그 커밋**을 쓴다). tmp 리포에서만.
      const module = await import(new URL('../lib/feed-cursor.mjs', import.meta.url).href).then(
      (loaded) => loaded,
      (error) => ({ __loadError: error instanceof Error ? error.message : String(error) }),
    )
      expect(module.__loadError, 'scripts/lib/feed-cursor.mjs 로드 (C3 신설 대상)').toBeUndefined()
      expect(typeof module.isCursorFormat).toBe('function')
      expect(typeof module.resolveCursorCommit).toBe('function')

      const tiny = initTinyRepo()
      tmps.push(tiny.repo)
      const runGit = makeRealGitRunner(tiny.repo)
      const shadowed = tiny.first.slice(0, 12)

      // ★ 대조 앵커(먼저) — 태그 **없는** 상태에서는 같은 커서가 **통과**한다.
      expect(module.resolveCursorCommit(shadowed, { runGit })).toBe(tiny.first)

      tiny.git(['tag', shadowed, tiny.second])

      // ★ 거부 사유가 ③ 임을 같은 하네스에서 보인다 — 이 세 줄이 없으면 "①이 잡았다" 와 구분되지 않는다.
      expect(module.isCursorFormat(shadowed), '① 정규식은 통과한다').toBe(true)
      expect(tiny.git(['rev-parse', '--verify', '--quiet', '--end-of-options', `${shadowed}^{commit}`])).toBe(tiny.second) // prettier-ignore

      expect(module.resolveCursorCommit(shadowed, { runGit }), '③ startsWith 가 잡아야 한다').toBeNull() // prettier-ignore
    },
  )
})

// ────────────────────────────────────────────────────────────────────────────
// CQ — `--count` 계약 (tdd §3.3 · D15·D16)
// ────────────────────────────────────────────────────────────────────────────

describe('`--count` 필수·값 검증 (CQ1·CQ2 · 🔴RED 오늘 전부 exit 0)', () => {
  it(
    'CQ1: `--count` 미지정이 **exit 2** · stdout 빈 문자열 · stderr 가 count 어휘로 말한다',
    { timeout: 300_000 },
    () => {
      // prettier-ignore
      // 앵커(pair): `--count=5` 는 exit 0 + 파싱 가능 JSON 이다(파서 전체가 죽은 것을 배제).
      const healthy = runFeedsCli(base.vault, { count: 5, timeoutMs: CLI_TIMEOUT_MS })
      expect(healthy.status, healthy.stderr).toBe(0)
      expect(() => JSON.parse(healthy.stdout)).not.toThrow()

      const missing = runFeedsCli(base.vault, { timeoutMs: CLI_TIMEOUT_MS })
      expect(missing.status, `stdout=${missing.stdout}`).toBe(2)
      expect(missing.stdout).toBe('')
      expect(missing.stderr, missing.stderr).toMatch(COUNT_VOCAB)
    },
  )

  it(
    'CQ2: 값 검증 **9종**이 전부 exit 2 이고 `1`·`5`·`200` 은 exit 0 이다 (pair)',
    { timeout: 600_000 },
    () => {
      // prettier-ignore
      // ★ plan·PRD 의 4종(`abc`·`0`·`-5`·누락)으로는 **부족하다** — `Number.parseInt` 실측:
      //     '1.9'→1 · '5e2'→**5**(500 아님) · ' 7'→7 · '0x10'→0 · ''→NaN · 'Infinity'→NaN
      //   `Number.isFinite(n) && n > 0` 만으로는 `1.9`·`5e2`·`' 7'` 이 **조용히 다른 수**로 통과한다.
      //   `String(n) !== raw` 대조가 유일한 방어층이다(`plugin.ts:243` 이 이미 그 형태다).
      // ★ 전부 **등호 결합**이다 — 공백 형태는 값이 `-` 로 시작하는 순간 parseArgs 가 먼저 throw 한다.
      for (const good of GOOD_COUNTS) {
      const result = runFeedsCli(base.vault, { count: good, timeoutMs: CLI_TIMEOUT_MS })
      expect(result.status, `정상값 ${JSON.stringify(good)}: ${result.stderr}`).toBe(0)
    }

      for (const bad of BAD_COUNTS) {
        const result = runFeedsCli(base.vault, { count: bad, timeoutMs: CLI_TIMEOUT_MS })
        expect(result.status, `무효값 ${JSON.stringify(bad)}: stdout=${result.stdout.slice(0, 80)}`).toBe(2) // prettier-ignore
        expect(result.stdout, JSON.stringify(bad)).toBe('')
        expect(result.stderr, `${JSON.stringify(bad)}: ${result.stderr}`).toMatch(COUNT_VOCAB)
      }
    },
  )

  it(
    'CQ2-짝(pair): **공백 형태** `--count -5` 는 parseArgs 층이라 exit 2 가 아니다',
    { timeout: 300_000 },
    () => {
      // prettier-ignore
      // CR7-짝과 같은 층 갈림이다. PRD `:513` 의 _"`-5` 가 exit 2"_ 는 **`--count=-5`** 로 읽어야 참이다.
      const result = runFeedsCli(base.vault, { extraArgs: ['--count', '-5'], timeoutMs: CLI_TIMEOUT_MS }) // prettier-ignore

      expect(result.status).not.toBe(0)
      expect(result.stdout).toBe('')
    },
  )
})

describe('침묵 폴백 소멸 · argv 잔재 0 (CQ3·CQ4·CQ5)', () => {
  /** 프로덕션 스캔 대상 — `scripts/**.mjs` 중 테스트 자산을 뺀 것. */
  function productionSources() {
    const { files } = listTracked(REPO_ROOT)
    return files.filter(
      (rel) => rel.startsWith('scripts/') && rel.endsWith('.mjs') && !rel.includes('__tests__/'),
    )
  }

  /** `feeds.mjs` **소스 텍스트**의 `parseArgs` 옵션 키. 상수를 import 하지 않는다(규범 A). */
  function feedsOptionKeys() {
    const source = readFileSync(path.join(SCRIPTS_DIR, 'feeds.mjs'), 'utf8')
    const block = source.match(/options:\s*\{([\s\S]*?)\n\s*\},/u)
    if (block === null) return []
    // 들여쓰기 폭에 결속하지 않는다 — 원래 정규식은 키 줄이 **정확히 6칸**이어야 매치됐다. 이
    //   리포에는 CI·훅이 없어(legacy-sweep.test.mjs) 포맷 드리프트가 실제 위험이고, 폭이 다른
    //   줄 하나만 스캔에서 조용히 빠져도(예: 재도입된 `from`/`to` 가 다른 폭으로 붙는다) 부재
    //   단언(`not.toContain('from')`)은 "정말 없다"와 "못 봤다"를 구분하지 못한다. `options:{}` 안의
    //   `key: {` 형태만 요구하고 앞의 공백 폭은 묻지 않는다 — `node:util.parseArgs` 의 옵션 스키마는
    //   `{ type, short, multiple, default }` 뿐이라 값 쪽에 중첩 객체가 오지 않으므로 안전하다.
    return [...block[1].matchAll(/([a-z][a-zA-Z]*):\s*\{/gu)].map((match) => match[1]).sort()
  }

  it('CQ3: `DEFAULT_FEED_LIMIT` 이 프로덕션에서 **0건**이다 (침묵 폴백 소멸)', () => {
    const files = productionSources()
    expect(files.length, '스캔 대상이 비었다').toBeGreaterThan(0) // 앵커 ①

    // ★ 앵커 ②: 같은 스캐너가 **살아 있는** 상수는 실제로 관측한다(스캐너 사망 배제).
    const alive = scanTracked({ files, pattern: /SCHEMA_VERSION/u, repoRoot: REPO_ROOT })
    expect(alive.hits.length, 'SCHEMA_VERSION 앵커').toBeGreaterThan(0)

    const dead = scanTracked({ files, pattern: /DEFAULT_FEED_LIMIT/u, repoRoot: REPO_ROOT })
    expect(dead.hits.map((hit) => `${hit.path}:${hit.line}`)).toEqual([])
  })

  it('CQ4: `package.json` 의 `feeds` 스크립트가 `--count` 를 싣는다 (flip)', () => {
    // ★ §4.5-⑤ 인계: `cli-contract.test.mjs:330`·`build.p5-plumbing.test.mjs:166` 이 이 문자열을
    //   **정확 pin** 한다. 이 케이스가 green 이 되는 순간 그 둘이 red 가 되며 그것은 **의도된 부수
    //   효과**다(C4 가 함께 flip 한다). 회귀로 읽지 마라.
    const scripts = JSON.parse(readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')).scripts

    // 앵커: 빌드 두 줄은 이미 `--count 200` 을 싣는다(스크립트 맵 자체가 죽은 것을 배제).
    expect(scripts.build, 'build 앵커').toContain('--count 200')
    expect(scripts['build-dev'], 'build-dev 앵커').toContain('--count 200')

    expect(scripts.feeds, `현행: ${scripts.feeds}`).toContain('--count')
  })

  it('CQ5: 프로덕션 argv 층에 `--from`/`--to` 가 **0건**이다', () => {
    // ★ **맨단어 `from`/`to` 로 세지 않는다**(plan Task 1 GOTCHA — `import … from` 이 걸린다).
    //   옵션 형태와 window 파라미터 접근만 판정 토큰으로 쓴다.
    const files = [...productionSources(), 'package.json']
    expect(files.length).toBeGreaterThan(1) // 앵커 ①

    // ★ 앵커 ②: 같은 스캐너가 `--env`·`--count` 는 **실재**로 관측한다(부재 단언의 실재 축).
    const alive = scanTracked({ files, pattern: /--env|--count/u, repoRoot: REPO_ROOT })
    expect(alive.hits.length, '--env/--count 앵커').toBeGreaterThan(0)

    const dead = scanTracked({
      files,
      pattern: /--from|--to\b|window\.(from|to)\b|params\.(from|to)\b/u,
      repoRoot: REPO_ROOT,
    })
    expect(dead.hits.map((hit) => `${hit.path}:${hit.line} ${hit.text}`.slice(0, 120))).toEqual([])

    // ★ 둘째 축 — **인자 선언 자체**를 본다. 텍스트 스캔은 `from: { type: 'string' }` 같은 선언을
    //   구조적으로 못 본다(맨단어 금지 규칙의 대가). `parseArgs` 옵션 키는 소스 구조로 읽는다.
    const options = feedsOptionKeys()
    expect(options, '앵커: parseArgs 옵션을 읽지 못했다').toContain('count')
    expect(options, '`--from` 선언이 남아 있다').not.toContain('from')
    expect(options, '`--to` 선언이 남아 있다').not.toContain('to')
  })
})

describe('exit code 충돌 — 사유는 stderr 가 가른다 (CQ6 · 규범 P)', () => {
  it('CQ6: `--env` 오타와 `--count` 무효가 **다른 어휘**로 말한다', { timeout: 300_000 }, () => {
    // OQ-P2-4 (a) — `--env` 를 먼저 본다. 순서는 계약이되 **exit code 로 가르지 않는다**(둘 다 2).
    const envOnly = runFeedsCli(base.vault, { count: 5, env: 'Dev', timeoutMs: CLI_TIMEOUT_MS })
    const countOnly = runFeedsCli(base.vault, { count: '0', timeoutMs: CLI_TIMEOUT_MS })
    const both = runFeedsCli(base.vault, { count: '0', env: 'Dev', timeoutMs: CLI_TIMEOUT_MS })

    expect(envOnly.status).toBe(2)
    expect(countOnly.status).toBe(2)
    expect(both.status).toBe(2)

    // ★ 두 사유의 어휘가 **서로 다르다** — 같으면 규범 P 위반이고, 그때 exit 2 단언은 엉뚱한 사유로
    //   green 이 된다.
    expect(envOnly.stderr, envOnly.stderr).toMatch(ENV_VOCAB)
    expect(countOnly.stderr, countOnly.stderr).toMatch(COUNT_VOCAB)
    expect(countOnly.stderr, 'count 사유가 env 어휘로 말한다').not.toMatch(ENV_VOCAB)

    // 둘 다 무효면 **어느 사유인지 stderr 가 말한다**(OQ-P2-4 (a) = env 먼저).
    expect(both.stderr, both.stderr).toMatch(ENV_VOCAB)
  })

  // 「호출이 틀렸다」와 「런타임이 실패했다」를 자동화가 가르려면 종료코드가 갈려야 한다. 그런데
  //   `node:util` 의 `parseArgs` 가 알 수 없는 인자에 던지는 throw 를 최상위 `.catch`(exit 1)로
  //   흘려보내는 CLI 가 있어, **같은 종류의 위반이 파일마다 다른 코드**로 나갔다(실측: 넷 중 둘이 1).
  //   그 상태에서는 위 CQ6 의 exit 2 단언도 "feeds 의 일부 갈래만" 보증하는 국소 계약이었다.
  const ARG_CONTRACT_CLIS = ['feeds.mjs', 'summary.mjs', 'validate.mjs', 'wiki.mjs']

  it('알 수 없는 인자는 네 엔드포인트에서 모두 exit 2 다', { timeout: 300_000 }, () => {
    // 앵커: 목록이 비면 아래 루프가 한 번도 돌지 않아 단언이 공허하게 통과한다.
    expect(ARG_CONTRACT_CLIS.length, '검사 대상 CLI 목록이 비었다').toBeGreaterThan(0)

    for (const cli of ARG_CONTRACT_CLIS) {
      const result = spawnSync(process.execPath, [path.join(SCRIPTS_DIR, cli), '--bogus'], {
        encoding: 'utf8',
        timeout: CLI_TIMEOUT_MS,
      })

      expect(result.error ?? null, `${cli} 실행 자체가 실패했다`).toBeNull()
      expect(result.status, `${cli} stderr=${result.stderr}`).toBe(2)
      expect(result.stdout, `${cli} 가 인자 위반 경로에서 stdout 을 썼다`).toBe('')
    }
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 빈 저장소 관용 — 커밋 0건은 「빈 페이지」이지 크래시가 아니다
// ────────────────────────────────────────────────────────────────────────────

describe('빈 저장소 관용', () => {
  const loadCursor = () =>
    import(new URL('../lib/feed-cursor.mjs', import.meta.url).href).then((m) => m.walkCursorPage)

  it('커밋 0건 vault 에서 빈 페이지를 낸다', async () => {
    // `walkCursorPage` 는 이 상태를 흡수하도록 설계돼 있지만, HEAD 해석이 쓰는
    //   `git rev-parse --verify --quiet` 는 실패 **사유를 stderr 에 남기지 않는다**(git 문서:
    //   "instead exit with non-zero status silently"). 그래서 문구 대조만으로는 이 상태를 원리적으로
    //   식별할 수 없고, 흡수 분기가 도달 불가가 된 채 사유 없는 예외가 올라왔다.
    const walkCursorPage = await loadCursor()
    const empty = initVault() // git init 만 — 커밋 0건
    tmps.push(empty)

    expect(walkCursorPage(empty, { count: 5, resolveItems: () => [] })).toEqual({
      items: [],
      nextCursor: null,
    })
  })

  it('앵커: git 저장소가 아닌 경로는 여전히 던진다', async () => {
    // 위 흡수가 「비0 종료는 전부 빈 페이지」로 넓어지면 진짜 고장(권한·손상·경로 오류)이 조용히
    //   "피드 끝" 으로 둔갑한다 — 그 방향을 이 앵커가 막는다. 이쪽은 git 이 사유를 말한다.
    const walkCursorPage = await loadCursor()
    const notARepo = makeOut()
    tmps.push(notARepo)

    expect(() => walkCursorPage(notARepo, { count: 5, resolveItems: () => [] })).toThrow()
  })

  it('앵커: 프로세스가 돌지도 못한 실패는 흡수하지 않는다', async () => {
    // 위 앵커와 **다른 축**이다. 저쪽은 git 이 사유를 말하므로 침묵 판정만으로도 걸러지지만, 이쪽은
    //   git 실행 자체가 안 된 경우(미설치·권한)라 **사유도 침묵**이다. 침묵만 보고 흡수하면 이
    //   실패가 "커밋 0건" 으로 둔갑해 피드가 통째로 빈 채 exit 0 이 된다.
    const walkCursorPage = await loadCursor()
    const spawnFailure = () => {
      const error = new Error('spawn git ENOENT')
      error.code = 'ENOENT'
      error.status = null // 프로세스가 시작되지 못했다 — 종료코드 자체가 없다
      throw error
    }
    const dir = makeOut()
    tmps.push(dir)

    expect(() =>
      walkCursorPage(dir, { count: 5, resolveItems: () => [], runGit: spawnFailure }),
    ).toThrow(/ENOENT/u)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 진단 마스킹 — `readFeedPage` 실패 메시지가 `spawnEnv` 원문을 흘리지 않는다 (자격증명 서브타입)
// ────────────────────────────────────────────────────────────────────────────

describe('진단 마스킹 — spawnEnv 가 진단 메시지로 새지 않는다', () => {
  it('실패 진단이 spawnEnv 원문 값 없이 마스크 표식만 남긴다 (앵커 쌍)', () => {
    // "시크릿 0"은 마스킹으로도, 진단 자체가 사라져도 성립한다 — 그래서 **부재(①)와 마스크 존재(②)를
    //   함께** 묻는다. ②가 없으면 ①은 "로그가 안 났다"와 구분되지 않는다.
    const secretValue = 'sekrit-token-6f21-do-not-leak'
    const spawnEnv = {
      ...process.env,
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'safe.directory',
      GIT_CONFIG_VALUE_0: '*',
      WIKI_TEST_FAKE_SECRET: secretValue,
    }

    // `--after` 형식 위반은 git 을 부르기 전에 exit 2 로 거부된다(D10 ①) — 결정적이고 빠르다.
    let thrown
    try {
      readFeedPage(base.vault, { after: 'not-a-valid-cursor', count: 1, spawnEnv })
    } catch (error) {
      thrown = error
    }

    expect(thrown, '잘못된 --after 인데도 readFeedPage 가 throw 하지 않았다').toBeInstanceOf(Error)
    // ① 원문 부재
    expect(thrown.message, '진단 메시지에 spawnEnv 원문 값이 그대로 남아 있다').not.toContain(
      secretValue,
    )
    // ② 마스크 존재(앵커) — ①만 있으면 "진단이 통째로 사라졌다"와 구분되지 않는다.
    expect(thrown.message, '진단 메시지에 마스크 표식(***)이 없다').toContain('***')
  })
})

// ── 형식 리터럴이 살아 있는지 (이 파일의 커서 입력이 12-hex 라는 전제) ────────────────────────
describe('입력 전제', () => {
  it('시딩 커서가 12-hex 다 (앵커)', { timeout: 300_000 }, () => {
    expect(base.feedIds.length).toBe(4)
    for (const id of base.feedIds) expect(id).toMatch(HEX12)
  })
})
