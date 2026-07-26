import { getCommitDiffHunks } from './git.mjs'
import { judgeFeedSurvival } from './feed-survival.mjs'

const FEED_SUBJECT_RE = /^feed:\s+(.+)$/
export const IMPORTANCE = new Set(['breaking', 'fix', 'highlight', 'normal'])

/**
 * 결정성: author-date **epoch** 내림차순(최신 먼저), 동률이면 id 오름차순.
 *
 * **사전순 비교 아님** — `%aI` 는 author 의 타임존 offset 을 그대로 렌더하므로(`+09:00` 등) 문자열
 * 사전순 ≠ 시간순이다(예: `2026-01-01T09:00:00+09:00` 는 사전순으로 `2026-01-01T02:00:00Z` 보다 크지만
 * 실제로는 2시간 **과거**다). `Date.parse` 로 epoch 를 비교해 offset 을 정규화한다. 파싱 불가(NaN)면
 * 결정적 id tie-break 로 폴백한다(순서 붕괴 방지). 현 vault 는 전부 `Z` 라 기존 산출과 동치.
 */
export const byRecencyThenId = (a, b) => {
  const diff = Date.parse(b.ts) - Date.parse(a.ts)
  return diff !== 0 && !Number.isNaN(diff) ? diff : a.id.localeCompare(b.id)
}

/**
 * 커밋들 → FeedItem[] + **조용한 유실을 관측 가능하게 만드는** stats.
 *
 * `feed:` 커밋의 diff 가 건드린 vault 문서를 전부 `docs[{ id }]` 로 만든다. diff 경로는
 * **그 커밋 당시의 경로**이므로 rename 역인덱스(`pathIndex`)로 현재 문서 id 를 해석한다.
 *
 * 해석 실패를 **`continue` 로 버리지 않는다** — 그것이 현행의 실패 모드(이동한 문서의 과거 피드가
 * 에러 없이 사라진다)이고, 이 phase 의 존재 이유다. 실패는 `stats.unresolvedPaths` 로 집계된다.
 *
 * @param {object[]} commits collectGitLog 결과(최신순)
 * @param {{
 *   deletedPaths: Set<string>,
 *   docsById: Map<string, { bodyLineOffset: number, status: string }>,
 *   everDeletedPaths?: Set<string>,
 *   excludedFeedRefs?: Set<string>,
 *   pathIndex: Map<string, string>,
 *   runGit: (args: string[]) => string,
 * }} context
 */
export function buildFeedItems(commits, context) {
  const {
    deletedPaths,
    everDeletedPaths = deletedPaths,
    excludedFeedRefs = new Set(),
    pathIndex,
    runGit,
    strayDocPaths = new Set(),
  } = context
  // 문서 후보 = git 이 아는 문서 경로 계보. prefix 리터럴이 아니라 pathIndex(=--follow 로 만든
  // rename 계보)와 draft 배제 좌표에서 유도한다 → 이관 전 경로가 자동으로 포함되고,
  // 위키 밖 .md(README·docs/*)는 애초에 들어오지 않는다.
  //
  // `strayDocPaths` 는 HEAD 상태 계층(parseVault)이 "지금 위키 루트에 있으나 파싱 실패" 로 판정해
  // 넘겨준 것이다. 후보에 넣어야 피드가 깨진 문서를 가리킬 때 조용히 넘어가지 않고 unresolved 로
  // 끊긴다. **판정은 저기서 끝났고 여기로는 결과만 온다** — 이 루프에 prefix 리터럴을 두지 않는 것이
  // 이 phase 의 요점이다.
  const everWikiPaths = new Set([
    ...[...pathIndex.keys(), ...excludedFeedRefs].map((key) => key.slice(key.indexOf(':') + 1)),
    ...strayDocPaths,
  ])
  const stats = {
    prunedDocRefs: 0,
    prunedFeeds: 0,
    unpublishedFeedCommits: [],
    unresolvedPaths: [],
    warnings: [],
  }
  const items = []

  for (const commit of commits) {
    const subject = commit.subject || ''
    const post = parseCommitForFeed(commit, stats)

    if (!post) continue

    const hunksByFile = getCommitDiffHunks(runGit, commit.hash)
    const refs = []

    for (const [rawFile, hunks] of Object.entries(hunksByFile)) {
      const filePath = rawFile.split('\\').join('/')
      if (!filePath.endsWith('.md')) continue
      // 문서가 아니면 조용히 건너뛴다. **현재 prefix 로 예외를 파지 않는다** — 그렇게 하면 히스토리
      //   계층에 현재 상태 개념이 다시 스며들어 이 phase 가 없애려는 결합이 부활한다. 파싱 실패한
      //   위키 문서(pathIndex 부재)는 `checkStrayDocs` 가 별도로 잡으므로 여기서 이중으로 붙들 필요가 없다.
      if (!everWikiPaths.has(filePath) && !everDeletedPaths.has(filePath)) continue

      // **역인덱스를 먼저 묻는다.** 순서가 뒤바뀌면 데이터가 조용히 사라진다.
      //
      // `pathIndex` 는 `(커밋, 그 시점 경로) → 문서 id` 라 **시간을 안다**. 반면 `deletedPaths` 는
      // "이 경로가 언젠가 지워졌고 HEAD 에 없다" 만 아는 **경로 단위(시간 무관)** 집합이다.
      // 그래서 deletedPaths 를 먼저 보면 이런 히스토리에서 틀린다:
      //   ① 문서 A 를 company/x.md 에 만든다 → ② A 를 고치는 feed: 커밋 → ③ A 를 company/y.md 로
      //   이동 → ④ **다른** 문서 B 를 비어 있는 company/x.md 에 만든다 → ⑤ B 를 삭제.
      // 이때 x.md 는 deletedPaths 에 들어가지만, ②의 diff 가 가리키는 x.md 는 **그 시점의 문서 A**
      // 이고 A 는 y.md 로 멀쩡히 살아 있다. 경로만 보고 끊으면 **살아 있는 문서의 과거 뉴스가
      // 통째로 사라진다**(실측 재현: feeds=0, prune=1).
      //
      // 역인덱스가 풀어내면 그것이 정답이다. 못 풀 때만 deletedPaths 로 "진짜 삭제라 못 찾은 것"과
      // "그 외 사유로 못 찾은 것(unresolved)" 을 가른다.
      const key = `${commit.hash}:${filePath}`
      const docId = pathIndex.get(key)

      if (!docId) {
        // 삭제된 문서는 도달할 곳이 없다(스텁조차 없다) → prune. disable 은 걷어내지 않는다.
        if (everDeletedPaths.has(filePath)) {
          refs.push({ id: null, reason: 'deleted' })
        } else if (excludedFeedRefs.has(`${commit.hash}:${filePath}`)) {
          // prod 에서 draft 로 배제된 문서를 가리킨 피드 — 삭제와 동일하게 prune 한다(정상 배제).
          //   부재를 draft 필터가 설명하므로 '해석 불가(조용한 유실)'가 아니다. 배제 좌표는
          //   rename 을 포함한 그 문서의 전 히스토리다(build.mjs 의 excludedFeedRefs).
          refs.push({ id: null, reason: 'draft-excluded' })
        } else {
          stats.unresolvedPaths.push({ path: filePath, sha: commit.hash })
          refs.push({ id: null, reason: 'unresolved' })
        }
        continue
      }

      if (excludedFeedRefs.has(key)) refs.push({ id: null, reason: 'draft-excluded' })
      else refs.push({ id: docId, reason: null })
    }

    const survival = judgeFeedSurvival({ importance: post.importance, refs })
    stats.prunedDocRefs += survival.counters.deleted + survival.counters.draftExcluded
    if (!survival.feedSurvives) {
      if (survival.counters.deleted + survival.counters.draftExcluded > 0) stats.prunedFeeds += 1
      continue
    }

    items.push({
      body: post.articleBody,
      docs: survival.docs,
      id: commit.hash.slice(0, 12),
      importance: post.importance,
      keywords: post.keywords,
      title: post.headline,
      ts: post.authorDate,
    })
  }

  // 결정성: ts 내림차순, 동률이면 id 오름차순.
  return {
    items: items.toSorted(byRecencyThenId),
    stats,
  }
}

