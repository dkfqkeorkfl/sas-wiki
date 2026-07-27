// @vitest-environment node
//
// P5 — **드리프트 반전** (B7·B8 의 직접 반전) — tdd §3.5 (DR0~DR6) · **이 phase 의 중심**
//
// 무엇이 결함인가: P3 이 세운 _"서빙되는 데이터 = 검증 통과 데이터"_ 가 지금 `summary` 에만 성립한다.
//   생성기는 깊은 티어로 `ID_TAMPERED`·`DELETED_ID_REUSE` 문서를 제외하는데, `feeds`·`wiki` 는 얕은
//   티어로 자체 재파싱하므로 **그 문서를 계속 서빙한다**. 피드 카드는 열리지 않는 문서를 가리키고
//   (B7), 문서 라우트는 제외된 문서의 본문을 렌더해 내보낸다(B8).
//
// ★ 왜 픽스처가 반드시 필요한가(tdd M7): 실 vault 는 dev·prod 모두 얕은/깊은 티어 결과가 **완전히
//   같다**(드리프트 0건). 그래서 실 vault 로 이 반전을 검증하려는 시도는 전부 공허하고, 클린 vault
//   에서는 전환 전후 출력이 **바이트 동일**이라 전환이 일어났는지조차 알 수 없다(B13). 이 파일과
//   `serving.cost-profile.test.mjs`(TR)와 §6 CX-E·CX-E′ 셋이 그 공백을 나눠 막는다.
//
// ★ 왜 시간축이 아니라 대조군인가: GREEN 이후에는 "전환 전" 을 재현할 수 없다. 그래서 arm 셋을
//   겹친다 — ① **티어 대조**(DR0) ② **대조 vault**(DR1~DR3·DR5·DR6 의 앵커) ③ **동시대 얕은 참조
//   경로**(DR4). Task 9 가 얕은 티어를 없애면 ③이 소멸하고 그 자리를 ①이 잇는다(§4.5 ㉒).
//
// RED 사유:
//   · DR2·DR3·DR5·DR6 — **RED(flip)**. 오늘 `feeds`·`wiki` 는 드리프트 문서를 그대로 서빙한다(실측).
//   · DR0·DR1·DR4 — **pair·pin**(오늘도 green). 앵커이므로 red 가 아닌 것이 정상이다.
//
// 관측 층(tdd §7.5): 순수 판정(DR0) · 깊은 티어 wire(DR1 — 생성기가 그 값을 **그대로** 아티팩트에
//   스탬프한다) · 엔드포인트 반환값(DR2·DR3·DR5·DR6) · 얕은 참조 경로(DR4). 파일·프로세스는 안 본다.
//   소비자 종단(404·카드)은 **HV7** 이 별도로 문다.
//
// 규범 A·F: 픽스처의 id·경로·제목은 헬퍼가 리터럴로 소유하고, 실 vault 는 읽지도 쓰지도 않는다.
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterAll, describe, expect, it } from 'vitest'

import { judgeDocs } from '../lib/doc-gate.mjs'
import { WIKI_PREFIX, loadHeadDocState } from '../lib/head-state.mjs'
import { buildWirePayload, parseVault } from '../lib/parse-vault.mjs'
import { makeGitRunner } from '../lib/git.mjs'
import { loadSchema } from '../lib/validate.mjs'
import { cleanup } from './helpers/tmp-git-vault.mjs'
import {
  DRIFT_FEED_TITLE,
  DRIFT_MARKER,
  DRAFT_FEED_TITLE,
  HEALTHY_MARKER,
  HEALTHY_REL,
  ID_ORIGINAL,
  seedControlVault,
  seedDraftRefVault,
  seedIdReuseVault,
  seedTamperedVault,
} from './helpers/drifted-vault.mjs'

const feedsModule = await import(new URL('../feeds.mjs', import.meta.url).href)
const wikiModule = await import(new URL('../wiki.mjs', import.meta.url).href)

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SCHEMA_DIR = path.resolve(HERE, '..', 'schema')

/** 깊은 티어가 더하는 사유 2종 — **리터럴**이다(`REASON_CODES` 를 import 하지 않는다 · 규범 A). */
const ID_TAMPERED = 'ID_TAMPERED'
const DELETED_ID_REUSE = 'DELETED_ID_REUSE'

/** 위키 루트 접두사 — 리터럴이다. 드리프트 감지는 기존 트립와이어(PR5)가 담당한다. */
const WIKI_ROOT_PREFIX = 'wiki/'

const tmps = []
afterAll(() => cleanup(...tmps))

const feeds = (vault, env, window = {}) => {
  if (typeof feedsModule.feeds !== 'function') throw new Error('[RED] feeds export 가 없다')
  return feedsModule.feeds(vault, env, window)
}
const wiki = (vault, env, ref) => {
  if (typeof wikiModule.wiki !== 'function') throw new Error('[RED] wiki export 가 없다')
  return wikiModule.wiki(vault, env, ref)
}

