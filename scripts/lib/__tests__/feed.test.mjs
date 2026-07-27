// @vitest-environment node
//
// P2 RED-6 · scripts/wiki/lib/feed.mjs (신 커밋 컨벤션 · trailer · 정렬) — tdd §6.6
//
// RED 사유: 현행 feed.mjs 는 구 컨벤션(`post(<해시>)`)만 안다.
//   - `parseCommitForFeed` 는 `post(` 로 시작하지 않으면 무조건 null → `feed:` 를 못 읽는다.
//
// 계약(GREEN 이 구현할 seam):
//   parseCommitForFeed(commit, stats)   // 이름 유지 — build.entry-guard.test.mjs:26 이 의존한다
//     `feed: <헤드라인>` → { articleBody, authorDate, hash, headline, importance, keywords }
//     그 외 subject → null (**warning 아님** — 정상 저작 커밋)
//   extractTrailers(body)               // 그대로 재사용 — vault.contract.test.mjs:24 가 import 한다(삭제 금지)
import { describe, expect, it } from 'vitest'

import { byRecencyThenId, extractTrailers, parseCommitForFeed } from '../feed.mjs'

function aCommit(patch) {
  return {
    authorDate: '2026-01-06T00:00:00Z',
    body: '본문 한 줄.\n\nKeywords: HBM\nImportance: normal',
    hash: 'f1f1f1f1f1f1000000000000000000000000aaaa',
    subject: 'feed: 헤드라인',
    ...patch,
  }
}

function emptyStats() {
  return {
    prunedDocRefs: 0,
    prunedFeeds: 0,
    unpublishedFeedCommits: [],
    unresolvedPaths: [],
    warnings: [],
  }
}

describe('parseCommitForFeed — 신 컨벤션 subject 3종 분기', () => {
  it('`feed: <헤드라인>` 은 피드를 발행한다', () => {
    const stats = emptyStats()

    const post = parseCommitForFeed(
      aCommit({ subject: 'feed: 삼성전자, HBM3E 12단 양산 승인' }),
      stats,
    )

    expect(post.headline).toBe('삼성전자, HBM3E 12단 양산 승인')
    expect(post.articleBody).toBe('본문 한 줄.')
    expect(stats.warnings).toEqual([])
  })

  // P2(contract-simplify) 계약 반전 — tdd §4 원장 ③(입력 교체) / §3.6 PS1.
  // **왜 바뀌었나(D6 · D-D)**: 컨벤션이 `feed:` 하나가 된다. 접두사는 더 이상 분기가 아니므로
  //   "`cwiki`/`uwiki` 는 정상이라 조용하다" 가 아니라 **`feed:` 가 아닌 전부가 조용하다**가 계약이다
  //   (저작/발행 분리 = 정상 워크플로). 입력을 임의 비-`feed:` 접두사로 교체한다(LG1 · P6 grep 스윕).
  //   `offConventionCommits` 집계는 D-D 가 제거하므로 여기서 단언하지 않는다 — 그 키의 **부재**는
  //   `scripts/__tests__/build.feed-survival.test.mjs` 의 PS1 이 문다.
  it('`feed:` 가 아닌 subject 는 미발행(null)이며 warning 을 남기지 않는다', () => {
    // 정상 저작을 warning 으로 오염시키면 진짜 신호(발행 실패)가 묻힌다.
    const stats = emptyStats()

    expect(parseCommitForFeed(aCommit({ subject: 'chore: HBM 문서 생성' }), stats)).toBeNull()
    expect(parseCommitForFeed(aCommit({ subject: 'docs: HBM 문서 이동' }), stats)).toBeNull()
    expect(stats.warnings).toEqual([])
  })

  it('trailer 를 keywords(콤마 split)·importance(enum)로 파싱한다 — `Tags:` 는 사라졌다', () => {
    const post = parseCommitForFeed(
      aCommit({ body: '본문\n\nKeywords: HBM, 양산\nImportance: breaking\nTags: 반도체' }),
      emptyStats(),
    )

    expect(post.keywords).toEqual(['HBM', '양산'])
    expect(post.importance).toBe('breaking')
    expect('tags' in post).toBe(false) // 태그 SSOT = 문서 프론트매터 (README · summary 반환값)
  })

  it('Importance enum 위반은 normal 로 대체하고 warning 을 남긴다', () => {
    // 2번째 케이스: 하드코딩 'breaking' 리턴으로는 통과 불가.
    const stats = emptyStats()

    const post = parseCommitForFeed(aCommit({ body: '본문\n\nImportance: urgent' }), stats)

    expect(post.importance).toBe('normal')
    expect(stats.warnings.length).toBeGreaterThan(0)
  })
})

describe('extractTrailers (재사용 — 삭제 금지)', () => {
  it('말미 trailer 블록을 키 소문자로 추출하고 본문과 분리한다', () => {
    const { articleBody, trailers } = extractTrailers(
      '본문 첫줄\n두번째 줄\n\nKeywords: a, b\nImportance: highlight',
    )

    expect(trailers.keywords).toBe('a, b')
    expect(trailers.importance).toBe('highlight')
    expect(articleBody).toBe('본문 첫줄\n두번째 줄')
  })
})

describe('byRecencyThenId — epoch 비교(비-UTC offset 안전 · F2 🔴RED)', () => {
  it('offset 섞인 ts 를 사전순이 아니라 순간(epoch)으로 내림차순 정렬한다', () => {
    // KST 09:00+09:00 = UTC 00:00(이른 순간)인데 **사전순으론 크다**('09' > '02'). 사전순 비교면 이게
    //   먼저 와서 뒤집힌다. epoch 비교면 실제로 늦은 UTC 02:00 이 먼저다.
    const kstEarly = { id: 'a', ts: '2026-03-01T09:00:00+09:00' } // 00:00Z
    const utcLate = { id: 'b', ts: '2026-03-01T02:00:00Z' } //         02:00Z

    expect([kstEarly, utcLate].toSorted(byRecencyThenId).map((item) => item.id)).toEqual(['b', 'a'])
  })

  it('동일 순간(offset 만 다름)은 id 오름차순 tie-break 로 결정적이다', () => {
    const a = { id: 'zzz', ts: '2026-03-01T09:00:00+09:00' } // 00:00Z
    const b = { id: 'aaa', ts: '2026-03-01T00:00:00Z' } //       00:00Z (동일 순간)

    expect([a, b].toSorted(byRecencyThenId).map((item) => item.id)).toEqual(['aaa', 'zzz'])
  })
})
