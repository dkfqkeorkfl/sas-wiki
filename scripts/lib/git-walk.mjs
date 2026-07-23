import fs from 'node:fs'
import path from 'node:path'

import { isDraft } from './draft.mjs'
import { byRecencyThenId, parseCommitForFeed } from './feed.mjs'
import { buildPathIndex, catFileBatch, getCommitDocStatuses, makeGitRunner } from './git.mjs'
import { applyIgnoreFeeds } from './ignore.mjs'
import {
  collectMarkdownFilesRecursive,
  derivePathAndBreadcrumb,
  parseFrontmatterYaml,
  parseMarkdownFile,
} from './parse.mjs'

const WIKI_PREFIX = 'vault/wiki/'
const DEFAULT_FEED_LIMIT = 50
const OVERWALK_FACTOR = 3

export function walkFeeds(vault, { after, count, env, from, to } = {}) {
  const vaultDir = path.resolve(vault)
  const limit = typeof count === 'number' && count > 0 ? count : DEFAULT_FEED_LIMIT
  // F4: prod 는 draft 문서를 headIds/pathIndex 에서 제외한다 → draft 만 가리키는 피드는 resolve 실패로
  //   prune 되어 노출되지 않는다(build.mjs 의 excludedFeedRefs 와 같은 방향, `isDraft` SSOT 재사용).
  //   dev(및 미지정)는 전량 — fail-safe 는 prod 만 숨긴다.
  const headDocs = loadHeadDocs(vaultDir, env === 'prod')
  const headIds = new Set(headDocs.map((doc) => doc.id))
  const ignoreEntries = loadIgnoreFeeds(vaultDir)
  const runGit = makeGitRunner(vaultDir)
  // pre-D1 폴백용 경로 역인덱스(경로→현재 doc-id · rename 추적) — build.mjs:buildContent 와 **동일 입력·
  // 동일 함수**(buildPathIndex)로 1회만 구성한다. **지연**: 고속경로(post-D1 blob id)가 전부 풀면 절대
  // 만들지 않아 비용 0. 실 vault(pre-D1: 피드가 id 부여 이전 커밋)에서만 트리거된다.
  let pathIndex = null
  const resolvePathIndex = () => (pathIndex ??= buildPathIndex(headDocs, runGit))
  const collected = new Map()

  // F1: **전량 워크(count 기반 조기 종료 금지)**. git rev-list 워크순서는 선형 히스토리에서 사실상
  //   커밋순(≠author-date)이라(GW3), author-date 가 뒤섞이면(rebase/backdate) 뒤 청크에 더 최신
  //   author-date 피드가 숨어 있을 수 있다. count 만큼 모였다고 끊으면 그 피드를 놓친다. 정렬-안전
  //   바운디드 종료는 "임의 old 커밋이 임의 high author-date 를 가질 수 있다"라 author-date monotonic
  //   가정 없이는 불가능하므로, 피드 커밋을 **전량 수집**한 뒤 JS 재정렬(byRecencyThenId)을 권위로
  //   페이지를 확정한다(억제·from/to·after·상한은 pageItems 가 최종 1회 적용 — 전량이라 언더필 없음).
  let tip = 'HEAD'
  while (true) {
    const commits = revListChunk(runGit, tip, Math.max(limit * OVERWALK_FACTOR, 1))
    if (commits.length === 0) break
    for (const item of resolveFeedItems(vaultDir, runGit, commits, headIds, resolvePathIndex)) {
      collected.set(item.id, item)
    }
    tip = `${commits.at(-1).hash}^`
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

function revListChunk(runGit, tip, maxCount) {
  let raw
  try {
    raw = runGit([
      'rev-list',
      '--author-date-order',
      tip,
      `--max-count=${maxCount}`,
      '--format=%H%x09%aI%x09%s%x09%b%x1e',
      '--',
      WIKI_PREFIX.replace(/\/$/u, ''),
    ])
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (/does not have any commits yet|unknown revision|bad revision/i.test(message)) return []
    throw error
  }

  return raw
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
}

function resolveFeedItems(vaultDir, runGit, commits, headIds, resolvePathIndex) {
  const feedCommits = commits
    .map((commit) => ({ commit, post: parseCommitForFeed(commit) }))
    .filter((entry) => entry.post !== null)

  // 커밋별 touched 문서 상태 + 고속경로용 blob 배치(`<sha>:<당시경로>` frontmatter id, N+1 회피).
  const refs = []
  const statusesByCommit = new Map()
  for (const { commit } of feedCommits) {
    const statuses = getCommitDocStatuses(runGit, commit.hash, WIKI_PREFIX)
    statusesByCommit.set(commit.hash, statuses)
    for (const status of statuses) refs.push(...refsForStatus(commit.hash, status))
  }

  const blobs = catFileBatch(vaultDir, [...new Set(refs)])
  const items = []
  for (const { commit, post } of feedCommits) {
    const docs = []
    const seenDocIds = new Set()
    for (const status of statusesByCommit.get(commit.hash) ?? []) {
      const id = resolveDocId(status, commit.hash, blobs, headIds, resolvePathIndex)
      if (!id || seenDocIds.has(id)) continue
      seenDocIds.add(id)
      docs.push({ anchor: null, anchorText: null, id })
    }
    if (docs.length === 0) continue
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
function resolveDocId(status, sha, blobs, headIds, resolvePathIndex) {
  for (const ref of refsForStatus(sha, status)) {
    const id = readBlobId(blobs.get(ref), ref)
    if (id && headIds.has(id)) return id
  }
  const pathIndex = resolvePathIndex()
  for (const key of [`${sha}:${status.path}`, status.oldPath ? `${sha}:${status.oldPath}` : null]) {
    if (key !== null) {
      const id = pathIndex.get(key)
      if (id && headIds.has(id)) return id
    }
  }
  return null
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
 * HEAD 문서 목록 — `{ filePath(리포 상대 posix), id(현재 doc-id) }`. `buildPathIndex` 입력이자
 * `headIds` 원천이다(둘을 한 번의 파싱으로 얻는다). id 는 frontmatter id, 없으면 path 폴백(기존
 * loadHeadDocIds 계약 보존). build.mjs 의 headDocs 구성(`${WIKI_PREFIX}${relPath}.md`)과 동형.
 *
 * `excludeDrafts`(prod) 면 draft 문서를 목록에서 뺀다 → 그 id 가 headIds/pathIndex 에 없어 draft 만
 * 가리키는 피드가 resolve 실패로 prune 된다(F4 · build.mjs 의 excludedFeedRefs 와 같은 방향).
 */
function loadHeadDocs(vaultDir, excludeDrafts) {
  const wikiDir = path.join(vaultDir, 'vault', 'wiki')
  return collectMarkdownFilesRecursive(wikiDir)
    .map((filePath) => {
      const parsed = parseMarkdownFile(filePath)
      if (!parsed) return null
      const derived = derivePathAndBreadcrumb(filePath, wikiDir)
      if (excludeDrafts && isDraft({ frontmatter: parsed.frontmatter, relPath: derived.path })) {
        return null
      }
      const id = parsed.frontmatter.id ?? derived.path
      return typeof id === 'string' ? { filePath: `${WIKI_PREFIX}${derived.path}.md`, id } : null
    })
    .filter((doc) => doc !== null)
}

function loadIgnoreFeeds(vaultDir) {
  const ignorePath = path.join(vaultDir, 'ignore-feeds.json')
  if (!fs.existsSync(ignorePath)) return []
  return JSON.parse(fs.readFileSync(ignorePath, 'utf8'))
}
