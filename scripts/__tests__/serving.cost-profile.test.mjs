// @vitest-environment node
//
// P5 · Task 3·4·9 — 비용 프로파일 · **런타임 로드 관측** · 얕은 티어 근절 (D-I·D-J) — tdd §3.6 (TR1~TR6)
//
// 이 파일이 `serving.cost-tier.test.mjs`(CT1)를 **교체**한다(§4.1 ①). CT1 의 전제(_서빙 파싱은 얕다_)는
//   Task 9 로 소멸하지만 그것이 지키려던 것("서빙이 문서당 git 을 팔지 않는다")은 더 강한 형태로
//   남는다 — **히트 경로의 git 호출 multiset === `[]`**. 삭제가 아니라 교체다.
//
// ★ 조회 도구의 git 계약은 분리되었다. `feeds.mjs` 는 커서 기반 라이브 워크를 직접
//   수행하므로 `rev-parse`·`rev-list` 양성이 정답이지만, `wiki.mjs` 는 절대경로로 지정된 마크다운
//   파일 하나만 파싱하므로 git 호출 0건이 정답이다. 양성 계약은 PU4, 0건 계약과 관측기
//   생존 대조는 PU5 케이스가 각각 지킨다.
//
// ★ 규범 G(이 phase 신설): "열지 않았다" 는 정적 그래프가 아니라 **실행에서** 관측한다. 재생성 분기가
//   `await import()` 라서 정적 게이트(FC1·WK8)가 green 인 채로 툴체인이 로드되는 상태가 성립한다
//   (CX-J′ 가 정확히 그 변이다). 계측은 `NODE_V8_COVERAGE`(tdd §2.4 가 실측으로 확정).
//
// RED 사유:
//   · TR1·TR2 — **RED(flip)**. 오늘 `feeds`·`wiki` 는 요청마다 vault 를 재파싱한다(실측: tmp vault
//     기준 git 9회 · 실 vault 20회 — M2·M3).
//   · TR3·TR5 — **RED**. 오늘 두 CLI 다 `node_modules` 185+ · `lib/render.mjs`·`derive.mjs`·
//     `parse-vault.mjs` 를 **실행한다**(실측).
//   · TR4 — **pair**. 생성 경로는 반대 방향이다 — "아예 생성하지 못하는 구현" 배제.
//   · TR6 — **RED · 후행(Task 9)**. 오늘 세 심볼이 프로덕션 소스에 살아 있다. 지정 Task 전까지
//     red 인 것이 **정상**이며 "무관한 실패" 로 보고 `.skip` 하면 안 된다(§5.1).
//
// 관측 층(tdd §7.5): **자식 프로세스 계측**(git argv · V8 coverage url)과 **소스 텍스트**뿐이다.
//   기능(무엇이 나오는가)은 FC·WK·DR 이 문다 — 구조 단언과 기능 단언을 한 케이스에 섞지 않는다.
//
// ★ 비용 설계: 자식 spawn 이 케이스당 수 초라 **측정은 `beforeAll` 에서 4회만** 하고 각 케이스는
//   그 관측을 읽기만 한다(공유 가변 상태가 아니라 고정된 사실이다). 케이스별 상한을 명시한다 —
//   느슨하게 푸는 것이 아니라 **실제 상한을 정직하게 적는 것**이다(AT6 선례).
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { cleanup } from './helpers/tmp-git-vault.mjs'
import { runCliWithLoadLog } from './helpers/runtime-load.mjs'
import { DRIFT_REL, seedControlVault } from './helpers/drifted-vault.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SCRIPTS_DIR = path.resolve(HERE, '..')

