// @vitest-environment node
//
// P5 · Task 3·4·9 — 비용 프로파일 · **런타임 로드 관측** · 얕은 티어 근절 (D-I·D-J) — tdd §3.6 (TR1~TR6)
//
// 이 파일이 `serving.cost-tier.test.mjs`(CT1)를 **교체**한다(§4.1 ①). CT1 의 전제(_서빙 파싱은 얕다_)는
//   Task 9 로 소멸하지만 그것이 지키려던 것("서빙이 문서당 git 을 팔지 않는다")은 더 강한 형태로
//   남는다 — **히트 경로의 git 호출 multiset === `[]`**. 삭제가 아니라 교체다.
//
// ★ v3 P1 Task 6 이후 조회 도구는 아티팩트를 읽기만 한다. git 을 한 번이라도 부르면 그 자체가
//   생성기 판정 경로가 되살아났다는 신호다. 그래서 **빈 multiset 동치**로 못박는다.
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
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { cleanup } from './helpers/tmp-git-vault.mjs'
import { runCliWithLoadLog } from './helpers/runtime-load.mjs'
import { DRIFT_REL, seedControlVault } from './helpers/drifted-vault.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SCRIPTS_DIR = path.resolve(HERE, '..')

/**
 * v3 P1(Task 6) 이후의 조회 경로 git 호출 계약 — **빈 multiset**이다.
 *
 * 신선도 판정이 사라지면 `rev-parse HEAD` 를 낼 이유도 사라진다(D1). 조회 도구는 **캐시 파일을 읽기만**
 * 한다 — git 을 한 번이라도 부르면 그 자체가 "판정이 남아 있다" 는 신호다.
 */
const READ_ONLY_GIT_CALLS = []

/**
 * ★ **v3 P2 · PU4 계약 소멸의 새 리터럴**(tdd §4.2). 조회가 라이브 커서 워크가 되면서 **반드시 내는**
 * git 동사 집합이다 — `rev-parse`(커서 3단 검증 ② · D10)와 `rev-list`(배치 워크 · D12).
 *
 * 정렬 리터럴이다(규범 N — 개수 단독 금지 → **정렬 집합 단언을 동반**한다). 「전량 동등」이 아니라
 * 「이 둘이 반드시 있다」인 이유: 워크는 문서 해석을 위해 `log`·`show` 도 내므로 전량을 리터럴로
 * 박으면 GREEN 의 내부 분해에 결속되어 깨지기 쉬운 가드가 된다(규범 A 의 취지).
 *
 * ★★ **`READ_ONLY_GIT_CALLS`(위)를 지우지 마라** — `:157` **PU5**(`wiki.mjs`)가 같은 상수를 쓰고
 * 그쪽은 **파이프라인 P4 소관이라 살아 있다.** 상수를 지우는 것이 가장 자연스러운 "정리" 이고,
 * 그것이 PU5 를 죽인다(§4.6 무변경 pin).
 */
const LIVE_WALK_VERBS = ['rev-list', 'rev-parse']

/** 로드 관측 좌표 — 경로 조각 리터럴. */
const RENDER = '/lib/render.mjs'
const DERIVE = '/lib/derive.mjs'
const PARSE_VAULT = '/lib/parse-vault.mjs'
const GIT_WALK = '/lib/git-walk.mjs'
const NODE_MODULES = '/node_modules/'

/** Task 9 가 근절하는 심볼 — 리터럴이다. `ctx.runGit`(티어 개념)은 **남는다**(§4.6 · TR6 경계). */
const SHALLOW_TIER_SYMBOLS = ['deepDocGate', 'walkFeeds', 'buildWirePayload']

const tmps = []
afterAll(() => cleanup(...tmps))

let coldFeeds
let coldWiki
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

  // ★ §4.5-③ arm 갱신 — D15 로 `--count` 가 **필수**가 되므로 PU4 가 관측하는 이 arm 이 그것을 실어야
  //   한다. 안 실으면 C4 착륙 즉시 이 arm 이 exit 2(count 누락)가 되어 PU4 의 red 사유가 「조회가 git 을
  //   안 부른다」에서 「인자가 모자란다」로 조용히 바뀐다 — 규범 P 가 막으려는 사유 뒤바뀜이다.
  //   오늘은 `--count` 가 옵셔널이라 이 한 줄이 **현재 판정을 바꾸지 않는다**(피드 2건 < 5).
  hitFeeds = runCliWithLoadLog('feeds.mjs', ['--env', 'dev', '--count=5'], { vault: control.vault })
  hitWiki = runCliWithLoadLog('wiki.mjs', ['--env', 'dev', '--path', DRIFT_REL], {
    vault: control.vault,
  })

  // 콜드 arm — 아티팩트가 **없는** vault. 오늘은 "재생성 경로가 무엇을 하는가" 의 대조군이고,
  //   Task 6 이후에는 **fail-loud 가 실제로 일어나는가**(PU6)의 관측 대상이 된다.
  const cold = seedControlVault()
  tmps.push(cold.vault)
  coldFeeds = runCliWithLoadLog('feeds.mjs', ['--env', 'dev', '--count=5'], { vault: cold.vault })
  coldWiki = runCliWithLoadLog('wiki.mjs', ['--env', 'dev', '--path', DRIFT_REL], { vault: cold.vault }) // prettier-ignore
}, 420_000)

