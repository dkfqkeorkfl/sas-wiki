// 3 엔드포인트 레퍼런스 SSOT (D5 · summary/feeds/wiki) — 순수 함수. 서빙 로직 없음.
//
// 미래 sas-wiki 서버는 이 세 함수를 HTTP 뒤에 **배선만** 한다(design-first — 계약 now / 서빙 later).
// 현 소비자(webfront news 씬)는 같은 계약을 회귀 없이 소비한다. 이 파일은 계약의 SSOT 이며,
// 억제·투영·봉투는 기존 SSOT(ignore.mjs·payloads.mjs)를 **재사용**한다 — 재구현은 두 번째 경로
// (우회)이므로 금지한다(Complete Mediation — Saltzer & Schroeder).
//
// 입력 payload = 미래 서버의 pre-wire 데이터셋이다. 각 함수는 자기 슬라이스만 읽는다:
//   summary — docs(draft 마커 포함)·tree·tags 를 env 로 투영(prod=draft 제외).
//   feeds   — items(억제 前)·ignore 를 읽어 억제 → 정렬 → 슬라이스.
//   wiki    — bodies(active 본문)·docs(disable 스텁)에서 ref(=path) 1건.

import { applyIgnoreFeeds } from './ignore.mjs'
import { buildFeeds, buildSummary } from './payloads.mjs'

/** feeds 기본 상한 — 소비자 DEFAULT_FEED_LIMIT 과 parity(미지정·0 이면 이 값으로 슬라이스). */
const DEFAULT_FEED_LIMIT = 50

/**
 * 피드 결정성 comparator — feed.mjs:133-134 와 **의미 일치**: ts 내림차순, 동률이면 id 오름차순.
 * 동률 tie-break 를 빼면 동일 ts 클러스터의 순서가 입력 의존(비결정)이 된다.
 */
const byRecencyThenId = (a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : a.id.localeCompare(b.id))

/**
 * summary 엔드포인트 — 화면 뼈대(부팅 페이로드).
 *
 * env='prod' 는 draft 문서를 제외한다(build.mjs visibleDocs 상속). env='dev' 는 전량 포함.
 * 투영(active 10키 / disable 4키)은 buildSummary 를 재사용한다 — 부팅에 본문이 새지 않는다.
 *
 * @param {{ docs: object[], generatedAt: string, sourceCommit: string, tags: object, tree: object[] }} payload
 * @param {'dev'|'prod'} env
 */
export function summary(payload, env) {
  const docs = env === 'prod' ? payload.docs.filter((doc) => doc.draft !== true) : payload.docs
  return buildSummary({
    docs,
    generatedAt: payload.generatedAt,
    sourceCommit: payload.sourceCommit,
    tags: payload.tags,
    tree: payload.tree,
  })
}

/**
 * feeds 엔드포인트 — 억제(P4 SSOT) → 정렬 안정 → from/to·count 슬라이스.
 *
 * 합성 순서가 계약이다: ① applyIgnoreFeeds 재사용(억제는 슬라이스 **전** — 직교) → ② byRecencyThenId
 * 정렬(ts desc·동률 id asc) → ③ from/to = ts **값** 경계(포함, inclusive) · count = **상한**(더 적게 가능).
 * count 미지정·0 → DEFAULT_FEED_LIMIT. 봉투는 buildFeeds 재사용(schemaVersion=1).
 *
 * @param {{ items: object[], ignore: object[], generatedAt: string, sourceCommit: string }} payload
 * @param {{ from?: string, to?: string, count?: number }} [window]
 */
export function feeds(payload, { count, from, to } = {}) {
  const limit = typeof count === 'number' && count > 0 ? count : DEFAULT_FEED_LIMIT
  const items = applyIgnoreFeeds(payload.items, payload.ignore)
    .toSorted(byRecencyThenId)
    .filter(
      (item) => (from === undefined || item.ts >= from) && (to === undefined || item.ts <= to),
    )
    .slice(0, limit)
  return buildFeeds({ generatedAt: payload.generatedAt, items, sourceCommit: payload.sourceCommit })
}

/**
 * wiki 엔드포인트 — ref(=path, canonical) 문서 **1건**.
 *
 * active 본문은 payload.bodies(breadcrumb 키잉)에서, disable 스텁은 payload.docs 에서 소싱한다.
 * active 문서는 항상 대응 body 가 있어 bodies 에서 먼저 잡히므로, docs 로 떨어지는 건 body 없는
 * disable 스텁뿐이다. 없는 path → null(throw 아님). 요청 path 문서만 반환(이웃 본문 격리).
 *
 * @param {{ bodies: object[], docs: object[] }} payload
 * @param {string} ref path(canonical)
 * @returns {object|null}
 */
export function wiki(payload, ref) {
  const body = payload.bodies.find((record) => record.breadcrumb.join('/') === ref)
  if (body) return projectBody(body, ref)

  const stub = payload.docs.find((doc) => doc.breadcrumb.join('/') === ref)
  return stub ?? null
}

/** active 본문 레코드 → 본문 4키 + 식별메타(path·status·breadcrumb). body 내부(md 등) 누출 차단. */
function projectBody(record, ref) {
  return {
    breadcrumb: record.breadcrumb,
    headings: record.headings,
    html: record.html,
    meta: record.meta,
    path: ref,
    sources: record.sources,
    status: record.status,
  }
}