/**
 * ★ **v3 P2 · PU4 계약 소멸의 새 리터럴**(tdd §4.2). 조회가 라이브 커서 워크가 되면서 **반드시 내는**
 * git 동사 집합이다 — `rev-parse`(커서 3단 검증 ② · D10)와 `rev-list`(배치 워크 · D12).
 *
 * 정렬 리터럴이다(규범 N — 개수 단독 금지 → **정렬 집합 단언을 동반**한다). 「전량 동등」이 아니라
 * 「이 둘이 반드시 있다」인 이유: 워크는 문서 해석을 위해 `log`·`show` 도 내므로 전량을 리터럴로
 * 박으면 GREEN 의 내부 분해에 결속되어 깨지기 쉬운 가드가 된다(규범 A 의 취지).
 *
 * `wiki.mjs` 는 이 집합의 소비처가 아니다. 같은 git shim 에서 `feeds.mjs` 호출을 양성 대조로
 * 삼아, `wiki.mjs` 의 0건이 관측기 사망이 아니라 실제 비용 계약임을 구분한다.
 */
const LIVE_WALK_VERBS = ['rev-list', 'rev-parse']

/** 로드 관측 좌표 — 경로 조각 리터럴. */
const RENDER = '/lib/render.mjs'
const DERIVE = '/lib/derive.mjs'
const PARSE = '/lib/parse.mjs'
const PARSE_VAULT = '/lib/parse-vault.mjs'
const GIT_WALK = '/lib/git-walk.mjs'
const NODE_MODULES = '/node_modules/'

/** Task 9 가 근절하는 심볼 — 리터럴이다. `ctx.runGit`(티어 개념)은 **남는다**(§4.6 · TR6 경계). */
const SHALLOW_TIER_SYMBOLS = ['deepDocGate', 'walkFeeds', 'buildWirePayload']

const tmps = []
afterAll(() => cleanup(...tmps))

let coldFeeds
let hitFeeds
let hitWiki
let warm
let warmFeeds

beforeAll(async () => {
  // 워밍 vault — 드리프트 없는 대조 vault(문서 2건 + 피드 1건). 아티팩트를 먼저 발행해 둔다.
  //
  // ★ v3 P1: 워밍을 `--status` 가 아니라 `--out` 으로 낸다. `--status` 는 Task 7 이 없애는 플래그라
  //   그대로 두면 착륙 즉시 **이 파일 전체가 준비 단계에서 죽는다**(exit 2). `--out` 은 오늘도 있고
  //   착륙 뒤에도 남는 **양 시대 공통 통로**다(D2).
  // ★ `feeds.mjs --out` 이 feeds 아티팩트 생산자다. summary 실행은 summary 파일만 만들고, 이 줄이
  //   같은 형태의 feeds 파일을 만든다. 준비 단계의 exit code 는 아래 조회 arm 의 앵커가 대신 문다.
  const control = seedControlVault()
  tmps.push(control.vault)
  const summaryOut = path.join(control.vault, 'cache', 'summary.dev.json')
  const feedsOut = path.join(control.vault, 'cache', 'feeds.dev.json')
  warm = runCliWithLoadLog('summary.mjs', ['--env', 'dev', '--out', summaryOut], { vault: control.vault }) // prettier-ignore
  warmFeeds = runCliWithLoadLog('feeds.mjs', ['--env', 'dev', '--count=200', '--out', feedsOut], { vault: control.vault }) // prettier-ignore
  // S4: `warmFeeds` 의 spawn 결과가 이전까지 어디서도 확인되지 않았다 — warm/cold arm 준비가
  //   조용히 무너져도(예: 생성기가 exit 0 이면서 아티팩트를 못 씀) 그것을 잡는 히트 케이스가 없었다
  //   (다른 vault·다른 CLI 를 호출하는 hitFeeds/coldFeeds 로는 이 준비 단계 실패가 전파되지 않는다).
  //   exit 0 과 아티팩트 실재를 함께 못박는다 — exit 0 인데 파일이 없으면 exit code 만으로는 못 잡는다.
  expect(warmFeeds.exitCode, warmFeeds.stderr).toBe(0)
  expect(existsSync(feedsOut), 'warmFeeds 준비가 feeds 아티팩트를 만들지 않았다').toBe(true)

  // ★ §4.5-③ arm 갱신 — D15 로 `--count` 가 **필수**가 되므로 PU4 가 관측하는 이 arm 이 그것을 실어야
  //   한다. 안 실으면 C4 착륙 즉시 이 arm 이 exit 2(count 누락)가 되어 PU4 의 red 사유가 「조회가 git 을
  //   안 부른다」에서 「인자가 모자란다」로 조용히 바뀐다 — 규범 P 가 막으려는 사유 뒤바뀜이다.
  //   오늘은 `--count` 가 옵셔널이라 이 한 줄이 **현재 판정을 바꾸지 않는다**(피드 2건 < 5).
  hitFeeds = runCliWithLoadLog('feeds.mjs', ['--env', 'dev', '--count=5'], { vault: control.vault })
  // `wiki.mjs` 는 `--file <절대경로>` 하나만 받는다. PU5·TR5′ 가 인자 오류가 아니라 정상
  // 실행의 git 호출·로드 프로파일을 물 수 있도록 실재하는 문서의 절대경로를 넘긴다.
  hitWiki = runCliWithLoadLog('wiki.mjs', ['--file', path.join(control.vault, 'wiki', `${DRIFT_REL}.md`)], { cwd: control.vault }) // prettier-ignore

  // `wiki.mjs` 콜드 arm 을 제거해도 무감시가 되는 자식 계약은 없다. 아티팩트 부재 계약은 부모
  // `wiki.doc-serving.contract.test.ts` P-6 이 관측하고, 자식은 절대경로 문서만 파싱한다.
  // 콜드 arm — 발행 아티팩트가 없는 vault. `feeds.mjs` 의 라이브 워크는 아티팩트에 의존하지
  // 않으므로, 히트 arm 과 같은 성공 경로를 사용한다.
  const cold = seedControlVault()
  tmps.push(cold.vault)
  coldFeeds = runCliWithLoadLog('feeds.mjs', ['--env', 'dev', '--count=5'], { vault: cold.vault })
}, 420_000)