const track = (seeded) => {
  tmps.push(seeded.vault)
  return seeded
}

/** 깊은 티어 wire — 생성기가 `buildSummary` 로 **그대로** 아티팩트에 스탬프하는 그 값이다. */
const deepWire = (vault, env) => parseVault(vault, env, SCHEMA_DIR, { deepDocGate: true }).wire

const itemByTitle = (page, title) => page.items.find((item) => item.title === title)
const docIdsOf = (item) => (item?.docs ?? []).map((doc) => doc.id)

describe('픽스처가 실제로 드리프트다 — 티어 대조 (DR0 · 🟩pair · 전 DR 의 앵커)', () => {
  it('DR0: 같은 문서 집합을 깊은 판정은 제외하고 얕은 판정은 제외하지 않는다', () => {
    // ★ P1 FP4 의 교훈("픽스처가 겨냥한 조건에 도달조차 못 한 채 green")을 이 픽스처에 적용한다.
    //   Task 9 가 얕은 티어를 없애도 `ctx.runGit` 옵션은 남으므로(§4.6) 이 대조는 계속 유효하다 —
    //   **DR4 의 자리를 잇는 것이 바로 이 케이스다**(§4.5 ㉒).
    const { vault } = track(seedTamperedVault())
    const schema = loadSchema(path.join(SCHEMA_DIR, 'wiki-doc.schema.json'))
    const state = loadHeadDocState(vault, 'dev', {})
    const ctx = {
      strayPaths: state.strayDocPaths,
      wikiPrefix: WIKI_ROOT_PREFIX,
      wikiSchema: schema,
    }

    const shallow = judgeDocs(state.parsedDocs, ctx)
    const deep = judgeDocs(state.parsedDocs, { ...ctx, runGit: makeGitRunner(vault) })

    // 앵커: 픽스처에 문서가 실제로 있다(빈 집합에서 0 == 0 으로 통과하는 것을 배제).
    expect(state.parsedDocs.length).toBeGreaterThan(1)
    expect(WIKI_PREFIX).toBe(WIKI_ROOT_PREFIX) // 리터럴이 소유자와 어긋나면 픽스처가 헛돈다

    expect(shallow.excluded.map((entry) => entry.reasonCode)).toEqual([])
    expect(deep.excluded.map((entry) => entry.reasonCode)).toEqual([ID_TAMPERED])
  })
})

describe('생성기 티어는 드리프트 문서를 제외한다 (DR1 · 🟢pin · 대조군 앵커)', () => {
  it('DR1: 드리프트 vault 의 깊은 티어 `docs` 에 그 문서가 **없고** 대조 vault 에는 **있다**', () => {
    const drifted = track(seedTamperedVault())
    const control = track(seedControlVault())

    const driftedIds = deepWire(drifted.vault, 'dev').docs.map((doc) => doc.id)
    const controlIds = deepWire(control.vault, 'dev').docs.map((doc) => doc.id)

    // 앵커: 대조 vault 에는 **있다** — 이 행이 없으면 DR2·DR3 의 "없다" 가 무엇 때문인지 모른다.
    expect(controlIds).toContain(ID_ORIGINAL)
    expect(driftedIds).not.toContain(ID_ORIGINAL)
    expect(driftedIds.length).toBeGreaterThan(0) // 전멸이 아니라 그 한 건만 빠졌다
  })
})

describe('B7 반전 — 피드는 살되 제외 문서를 가리키지 않는다 (DR2 · 🔴RED flip)', () => {
  it('DR2: 드리프트 vault 의 피드가 **생존**하되 `docs === []` 다', async () => {
    const drifted = track(seedTamperedVault())
    const control = track(seedControlVault())

    const driftedPage = await feeds(drifted.vault, 'dev', {})
    const controlPage = await feeds(control.vault, 'dev', {})

    // 앵커 ①: 대조 vault 에서는 그 문서를 **가리킨다**(사유 판정이 죽어서 전부 빈 것을 배제).
    expect(docIdsOf(itemByTitle(controlPage, DRIFT_FEED_TITLE))).toEqual([ID_ORIGINAL])
    // 앵커 ②: 드리프트 vault 에서도 **피드 자체는 응답에 있다**(통째로 사라져 통과하는 것을 배제).
    expect(itemByTitle(driftedPage, DRIFT_FEED_TITLE)).toBeDefined()

    expect(docIdsOf(itemByTitle(driftedPage, DRIFT_FEED_TITLE))).toEqual([])
  })
})

