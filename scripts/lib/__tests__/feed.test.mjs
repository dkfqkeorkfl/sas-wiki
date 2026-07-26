// @vitest-environment node
//
// P2 RED-6 · scripts/wiki/lib/feed.mjs (신 커밋 컨벤션 · 다중 문서 · rename · prune) — tdd §6.6
// **이 phase 의 심장이다.** 조용한 유실(rename 매칭 실패·prune)이 관측 가능해지는 지점.
//
// RED 사유: 현행 feed.mjs 는 구 컨벤션(`post(<해시>)`)만 알고 `buildFeedItems` 가 없다.
//   - `parseCommitForFeed` 는 `post(` 로 시작하지 않으면 무조건 null → `feed:` 를 못 읽는다.
//   - `buildFeedItems` 미구현(export 부재) → import 링크 실패(파일 전체 RED).
//
// 계약(GREEN 이 구현할 seam):
//   parseCommitForFeed(commit, stats)   // 이름 유지 — build.entry-guard.test.mjs:26 이 의존한다
//     `feed: <헤드라인>` → { articleBody, authorDate, hash, headline, importance, keywords }
//     `cwiki: ` / `uwiki: ` → null (**warning 아님** — 정상 컨벤션)
//   extractTrailers(body)               // 그대로 재사용 — vault.contract.test.mjs:24 가 import 한다(삭제 금지)
//   buildFeedItems(commits, { runGit, pathIndex, deletedPaths, docsById, headingsById })
//     → { items, stats }
//       stats = { offConventionCommits: [{sha,subject}], prunedDocRefs, prunedFeeds,
//                 unresolvedPaths: [{sha,path}], warnings: [{sha,reason}] }
//       pathIndex   : Map<`${sha}:${당시경로}`, docId>   ← git.buildPathIndex (rename 역인덱스)
//       deletedPaths: Set<'wiki/….md'>            ← git.collectDeletedDocPaths
//       docsById    : Map<docId, { bodyLineOffset, status }>
//       headingsById: Map<docId, [{ anchor, level, line, text }]>  ← HEAD 기준
//
// **`continue` 로 버리지 마라**(현행 `feed.mjs:108-109`). 해석 실패는 집계 → stdout 이다(tdd §8).
import { describe, expect, it } from 'vitest'

import { buildFeedItems, byRecencyThenId, extractTrailers, parseCommitForFeed } from '../feed.mjs'

const SAMSUNG_ID = 'aaaaaaaaaaaa'
const HYNIX_ID = 'bbbbbbbbbbbb'
const HBM_ID = 'cccccccccccc'
const DISABLED_ID = 'dddddddddddd'

const SAMSUNG_FILE = 'wiki/company/삼성전자.md'
const HYNIX_FILE = 'wiki/company/SK하이닉스.md'
const HBM_OLD_FILE = 'wiki/concept/HBM.md' // 이동 전 경로(커밋 당시)
const DISABLED_FILE = 'wiki/concept/온디바이스-AI.md'
const SCRAP_FILE = 'wiki/concept/폐기예정-메모.md' // 이후 삭제됨

// 문서 본문 헤딩(HEAD) — frontmatter 8줄 뒤에 본문이 시작한다(bodyLineOffset=8).
const SAMSUNG_HEADINGS = [
  { anchor: '개요', level: 2, line: 1, text: '개요' },
  { anchor: '사업-부문', level: 2, line: 5, text: '사업 부문' },
  { anchor: '메모리-로드맵', level: 2, line: 9, text: '메모리 로드맵' },
]
const HYNIX_HEADINGS = [
  { anchor: '개요', level: 2, line: 1, text: '개요' },
  { anchor: '메모리-사업', level: 2, line: 5, text: '메모리 사업' },
]
const HBM_HEADINGS = [
  { anchor: '정의', level: 2, line: 1, text: '정의' },
  { anchor: '공급망', level: 2, line: 9, text: '공급망' },
]