const countUrls = (observation, fragment) =>
  observation.loadedUrls.filter((url) => url.includes(fragment)).length
const gitVerbs = (observation) =>
  observation.gitCalls.map((argv) => argv.filter((token) => !token.startsWith('-')).join(' '))

/**
 * 그 동사를 낸 git 호출 수. `argv` **원소 동등**으로 센다 — `gitVerbs` 는 `-c core.quotepath=false`
 * 의 값 토큰(대시로 시작하지 않는다)을 앞에 남기므로 첫 토큰을 동사로 삼으면 조용히 빗나간다.
 */
const verbCount = (observation, verb) =>
  observation.gitCalls.filter((argv) => argv.includes(verb)).length

/** 프로덕션 소스만 읽어 붙인다(`__tests__`·`helpers` 제외) — 트립와이어가 자기 자신을 물지 않게. */
function productionSources() {
  const chunks = []
  const stack = [SCRIPTS_DIR]
  while (stack.length > 0) {
    const current = stack.pop()
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.name === '__tests__' || entry.name === 'helpers') continue
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
    const observed = LIVE_WALK_VERBS.filter((verb) => verbCount(hitFeeds, verb) > 0)
    expect(observed, `관측된 git 호출: ${JSON.stringify(gitVerbs(hitFeeds))}`).toEqual(LIVE_WALK_VERBS) // prettier-ignore
    expect(verbCount(hitFeeds, 'rev-parse')).toBeGreaterThanOrEqual(1)
    expect(verbCount(hitFeeds, 'rev-list')).toBeGreaterThanOrEqual(1)
  })

  it('PU5(구 TR2): `wiki.mjs` 히트 실행도 git 호출 multiset === `[]`', () => {
    // 하나만 고친 구현을 배제한다 — D-E 와 D-F 는 서로 다른 Task 다.
    expect(hitWiki.exitCode).toBe(0)
    expect(hitWiki.gitCalls).toEqual(READ_ONLY_GIT_CALLS)
  })
})

describe('생성기 결속 0 — 정적 그래프 (PU1 · 🔴RED 미구현)', () => {
  it('PU1: `feeds.mjs`·`wiki.mjs` 의 정적 import 폐포에 `lib/generator.mjs` 가 **0회**다', async () => {
    // 🔴 두 조회 도구가 오늘은 `runSummaryGenerator` 를 **정적으로** 물고 있다(`feeds.mjs:13`·
    //   `wiki.mjs:13`). 런타임 관측(PU2)과 층이 다르다 — 정적 결속이 남아 있으면 "지금은 안 부른다"
    //   가 한 줄 수정으로 되살아난다.
    const { staticImportClosure } = await import(
      new URL('./helpers/static-import-graph.mjs', import.meta.url).href
    )
    const generator = path.join(SCRIPTS_DIR, 'lib', 'generator.mjs')

    for (const entry of ['feeds.mjs', 'wiki.mjs']) {
      const closure = staticImportClosure(path.join(SCRIPTS_DIR, entry))

      // ★ 앵커: 폐포가 비어 있지 않고 **살아남는 모듈 2종을 실제로 담는다**.
      //   `helpers/static-import-graph.mjs:50-51` 이 _"읽을 수 없는 파일은 폐쇄에서 조용히 빠진다"_
      //   를 자인하므로, 크기와 실재를 함께 못박지 않으면 부재 단언이 파서 사망과 구분되지 않는다.
      //   ★ v3 P2 — 앵커 모듈이 `artifact.mjs` → `cli-env.mjs` 로 바뀐다. `feeds.mjs` 의 조회 경로가
      //   라이브 커서 워크로 교체되면서 **아티팩트를 읽지 않게 됐고**(PU6b) 그 import 가 사라졌기
      //   때문이다. 이 두 줄은 「폐포 파서가 살아 있다」를 증명하는 앵커이지 그 두 모듈에 대한
      //   요구가 아니므로, 두 CLI 가 **여전히 공유하는** 모듈로 재조준한다.
      expect(closure.files.length, entry).toBeGreaterThan(1)
      expect(closure.files, entry).toContain(path.join(SCRIPTS_DIR, 'lib', 'cli-env.mjs'))
      expect(closure.files, entry).toContain(path.join(SCRIPTS_DIR, 'lib', 'head-state.mjs'))

      expect(closure.files, `${entry} 가 생성기를 정적으로 문다`).not.toContain(generator)
    }
  })
})