const countUrls = (observation, fragment) =>
  observation.loadedUrls.filter((url) => url.includes(fragment)).length
const gitVerbs = (observation) =>
  observation.gitCalls.map((argv) => argv.filter((token) => !token.startsWith('-')).join(' '))

/**
 * git argv 의 **verb 위치**(첫 서브커맨드 토큰). `-c <key>=<value>` 글로벌 옵션이 verb 앞에 올 수
 * 있고 그 값 토큰(`core.quotepath=false` 등)은 대시로 시작하지 않으므로 "대시로 시작하지 않는 첫
 * 토큰"을 그대로 verb 로 삼으면 그 값을 verb 로 오인한다(`gitVerbs` 의 문자열 표현이 같은 이유로
 * 이 자리에 못 쓰인다 — 그 주석). `-c` 뒤 토큰은 항상 그 값이므로 함께 건너뛴다.
 */
function gitVerb(argv) {
  let index = 0
  while (index < argv.length) {
    if (argv[index] === '-c') {
      index += 2
      continue
    }
    if (argv[index].startsWith('-')) {
      index += 1
      continue
    }
    return argv[index]
  }
  return undefined
}

/**
 * 그 동사가 **verb 위치**에서 실제로 불린 횟수. `argv.includes(verb)` 는 그 문자열이 인자값·경로로
 * 위장돼 있어도(예: `git log --grep rev-list` — 'rev-list' 가 grep 패턴 값일 뿐 verb 가 아니다) 참이
 * 되므로 위치 무관 매칭은 위장에 취약하다 — verb 위치만 본다.
 */
const verbCount = (observation, verb) =>
  observation.gitCalls.filter((argv) => gitVerb(argv) === verb).length

/** 프로덕션 소스만 읽어 붙인다(테스트 트리 제외) — 트립와이어가 자기 자신을 물지 않게.
 *  ★ `helpers` 를 이름으로 블랭킷 제외하지 않는다 — 그러면 장차 프로덕션 `scripts/helpers/` 가
 *  생겨도 스캔에서 조용히 빠진다. 오늘 모든 `helpers/` 는 `__tests__/` 아래에만 산다(실측:
 *  `scripts/__tests__/helpers` · `scripts/lib/__tests__/helpers` 둘뿐 — `find scripts -type d -name
 *  helpers` 확인)이므로 `__tests__` 하나만 걸러도 오늘의 헬퍼는 전부 빠지고, 제외 범위는 **테스트
 *  트리 아래로만** 좁혀진다. */
