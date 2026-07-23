// @vitest-environment node
//
// P1 · Task 2B — endpoints.feeds 계약 pin (D5 · 3창구 정형화) — tdd §Task 2B
//
// RED 사유: `scripts/lib/endpoints.mjs` **부재** → 지연 import 가 "Cannot find module" 로 throw
//   → 전 케이스 수집 실패 RED. (정적 import 는 소비자 eslint import-x/no-unresolved 로 RED 커밋 차단 → 런타임 지연.)
//
// GFS/RED 정직 표기(behavior 기준): **feeds 는 이 phase 의 진짜 hardening 지점**이다.
//   F1(억제 SSOT 재사용)·F3(동일 ts tie-break)·F4/F5(값 경계 inclusive)·F6/F7(count 상한·기본)·F8(빈 입력)
//   = 🔴RED — endpoints.mjs 를 트리비얼 wrap(=상위 N 만 잘라도) 통과하지 못한다. F2(ts desc)는 정렬 계약.
//   억제 직교·정렬 우회의 hidden 방어는 endpoints.feeds.verify.test.mjs 가 별도로 막는다.
//
// 계약(GREEN 이 구현 — 순서·의미가 계약):
//   feeds(payload, { from, to, count }) →
//     ① applyIgnoreFeeds(payload.items, payload.ignore)  **재사용**(재구현=우회=Complete Mediation 위반)
//     ② 정렬 안정: ts 내림차순 · 동률 id 오름차순 (feed.mjs:133-134 comparator 와 **의미 일치**)
//     ③ from/to = ts **값** 경계(포함, inclusive) · count = **상한**(더 적게 가능) 슬라이스. 억제는 ②③ **전**(직교).
//     → 봉투 { generatedAt, items, schemaVersion, sourceCommit }.
//   from/to/count 미지정 허용. count 미지정·0 → 기본 상한 50(소비자 DEFAULT_FEED_LIMIT parity).
import { describe, expect, it } from 'vitest'

import {
  aFeed,
  aPayload,
  aTombstone,
  GENERATED_AT,
  ids,
  SOURCE_COMMIT,
  timestamps,
} from './helpers/endpoint-builders.mjs'

const { feeds } = await import(new URL('../endpoints.mjs', import.meta.url).href)

// 채택 기본 상한 — 소비자 DEFAULT_FEED_LIMIT 과 parity. SUT 계약 상수(정본 데이터 수 아님).
const DEFAULT_FEED_LIMIT = 50

// 12hex feed id (localeCompare: A < B < C < D < E → tie-break 기대 순서).
const A = 'aaaaaaaaaaaa'
const B = 'bbbbbbbbbbbb'
const C = 'cccccccccccc'
const D = 'dddddddddddd'
const E = 'eeeeeeeeeeee'

// 서로 다른 ts(ISO UTC 는 사전식=시간순). T1 최과거 … T5 최신.
const T1 = '2026-01-01T00:00:00Z'
const T2 = '2026-01-02T00:00:00Z'
const T3 = '2026-01-03T00:00:00Z'
const T4 = '2026-01-04T00:00:00Z'
const T5 = '2026-01-05T00:00:00Z'

/** 개별 ts 를 통제하는 5건 세계관(id 는 ts 역순으로 붙여 "정렬이 실제로 재배열함" 을 드러낸다). */
function fiveByTs() {
  return [aFeed(E, { ts: T1 }), aFeed(D, { ts: T2 }), aFeed(C, { ts: T3 }), aFeed(B, { ts: T4 }), aFeed(A, { ts: T5 })] // prettier-ignore
}

function feedsOf(items, opts = {}, ignore = []) {
  return feeds(aPayload({ ignore, items }), opts)
}

describe('endpoints.feeds — 억제 SSOT 재사용 (🔴RED)', () => {
  it('F1: 억제 tombstone id 를 가진 항목이 출력에 없다', () => {
    const items = [aFeed(A, { ts: T3 }), aFeed(B, { ts: T2 }), aFeed(C, { ts: T1 })]

    const out = feedsOf(items, {}, [aTombstone(B)])

    expect(ids(out.items)).not.toContain(B)
    expect(ids(out.items)).toEqual([A, C]) // 억제 후 정렬(ts desc)
  })
})

