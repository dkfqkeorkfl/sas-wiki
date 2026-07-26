import fs from 'node:fs'
import path from 'node:path'

import { isDraft } from './draft.mjs'
import { byRecencyThenId, parseCommitForFeed } from './feed.mjs'
import {
  anyMarkdown,
  buildPathIndex,
  catFileBatch,
  collectEverDeletedDocPaths,
  getCommitDocStatuses,
  makeGitRunner,
} from './git.mjs'
import { judgeFeedSurvival } from './feed-survival.mjs'
import { applyIgnoreFeeds } from './ignore.mjs'
import {
  collectMarkdownFilesRecursive,
  derivePathAndBreadcrumb,
  parseFrontmatterYaml,
  parseMarkdownFile,
} from './parse.mjs'
import { WIKI_PREFIX } from './parse-vault.mjs'

const DEFAULT_FEED_LIMIT = 50

export function walkFeeds(vault, { after, count, env, from, to } = {}) {
  const vaultDir = path.resolve(vault)
  const limit = typeof count === 'number' && count > 0 ? count : DEFAULT_FEED_LIMIT
  // 판정은 **`dev` 만 전량, 그 외는 전부 prod**(fail-closed) — parse-vault.mjs 의 visibleDocs 와
  // 같은 극성이어야 한다. `pathIndex` 는 draft 포함 전 문서로 만들어야 삭제와 draft 배제 사유를 가른다.
  const excludeDrafts = env !== 'dev'
  const headDocs = loadHeadDocs(vaultDir)
  const visibleHeadDocs = excludeDrafts ? headDocs.filter((doc) => !doc.draft) : headDocs
  const headIds = new Set(visibleHeadDocs.map((doc) => doc.id))
  const allHeadIds = new Set(headDocs.map((doc) => doc.id))
  const ignoreEntries = loadIgnoreFeeds(vaultDir)
  const runGit = makeGitRunner(vaultDir)
  // pre-D1 폴백용 경로 역인덱스(경로→현재 doc-id · rename 추적) — build.mjs:buildContent 와 **동일 입력·
  // 동일 함수**(buildPathIndex)로 1회만 구성한다. **지연**: 고속경로(post-D1 blob id)가 전부 풀면 절대
  // 만들지 않아 비용 0. 실 vault(pre-D1: 피드가 id 부여 이전 커밋)에서만 트리거된다.
  let pathIndex = null
  const resolvePathIndex = () => (pathIndex ??= buildPathIndex(headDocs, runGit))
  let everDeletedPaths = null
  const resolveEverDeletedPaths = () =>
    (everDeletedPaths ??= collectEverDeletedDocPaths(runGit, { isDocPath: anyMarkdown }))
  const collected = new Map()

  // F1: **전량 워크(count 기반 조기 종료 금지)**. git rev-list 워크순서는 선형 히스토리에서 사실상
  //   커밋순(≠author-date)이라(GW3), author-date 가 뒤섞이면(rebase/backdate) 뒤 청크에 더 최신
  //   author-date 피드가 숨어 있을 수 있다. count 만큼 모였다고 끊으면 그 피드를 놓친다. 정렬-안전
  //   바운디드 종료는 "임의 old 커밋이 임의 high author-date 를 가질 수 있다"라 author-date monotonic
  //   가정 없이는 불가능하므로, 피드 커밋을 **전량 수집**한 뒤 JS 재정렬(byRecencyThenId)을 권위로
  //   페이지를 확정한다(억제·from/to·after·상한은 pageItems 가 최종 1회 적용 — 전량이라 언더필 없음).
  const commits = revListFeedCandidates(runGit)
  for (const item of resolveFeedItems(vaultDir, runGit, commits, {
    allHeadIds,
    headIds,
    resolveEverDeletedPaths,
    resolvePathIndex,
  })) {
    collected.set(item.id, item)
  }

  const visible = pageItems([...collected.values()], ignoreEntries, { after, from, limit, to })
  return withCursor(visible.slice(0, limit), visible.length > limit ? visible[limit - 1] : null)
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
 * 사유). 파싱 불가(유효 ISO 아님) → throw: 잘못된 경계로 조용히 오필터(전량 통과/전량 배제)하느니
 * 시끄럽게 끊는다(fail-loud).
 */