function productionSources() {
  const chunks = []
  const stack = [SCRIPTS_DIR]
  while (stack.length > 0) {
    const current = stack.pop()
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.name === '__tests__') continue
      const child = path.join(current, entry.name)
      if (entry.isDirectory()) stack.push(child)
      else if (entry.isFile() && entry.name.endsWith('.mjs')) chunks.push(readFileSync(child, 'utf8')) // prettier-ignore
    }
  }
  return chunks.join('\n')
}

function testSources() {
  const chunks = []
  const stack = [path.join(SCRIPTS_DIR, '__tests__'), path.join(SCRIPTS_DIR, 'lib', '__tests__')]
  while (stack.length > 0) {
    const current = stack.pop()
    if (!statSync(current, { throwIfNoEntry: false })?.isDirectory()) continue
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const child = path.join(current, entry.name)
      if (entry.isDirectory()) stack.push(child)
      else if (entry.isFile() && entry.name.endsWith('.mjs')) chunks.push(readFileSync(child, 'utf8')) // prettier-ignore
    }
  }
  return chunks.join('\n')
}

describe('조회 경로 git 프로파일 (PU4 · 🔴RED(flip) v3 P2: 조회가 **라이브 워크**가 된다)', () => {
  it('PU4(구 TR1): `feeds.mjs` 조회 실행이 `rev-parse`·`rev-list` 를 **각각 1회 이상** 낸다', () => {
    // ★★ **계약 소멸의 기록**(`prd.md:31-33` 이 요구하는 사유 · tdd §4.2):
    //   _"P1 의 「조회는 git 을 안 부른다」는 그때 참이었고 v3 P2 가 조회를 라이브 워크로 바꾸면서
    //    거짓이 된다"_. 해석 A 의 직접 귀결이다 — `feeds.mjs` 의 조회 경로가 아티팩트 읽기에서
    //   커서 기반 git 워크로 **교체**된다(D10 3단 검증 + D12 배치 워크).
    //   옛 기대(`hitFeeds.gitCalls === []`)는 "판정이 사라졌다" 는 P1 의 사실이었고, 지금은
    //   **관측 대상 자체가 바뀐 것**이지 방어가 약해진 것이 아니다.
    //
    // ★ 앵커는 그대로 둔다(§4.1 변이 ⑤). 위험 실재 축 = `summary.mjs` 실행이 같은 shim 에서 실제로
    //   `log`·`rev-list` 를 낸다 — 관측기(PATH shim)가 죽어 빈 배열인 상태를 배제한다.
    expect(warm.exitCode, warm.stderr).toBe(0)
    expect(warm.gitCalls.length).toBeGreaterThan(0)
    expect(gitVerbs(warm).some((verb) => verb.startsWith('rev-list'))).toBe(true)
    expect(gitVerbs(warm).some((verb) => verb.startsWith('log'))).toBe(true)

    expect(hitFeeds.exitCode, hitFeeds.stderr).toBe(0)
    // 앵커: 조회가 git 을 **한 번이라도** 부른다(0건이면 아래 집합 단언이 사유를 못 가른다).
    expect(hitFeeds.gitCalls.length, `git 호출 0건 (exit=${hitFeeds.exitCode})`).toBeGreaterThan(0)

    // 규범 N — 개수 단독 금지: **정렬 verb 집합 동등**과 verb 별 개수 하한을 함께 문다.
    // ★ 이 단언이 **무는 방향과 안 무는 방향**을 정직하게 적어 둔다.
    //   · 문다(누락): 기대 동사 중 하나라도 verb 위치에서 나지 않으면 red 다. 위장에 속지 않는 것은
    //     `verbCount` 가 `argv.includes` 가 아니라 `gitVerb`(verb 위치)로 세기 때문이다 — 실측
    //     프로브에서 `git log --grep rev-list` 처럼 값 토큰에 동사 문자열만 끼워 넣은 호출이 예전
    //     구현을 통과했다.
    //   · 안 문다(잉여): 아래 `filter` 로 기대 집합 밖 동사는 버린다. **의도한 것**이다 — 라이브
    //     워크는 가용성 확인·문서 해석 계층에서도 git 을 부르므로 "이 동사들만 난다"는 참이 아니다.
    //     잉여 동사를 금지하고 싶으면 그것은 별도 축이어야 한다(여기서 뭉치면 둘 다 못 문다).
    //   그래서 `observedVerbs` 를 기대 배열에서 유도하지 않고 `hitFeeds.gitCalls` 에서 직접 뽑는다 —
    //   집계의 출처는 실측 데이터이고, 기대 집합은 **비교 상대**로만 쓰인다.
    const observedVerbs = [...new Set(hitFeeds.gitCalls.map((argv) => gitVerb(argv)))]
      .filter((verb) => LIVE_WALK_VERBS.includes(verb))
      .sort()
    expect(observedVerbs, `관측된 git 호출: ${JSON.stringify(gitVerbs(hitFeeds))}`).toEqual(
      [...LIVE_WALK_VERBS].sort(),
    )
    expect(verbCount(hitFeeds, 'rev-parse')).toBeGreaterThanOrEqual(1)
    expect(verbCount(hitFeeds, 'rev-list')).toBeGreaterThanOrEqual(1)
  })

  // ★★ **「승계」가 아니라 「대체」다 — 이 문단을 지우면 다음 독자가 «방어가 약해졌다»고 읽는다.**
  //
  //    지키던 것 → 지키게 된 것: 「`wiki.mjs` 가 문서 응답의 이력을 조달하려고
  //    `rev-parse`·`rev-list` 를 반드시 부른다」 → **「절대경로로 받은 마크다운 파일 하나만
  //    파싱하며 git 을 한 번도 부르지 않는다」**. 이력 조달과 문서 응답 조립은 소비자 층으로
  //    옮겨 갔으므로, 예전의 양성 단언을 삭제하지 않고 **0건 단언으로 반전**해 이관 성과를 문다.
  //    같은 PATH shim 에서 `feeds.mjs` 가 git 을 실제로 부른다는 양성 대조를 두어, 빈 배열이
  //    관측기 사망이 아니라 `wiki.mjs` 자체의 계약임을 구분한다.
  it('PU5(구 TR2): `wiki.mjs` 히트 실행은 git 을 **한 번도 부르지 않는다** (🔴축 교체)', () => {
    // 앵커 ⓐ: 인자 계약 위반(exit 2)으로 죽은 것이 아니다 — 사유 뒤바뀜 방지(규범 P).
    expect(hitWiki.exitCode, hitWiki.stderr).toBe(0)
    // 앵커 ⓑ: 같은 하네스의 PATH shim 이 `feeds.mjs` 실행에서는 git 을 실제로 관측한다.
    expect(
      hitFeeds.gitCalls.length,
      `feeds git 호출 0건 (exit=${hitFeeds.exitCode})`,
    ).toBeGreaterThan(0)

    expect(hitWiki.gitCalls).toHaveLength(0)
  })
})

