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
 * ISO 8601 날짜-시각 리터럴 — `YYYY-MM-DDTHH:mm:ss[.sss](Z|±HH:MM)`.
 *
 * 이 파일이 실제로 받는 두 값이 전부 이 형태다: ① `from`/`to` 호출부 리터럴(예:
 * `'2026-01-01T00:00:00Z'`) ② 커서의 `ts` — git `%aI`(strict ISO 8601, author-date)를 그대로 실은
 * 값(offset 표기, 예: `'2026-01-01T00:00:00+09:00'`). `Date.parse` 는 `"0"`·`"2026"` 같은 비-ISO
 * 문자열도 구현정의 폴백으로 파싱해 유효한 timestamp 를 돌려준다(실측: `Date.parse('0')` →
 * 946652400000, `Date.parse('2026')` → 1767225600000) — 그래서 형태부터 확인한 뒤에만 파싱한다.
 * 프로덕션 커서 형식(`lib/feed-cursor.mjs` 의 `isCursorFormat` — 12-hex 커밋 해시 축약)과는 **다른
 * 축**이다: 그건 라이브 워크의 불투명 커서고, 이건 이 참조 구현이 쓰는 `{ts,feedId}` 객체 커서의
 * `ts` 필드 — import 하지 않고 이 파일 안에 리터럴로 둔다(규범 A · 이 파일 자신이 이미 그렇게
 * 설계돼 있다 — `writeDoc` 의 `wikiRoot` 리터럴 기본값과 같은 원칙).
 */
const ISO_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/u

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

/**
 * `limit` **미지정**(undefined/null)만 `DEFAULT_FEED_LIMIT` 로 조용히 채운다(기존 계약 — 호출부가
 * count 를 안 줘도 되는 자리). 지정했는데 **양의 정수가 아니면 던진다**: 소수(`1.5`)는 `slice(0,
 * limit+1)` 의 경계가 정수 아닌 값에서 뜻이 불분명해지고, `Infinity` 는 그 경계가 사실상 무제한이
 * 되어 이 함수의 존재 이유(페이지 상한)를 무력화한다 — 둘 다 조용히 받아들이면 페이지 경계가
 * 말없이 사라지거나 `TypeError` 로 엉뚱한 자리에서 터진다.
 */
function resolveLimit(limit) {
  if (limit === undefined || limit === null) return DEFAULT_FEED_LIMIT
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new Error(`pageFeeds limit 은 양의 정수여야 한다: ${JSON.stringify(limit)}`)
  }
  return limit
}

export function pageFeeds(items, ignoreEntries, { after, from, limit, to } = {}) {
  const resolvedLimit = resolveLimit(limit)
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
 * 사유). **형태부터 ISO 8601 인지 확인한 뒤에만** 파싱한다 — `Date.parse` 단독으로는 `"0"`·`"2026"`
 * 같은 오타 경계도 구현정의 폴백으로 "유효한" timestamp 를 내어 조용히 다른 필터가 된다(ISO_DATETIME_RE
 * 도크 참조). 형태가 어긋나거나(비-ISO) 형태는 맞는데도 파싱 불가(예: `2026-13-45T00:00:00Z` 같은
 * 존재하지 않는 날짜)면 둘 다 → throw: 잘못된 경계로 조용히 오필터(전량 통과/전량 배제)하느니
 * 시끄럽게 끊는다(fail-loud, 이 파일의 기존 방향과 동일).
 */
function parseBoundary(value, name) {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string' || !ISO_DATETIME_RE.test(value)) {
    throw new Error(
      `pageFeeds ${name} 경계가 유효한 ISO 8601 날짜-시각이 아니다: ${JSON.stringify(value)}`,
    )
  }
  const ms = Date.parse(value)
  if (Number.isNaN(ms)) {
    throw new Error(
      `pageFeeds ${name} 경계가 유효한 ISO 8601 날짜-시각이 아니다: ${JSON.stringify(value)}`,
    )
  }
  return ms
}

/**
 * 커서를 `{ id, ts }` 로 정규화한다. `ts` 는 **형태를 확인**한다(ISO_DATETIME_RE) — 검증 없이 쓰면
 * 오타 커서(`{ ts: '0', feedId: '…' }` 등)가 `byRecencyThenId` 의 `Date.parse` 비교까지 조용히
 * 흘러들어가 페이지 경계가 말없이 어긋난다. `id` 는 형태를 강제하지 않는다(feedId 는 이 파일
 * 밖(`git-walk.mjs`)이 낸 값이고, 이 파일의 책임은 페이지 경계지 id 형식 검증이 아니다).
 */
function normalizeCursor(after) {
  if (after === undefined || after === null || after === '') return null
  if (typeof after === 'string') {
    const parsed = JSON.parse(after)
    return normalizeCursor(parsed)
  }
  const id = after.feedId ?? after.id
  if (typeof after.ts !== 'string' || !ISO_DATETIME_RE.test(after.ts) || typeof id !== 'string') {
    throw new Error(`after 커서는 ISO 8601 ts 와 feedId 를 담아야 한다: ${JSON.stringify(after)}`)
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
