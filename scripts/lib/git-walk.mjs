import { parseCommitForFeed } from './feed.mjs'
import {
  anyMarkdown,
  buildPathIndex,
  collectEverDeletedDocPaths,
  getCommitDocStatuses,
  makeGitRunner,
} from './git.mjs'
import { judgeFeedSurvival } from './feed-survival.mjs'
import { loadHeadDocState } from './head-state.mjs'
import { parseFrontmatterYaml } from './parse.mjs'

// ★ P5 Task 9(D-I) — 독립 실행형 피드 워크(수집+페이지 합성)는 `scripts/__tests__/helpers/`로
//   옮겼다(테스트 전용 참조 구현이라는 그 성격 자체는 P1 부터 그대로다 — 자리만 프로덕션 스캔
//   범위 밖으로 이동했다).
//
// ★ v3 P2(D6·D12·D16·D39) — **페이지 합성(`pageFeeds`)도 같은 자리로 옮겼다.** 조회 경로가
//   커서 기반 라이브 워크(`lib/feed-cursor.mjs`)로 교체되면서 프로덕션 호출자가 0이 됐고, 그 함수가
//   들고 있던 세 가지 — 페이지 크기 침묵 폴백(D16) · `from`/`to` ISO 경계(D6) · `{ts,feedId}`
//   객체 커서(D8) — 는 **개념 자체가 소멸**한다. 정렬 권위도 JS 재정렬에서 git 워크 순서로 옮겨갔다
//   (D39). 남은 참조 구현으로서의 값은 테스트에만 있으므로 `__tests__/helpers/walk-feeds.mjs` 가
//   소유한다.
//
// 이 파일이 프로덕션에 내보내는 것은 `collectFeedItems`(생성기·validate 가 쓴다)와
//   `makeFeedItemResolver`(커서 워크가 주입받는 해석기) 둘뿐이다.

export function collectFeedItems(vaultDir, { env, headState: injectedHeadState, runGit } = {}) {
  const resolvedRunGit = runGit ?? makeGitRunner(vaultDir)
  const { context, stats } = buildResolveContext(vaultDir, resolvedRunGit, env, injectedHeadState)
  const collected = new Map()

  // F1: **전량 워크(count 기반 조기 종료 금지)**.
  //   ★ v3 P2(D39) — 이 사유가 「정렬 권위」에서 **「조회가 아니라 검증·생성이 전량을 요구한다」**로
  //   바뀐다. 조회는 더 이상 이 함수를 타지 않는다(커서 워크가 필요한 만큼만 훑는다). 이 함수의
  //   유일한 프로덕션 호출자는 `parse-vault.mjs:33` 이고, 그 소비자는 생성기(`--out` 아티팩트)와
  //   `validate.mjs`(무결성 게이트)다 — 둘 다 **히스토리 전량**을 봐야 판정이 성립한다:
  //     · validate 는 "어느 feed 커밋이 해석되지 않는가"(`checkFeedResolution`)를 전수로 묻는다.
  //     · 생성기는 200건 윈도우를 자르기 **전에** 전량을 알아야 억제·생존 판정이 창 밖에서도 맞다.
  //   즉 전량 워크는 비용 최적화의 미착수가 아니라 **판정의 전제**다. 조기 종료를 넣지 마라.
  const commits = revListFeedCandidates(resolvedRunGit)
  for (const item of resolveFeedItems(vaultDir, resolvedRunGit, commits, context)) {
    collected.set(item.id, item)
  }

  return { items: [...collected.values()], stats }
}

/**
 * 커서 워크(`lib/feed-cursor.mjs` `walkCursorPage`)가 주입받는 **해석기**를 만든다 —
 * 설계 §3-3 절차 ③(`feed:` 필터) + ④ 앞단(생존 판정 `judgeFeedSurvival`).
 *
 * 왜 주입인가: 배치·커서(무엇을 몇 개 훑는가)는 **비용 정책**이고, 커밋 → feed item 해석은 HEAD
 * 문서 상태·경로 역인덱스를 드는 **데이터 계층**이다. 층이 달라 실패 모드도 다르다.
 *
 * ★ 컨텍스트(HEAD 문서 상태·역인덱스)는 **첫 호출에서 한 번만** 만든다 — 2차 배치가 그것을 다시
 *   만들면 워크 1회의 비용이 두 배가 된다(D23 이 막으려는 바로 그 비용).
 *
 * @param {string} vaultDir
 * @param {{ env?: 'dev'|'prod', headState?: object, runGit?: (args: string[]) => string }} [options]
 * @returns {(shas: string[]) => object[]} 커밋 해시 배열을 **워크 순서 그대로** 받아 살아남은 item
 */