describe('생성기 결속 0 — 정적 그래프 (PU1)', () => {
  it('PU1: `feeds.mjs`·`wiki.mjs` 의 정적 import 폐포에 `lib/generator.mjs` 가 **0회**다', async () => {
    const { staticImportClosure } = await import(
      new URL('./helpers/static-import-graph.mjs', import.meta.url).href
    )
    const generator = path.join(SCRIPTS_DIR, 'lib', 'generator.mjs')

    // ★★ **「승계」가 아니라 「대체」다 — 앵커 강도가 바뀌었음을 명시한다.**
    //
    //    지키던 것 → 지키게 된 것: 「`feeds.mjs`·`wiki.mjs` 모두의 폐포가 `cli-env.mjs`·
    //    `head-state.mjs` 두 실재 모듈을 담는다」 → **「`feeds.mjs` 는 기존 두 앵커를 그대로 담고,
    //    `wiki.mjs` 는 유일한 의존성 `parse.mjs` 를 담는다」**. `wiki.mjs` 의 정적 폐포는 자기 자신과
    //    `parse.mjs` 정확히 2파일이라 `length > 1` 은 여유 0으로 통과하고, 비공허성 보증도
    //    `toContain(parse.mjs)` 한 줄로 줄었다. 따라서 기존 강도로 읽으면 안 되며, 이 양성 앵커가
    //    읽기 실패로 빈 폐포가 된 상태와 생성기 부재를 구분한다.
    const feedsClosure = staticImportClosure(path.join(SCRIPTS_DIR, 'feeds.mjs'))
    expect(feedsClosure.files.length, 'feeds.mjs').toBeGreaterThan(1)
    expect(feedsClosure.files, 'feeds.mjs').toContain(path.join(SCRIPTS_DIR, 'lib', 'cli-env.mjs'))
    expect(feedsClosure.files, 'feeds.mjs').toContain(
      path.join(SCRIPTS_DIR, 'lib', 'head-state.mjs'),
    )
    expect(feedsClosure.files, 'feeds.mjs 가 생성기를 정적으로 문다').not.toContain(generator)

    const wikiClosure = staticImportClosure(path.join(SCRIPTS_DIR, 'wiki.mjs'))
    expect(wikiClosure.files.length, 'wiki.mjs').toBeGreaterThan(1)
    expect(wikiClosure.files, 'wiki.mjs').toContain(path.join(SCRIPTS_DIR, 'lib', 'parse.mjs'))
    expect(wikiClosure.files, 'wiki.mjs 가 생성기를 정적으로 문다').not.toContain(generator)
  })
})