export function extractTrailers(body) {
  const lines = body.split(/\r?\n/)
  const trailers = {}
  let trailerStart = lines.length
  let lastBlankIdx = -1
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (lines[i].trim() === '') {
      lastBlankIdx = i
      break
    }
  }
  const candidateLines = lastBlankIdx === -1 ? lines : lines.slice(lastBlankIdx + 1)
  const allTrailers =
    candidateLines.length > 0 &&
    candidateLines.every(
      (line) => /^[A-Za-z][A-Za-z-]*:\s*.+$/.test(line.trim()) || line.trim() === '',
    )

  if (allTrailers) {
    for (const line of candidateLines) {
      const trimmed = line.trim()
      if (trimmed === '') continue
      const idx = trimmed.indexOf(':')
      trailers[trimmed.slice(0, idx).trim().toLowerCase()] = trimmed.slice(idx + 1).trim()
    }
    trailerStart = lastBlankIdx === -1 ? 0 : lastBlankIdx
  }

  return { articleBody: lines.slice(0, trailerStart).join('\n').replace(/\s+$/, ''), trailers }
}

/**
 * subject 3종 분기 — `feed:` 만 피드를 발행한다.
 *
 * `cwiki:`/`uwiki:` 는 **정상 컨벤션**이므로 null 을 내되 warning 을 남기지 않는다(정상을 warning
 * 으로 오염시키면 진짜 신호가 묻힌다). 그 외 subject 의 규약 위반 집계는 `buildFeedItems` 가 한다
 * — vault 를 건드렸는지는 diff 를 봐야 알 수 있고, 커밋 객체엔 그 정보가 없다.
 *
 * 이름 유지: `build.entry-guard.test.mjs` 가 이 export 를 단언한다.
 */
export function parseCommitForFeed(commit, stats) {
  const sink = stats ?? { unpublishedFeedCommits: [], warnings: [] }
  const subject = commit.subject || ''
  const match = subject.match(FEED_SUBJECT_RE)
  if (!match && subject.startsWith('feed:')) {
    sink.unpublishedFeedCommits?.push({ sha: commit.hash, subject })
  }
  if (!match) return null
  const headline = match[1].trim()
  if (!headline) return null

  const { articleBody, trailers } = extractTrailers(commit.body || '')
  const keywords = trailers.keywords
    ? trailers.keywords
        .split(',')
        .map((keyword) => keyword.trim())
        .filter(Boolean)
    : []

  let importance = 'normal'
  if (trailers.importance !== undefined) {
    const value = trailers.importance.trim().toLowerCase()
    if (IMPORTANCE.has(value)) importance = value
    else
      sink.warnings.push({
        reason: `Importance trailer enum 위반("${trailers.importance}")`,
        sha: commit.hash,
      })
  }

  return { articleBody, authorDate: commit.authorDate, hash: commit.hash, headline, importance, keywords } // prettier-ignore
}