describe('endpoints.feeds — 정렬 안정 (🔴RED)', () => {
  it('F2: 출력 ts 는 내림차순(최신 우선)이다', () => {
    const out = feedsOf(fiveByTs())

    expect(timestamps(out.items)).toEqual([T5, T4, T3, T2, T1])
  })

  it('F3: 동일 ts 는 id 오름차순으로 tie-break 된다(입력 순서 무의존·결정적)', () => {
    // 같은 ts 3건을 **뒤섞어** 입력한다. tie-break 없는 순진 정렬(V8 stable)은 입력 순서 [C,A,B] 를
    // 보존해 실패한다 — 소비자 takeLatest(Date.parse 차분, tie-break 부재)가 정확히 그 함정이다.
    const sameTs = [aFeed(C, { ts: T3 }), aFeed(A, { ts: T3 }), aFeed(B, { ts: T3 })]

    const out = feedsOf(sameTs)

    expect(ids(out.items)).toEqual([A, B, C])
  })
})

describe('endpoints.feeds — 값 경계 슬라이스 (🔴RED, inclusive)', () => {
  it('F4: from=T3 → 모든 출력 ts >= T3, 경계값(T3) 포함', () => {
    const out = feedsOf(fiveByTs(), { from: T3 })

    expect(timestamps(out.items)).toEqual([T5, T4, T3])
    expect(timestamps(out.items).every((ts) => ts >= T3)).toBe(true)
  })

  it('F5: to=T3 → 모든 출력 ts <= T3, 경계값(T3) 포함', () => {
    const out = feedsOf(fiveByTs(), { to: T3 })

    expect(timestamps(out.items)).toEqual([T3, T2, T1])
    expect(timestamps(out.items).every((ts) => ts <= T3)).toBe(true)
  })

  it('F4+F5: from/to 동시 = 닫힌 구간 [T2, T4] (양끝 포함)', () => {
    const out = feedsOf(fiveByTs(), { from: T2, to: T4 })

    expect(timestamps(out.items)).toEqual([T4, T3, T2])
  })
})

describe('endpoints.feeds — count 상한 (🔴RED)', () => {
  it('F6a: count < 가용 → 정확히 count건(최신순 상위)', () => {
    const out = feedsOf(fiveByTs(), { count: 3 })

    expect(timestamps(out.items)).toEqual([T5, T4, T3])
  })

  it('F6b: count > 가용 → 전량(상한이지 요구량이 아님)', () => {
    const out = feedsOf(fiveByTs(), { count: 10 })

    expect(out.items).toHaveLength(5)
  })

  it('F7: count 미지정 → 기본 상한 50, count=2 대조군과 상이(Green Bar 방지)', () => {
    // 합성 60건(정본 데이터 수 아님) — 기본 상한이 실제 슬라이스함을 드러낸다.
    const many = Array.from({ length: 60 }, (_, i) =>
      aFeed(String(i).padStart(12, '0'), { ts: `2026-01-01T00:00:${String(i).padStart(2, '0')}Z` }),
    )

    expect(feedsOf(many)).toHaveProperty('items')
    expect(feedsOf(many).items).toHaveLength(DEFAULT_FEED_LIMIT)
    expect(feedsOf(many, { count: 2 }).items).toHaveLength(2)
  })

  it('F7b: count=0 → 미지정과 동일하게 기본 상한으로 취급한다', () => {
    const many = Array.from({ length: 60 }, (_, i) =>
      aFeed(String(i).padStart(12, '0'), { ts: `2026-01-01T00:00:${String(i).padStart(2, '0')}Z` }),
    )

    expect(feedsOf(many, { count: 0 }).items).toHaveLength(DEFAULT_FEED_LIMIT)
  })
})

describe('endpoints.feeds — 봉투·경계 (🔴RED)', () => {
  it('F8: 빈 items → items=[]·유효 봉투, throw 없음', () => {
    const out = feedsOf([])

    expect(out.items).toEqual([])
    expect(Object.keys(out).toSorted()).toEqual([
      'generatedAt',
      'items',
      'schemaVersion',
      'sourceCommit',
    ])
    expect(out.schemaVersion).toBe(1)
    expect(out.generatedAt).toBe(GENERATED_AT)
    expect(out.sourceCommit).toBe(SOURCE_COMMIT)
  })
})
