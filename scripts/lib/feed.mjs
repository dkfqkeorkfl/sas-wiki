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
 * 으로 오염시키면 진짜 신호가 묻힌다). 그 외 subject 의 규약 위반 집계는 diff 를 보는 호출자가 한다
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