export function makeFeedItemResolver(vaultDir, { env, headState, runGit } = {}) {
  const resolvedRunGit = runGit ?? makeGitRunner(vaultDir)
  let prepared = null
  const ensure = () => (prepared ??= buildResolveContext(vaultDir, resolvedRunGit, env, headState))

  return (shas) => {
    if (shas.length === 0) return []
    const commits = readCommitRecords(resolvedRunGit, shas)
    return resolveFeedItems(vaultDir, resolvedRunGit, commits, ensure().context)
  }
}

/** `resolveFeedItems` 가 요구하는 HEAD 상태·역인덱스·통계 — 수집 경로와 커서 경로가 공유한다. */
function buildResolveContext(vaultDir, resolvedRunGit, env, injectedHeadState) {
  // 판정은 **`dev` 만 전량, 그 외는 전부 prod**(fail-closed) — parse-vault.mjs 의 visibleDocs 와
  // 같은 극성이어야 한다. `pathIndex` 는 draft 포함 전 문서로 만들어야 삭제와 draft 배제 사유를 가른다.
  const excludeDrafts = env !== 'dev'
  const headState = injectedHeadState ?? loadHeadDocState(vaultDir, env, { runGit: resolvedRunGit })
  const headDocs = headState.headDocs
  const visibleHeadDocs = excludeDrafts ? headDocs.filter((doc) => !doc.draft) : headDocs
  const headIds = new Set(visibleHeadDocs.map((doc) => doc.id))
  const allHeadIds = new Set(headDocs.map((doc) => doc.id))
  const invalidIds = new Set(headState.invalidDocs.map((doc) => doc.frontmatter.id))
  // pre-D1 폴백용 경로 역인덱스(경로→현재 doc-id · rename 추적) — build.mjs:buildContent 와 **동일 입력·
  // 동일 함수**(buildPathIndex)로 1회만 구성한다. **지연**: 고속경로(post-D1 blob id)가 전부 풀면 절대
  // 만들지 않아 비용 0. 실 vault(pre-D1: 피드가 id 부여 이전 커밋)에서만 트리거된다.
  let pathIndex = null
  const resolvePathIndex = () => (pathIndex ??= buildPathIndex(headDocs, resolvedRunGit))
  let invalidPathIndex = null
  const resolveInvalidPathIndex = () =>
    (invalidPathIndex ??= buildPathIndex(headState.invalidRefs, resolvedRunGit))
  let everDeletedPaths = null
  const resolveEverDeletedPaths = () =>
    (everDeletedPaths ??= collectEverDeletedDocPaths(resolvedRunGit, { isDocPath: anyMarkdown }))
  const stats = {
    invalidExcludedRefs: [],
    prunedDocRefs: 0,
    prunedFeeds: 0,
    unpublishedFeedCommits: [],
    unresolvedPaths: [],
    warnings: [],
  }

  return {
    context: {
      allHeadIds,
      headIds,
      invalidIds,
      resolveInvalidPathIndex,
      resolveEverDeletedPaths,
      resolvePathIndex,
      runGit: resolvedRunGit,
      stats,
      strayDocPaths: headState.strayDocPaths,
    },
    stats,
  }
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

  return parseCommitRecords(raw)
}

/**
 * 이미 정해진 커밋 해시 목록의 메타(해시·author-date·subject·body)를 **워크 순서 그대로** 읽는다.
 *
 * `--no-walk=unsorted` 가 계약이다 — 기본 `--no-walk`(=sorted)는 커밋 날짜로 **다시 정렬**하므로
 * 커서 워크가 정한 순서(= 페이지 순서이자 `nextCursor` 의 근거)가 조용히 뒤바뀐다.
 * `--max-count` 은 **붙이지 않는다**: 이 호출은 배치 워크가 아니라 메타 조회이고, 붙이면 배치 관측
 * (WA1~WA3·WA9 가 `rev-list` + `--max-count=` 로 배치를 식별한다)이 오염된다.
 */
function readCommitRecords(runGit, shas) {
  const raw = runGit([
    'rev-list',
    '--no-walk=unsorted',
    '--format=%H%x09%aI%x09%s%x09%b%x1e',
    '--end-of-options',
    ...shas,
  ])
  return parseCommitRecords(raw)
}