function aCommit(patch) {
  return {
    authorDate: '2026-01-06T00:00:00Z',
    body: '본문 한 줄.\n\nKeywords: HBM\nImportance: normal',
    hash: 'f1f1f1f1f1f1000000000000000000000000aaaa',
    subject: 'feed: 헤드라인',
    ...patch,
  }
}

/**
 * 기본 컨텍스트. 각 테스트는 필요한 축만 override 한다.
 *
 * @param {{ diffs?: Record<string,string>, pathIndex?: Map, deletedPaths?: Set }} overrides
 */
function aContext({ deletedPaths = new Set(), diffs = {}, pathIndex } = {}) {
  return {
    deletedPaths,
    docsById: new Map([
      [DISABLED_ID, { bodyLineOffset: 8, status: 'disable' }],
      [HBM_ID, { bodyLineOffset: 8, status: 'active' }],
      [HYNIX_ID, { bodyLineOffset: 8, status: 'active' }],
      [SAMSUNG_ID, { bodyLineOffset: 8, status: 'active' }],
    ]),
    headingsById: new Map([
      [HBM_ID, HBM_HEADINGS],
      [HYNIX_ID, HYNIX_HEADINGS],
      [SAMSUNG_ID, SAMSUNG_HEADINGS],
      // disable 문서는 body·headings 가 없다 → anchor 는 null 로 강등돼야 한다(불변식 6).
    ]),
    pathIndex: pathIndex ?? defaultPathIndex(),
    // getCommitDiffHunks(runGit, hash) → 마지막 인자가 hash 다.
    runGit: (args) => diffs[args.at(-1)] ?? '',
    wikiPrefix: 'wiki/',
  }
}

/** git show --unified=0 출력(파일별 hunk). getCommitDiffHunks 가 파싱하는 실제 포맷. */
function aDiff(files) {
  return files
    .flatMap(({ hunks, path: filePath }) => [
      `diff --git a/${filePath} b/${filePath}`,
      `--- a/${filePath}`,
      `+++ b/${filePath}`,
      ...hunks.map(({ count, start }) => `@@ -${start},0 +${start},${count} @@`),
    ])
    .join('\n')
}

/**
 * 역인덱스는 **HEAD 에 살아 있는 문서**로만 만들어진다(`buildPathIndex(docs, …)` 의 `docs` 가 HEAD 문서다).
 *
 * 그래서 **삭제된 문서(SCRAP)는 인덱스에 없다.** 이 픽스처가 그것을 넣어두면 현실에 없는 상태를
 * 모델링하게 되고, prune 판정과 역인덱스 조회의 상호작용을 잘못 검증한다(리뷰 지적).
 * prune 은 "인덱스가 못 푼 경로"를 분류하는 단계이지, 인덱스보다 먼저 끊는 관문이 아니다.
 */
function defaultPathIndex() {
  const index = new Map()
  for (const sha of ['f1f1f1f1f1f1000000000000000000000000aaaa', 'c1', 'c2', 'c3', 'c4']) {
    index.set(`${sha}:${SAMSUNG_FILE}`, SAMSUNG_ID)
    index.set(`${sha}:${HYNIX_FILE}`, HYNIX_ID)
    index.set(`${sha}:${HBM_OLD_FILE}`, HBM_ID) // 당시 경로 → 이동 후 현재 문서
    index.set(`${sha}:${DISABLED_FILE}`, DISABLED_ID)
  }
  return index
}

