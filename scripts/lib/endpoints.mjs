// 3 엔드포인트 레퍼런스 SSOT (D5 · summary/feeds/wiki) — 순수 함수. 서빙 로직 없음.

import { buildWirePayload } from './parse-vault.mjs'
import { walkFeeds } from './git-walk.mjs'
import { buildFeeds, buildSummary } from './payloads.mjs'

/** feeds 기본 상한 — 소비자 DEFAULT_FEED_LIMIT 과 parity(미지정·0 이면 이 값으로 슬라이스). */
const DEFAULT_FEED_LIMIT = 50

/**
 * summary 엔드포인트 — vault 를 on-demand 파싱해 화면 뼈대만 투영한다.
 *
 * @param {string} vault git vault repository root
 * @param {'dev'|'prod'} env
 */
export function summary(vault, env = 'prod') {
  const payload = buildWirePayload(vault, env)
  return buildSummary({
    docs: payload.docs,
    generatedAt: payload.generatedAt,
    sourceCommit: payload.sourceCommit,
    tags: payload.tags,
    tree: payload.tree,
  })
}

/**
 * feeds 엔드포인트 — walkFeeds 가 억제·정렬·커서·상한을 결정하고 여기서는 봉투만 씌운다.
 *
 * `env` 를 walkFeeds 로 배선한다(summary/wiki 와 시그니처 일관) — **prod 는 draft 문서 참조 피드를
 * 제외**한다(F4: env 미전달이면 walkFeeds 가 전체 HEAD 로 resolve 해 prod 에서 draft 피드가 노출됐다).
 *
 * @param {string} vault git vault repository root
 * @param {'dev'|'prod'} env
 * @param {{ after?: object|string, count?: number, from?: string, to?: string }} [window]
 */
export function feeds(vault, env = 'prod', window = {}) {
  const payload = buildWirePayload(vault, env)
  const items = walkFeeds(vault, {
    after: window.after,
    count: window.count ?? DEFAULT_FEED_LIMIT,
    env,
    from: window.from,
    to: window.to,
  })
  return {
    ...buildFeeds({
      generatedAt: payload.generatedAt,
      items,
      sourceCommit: payload.sourceCommit,
    }),
    nextCursor: items.nextCursor ?? null,
  }
}

/**
 * wiki 엔드포인트 — ref(=path, canonical) 문서 1건.
 *
 * active 문서는 본문 4키 + path/status/breadcrumb 를, disable 문서는 summary stub 를 반환한다.
 * 없는 path 는 null 이다.
 *
 * @param {string} vault git vault repository root
 * @param {'dev'|'prod'} env
 * @param {string} ref path(canonical)
 * @returns {object|null}
 */
export function wiki(vault, env = 'prod', ref = '') {
  const payload = buildWirePayload(vault, env)
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
