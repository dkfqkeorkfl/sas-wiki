// @vitest-environment node
//
// P1 · Task 2 — 단일 choke-point 필터 + hygiene (순수 함수) — tdd §3 Task 2
//
// RED 사유: `scripts/lib/ignore.mjs` 부재 → 아래 지연 import 가 "Cannot find module" 로 throw →
//   모듈 수집 실패(전 케이스 RED). 정적 import 로 적으면 eslint import-x/no-unresolved 가
//   pre-commit(lint-staged)에서 **RED 커밋 자체를 막는다** → 해석을 런타임으로 미룬다.
//   (전례: build.vault.test.mjs:44 · invariants.test.mjs:33 — in-process 라 coverage 계측 유지.)
//
// 계약(GREEN 이 구현):
//   applyIgnoreFeeds(items, entries) — `new Set(entries.map(e=>e.id))` 로 items 필터. **순수 함수**
//     (입력 items·entries 불변, 신규 배열 반환), 순서 보존(입력의 subsequence).
//   reportIgnoreHygiene(entries, allFeedIds) — allFeedIds(Set)에 없는 entry 목록 **반환만**
//     (entries 를 변형·삭제하지 않는다 — GC 아님).
import { describe, expect, it } from 'vitest'

const { applyIgnoreFeeds, reportIgnoreHygiene } = await import(
  new URL('../ignore.mjs', import.meta.url).href
)

const WHEN = '2026-07-23T00:00:00Z'
const AAA = 'aaaaaaaaaaaa'
const BBB = 'bbbbbbbbbbbb'
const CCC = 'cccccccccccc'
const DDD = 'dddddddddddd'
const EEE = 'eeeeeeeeeeee'
const MISSING = '000000000000'

/** 소형 FeedItem 빌더 — id 외 필드는 "억제=제거만, 내용 무변형" 을 드러내기 위한 페이로드다(DAMP). */
function aFeed(id, patch = {}) {
  return {
    body: `본문 ${id.slice(0, 3)}`,
    docs: [],
    id,
    importance: 'normal',
    keywords: [],
    title: `feed ${id.slice(0, 3)}`,
    ts: '2026-01-01T00:00:00Z',
    ...patch,
  }
}

/** tombstone 엔트리 리터럴. 필터는 id 만 읽는다(when 은 감사 메타). */
function aTombstone(id) {
  return { id, when: WHEN }
}

const ids = (items) => items.map((item) => item.id)

describe('applyIgnoreFeeds — 억제 id 제거', () => {
  it('억제 목록의 id 를 가진 항목만 제거한다', () => {
    const items = [aFeed(AAA), aFeed(BBB), aFeed(CCC)]

    expect(ids(applyIgnoreFeeds(items, [aTombstone(BBB)]))).toEqual([AAA, CCC])
  })

  it('남은 항목은 입력 객체와 동일 참조·값이다(억제=제거만, 필드 변형 0)', () => {
    const a = aFeed(AAA, { keywords: ['x'] })
    const c = aFeed(CCC, { importance: 'breaking' })

    const result = applyIgnoreFeeds([a, aFeed(BBB), c], [aTombstone(BBB)])

    expect(result).toEqual([a, c])
    expect(result[0]).toBe(a) // 새 객체를 만들지 않는다 — 남은 항목은 입력 참조 그대로
    expect(result[1]).toBe(c)
  })

  it('순서를 보존한다(입력의 subsequence — 페이지네이션 직교)', () => {
    const items = [aFeed(AAA), aFeed(BBB), aFeed(CCC), aFeed(DDD), aFeed(EEE)]

    expect(ids(applyIgnoreFeeds(items, [aTombstone(CCC)]))).toEqual([AAA, BBB, DDD, EEE])
  })
})

describe('applyIgnoreFeeds — edge', () => {
  it('빈 억제 목록은 전량을 통과시킨다(무영향)', () => {
    const items = [aFeed(AAA), aFeed(BBB)]

    expect(ids(applyIgnoreFeeds(items, []))).toEqual([AAA, BBB])
  })

  it('존재하지 않는 id 억제는 no-op 이다(어느 항목과도 불일치)', () => {
    const items = [aFeed(AAA), aFeed(BBB)]

    expect(ids(applyIgnoreFeeds(items, [aTombstone(MISSING)]))).toEqual([AAA, BBB])
  })

  it('중복 id 억제는 무해하다(Set)', () => {
    const items = [aFeed(AAA), aFeed(BBB), aFeed(CCC)]

    expect(ids(applyIgnoreFeeds(items, [aTombstone(BBB), aTombstone(BBB)]))).toEqual([AAA, CCC])
  })

  it('빈 목록과 채운 목록은 결과가 다르다(no-op 하드코딩 대조군 — 필터가 실제로 작동)', () => {
    const items = [aFeed(AAA), aFeed(BBB)]

    expect(ids(applyIgnoreFeeds(items, []))).not.toEqual(
      ids(applyIgnoreFeeds(items, [aTombstone(AAA)])),
    )
  })
})

describe('applyIgnoreFeeds — 순수성 / 직교', () => {
  it('입력 items·entries 를 변형하지 않는다(순수)', () => {
    const items = [aFeed(AAA), aFeed(BBB), aFeed(CCC)]
    const entries = [aTombstone(BBB)]
    const itemsSnapshot = structuredClone(items)
    const entriesSnapshot = structuredClone(entries)

    applyIgnoreFeeds(items, entries)

    expect(items).toEqual(itemsSnapshot)
    expect(entries).toEqual(entriesSnapshot)
  })

  it('ignore 후 slice 가 slice-after-ignore 와 정합한다(ignore ⟂ pagination)', () => {
    const items = [aFeed(AAA), aFeed(BBB), aFeed(CCC), aFeed(DDD), aFeed(EEE)]

    expect(ids(applyIgnoreFeeds(items, [aTombstone(CCC)]).slice(0, 2))).toEqual([AAA, BBB])
  })
})

describe('reportIgnoreHygiene — stale 관측(GC 아님)', () => {
  it('실존 id 는 stale 로 보고하지 않는다', () => {
    const stale = reportIgnoreHygiene([aTombstone(AAA)], new Set([AAA, BBB]))

    expect(stale.map((entry) => entry.id)).not.toContain(AAA)
  })

  it('실존 피드에 대응하지 않는 id 를 stale 로 보고한다', () => {
    const stale = reportIgnoreHygiene([aTombstone(MISSING)], new Set([AAA, BBB]))

    expect(stale.map((entry) => entry.id)).toContain(MISSING)
  })

  it('entries 를 변형·삭제하지 않는다(GC 금지 — 반환은 별도 배열)', () => {
    const entries = [aTombstone(AAA), aTombstone(MISSING)]
    const snapshot = structuredClone(entries)

    const stale = reportIgnoreHygiene(entries, new Set([AAA]))

    expect(entries).toEqual(snapshot) // 원본 불변(길이·원소)
    expect(stale).not.toBe(entries) // 반환은 별도 배열(제자리 변형 아님)
  })

  it('stale 로 보고된 entry 도 억제는 유지된다(hygiene 이 해제하지 않는다)', () => {
    const entries = [aTombstone(AAA)]

    reportIgnoreHygiene(entries, new Set()) // AAA 는 stale 로 보고되지만…

    // …같은 entries 로 필터하면 여전히 AAA 를 제거한다(hygiene 이 entries 를 비우지 않았다).
    expect(ids(applyIgnoreFeeds([aFeed(AAA), aFeed(BBB)], entries))).toEqual([BBB])
  })
})