describe('런타임 로드 관측 — 규범 G (TR3′·TR5′ · CX-J′·CX-K)', () => {
  // ★ v3 P1 에서 이 케이스가 **PU2**(§3.9)를 겸한다 — 계약도 관측 기법도 그대로이고, 달라지는 것은
  //   "왜 로드하지 않는가" 의 사유뿐이다(오늘: 히트 스킵 / Task 6 이후: **생성기를 아예 안 부른다**).
  //   짝(PU3)의 대상이 `coldFeeds` → `summary.mjs` 로 옮겨간 것이 이 절의 유일한 구조 변경이다.
  // ★★ **TR3′ 앵커 이전 — 「승계」가 아니라 「대체」다. 이 문단을 지우면 다음 독자가 «앵커를 왜
  //    옮겼는지» 를 모른 채 되돌린다.**
  //
  //    옛 앵커는 `hitWiki` 였다: _"같은 하네스가 `wiki.mjs` 히트 실행에서는 `lib/render.mjs` 를
  //    **실제로 관측한다**"_. 그 한 쌍이 「관측기(자식 프로세스 V8 coverage 로드 로그)가 살아 있다」
  //    를 지고, 그 아래 `hitFeeds` **부재 단언 4개**가 그 위에 서 있었다.
  //
  //    🔴 md 컷오버가 `wiki.mjs` 히트 경로의 렌더 로드를 **0 으로 만든다**(서버가 렌더를 그만두므로).
  //    ⇒ 옛 앵커가 이 변경으로 **함께 죽는다**. 여기서 앵커를 지우거나 `toBe(0)` 으로 반전하면 이
  //    케이스의 단언이 전부 「0건」이 되어, 관측기가 통째로 비어도 통과한다 — 부재 단언 4개가 한꺼번에
  //    장식이 된다.
  //
  //    ⇒ 처분은 **반전이 아니라 이전**이다. `render.mjs` 를 여전히 여는 실행, 즉 `summary.mjs`(warm)
  //    로 옮긴다 — 벌크 생성은 이 컷오버 뒤에도 전 문서를 파싱·렌더한다. 그 실재는 같은 파일의
  //    **PU3** 가 독립 케이스로 이미 관측하므로(`warm` 에서 `parse-vault`·`render`·패키지 로드),
  //    앵커가 「있다고 가정한 것」이 아니라 「짝으로 보장된 것」이다.
  //    지키던 것 → 지키게 된 것: 「조회 도구 wiki 는 렌더를 연다」 → **「관측기는 살아 있다 — 그
  //    증거가 생성 경로로 옮겨갔다」**(부재 단언 4개가 지키는 계약 자체는 무손상).
  it('TR3′(=PU2): `feeds.mjs` 히트 실행이 렌더·파생·파싱 툴체인을 **실행하지 않는다**', () => {
    // ★ 앵커(CX-K 대응): 같은 하네스가 `summary.mjs` 실행에서는 `lib/render.mjs` 를 **실제로
    //   관측한다**. 관측기가 항상 빈 집합을 내면 아래 부재 단언들은 장식이다.
    expect(warm.loadedUrls.length).toBeGreaterThan(0)
    expect(countUrls(warm, RENDER)).toBeGreaterThan(0)

    expect(hitFeeds.loadedUrls.length).toBeGreaterThan(0)
    expect(countUrls(hitFeeds, RENDER)).toBe(0)
    expect(countUrls(hitFeeds, DERIVE)).toBe(0)
    expect(countUrls(hitFeeds, PARSE_VAULT)).toBe(0)
    expect(countUrls(hitFeeds, NODE_MODULES)).toBe(0)
  })

  // ★★ **「승계」가 아니라 「대체」다 — 반전된 단언이 책임 이관의 성과를 직접 문다.**
  //
  //    지키던 것 → 지키게 된 것: 「`wiki.mjs` 가 문서 이력을 조달하려고 `git-walk.mjs` 를
  //    실제로 연다」 → **「지정된 마크다운을 `parse.mjs` 로 파싱할 뿐 `git-walk.mjs` 를 열지
  //    않는다」**. 이력 조달과 5키 응답 조립은 소비자 층으로 옮겨 갔고, `wiki.mjs` 자체는
  //    `{md, meta, status}` 3키를 만드는 단일 문서 파서가 되었다. 그러므로 `GIT_WALK > 0` 을
  //    삭제하는 것이 아니라 **`GIT_WALK === 0` 으로 반전**한다. `loadedUrls.length > 0` 은 로드
  //    관측기가 살아 있음을, `PARSE > 0` 은 「아무것도 안 열었다」가 아니라 「git-walk 만
  //    안 열었다」는 것을 각각 증명한다. `render`·`derive` 0건 계약도 그대로 유지한다.
  it('TR5′: `wiki.mjs` 히트 실행은 `parse` 만 열고 `render`·`derive`·`git-walk` 는 **안 연다** (🔴축 교체)', () => {
    // 앵커: 이 실행의 로드 관측이 살아 있다(빈 로그로 아래 0건이 참이 되는 것을 배제).
    expect(hitWiki.loadedUrls.length).toBeGreaterThan(0)

    // 양성 축: 지정된 단일 문서는 실제로 파싱한다.
    expect(countUrls(hitWiki, PARSE)).toBeGreaterThan(0)

    expect(countUrls(hitWiki, RENDER)).toBe(0)
    expect(countUrls(hitWiki, DERIVE)).toBe(0)
    expect(countUrls(hitWiki, GIT_WALK)).toBe(0)
  })
})

