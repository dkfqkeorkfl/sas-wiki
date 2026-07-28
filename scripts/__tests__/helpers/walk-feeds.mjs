// P5 Task 9(D-I) — 독립 실행형 피드 워크(수집(`collectFeedItems`) + 페이지(`pageFeeds`)의 합성).
//
// **프로덕션 경로는 이것을 부르지 않는다**(P1 부터 그랬다 — 이 파일은 그 성격을 그대로 옮긴 것뿐이다).
// `deepDocGate` 가면이 사라지며 얕은 티어 프로덕션 호출자가 0이 됐고(D-I), 이 함수는 항상 이제
// **깊은 티어**로만 판정한다(`collectFeedItems` → `loadHeadDocState` 가 항상 `runGit` 을 문다).
// 전체 파싱 없이 피드만 훑고 싶은 테스트를 위한 참조 구현으로 남는다.
//
// (vitest 기본 include 는 `*.test.mjs` 만 잡으므로 helpers/*.mjs 는 테스트로 수집되지 않는다 — 의도.)
import path from 'node:path'

import { collectFeedItems, pageFeeds } from '../../lib/git-walk.mjs'
import { loadIgnoreFeeds } from '../../lib/ignore.mjs'

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