function parseCommitRecords(raw) {
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
  const stats = context.stats
  const feedCommits = commits
    .map((commit) => ({ commit, post: parseCommitForFeed(commit, stats) }))
    .filter((entry) => entry.post !== null)

  // 커밋별 touched 문서 상태. 현재 id 해석은 rename-aware pathIndex 로 통일한다.
  const statusesByCommit = new Map()
  for (const { commit } of feedCommits) {
    const statuses = getCommitDocStatuses(runGit, commit.hash, anyMarkdown, {
      diffMerges: 'first-parent',
    })
    statusesByCommit.set(commit.hash, statuses)
  }

  const items = []
  for (const { commit, post } of feedCommits) {
    const docs = []
    for (const status of statusesByCommit.get(commit.hash) ?? []) {
      docs.push(resolveDocRef(status, commit.hash, context))
    }
    const survival = judgeFeedSurvival({ importance: post.importance, refs: docs })
    // ★ Task 10(F-17) 실측 수정 — `unresolved`(stray 문서 참조)를 이 합에서 빠뜨리면 그 사유로
    //   드랍된 feed 가 `items` 에서는 사라지는데(아래 continue) `prunedFeeds`/`prunedDocRefs` 는 0인
    //   채로 남는다 — "버려졌다" 는 사실 자체가 리포트에서 조용히 유실된다(PL11 이 그 유실을 잡는다).
    //   `deleted`·`draft-excluded`·`invalid-excluded` 와 같은 자리에서 세야 진단이 실제 드랍과 일치한다.
    stats.prunedDocRefs +=
      survival.counters.deleted +
      survival.counters.draftExcluded +
      survival.counters.invalidExcluded +
      survival.counters.unresolved
    if (!survival.feedSurvives) {
      if (
        survival.counters.deleted +
          survival.counters.draftExcluded +
          survival.counters.invalidExcluded +
          survival.counters.unresolved >
        0
      ) {
        stats.prunedFeeds += 1
      }
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
  {
    allHeadIds,
    headIds,
    invalidIds,
    resolveEverDeletedPaths,
    resolveInvalidPathIndex,
    resolvePathIndex,
    runGit,
    stats,
    strayDocPaths,
  },
) {
  const pathIndex = resolvePathIndex()
  const invalidPathIndex = resolveInvalidPathIndex()
  for (const key of [`${sha}:${status.path}`, status.oldPath ? `${sha}:${status.oldPath}` : null]) {
    if (key !== null) {
      const id = pathIndex.get(key)
      if (id && headIds.has(id)) return { id, reason: null }
      const invalidId = invalidPathIndex.get(key)
      if (invalidId && invalidIds.has(invalidId)) {
        stats.invalidExcludedRefs.push({ path: status.path, sha })
        return { id: null, reason: 'invalid-excluded' }
      }
      if (id && allHeadIds.has(id)) return { id: null, reason: 'draft-excluded' }
    }
  }
  for (const ref of refsForStatus(sha, status)) {
    const id = readBlobId(runGit, ref, status.path)
    if (id && headIds.has(id)) return { id, reason: null }
    if (id && invalidIds.has(id)) {
      stats.invalidExcludedRefs.push({ path: status.path, sha })
      return { id: null, reason: 'invalid-excluded' }
    }
    if (id && allHeadIds.has(id)) return { id: null, reason: 'draft-excluded' }
  }
  if (strayDocPaths.has(status.path) || (status.oldPath && strayDocPaths.has(status.oldPath))) {
    stats.invalidExcludedRefs.push({ path: status.path, sha })
    stats.unresolvedPaths.push({ path: status.path, sha })
    return { id: null, reason: 'unresolved' }
  }
  const deleted = resolveEverDeletedPaths()
  if (deleted.has(status.path) || (status.oldPath && deleted.has(status.oldPath))) {
    return { id: null, reason: 'deleted' }
  }
  return { id: null, reason: 'unresolved' }
}

function readBlobId(runGit, ref, filePath) {
  let blob
  try {
    blob = runGit(['-c', 'core.quotepath=false', 'show', ref])
  } catch {
    return null
  }
  const match = blob.match(/^---\r?\n([\s\S]*?)\r?\n---/u)
  if (!match) return null
  try {
    const id = parseFrontmatterYaml(match[1], filePath).id
    return typeof id === 'string' ? id : null
  } catch {
    return null
  }
}

function refsForStatus(sha, status) {
  const refs = [`${sha}:${status.path}`]
  if (status.oldPath) {
    refs.push(`${sha}:${status.oldPath}`, `${sha}^:${status.oldPath}`)
  }
  return refs
}
