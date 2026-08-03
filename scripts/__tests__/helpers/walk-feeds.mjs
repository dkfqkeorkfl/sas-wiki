// P5 Task 9(D-I) — 독립 실행형 피드 워크(수집(`collectFeedItems`) + 페이지(`pageFeeds`)의 합성).
//
// **프로덕션 경로는 이것을 부르지 않는다**(P1 부터 그랬다 — 이 파일은 그 성격을 그대로 옮긴 것뿐이다).
// `deepDocGate` 가면이 사라지며 얕은 티어 프로덕션 호출자가 0이 됐고(D-I), 이 함수는 항상 이제
// **깊은 티어**로만 판정한다(`collectFeedItems` → `loadHeadDocState` 가 항상 `runGit` 을 문다).
// 전체 파싱 없이 피드만 훑고 싶은 테스트를 위한 참조 구현으로 남는다.
//
// (vitest 기본 include 는 `*.test.mjs` 만 잡으므로 helpers/*.mjs 는 테스트로 수집되지 않는다 — 의도.)
import path from 'node:path'

import { byRecencyThenId } from '../../lib/feed.mjs'
import { collectFeedItems } from '../../lib/git-walk.mjs'
import { applyIgnoreFeeds, loadIgnoreFeeds } from '../../lib/ignore.mjs'

// ★ v3 P2 — **페이지 합성(`pageFeeds`)이 여기로 내려왔다.** 조회 경로가 커서 기반 라이브 워크
//   (`lib/feed-cursor.mjs`)로 교체되면서 프로덕션 호출자가 0이 됐고, 이 함수가 들고 있던 세 개념이
//   함께 소멸했다: `DEFAULT_FEED_LIMIT` 침묵 폴백(D16) · `from`/`to` ISO 경계(D6) · `{ts,feedId}`
//   객체 커서(D8). 정렬 권위도 JS 재정렬 → git 워크 순서로 이전됐다(D39).
//   `collectFeedItems`(전량 수집)를 그대로 쓰는 **테스트 전용 참조 구현**으로만 남는다 —
//   `walkFeeds` 자신이 P5 에서 같은 이유로 여기 내려온 것과 동일한 조치다.

const DEFAULT_FEED_LIMIT = 50

/**
 * @param {string} vault
 * @param {{ after?: object|string, count?: number, env?: 'dev'|'prod', from?: string,
 *           headState?: object, runGit?: Function, to?: string }} [options]
 */
export function walkFeeds(vault, { after, count, env, from, headState, runGit, to } = {}) {
  const vaultDir = path.resolve(vault)
  const ignoreEntries = loadIgnoreFeeds(vaultDir)
  const collected = collectFeedItems(vaultDir, { env, headState, runGit })
  const paged = pageFeeds(collected.items, ignoreEntries, { after, from, limit: count, to })

  return withMeta(paged.items, paged.nextCursor, collected.stats)
}

export function pageFeeds(items, ignoreEntries, { after, from, limit, to } = {}) {
  const resolvedLimit = typeof limit === 'number' && limit > 0 ? limit : DEFAULT_FEED_LIMIT
  const paged = pageItems(items, ignoreEntries, { after, from, limit: resolvedLimit, to })
  return {
    items: paged.slice(0, resolvedLimit),
    nextCursor:
      paged.length > resolvedLimit ? { feedId: paged[resolvedLimit - 1].id, ts: paged[resolvedLimit - 1].ts } : null, // prettier-ignore
  }
}

function pageItems(items, ignoreEntries, { after, from, limit, to }) {
  const cursor = normalizeCursor(after)
  // F3: from/to 를 epoch 로 1회 정규화해 **숫자 비교**한다(문자열 사전순 금지 — 비-UTC offset 안전).
  const fromMs = parseBoundary(from, 'from')
  const toMs = parseBoundary(to, 'to')
  return applyIgnoreFeeds(items, ignoreEntries)
    .toSorted(byRecencyThenId)
    .filter((item) => fromMs === null || Date.parse(item.ts) >= fromMs)
    .filter((item) => toMs === null || Date.parse(item.ts) <= toMs)
    .filter((item) => cursor === null || byRecencyThenId(item, cursor) > 0)
    .slice(0, limit + 1)
}

/**
 * from/to 경계를 epoch(ms)로 1회 정규화. 미지정 → null. **문자열 비교 금지**(byRecencyThenId 와 동일
 * 사유). 파싱 불가(유효 ISO 아님) → throw: 잘못된 경계로 조용히 오필터(전량 통과/전량 배제)하느니
 * 시끄럽게 끊는다(fail-loud).
 */
function parseBoundary(value, name) {
  if (value === undefined || value === null) return null
  const ms = Date.parse(value)
  if (Number.isNaN(ms)) {
    throw new Error(`pageFeeds ${name} 경계가 유효한 ISO 날짜가 아니다: ${JSON.stringify(value)}`)
  }
  return ms
}

function normalizeCursor(after) {
  if (after === undefined || after === null || after === '') return null
  if (typeof after === 'string') {
    const parsed = JSON.parse(after)
    return normalizeCursor(parsed)
  }
  const id = after.feedId ?? after.id
  if (typeof after.ts !== 'string' || typeof id !== 'string') {
    throw new Error('after cursor must contain ts and feedId')
  }
  return { id, ts: after.ts }
}

function withMeta(items, cursor, stats) {
  Object.defineProperty(items, 'nextCursor', {
    configurable: true,
    enumerable: false,
    value: cursor,
  })
  Object.defineProperty(items, 'stats', {
    configurable: true,
    enumerable: false,
    value: stats,
  })
  return items
}