describe('B8 반전 — 제외 문서의 본문을 서빙하지 않는다 (DR3 · 🔴RED flip)', () => {
  it('DR3: 드리프트 문서 조회가 `null` 이고 대조 vault 의 같은 path 는 본문을 준다', async () => {
    const drifted = track(seedTamperedVault())
    const control = track(seedControlVault())

    // 앵커 ①: 대조 vault 의 같은 path 는 non-null 이고 본문 마커가 있다.
    const controlDoc = await wiki(control.vault, 'dev', drifted.tamperedRel)
    expect(controlDoc).not.toBeNull()
    expect(controlDoc.html).toContain(DRIFT_MARKER)

    // 앵커 ②: 같은 드리프트 vault 의 **정상 문서**는 여전히 non-null(전부 null 인 구현 배제).
    const healthy = await wiki(drifted.vault, 'dev', HEALTHY_REL)
    expect(healthy).not.toBeNull()
    expect(healthy.html).toContain(HEALTHY_MARKER)

    expect(await wiki(drifted.vault, 'dev', drifted.tamperedRel)).toBeNull()
  })
})

describe('동시대 증거 — 얕은 참조 경로는 아직 그 문서를 담는다 (DR4 · 🟢pin · Task 9 에서 재홈)', () => {
  it('DR4: `buildWirePayload`(얕은 티어)는 드리프트 문서를 **여전히** `docs` 에 담는다', () => {
    // ★ plan 비공허성 요구 ② 의 "전환 **전**" 축이다 — 오늘의 서빙이 무엇을 내보내고 있었는지를
    //   같은 커밋 안에서 증거로 남긴다. **Task 9 가 얕은 티어를 없애면 이 arm 이 소멸하고**
    //   DR0 이 그 역할을 잇는다(§4.5 ㉒ — 삭제가 아니라 이동이며 스펙 주석에 사유를 남긴다).
    const drifted = track(seedTamperedVault())
    const pathsOf = (docs) => docs.map((doc) => doc.breadcrumb.join('/'))

    expect(pathsOf(buildWirePayload(drifted.vault, 'dev').docs)).toContain(drifted.tamperedRel)
    // 앵커: 같은 vault 를 깊은 티어로 보면 그 경로가 **빠진다** — 두 경로의 결과가 실제로 갈린다.
    expect(pathsOf(deepWire(drifted.vault, 'dev').docs)).not.toContain(drifted.tamperedRel)
  })
})

describe('서빙 극성 반전 금지 (DR5 · 🔴RED 오늘 사유 자체가 안 생긴다 · CX-F)', () => {
  it('DR5: 드리프트 참조 피드는 prod 에서도 **생존**(fail-open) · draft 참조 피드는 **사라진다**', async () => {
    // ★ R2 D3 가 경고한 오라벨(`ID_TAMPERED` → `draft-excluded`)을 배제한다. 두 사유는 서빙 극성이
    //   **반대**라 오분류가 곧 서빙 오류다 — 그래서 극성 대조군(draft)을 같은 케이스에 둔다.
    const drifted = track(seedTamperedVault())
    const draftRef = track(seedDraftRefVault())

    const driftedProd = await feeds(drifted.vault, 'prod', {})
    const draftProd = await feeds(draftRef.vault, 'prod', {})
    const draftDev = await feeds(draftRef.vault, 'dev', {})

    // 앵커: 극성 대조가 **실재한다** — draft 참조 피드는 dev 에 있고 prod 에서 사라진다(fail-closed).
    expect(itemByTitle(draftDev, DRAFT_FEED_TITLE)).toBeDefined()
    expect(itemByTitle(draftProd, DRAFT_FEED_TITLE)).toBeUndefined()

    // 본 단언: 드리프트 참조 피드는 prod 에서도 살아 있되 문서를 가리키지 않는다(fail-open).
    expect(itemByTitle(driftedProd, DRIFT_FEED_TITLE)).toBeDefined()
    expect(docIdsOf(itemByTitle(driftedProd, DRIFT_FEED_TITLE))).toEqual([])
  })
})

describe('두 번째 깊은 사유도 같은 반전 (DR6 · 🔴RED flip)', () => {
  it('DR6: `DELETED_ID_REUSE` vault 에서도 피드 docs 는 비고 문서 조회는 `null` 이다', async () => {
    // 한 사유만 고친 구현을 배제한다 — 깊은 티어가 더하는 판정은 정확히 둘뿐이다(B6).
    const reuse = track(seedIdReuseVault())

    // 앵커: 깊은 티어가 실제로 그 사유로 제외한다(픽스처가 겨냥한 조건에 도달했다).
    const state = loadHeadDocState(reuse.vault, 'dev', { deepDocGate: true })
    expect(state.excluded.map((entry) => entry.reasonCode)).toEqual([DELETED_ID_REUSE])

    const page = await feeds(reuse.vault, 'dev', {})
    const item = page.items.at(0)
    expect(item).toBeDefined() // 피드 자체는 생존한다(fail-open)
    expect(docIdsOf(item)).toEqual([])

    expect(await wiki(reuse.vault, 'dev', reuse.reusedRel)).toBeNull()
  })
})