describe('런타임 로드 관측 — 규범 G (TR3·TR5 · 🔴RED 오늘 툴체인을 실행한다 · CX-J′·CX-K)', () => {
  // ★ v3 P1 에서 이 케이스가 **PU2**(§3.9)를 겸한다 — 계약도 관측 기법도 그대로이고, 달라지는 것은
  //   "왜 로드하지 않는가" 의 사유뿐이다(오늘: 히트 스킵 / Task 6 이후: **생성기를 아예 안 부른다**).
  //   짝(PU3)의 대상이 `coldFeeds` → `summary.mjs` 로 옮겨간 것이 이 절의 유일한 구조 변경이다.
  it('TR3(=PU2): `feeds.mjs` 히트 실행이 렌더·파생·파싱 툴체인을 **실행하지 않는다**', () => {
    // ★ 앵커(CX-K 대응): 같은 하네스가 `wiki.mjs` 히트 실행에서는 `lib/render.mjs` 를 **실제로
    //   관측한다**. 관측기가 항상 빈 집합을 내면 이 부재 단언은 장식이다.
    expect(hitWiki.loadedUrls.length).toBeGreaterThan(0)
    expect(countUrls(hitWiki, RENDER)).toBeGreaterThan(0)

    expect(hitFeeds.loadedUrls.length).toBeGreaterThan(0)
    expect(countUrls(hitFeeds, RENDER)).toBe(0)
    expect(countUrls(hitFeeds, DERIVE)).toBe(0)
    expect(countUrls(hitFeeds, PARSE_VAULT)).toBe(0)
    expect(countUrls(hitFeeds, NODE_MODULES)).toBe(0)
  })

  it('TR5: `wiki.mjs` 히트 실행은 `derive`·`git-walk` 를 안 열고 **`render` 는 연다**', () => {
    // D-F 의 비대칭이 **의도**임을 못박는다 — `wiki` 는 본문 HTML 이 실제로 필요하다(F-21 미배정).
    expect(countUrls(hitWiki, RENDER)).toBeGreaterThan(0)
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

describe('캐시 부재 — 판정 주체가 갈린다 (PU6 · PU6b · v3 P2 이월)', () => {
  // ★★ **삭제도 `.skip` 도 아니다 — arm 을 가르고 한쪽 기대를 뒤집는다**(tdd §4.2 · P2 배정).
  //   「캐시 부재 시 무엇을 할지」의 **판정 주체가 스크립트 → 서버로 옮겨간다**(D21).
  //   feeds 부재 폴백·summary 부재 fail 의 분기는 **파이프라인 P3** 가 소유한다.
  //   그래서 여기서는 두 CLI 의 기대가 갈린다:
  //     · `wiki.mjs`  — 여전히 fail-loud 다(파이프라인 **P4** 까지 참 · 아래 PU6 그대로 유지)
  //     · `feeds.mjs` — v3 P2 에서 조회가 **라이브 커서 워크**가 되므로 캐시 부재가 실패 사유가
  //       아니게 된다. 기대를 뒤집어 **PU6b** 로 옮긴다.
  it('PU6: 아티팩트가 없는 vault 에서 `wiki.mjs` 가 죽고 stdout 을 흘리지 않는다', () => {
    // ★ 이 상태는 **오늘 성립하지 않는다** — 재생성이 먼저라 부재가 관측될 수 없었다. Task 6 이
    //   그 폴백을 끊으면서 「캐시 부재」가 처음으로 실재한다. plan Task 6 은 _"fail-loud throw 는
    //   유지하되 메시지를 바꾼다"_ 로만 적었고 **그것을 무는 케이스가 없었다**.
    // 앵커: 같은 CLI 가 **아티팩트가 있으면 exit 0 이고 파싱 가능한 JSON 을 낸다**(PU4·TR2 의 arm).
    expect(hitWiki.exitCode, hitWiki.stderr).toBe(0)

    expect(coldWiki.exitCode, `준비 단계 feeds --out exit=${warmFeeds.exitCode}`).not.toBe(0)
    expect(coldWiki.stdout).toBe('')
    // 메시지가 **무엇을 하라는지** 말한다 — "실패했다" 만으로는 사람이 다음 행동을 모른다.
    expect(coldWiki.stderr).toMatch(/빌드|build/i)
  })

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
