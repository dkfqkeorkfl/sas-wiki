import path from 'node:path'

import { getCommitDiffHunks } from './git.mjs'

const FEED_SUBJECT_RE = /^feed:\s+(.+)$/
const CONVENTION_SUBJECT_RE = /^(cwiki|uwiki|feed):\s/
const IMPORTANCE = new Set(['breaking', 'highlight', 'normal'])

/** 앵커 미매핑 — `anchor` 가 null 이면 `anchorText` 도 null 이다(불변식 6 이 강제한다). */
const NO_ANCHOR = Object.freeze({ anchor: null, anchorText: null })

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
 * `feed:` 커밋의 diff 가 건드린 vault 문서를 전부 `docs[{ id, anchor, anchorText }]` 로 만든다. diff 경로는
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
 *   headingsById: Map<string, { anchor: string, line: number, text: string }[]>,
 *   pathIndex: Map<string, string>,
 *   runGit: (args: string[]) => string,
 *   wikiPrefix?: string,
 * }} context
 */
export function buildFeedItems(commits, context) {
  const {
    deletedPaths,
    docsById,
    everDeletedPaths = deletedPaths,
    excludedFeedRefs = new Set(),
    headingsById,
    pathIndex,
    runGit,
    wikiPrefix = 'vault/wiki/',
  } = context
  const stats = {
    offConventionCommits: [],
    prunedDocRefs: 0,
    prunedFeeds: 0,
    unresolvedPaths: [],
    warnings: [],
  }
  const items = []

  for (const commit of commits) {
    const subject = commit.subject || ''
    const post = parseCommitForFeed(commit, stats)

    if (!post) {
      // "vault 를 건드렸는가"는 커밋 객체가 모른다 — diff 를 봐야 안다. vault 밖 관리용 커밋
      // (chore·ci·docs)은 규약 대상이 아니므로 warning 이 아니다(노이즈 금지).
      if (!CONVENTION_SUBJECT_RE.test(subject) && touchesVault(runGit, commit.hash, wikiPrefix)) {
        stats.offConventionCommits.push({ sha: commit.hash, subject })
      }
      continue
    }

    const hunksByFile = getCommitDiffHunks(runGit, commit.hash)
    const docs = []
    let prunedHere = 0

    for (const [rawFile, hunks] of Object.entries(hunksByFile)) {
      const filePath = rawFile.split(path.sep).join('/')
      if (!filePath.startsWith(wikiPrefix) || !filePath.endsWith('.md')) continue

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
      const docId = pathIndex.get(`${commit.hash}:${filePath}`)

      if (!docId) {
        // 삭제된 문서는 도달할 곳이 없다(스텁조차 없다) → prune. disable 은 걷어내지 않는다.
        if (everDeletedPaths.has(filePath)) {
          stats.prunedDocRefs += 1
          prunedHere += 1
        } else if (excludedFeedRefs.has(`${commit.hash}:${filePath}`)) {
          // prod 에서 draft 로 배제된 문서를 가리킨 피드 — 삭제와 동일하게 prune 한다(정상 배제).
          //   부재를 draft 필터가 설명하므로 '해석 불가(조용한 유실)'가 아니다. 배제 좌표는
          //   rename 을 포함한 그 문서의 전 히스토리다(build.mjs 의 excludedFeedRefs).
          stats.prunedDocRefs += 1
          prunedHere += 1
        } else {
          stats.unresolvedPaths.push({ path: filePath, sha: commit.hash })
        }
        continue
      }

      const { anchor, anchorText } = deriveAnchor(hunks, docId, docsById, headingsById)
      docs.push({ anchor, anchorText, id: docId })
    }

    if (docs.length === 0) {
      if (prunedHere > 0) stats.prunedFeeds += 1
      else
        stats.warnings.push({
          reason: `feed 커밋이 vault 문서를 하나도 가리키지 않는다: "${subject}"`,
          sha: commit.hash,
        })
      continue
    }

    items.push({
      body: post.articleBody,
      docs,
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
  const sink = stats ?? { warnings: [] }
  const match = (commit.subject || '').match(FEED_SUBJECT_RE)
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

/**
 * diff hunk → 그 문서에서 가장 많이 바뀐 섹션. 매핑 불가면 **둘 다 null**.
 *
 * `anchor` 는 URL 슬러그(`메모리-로드맵`), `anchorText` 는 그 heading 의 **원문**(`메모리 로드맵`)이다.
 * 카드의 점프 칩은 원문을 보여줘야 하는데(계약 §7) 원문은 `headings` 에만 있고 `headings` 는 지연
 * 로드되는 `wiki_body.json` 에 있다 → 피드 화면이 본문을 당겨오게 되면 "부팅 페이로드에 본문 없음"
 * 이라는 이 계약의 목적이 무너진다. 그래서 **표시용 텍스트를 피드에 비정규화한다**(빌드는 이미
 * heading 객체를 손에 쥐고 있으므로 추가 계산이 0 이다 — `excerpt` 를 summary 에 실은 것과 같은 원리).
 *
 * hunk 는 **파일** 라인이고 heading 은 **본문** 라인이므로 frontmatter 오프셋을 보정한다. 보정을
 * 빠뜨리면 frontmatter 전용 수정이 엉뚱한 앵커를 잡는다.
 * disable 문서(headings 부재)와 죽은 앵커는 **null 로 강등**된다(불변식 6).
 *
 * @returns {{ anchor: string|null, anchorText: string|null }}
 */
function deriveAnchor(hunks, docId, docsById, headingsById) {
  const headings = headingsById.get(docId) ?? []
  if (headings.length === 0 || hunks.length === 0) return NO_ANCHOR
  const offset = docsById.get(docId)?.bodyLineOffset ?? 0

  // heading **객체**로 집계한다 — 앵커(슬러그)만 세면 원문 텍스트를 다시 찾아야 하고, 그 재조회가
  // 어긋나는 순간 표시가 조용히 틀어진다(불변식 6 이 그 정합을 강제한다).
  const coverage = new Map()
  for (const hunk of hunks) {
    const start = hunk.startLine - offset
    const end = start + hunk.lineCount - 1
    for (let line = start; line <= end; line += 1) {
      let best = null
      for (const heading of headings) {
        if (heading.line <= line && (!best || heading.line > best.line)) best = heading
      }
      if (best) coverage.set(best, (coverage.get(best) || 0) + 1)
    }
  }
  if (coverage.size === 0) return NO_ANCHOR
  const [heading] = [...coverage.entries()].toSorted((a, b) => b[1] - a[1])[0]
  return { anchor: heading.anchor, anchorText: heading.text }
}

function touchesVault(runGit, hash, wikiPrefix) {
  return Object.keys(getCommitDiffHunks(runGit, hash)).some((file) =>
    file.split(path.sep).join('/').startsWith(wikiPrefix),
  )
}