function parseBoundary(value, name) {
  if (value === undefined || value === null) return null
  const ms = Date.parse(value)
  if (Number.isNaN(ms)) {
    throw new Error(`walkFeeds ${name} 경계가 유효한 ISO 날짜가 아니다: ${JSON.stringify(value)}`)
  }
  return ms
}

function withCursor(items, cursorItem) {
  const cursor =
    cursorItem === null || cursorItem === undefined
      ? null
      : { feedId: cursorItem.id, ts: cursorItem.ts }
  Object.defineProperty(items, 'nextCursor', {
    configurable: true,
    enumerable: false,
    value: cursor,
  })
  return items
}

function normalizeCursor(after) {
  if (after === undefined || after === null || after === '') return null
  if (typeof after === 'string') {
    const parsed = JSON.parse(after)
    return normalizeCursor(parsed)
  }
  const id = after.feedId ?? after.id
  if (typeof after.ts !== 'string' || typeof id !== 'string') {
    throw new Error('after cursor must contain ts and feedId')
  }
  return { id, ts: after.ts }
}

function revListFeedCandidates(runGit) {
  let raw
  try {
    raw = runGit(['rev-list', '--author-date-order', 'HEAD', '--format=%H%x09%aI%x09%s%x09%b%x1e'])
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (/does not have any commits yet|unknown revision|bad revision/i.test(message)) return []
    throw error
  }

  return (
    raw
      .split('\x1e')
      // git 은 각 커밋의 format 출력 뒤에 개행을 붙인다 → `\x1e` 로 자르면 **첫 레코드를 뺀 나머지**는
      // 선행 `\n` 을 달고 온다. `^commit …` 는 (m 플래그 없이) 문자열 시작에 고정돼 있어 그 선행 개행 탓에
      // 두 번째 레코드부터 헤더줄이 안 벗겨지고, hash 필드에 `\ncommit <sha>\n<hash>` 가 섞여 이후 모든
      // git 조회가 조용히 실패했다(피드 1건만 resolve). 선행 개행을 함께 소거한다.
      .map((record) => record.replace(/^\r?\n?commit [0-9a-f]{40}\r?\n/u, '').trimEnd())
      .filter(Boolean)
      .map((record) => {
        const [hash, authorDate, subject, ...bodyParts] = record.split('\t')
        return {
          authorDate,
          body: bodyParts.join('\t').replace(/^\n+/, '').replace(/\s+$/u, ''),
          hash,
          subject: subject || '',
        }
      })
  )
}