describe('짝 가드 — 생성 경로는 반대 방향이다 (PU3 · 🟩pair)', () => {
  it('PU3(구 TR4): `summary.mjs` 실행은 `parse-vault`·`render`·패키지를 **로드한다**', () => {
    // "아예 만들지 못하는 구현" 배제 + **동적 import 가 실제로 열린다는 증거**. PU2 와 정확히 반대
    //   방향이다(P4 REFACTOR 가 찾은 구멍 ① — 되돌림 방향을 한쪽만 보는 CX 를 구조로 막는다).
    //
    // ★ 대상 교체(§3.9 · §4.6 ①): 옛 짝은 `coldFeeds`(아티팩트 부재 → 재생성)였는데 Task 6 이후
    //   그 실행은 **throw** 해서 아무것도 로드하지 않는다 — 그러면 이 짝이 통째로 죽고, PU2 의
    //   "로드하지 않는다" 가 **관측기 사망과 구분 불가**가 된다. 항상 파싱하는 `summary.mjs` 로 옮긴다.
    expect(countUrls(warm, PARSE_VAULT)).toBeGreaterThan(0)
    expect(countUrls(warm, RENDER)).toBeGreaterThan(0)
    expect(countUrls(warm, NODE_MODULES)).toBeGreaterThan(0)
  })
})

