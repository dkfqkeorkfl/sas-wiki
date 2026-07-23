// @vitest-environment node
//
// P1 (hidden verify) · Task 2D — endpoints.feeds spec-gaming 차단 — tdd §Task 2D
//
// 규약: `*.verify.test.*` 는 **GREEN 완료 후**에만 판정에 쓴다(RED 작성자·GREEN 구현자 비노출 계약).
//   visible F1~F8 만으로는 "억제·정렬을 무시하고 상위 N 만 잘라도" 통과할 수 있다 — 아래가 그 우회를 막는다.
//
// RED 사유: `scripts/lib/endpoints.mjs` **부재** → 지연 import 가 "Cannot find module" 로 throw → 전 케이스 RED.
//   ⚠️ 이 파일은 **참조 구현(reference)** 을 P4 SSOT `applyIgnoreFeeds`(실존 · 정적 import 가능) + 명세
//   comparator(feed.mjs:133-134 의미) 로 **독립 재현**해 feeds 출력과 deep-equal 한다. 재현이 아니라
//   feeds 의 억제가 SSOT 와 조금이라도 다르면(다른 필드 매칭·억제 생략·slice-후-억제) 갈려서 실패한다
//   → 억제 재사용(Complete Mediation)과 정렬·오프셋 무드리프트를 behavior 로 강제한다(구현 디테일 스파이 아님).
//
// 라벨: V1(억제 직교 우회)·V2(정렬·tie-break 우회)·V3(offset 드리프트) 전부 🔴RED.
import { describe, expect, it } from 'vitest'

import { applyIgnoreFeeds } from '../ignore.mjs'
import { aFeed, aPayload, aTombstone, ids, timestamps } from './helpers/endpoint-builders.mjs'

const { feeds } = await import(new URL('../endpoints.mjs', import.meta.url).href)

const DEFAULT_FEED_LIMIT = 50

const A = 'aaaaaaaaaaaa'
const B = 'bbbbbbbbbbbb'
const C = 'cccccccccccc'
const D = 'dddddddddddd'
const E = 'eeeeeeeeeeee'

const T1 = '2026-01-01T00:00:00Z'
const T2 = '2026-01-02T00:00:00Z'
const T3 = '2026-01-03T00:00:00Z'
const T4 = '2026-01-04T00:00:00Z'
const T5 = '2026-01-05T00:00:00Z'

/** 명세 comparator — feed.mjs:133-134 와 **의미 일치**(ts 내림차순 · 동률 id 오름차순). */
const COMPARATOR = (a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : a.id.localeCompare(b.id))

/**
 * 명세 파이프라인의 **독립 재현**: SSOT applyIgnoreFeeds(억제) → 정렬 → from/to(포함)/count(상한) 슬라이스.
 * feeds 가 이와 갈리면(우회) 실패한다 — 이것이 억제 재사용·정렬·무드리프트의 behavior 게이트다.
 */
function expectedItems(items, ignore, { count, from, to } = {}) {
  const limit = typeof count === 'number' && count > 0 ? count : DEFAULT_FEED_LIMIT
  return applyIgnoreFeeds(items, ignore)
    .toSorted(COMPARATOR)
    .filter((it) => (from === undefined || it.ts >= from) && (to === undefined || it.ts <= to))
    .slice(0, limit)
}

function feedsItems(items, ignore, opts) {
  return feeds(aPayload({ ignore, items }), opts).items
}

describe('endpoints.feeds.verify — 억제 ⟂ 슬라이스 (V1 🔴RED)', () => {
  it('V1: top-N 창 안 항목 억제 시 결과 == applyIgnoreFeeds→정렬→slice, count 정확', () => {
    // T4(id=B)는 정렬 후 상위 3 창 [T5,T4,T3] 안에 있다 → slice-후-억제면 length 2 로 새고, 억제-후-slice 면 T2 가 승격.
    const items = [aFeed(E, { ts: T1 }), aFeed(D, { ts: T2 }), aFeed(C, { ts: T3 }), aFeed(B, { ts: T4 }), aFeed(A, { ts: T5 })] // prettier-ignore
    const ignore = [aTombstone(B)]
    const opts = { count: 3 }

    const got = feedsItems(items, ignore, opts)

    expect(got).toEqual(expectedItems(items, ignore, opts))
    expect(got).toHaveLength(3) // 억제-후-slice: 창이 여전히 꽉 찬다(슬라이스-후-억제면 2)
    expect(ids(got)).not.toContain(B)
  })
})

describe('endpoints.feeds.verify — 정렬·tie-break 우회 (V2 🔴RED)', () => {
  it('V2: 뒤섞인 입력(동일 ts 클러스터 포함) → 명세 comparator 정렬 결과, 입력 순서 무의존', () => {
    // 동일 ts=T3 클러스터 {C,E,D} + A@T5, B@T4 를 뒤섞어 입력. 기대: [A, B, C, D, E](ts desc, 동률 id asc).
    const scrambled = [aFeed(C, { ts: T3 }), aFeed(A, { ts: T5 }), aFeed(E, { ts: T3 }), aFeed(B, { ts: T4 }), aFeed(D, { ts: T3 })] // prettier-ignore

    const got = feedsItems(scrambled, [], {})

    expect(got).toEqual(expectedItems(scrambled, [], {}))
    expect(ids(got)).toEqual([A, B, C, D, E])
  })
})

describe('endpoints.feeds.verify — offset 무드리프트 (V3 🔴RED)', () => {
  it('V3: 창 안 억제로 빠진 자리를 다음 최신 항목이 채운다(구멍·undefined 없음)', () => {
    // T3(id=C) 억제. 억제 없으면 top-3 = [T5,T4,T3]. C 억제 → 3번째 슬롯을 T2 가 **승격**해 채운다.
    const items = [aFeed(E, { ts: T1 }), aFeed(D, { ts: T2 }), aFeed(C, { ts: T3 }), aFeed(B, { ts: T4 }), aFeed(A, { ts: T5 })] // prettier-ignore
    const ignore = [aTombstone(C)]
    const opts = { count: 3 }

    const got = feedsItems(items, ignore, opts)

    expect(got).toHaveLength(3) // 드리프트로 length 2 가 되면 안 된다
    expect(timestamps(got)).toEqual([T5, T4, T2]) // T3 자리를 T2 가 승격해 채움(offset 무드리프트)
    expect(got.every((item) => item && typeof item.ts === 'string')).toBe(true) // 구멍/undefined 없음
  })
})
