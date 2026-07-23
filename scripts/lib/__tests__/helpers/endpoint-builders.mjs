// 3 엔드포인트 payload Test Data Builder — endpoints.{summary,feeds,wiki} 계약 테스트 공용 (P5 · tdd §Task 2).
//
// DAMP 경계: 이 파일은 **정상(green) 픽스처만** 만든다 — `expect` 를 넣지 않는다. 위반은 스펙 본문에서
//   **딱 한 곳만** 망가뜨린다 → 무엇이 틀렸는지가 테스트 본문에 보인다. (`*.test.mjs` include 에 안 걸린다.)
//
// **endpoint payload = 미래 서버의 pre-wire 데이터셋**이다(엔드포인트는 순수 함수 레퍼런스 — 서빙 아님).
//   derive 산출(docs·bodies·tree·tags) + raw items(**억제 前**) + ignore tombstone + generatedAt·sourceCommit
//   을 한 봉투에 싣는다. 억제 직교를 **엔드포인트층에서** 검증하려면 raw items 와 ignore 가 함께 실려야 한다
//   (tdd §Task1 GOTCHA). 각 엔드포인트는 자기 슬라이스만 읽는다:
//     summary(payload, env) — docs(draft 마커 포함)·tree·tags 를 env 로 투영(prod=draft 제외 · P2 상속).
//     feeds(payload, {from,to,count}) — items·ignore 를 읽어 applyIgnoreFeeds(억제)→정렬(ts desc·id asc)→슬라이스.
//     wiki(payload, ref) — bodies(active 본문)·docs(disable 스텁)에서 ref(=path) 1건.
//
//   ⚠️ payload 필드 **배치**는 GREEN 재량(계약은 억제→정렬→슬라이스 순서·의미)이나, RED 는 구체 입력이
//   필요하므로 아래 형태를 계약 핸드오프로 고정한다 — GREEN 은 이 형태를 대상으로 구현한다.

import { DOC_A, DOC_B, DOC_D, GENERATED_AT, SOURCE_COMMIT } from './payload-builders.mjs'

export { DOC_A, DOC_B, DOC_D, GENERATED_AT, SOURCE_COMMIT }

/** feeds 봉투 schemaVersion (buildFeeds·buildSummary 와 parity · payloads.mjs SCHEMA_VERSION). */
export const SCHEMA_VERSION = 1

/**
 * endpoint payload world — 각 엔드포인트가 자기 슬라이스만 읽는다.
 * `overrides` 로 **관심 슬라이스만** 채워 무엇이 걸린 입력인지 테스트 본문에 드러낸다(DAMP).
 */
export function aPayload(overrides = {}) {
  return {
    bodies: [],
    docs: [],
    generatedAt: GENERATED_AT,
    ignore: [],
    items: [],
    sourceCommit: SOURCE_COMMIT,
    tags: {},
    tree: [],
    ...overrides,
  }
}

/**
 * raw FeedItem(억제 前) — `id`(12hex feed 커밋해시)·`ts`(정렬 키)를 호출부가 통제한다.
 * 그 외 필드는 "억제=제거만, 내용 무변형 / 정렬은 ts·id 만" 을 드러내는 페이로드다(DAMP).
 */
export function aFeed(id, patch = {}) {
  return {
    body: `본문 ${id.slice(0, 3)}`,
    docs: [{ anchor: null, anchorText: null, id: DOC_A.id }],
    id,
    importance: 'normal',
    keywords: [],
    title: `feed ${id.slice(0, 3)}`,
    ts: '2026-01-01T00:00:00Z',
    ...patch,
  }
}

/** ignore-feeds tombstone 엔트리. applyIgnoreFeeds 는 id 만 읽는다(when 은 감사 메타). */
export function aTombstone(id) {
  return { id, when: '2026-07-23T00:00:00Z' }
}

/** item id 목록(순서 단언용). */
export const ids = (items) => items.map((item) => item.id)

/** item ts 목록(정렬·경계 단언용). */
export const timestamps = (items) => items.map((item) => item.ts)