function emptyStats() {
  return {
    offConventionCommits: [],
    prunedDocRefs: 0,
    prunedFeeds: 0,
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

  it('`cwiki:` / `uwiki:` 는 미발행(null)이며 warning 을 남기지 않는다', () => {
    // 정상 컨벤션을 warning 으로 오염시키면 진짜 신호(규약 위반)가 묻힌다.
    const stats = emptyStats()

    expect(parseCommitForFeed(aCommit({ subject: 'cwiki: HBM 문서 생성' }), stats)).toBeNull()
    expect(parseCommitForFeed(aCommit({ subject: 'uwiki: HBM 문서 이동' }), stats)).toBeNull()
    expect(stats.warnings).toEqual([])
    expect(stats.offConventionCommits).toEqual([])
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

describe('buildFeedItems — 문서 참조(docs[])', () => {
  it('FeedItem 은 정확히 7키다(refs·path·bodyHtml·tags·breadcrumb·sentiment·link·source 부재)', () => {
    const commit = aCommit({}) // hash = 40자
    const ctx = aContext({
      diffs: { [commit.hash]: aDiff([{ hunks: [{ count: 2, start: 20 }], path: SAMSUNG_FILE }]) },
    })

    const { items } = buildFeedItems([commit], ctx)

    expect(Object.keys(items[0]).toSorted()).toEqual([
      'body',
      'docs',
      'id',
      'importance',
      'keywords',
      'title',
      'ts',
    ])
    expect(items[0].id).toBe('f1f1f1f1f1f1') // 커밋 해시 12자
    expect(items[0].ts).toBe('2026-01-06T00:00:00Z') // author date
  })

  it('한 커밋이 문서 2개를 고치면 docs[] 가 2건이고 각자의 앵커를 갖는다', () => {
    const commits = [aCommit({ hash: 'c1' })]
    const ctx = aContext({
      diffs: {
        c1: aDiff([
          { hunks: [{ count: 2, start: 20 }], path: SAMSUNG_FILE }, // body line 12 → 메모리-로드맵(9)
          { hunks: [{ count: 2, start: 14 }], path: HYNIX_FILE }, // body line 6 → 메모리-사업(5)
        ]),
      },
    })

    const { items } = buildFeedItems(commits, ctx)
    const refOf = (id) => items[0].docs.find((ref) => ref.id === id)

    expect(items[0].docs).toHaveLength(2)
    expect(refOf(SAMSUNG_ID).anchor).toBe('메모리-로드맵')
    expect(refOf(HYNIX_ID).anchor).toBe('메모리-사업')
  })

  it('anchorText 는 그 heading 의 **원문**이다(슬러그가 아니다)', () => {
    // 카드 점프 칩은 `삼성전자 › 메모리 로드맵` 을 보여준다(계약 §7) — URL 슬러그(`메모리-로드맵`)가
    // 아니다. 원문은 headings 에만 있고 headings 는 지연 로드되는 body 에 있으므로, 피드가 들고 있지
    // 않으면 피드 화면이 본문을 당겨오게 된다(= 부팅 페이로드에 본문이 없다는 목적 붕괴).
    const commits = [aCommit({ hash: 'c1' })]
    const ctx = aContext({
      diffs: { c1: aDiff([{ hunks: [{ count: 2, start: 20 }], path: SAMSUNG_FILE }]) },
    })

    const { items } = buildFeedItems(commits, ctx)

    expect(items[0].docs).toEqual([
      { anchor: '메모리-로드맵', anchorText: '메모리 로드맵', id: SAMSUNG_ID },
    ])
  })

  it('rename: 당시 경로가 역인덱스로 현재 문서에 해석되고 앵커가 살아남는다', () => {
    // 커밋 11 은 concept/HBM.md 를 고쳤고, 커밋 12 가 tech/HBM.md 로 옮겼다.
    // 현재 경로로 조회하면 못 찾는다 → (sha, 당시경로) 역인덱스가 유일한 길이다.
    const commits = [aCommit({ hash: 'c1', subject: 'feed: HBM4 로드맵 갱신' })]
    const ctx = aContext({
      diffs: { c1: aDiff([{ hunks: [{ count: 2, start: 20 }], path: HBM_OLD_FILE }]) },
    })

    const { items, stats } = buildFeedItems(commits, ctx)

    expect(items[0].docs).toEqual([{ anchor: '공급망', anchorText: '공급망', id: HBM_ID }])
    expect(stats.unresolvedPaths).toEqual([])
  })

  it('frontmatter 전용 수정은 anchor 가 null 이다(bodyLineOffset 보정)', () => {
    // 파일 12행 = 본문 4행(offset 8) → 첫 heading(1행) 아래지만…
    // 보정을 빠뜨리면 파일 12행이 본문 12행으로 읽혀 **메모리-로드맵**(9행)이 잡힌다 → 엉뚱한 앵커.
    const commits = [aCommit({ hash: 'c1' })]
    const ctxBody = aContext({
      diffs: { c1: aDiff([{ hunks: [{ count: 1, start: 12 }], path: SAMSUNG_FILE }]) },
    })

    expect(buildFeedItems(commits, ctxBody).items[0].docs[0].anchor).toBe('개요')

    // frontmatter(파일 6행)만 고친 커밋 → 본문 hunk 가 없다 → null
    const ctxFront = aContext({
      diffs: { c1: aDiff([{ hunks: [{ count: 1, start: 6 }], path: SAMSUNG_FILE }]) },
    })

    expect(buildFeedItems(commits, ctxFront).items[0].docs[0].anchor).toBeNull()
  })

  it('anchor 가 null 이면 anchorText 도 null 이다(라벨만 남으면 안 된다)', () => {
    // 가리킬 섹션이 없는데 라벨만 남으면 카드가 존재하지 않는 섹션으로 안내한다(불변식 6 이 그것도 잡는다).
    const commits = [aCommit({ hash: 'c1' })]
    const ctxFront = aContext({
      diffs: { c1: aDiff([{ hunks: [{ count: 1, start: 6 }], path: SAMSUNG_FILE }]) }, // frontmatter 전용
    })

    expect(buildFeedItems(commits, ctxFront).items[0].docs).toEqual([
      { anchor: null, anchorText: null, id: SAMSUNG_ID },
    ])
  })

  it('정렬은 ts 내림차순, 동률이면 id 오름차순이다(결정성)', () => {
    const commits = [
      aCommit({ authorDate: '2026-01-01T00:00:00Z', hash: 'c4', subject: 'feed: B' }),
      aCommit({ authorDate: '2026-01-01T00:00:00Z', hash: 'c3', subject: 'feed: A' }),
      aCommit({ authorDate: '2026-01-09T00:00:00Z', hash: 'c1', subject: 'feed: 최신' }),
    ]
    const diff = aDiff([{ hunks: [{ count: 2, start: 20 }], path: SAMSUNG_FILE }])
    const ctx = aContext({ diffs: { c1: diff, c3: diff, c4: diff } })

    const { items } = buildFeedItems(commits, ctx)

    expect(items.map((item) => item.id)).toEqual(['c1', 'c3', 'c4'])
  })
})

describe('buildFeedItems — prune (삭제 문서) vs disable (유지)', () => {
  it('삭제된 문서 참조는 걷어내고 건수를 집계한다', () => {
    const commits = [aCommit({ hash: 'c1' })]
    const ctx = aContext({
      deletedPaths: new Set([SCRAP_FILE]),
      diffs: {
        c1: aDiff([
          { hunks: [{ count: 2, start: 20 }], path: SAMSUNG_FILE },
          { hunks: [{ count: 2, start: 20 }], path: SCRAP_FILE },
        ]),
      },
    })

    const { items, stats } = buildFeedItems(commits, ctx)

    expect(items[0].docs.map((ref) => ref.id)).toEqual([SAMSUNG_ID])
    expect(stats.prunedDocRefs).toBe(1)
    expect(stats.prunedFeeds).toBe(0)
  })

  it('docs[] 가 비면 피드 자체를 뺀다(도달할 곳이 없다)', () => {
    const commits = [aCommit({ hash: 'c1', subject: 'feed: 폐기예정 메모 관련 소식' })]
    const ctx = aContext({
      deletedPaths: new Set([SCRAP_FILE]),
      diffs: { c1: aDiff([{ hunks: [{ count: 2, start: 20 }], path: SCRAP_FILE }]) },
    })

    const { items, stats } = buildFeedItems(commits, ctx)

    expect(items).toEqual([])
    expect(stats.prunedDocRefs).toBe(1)
    expect(stats.prunedFeeds).toBe(1)
  })

  it('역인덱스가 푸는 경로는 deletedPaths 에 있어도 prune 하지 않는다(경로 재사용)', () => {
    // 문서 A 가 x 에 있었다가 y 로 이동하고, 그 뒤 **다른** 문서 B 가 빈 x 를 재사용했다가 삭제되면,
    // x 는 deletedPaths 에 들어간다. 그러나 과거 피드의 diff 가 가리키는 x 는 **그 시점의 A** 이고
    // A 는 y 로 살아 있다. 경로만 보고 끊으면 살아 있는 문서의 뉴스가 통째로 사라진다.
    // deletedPaths 는 인덱스가 **못 풀었을 때만** 쓰는 분류기다.
    const commits = [aCommit({ hash: 'c1' })]
    const ctx = aContext({
      deletedPaths: new Set([HBM_OLD_FILE]), // 그 경로는 지금 삭제 상태다(B 가 재사용 후 삭제)
      diffs: { c1: aDiff([{ hunks: [{ count: 2, start: 20 }], path: HBM_OLD_FILE }]) },
    })

    const { items, stats } = buildFeedItems(commits, ctx)

    expect(items[0].docs.map((ref) => ref.id)).toEqual([HBM_ID]) // 이동한 문서로 정확히 해석된다
    expect(stats.prunedDocRefs).toBe(0)
    expect(stats.prunedFeeds).toBe(0)
  })

  it('disable 문서는 prune 하지 않는다 — 피드는 살고 anchor 만 null 로 강등된다', () => {
    // 스텁 4키가 링크를 살려두는 이유가 이것이다(README · summary 반환값).
    const commits = [aCommit({ hash: 'c1', subject: 'feed: 온디바이스 AI, 스마트폰 탑재 확대' })]
    const ctx = aContext({
      diffs: { c1: aDiff([{ hunks: [{ count: 2, start: 20 }], path: DISABLED_FILE }]) },
    })

    const { items, stats } = buildFeedItems(commits, ctx)

    expect(items[0].docs).toEqual([{ anchor: null, anchorText: null, id: DISABLED_ID }])
    expect(stats.prunedDocRefs).toBe(0)
    expect(stats.prunedFeeds).toBe(0)
  })
})

describe('buildFeedItems — 조용한 유실 금지 (tdd §8)', () => {
  it('역인덱스로도 못 찾은 경로는 unresolvedPaths 에 집계된다', () => {
    // 현행 `feed.mjs:108-109` 는 `if (!targetDoc) continue` 로 **조용히 버린다**.
    // 같은 경로의 다른 좌표만 넣어 "문서 후보이지만 이 커밋에서는 못 푼다"를 증명한다
    // (§9 의 `unresolved === 0` 의 vacuous 짝).
    const commits = [aCommit({ hash: 'c1' })]
    const ctx = aContext({
      diffs: { c1: aDiff([{ hunks: [{ count: 2, start: 20 }], path: SAMSUNG_FILE }]) },
      pathIndex: new Map([[`c0:${SAMSUNG_FILE}`, SAMSUNG_ID]]),
    })

    const { stats } = buildFeedItems(commits, ctx)

    expect(stats.unresolvedPaths).toEqual([{ path: SAMSUNG_FILE, sha: 'c1' }])
  })

  it('규약 밖 subject 가 vault 문서를 건드리면 offConventionCommits 에 집계된다', () => {
    const commits = [
      aCommit({ hash: 'c1', subject: 'refactor: 문서 손질' }),
      aCommit({ hash: 'c2', subject: 'chore: CI 설정' }),
    ]
    const ctx = aContext({
      diffs: {
        c1: aDiff([{ hunks: [{ count: 2, start: 20 }], path: SAMSUNG_FILE }]),
        c2: aDiff([{ hunks: [{ count: 2, start: 1 }], path: '.github/workflows/ci.yml' }]),
      },
    })

    const { stats } = buildFeedItems(commits, ctx)

    // vault 를 건드리지 않는 관리용 커밋(chore·ci·docs)은 **warning 이 아니다**(노이즈 금지).
    expect(stats.offConventionCommits).toEqual([{ sha: 'c1', subject: 'refactor: 문서 손질' }])
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
