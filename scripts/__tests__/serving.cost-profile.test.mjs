// @vitest-environment node
//
// P5 · Task 3·4·9 — 비용 프로파일 · **런타임 로드 관측** · 얕은 티어 근절 (D-I·D-J) — tdd §3.6 (TR1~TR6)
//
// 이 파일이 `serving.cost-tier.test.mjs`(CT1)를 **교체**한다(§4.1 ①). CT1 의 전제(_서빙 파싱은 얕다_)는
//   Task 9 로 소멸하지만 그것이 지키려던 것("서빙이 문서당 git 을 팔지 않는다")은 더 강한 형태로
//   남는다 — **히트 경로의 git 호출 multiset === `[['rev-parse','HEAD']]`**. 삭제가 아니라 교체다.
//
// ★ 「git spawn 0」은 **도달 불가**다(tdd §12 ① · 메인 재측정). 신선도 판정이 `rev-parse HEAD` 를
//   반드시 내며 그것이 D1 의 신선도 정의 자체다. 도달 불가 목표를 남기면 그 단언은 영원히 red 이거나
//   (정직) 조용히 완화된다(위험). 그래서 **multiset 동치**로 못박는다.
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
//   · TR4 — **pair**(오늘도 green). 재생성 경로는 반대 방향이다 — "아예 재생성을 못 하는 구현" 배제.
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

/** 히트 경로의 git 호출 계약 — **리터럴 argv**다(규범 A: 프로덕션 상수로 기대값을 만들지 않는다). */
const HIT_GIT_CALLS = [['rev-parse', 'HEAD']]

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
let hitFeeds
let hitWiki
let warm

beforeAll(async () => {
  // 워밍 vault — 드리프트 없는 대조 vault(문서 2건 + 피드 1건). 아티팩트를 먼저 발행해 둔다.
  const control = seedControlVault()
  tmps.push(control.vault)
  warm = runCliWithLoadLog('summary.mjs', ['--env', 'dev', '--status'], { vault: control.vault })

  hitFeeds = runCliWithLoadLog('feeds.mjs', ['--env', 'dev'], { vault: control.vault })
  hitWiki = runCliWithLoadLog('wiki.mjs', ['--env', 'dev', '--path', DRIFT_REL], {
    vault: control.vault,
  })

  // 콜드 arm — 아티팩트가 **없는** vault. 재생성 경로가 실제로 무엇을 하는지의 대조군이다.
  const cold = seedControlVault()
  tmps.push(cold.vault)
  coldFeeds = runCliWithLoadLog('feeds.mjs', ['--env', 'dev'], { vault: cold.vault })
}, 240_000)

const countUrls = (observation, fragment) =>
  observation.loadedUrls.filter((url) => url.includes(fragment)).length
const gitVerbs = (observation) =>
  observation.gitCalls.map((argv) => argv.filter((token) => !token.startsWith('-')).join(' '))

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

describe('히트 경로 git 프로파일 (TR1·TR2 · 🔴RED flip: 오늘 매 요청 재파싱)', () => {
  it('TR1: `feeds.mjs` 히트 실행의 git 호출 multiset === `[["rev-parse","HEAD"]]`', () => {
    // 앵커: 같은 하네스의 **콜드 실행**에서는 `log`·`show`·`rev-list` 가 실제로 나온다 — shim 이
    //   죽어서 0건인 것이 아니다(부재 단언 앞의 위험 실재 · 규범 B).
    expect(warm.exitCode).toBe(0)
    expect(coldFeeds.exitCode).toBe(0)
    expect(coldFeeds.gitCalls.length).toBeGreaterThan(HIT_GIT_CALLS.length)
    expect(gitVerbs(coldFeeds).some((verb) => verb.startsWith('rev-list'))).toBe(true)
    expect(gitVerbs(coldFeeds).some((verb) => verb.startsWith('log'))).toBe(true)

    expect(hitFeeds.exitCode).toBe(0)
    expect(hitFeeds.gitCalls).toEqual(HIT_GIT_CALLS)
  })

  it('TR2: `wiki.mjs` 히트 실행도 동상 (두 CLI 를 **각각** 문다)', () => {
    // 하나만 고친 구현을 배제한다 — D-E 와 D-F 는 서로 다른 Task 다.
    expect(hitWiki.exitCode).toBe(0)
    expect(hitWiki.gitCalls).toEqual(HIT_GIT_CALLS)
  })
})

describe('런타임 로드 관측 — 규범 G (TR3·TR5 · 🔴RED 오늘 툴체인을 실행한다 · CX-J′·CX-K)', () => {
  it('TR3: `feeds.mjs` 히트 실행이 렌더·파생·파싱 툴체인을 **실행하지 않는다**', () => {
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

describe('짝 가드 — 재생성 경로는 반대 방향이다 (TR4 · 🟩pair)', () => {
  it('TR4: 콜드(아티팩트 부재) 실행에서는 `parse-vault`·`render` 를 **로드한다**', () => {
    // "아예 재생성을 못 하는 구현" 배제 + **동적 import 가 실제로 열린다는 증거**. TR3 과 정확히
    //   반대 방향이다(P4 REFACTOR 가 찾은 구멍 ① — 되돌림 방향을 한쪽만 보는 CX 를 구조로 막는다).
    expect(countUrls(coldFeeds, PARSE_VAULT)).toBeGreaterThan(0)
    expect(countUrls(coldFeeds, RENDER)).toBeGreaterThan(0)
    expect(countUrls(coldFeeds, NODE_MODULES)).toBeGreaterThan(0)
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