function resolveFeedItems(vaultDir, runGit, commits, context) {
  const feedCommits = commits
    .map((commit) => ({ commit, post: parseCommitForFeed(commit) }))
    .filter((entry) => entry.post !== null)

  // 커밋별 touched 문서 상태 + 고속경로용 blob 배치(`<sha>:<당시경로>` frontmatter id, N+1 회피).
  const refs = []
  const statusesByCommit = new Map()
  for (const { commit } of feedCommits) {
    const statuses = getCommitDocStatuses(runGit, commit.hash, anyMarkdown, {
      diffMerges: 'first-parent',
    })
    statusesByCommit.set(commit.hash, statuses)
    for (const status of statuses) refs.push(...refsForStatus(commit.hash, status))
  }

  const blobs = catFileBatch(vaultDir, [...new Set(refs)])
  const items = []
  for (const { commit, post } of feedCommits) {
    const docs = []
    for (const status of statusesByCommit.get(commit.hash) ?? []) {
      docs.push(resolveDocRef(status, commit.hash, blobs, context))
    }
    const survival = judgeFeedSurvival({ importance: post.importance, refs: docs })
    if (!survival.feedSurvives) continue
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
  return items
}

/**
 * feed 커밋이 건드린 문서 → 현재 doc-id (하이브리드 resolve · build.mjs 와 동치가 목표).
 *   ① 고속경로(post-D1): `<sha>:<당시경로>` blob frontmatter id 를 읽어 summary(headIds)에 있으면 채택.
 *   ② 폴백(pre-D1: 그 시점 blob 에 id 부재 → readBlobId null): `buildPathIndex`(경로→현재 id · rename
 *      추적, build.mjs 가 쓰는 그 함수)로 resolve. 실 vault 는 피드가 id 부여(P1 마이그레이션)보다
 *      먼저라 ①이 전부 null → 이 폴백이 없으면 피드가 통째로 prune 돼 feeds 가 빈다.
 *   어느 쪽도 headIds 에 없으면(문서 삭제됨) null → prune. 폴백은 resolve 실패 지점에만 얹는다.
 */
function resolveDocRef(
  status,
  sha,
  blobs,
  { allHeadIds, headIds, resolveEverDeletedPaths, resolvePathIndex },
) {
  for (const ref of refsForStatus(sha, status)) {
    const id = readBlobId(blobs.get(ref), ref)
    if (id && headIds.has(id)) return { id, reason: null }
    if (id && allHeadIds.has(id)) return { id: null, reason: 'draft-excluded' }
  }
  const pathIndex = resolvePathIndex()
  for (const key of [`${sha}:${status.path}`, status.oldPath ? `${sha}:${status.oldPath}` : null]) {
    if (key !== null) {
      const id = pathIndex.get(key)
      if (id && headIds.has(id)) return { id, reason: null }
      if (id && allHeadIds.has(id)) return { id: null, reason: 'draft-excluded' }
    }
  }
  const deleted = resolveEverDeletedPaths()
  if (deleted.has(status.path) || (status.oldPath && deleted.has(status.oldPath))) {
    return { id: null, reason: 'deleted' }
  }
  return { id: null, reason: 'unresolved' }
}

function refsForStatus(sha, status) {
  const refs = [`${sha}:${status.path}`]
  if (status.oldPath) {
    refs.push(`${sha}:${status.oldPath}`, `${sha}^:${status.oldPath}`)
  }
  return refs
}

function readBlobId(blob, filePath) {
  if (!blob) return null
  const match = blob.match(/^---\r?\n([\s\S]*?)\r?\n---/u)
  if (!match) return null
  const id = parseFrontmatterYaml(match[1], filePath).id
  return typeof id === 'string' ? id : null
}

/**
 * HEAD 문서 목록 — `{ filePath(리포 상대 posix), id(현재 doc-id), draft }`. `buildPathIndex` 는 draft 포함
 * 전 문서로 만들고, 노출 가능 id 집합만 env 별로 좁힌다.
 */
function loadHeadDocs(vaultDir) {
  const wikiDir = path.join(vaultDir, ...WIKI_PREFIX.split('/').filter(Boolean))
  return collectMarkdownFilesRecursive(wikiDir)
    .map((filePath) => {
      const parsed = parseMarkdownFile(filePath)
      if (!parsed) return null
      const derived = derivePathAndBreadcrumb(filePath, wikiDir)
      const id = parsed.frontmatter.id ?? derived.path
      return typeof id === 'string'
        ? {
            draft: isDraft({ frontmatter: parsed.frontmatter, relPath: derived.path }),
            filePath: `${WIKI_PREFIX}${derived.path}.md`,
            id,
          }
        : null
    })
    .filter((doc) => doc !== null)
}

function loadIgnoreFeeds(vaultDir) {
  const ignorePath = path.join(vaultDir, 'ignore-feeds.json')
  if (!fs.existsSync(ignorePath)) return []
  return JSON.parse(fs.readFileSync(ignorePath, 'utf8'))
}