describe('캐시 부재 — 판정 주체가 갈린다 (PU6 이동 · PU6b)', () => {
  // ★★ **「승계」가 아니라 「이동」이다 — 계약이 약해진 것이 아니라 주체가 옮겨 갔다.**
  //
  //   이 자리가 지키던 「발행 아티팩트가 없으면 500으로 실패하고 진단에 「빌드」 어휘를
  //   남긴다」는 계약은 아티팩트를 읽는 소비자(부모 서버) 층으로 옮겨 갔다. `wiki.mjs` 는
  //   절대경로로 받은 마크다운 파일만 파싱하여 아티팩트 부재를 판정할 수 없으므로, 기존
  //   PU6 케이스는 여기서 소멸하고 `wiki.doc-serving.contract.test.ts` 의 **P-6** 이 그 계약을 인수한다.
  it('PU6b: 아티팩트가 없어도 `feeds.mjs` 는 라이브 워크로 exit 0 이고 파싱 가능한 JSON 을 낸다', () => {
    // 앵커: 아티팩트가 **있는** 실행도 exit 0 + 파싱 가능 JSON 이다(둘이 같은 계산 경로를 탄다).
    expect(hitFeeds.exitCode, hitFeeds.stderr).toBe(0)
    expect(() => JSON.parse(hitFeeds.stdout)).not.toThrow()

    expect(coldFeeds.exitCode, coldFeeds.stderr).toBe(0)
    expect(() => JSON.parse(coldFeeds.stdout)).not.toThrow()
    // ★ 앵커: 빈 페이지로 통과하는 것을 배제한다 — 대조 vault 에는 피드가 실재한다.
    expect(JSON.parse(coldFeeds.stdout).items.length).toBeGreaterThan(0)
  })
})

describe('얕은 티어 근절 게이트 (TR6 · 🔴RED 후행 · Task 9 · CX-L)', () => {
  it('TR6: 프로덕션 소스에 `deepDocGate`·`walkFeeds`·`buildWirePayload` 가 **각 0회**다', () => {
    // ★ "호출자 0" 을 grep 스냅샷이 아니라 **소스 전수 스캔 게이트**로 결속한다(R4-4 조건 ②).
    //   경계: `doc-gate.mjs` 의 `ctx.runGit` 은 **남는다** — 티어 개념은 단위층(DG11·DG12)에 계속
    //   살고, 없애는 것은 `deepDocGate` 라는 **비용 스위치 가면**뿐이다(R2 반례 6).
    //   ※ §4.5 ㉔ 가 "심볼 자체를 지울지 / 테스트 전용 참조 구현으로 남길지" 를 §4.4 실측 후에
    //     확정한다. 남기기로 하면 이 케이스의 대상에서 **명시적으로 제외**하고 사유를 여기 남긴다.
    const production = productionSources()
    const tests = testSources()
    const count = (text, token) => text.split(token).length - 1

    // 앵커: `__tests__` 에는 `walkFeeds` 가 **여전히 있다**(심볼 자체는 살아 있고, 스캐너도 살아 있다).
    expect(count(tests, 'walkFeeds')).toBeGreaterThan(0)
    expect(production.length).toBeGreaterThan(1000)

    expect(SHALLOW_TIER_SYMBOLS.map((symbol) => count(production, symbol))).toEqual([0, 0, 0])
  })
})
