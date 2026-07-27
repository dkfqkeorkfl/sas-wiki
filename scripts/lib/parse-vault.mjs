import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { derive } from './derive.mjs'
import { judgeDocs } from './doc-gate.mjs'
import { isDraft } from './draft.mjs'
import { buildFeedItems, parseCommitForFeed } from './feed.mjs'
import {
  anyMarkdown,
  buildPathIndex,
  checkGitAvailable,
  checkHistoryIntegrity,
  collectDeletedDocPaths,
  collectEverDeletedDocPaths,
  collectGitLog,
  makeGitRunner,
} from './git.mjs'
import { reportIgnoreHygiene } from './ignore.mjs'
import {
  collectMarkdownFilesRecursive,
  derivePathAndBreadcrumb,
  parseMarkdownFile,
} from './parse.mjs'
import { loadSchema, validateItem } from './validate.mjs'

/** vault 문서의 리포 상대 경로 접두사 — lib 하위에 하드코딩하지 않고 이 한 곳에서 주입한다(이관 가능성). */
export const WIKI_PREFIX = 'wiki/'

/** 생산 JSON Schema 디렉토리 — 이 모듈은 scripts/lib/ 이므로 상위 scripts/schema. */
const SCHEMA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'schema')

/**
 * read-path 순수 파싱: git → pre-wire payload. **엔드포인트(buildWirePayload)와 검증기(validate.mjs)가
 * 공유하는 단일 파싱 엔진**이다. 검증 throw-게이트는 여기서 돌지 않는다 — validate.mjs 가 반환된
 * `gate`/`stats` 로 게이트를 얹고, on-demand 엔드포인트는 검증된 vault 를 가정하고 이 함수만 부른다.
 *
 * @param {string} vaultDir vault 리포 루트(절대경로)
 * @param {'dev'|'prod'} env
 * @param {string} schemaDir 생산 JSON Schema 디렉토리
 * @returns {{ gate: { commits: object[], derived: object, runGit: Function, visibleDocs: object[] }, stats: object, wire: object }}
 */
export function parseVault(
  vaultDir,
  env,
  schemaDir,
  { deepDocGate = false, runGit: injectedRunGit } = {},
) {
  const wikiDir = path.join(vaultDir, ...WIKI_PREFIX.split('/').filter(Boolean))

  // 한 파싱 안에서 같은 git 질의는 같은 답을 낸다(리포는 그동안 변하지 않는다). 문서별
  // `git log --follow` 는 검증·파생·역인덱스 3곳이 각각 부르므로 캐시 없이는 프로세스 스폰이 3배다.
  const runGit = memoize(injectedRunGit ?? makeGitRunner(vaultDir))
  checkGitAvailable(runGit)
  assertHistoryIntegrity(runGit, vaultDir)
  const commits = collectGitLog(runGit)
  const sourceCommit = commits.length > 0 ? commits[0].hash : null

  // 위키 루트에 있으나 파싱에 실패한 `.md`(frontmatter 부재 등). **문서 후보이되 문서는 아니다** —
  //   피드가 이런 파일을 가리키면 조용히 넘기지 않고 unresolved 로 시끄럽게 끊어야 어느 커밋이
  //   깨진 문서를 참조하는지 알 수 있다(validate.cli 계약: sha + 경로). 이 판정은 "지금 위키 루트
  //   안에 있는가"를 묻는 **HEAD 상태 계층**이므로 여기서 prefix 를 쓰는 것이 정당하다 — 커밋별 diff
  //   루프(히스토리 계층)에 prefix 리터럴을 되돌려 넣으면 이 phase 가 없앤 결합이 부활한다.
  const strayDocPaths = new Set()

  const parsedDocs = collectMarkdownFilesRecursive(wikiDir)
    .map((filePath) => {
      const parsed = parseMarkdownFile(filePath)
      if (!parsed) {
        strayDocPaths.add(`${WIKI_PREFIX}${path.relative(wikiDir, filePath).split(path.sep).join('/')}`) // prettier-ignore
        return null
      }
      const derived = derivePathAndBreadcrumb(filePath, wikiDir)
      return { ...parsed, breadcrumb: derived.breadcrumb, relPath: derived.path }
    })
    .filter(Boolean)

  const visibleCandidates = env === 'dev' ? parsedDocs : parsedDocs.filter((doc) => !isDraft(doc))
  const draftExcludedDocs = env === 'dev' ? [] : parsedDocs.filter((doc) => isDraft(doc))
  const judged = judgeDocs(visibleCandidates, {
    runGit: deepDocGate ? runGit : undefined,
    strayPaths: strayDocPaths,
    wikiPrefix: WIKI_PREFIX,
    wikiSchema: loadSchema(path.join(schemaDir, 'wiki-doc.schema.json')),
  })
  const visibleDocs = judged.visible
  const excludedPaths = new Set(judged.excluded.map((entry) => entry.path))
  const invalidDocs = visibleCandidates.filter((doc) =>
    excludedPaths.has(`${WIKI_PREFIX}${doc.relPath}.md`),
  )
  const invalidIds = new Set(invalidDocs.map((doc) => doc.frontmatter.id))

  const derived = derive(visibleDocs, runGit, { wikiPrefix: WIKI_PREFIX })

  const allHeadDocs = parsedDocs
    .filter((doc) => !invalidDocs.includes(doc))
    .map((doc) => ({
      filePath: `${WIKI_PREFIX}${doc.relPath}.md`,
      id: doc.frontmatter.id,
    }))
  const headDocs = [...derived.pathToDoc.values()].map((doc) => ({
    filePath: `${WIKI_PREFIX}${doc.relPath}.md`,
    id: doc.id,
  }))
  const pathIndex = buildPathIndex(allHeadDocs, runGit)
  const invalidFeedRefs = new Set(
    buildPathIndex(
      invalidDocs.map((doc) => ({ filePath: `${WIKI_PREFIX}${doc.relPath}.md`, id: doc.frontmatter.id })), // prettier-ignore
      runGit,
    ).keys(),
  )
  for (const strayPath of strayDocPaths) invalidFeedRefs.add(`HEAD:${strayPath}`)
  const deletedPaths = collectDeletedDocPaths(runGit, {
    headPaths: new Set(allHeadDocs.map((doc) => doc.filePath)),
    isDocPath: anyMarkdown,
  })
  const everDeletedPaths = collectEverDeletedDocPaths(runGit, { isDocPath: anyMarkdown })
  const excludedFeedRefs = new Set(
    buildPathIndex(
      draftExcludedDocs.map((doc) => ({ filePath: `${WIKI_PREFIX}${doc.relPath}.md`, id: doc.frontmatter.id })), // prettier-ignore
      runGit,
    ).keys(),
  )
  const { items, stats } = buildFeedItems(commits, {
    deletedPaths,
    everDeletedPaths,
    excludedIds: new Set(draftExcludedDocs.map((doc) => doc.frontmatter.id)),
    excludedFeedRefs,
    invalidFeedRefs,
    invalidIds,
    pathIndex,
    runGit,
    strayDocPaths,
  })
  stats.excluded = judged.excluded
  stats.invalidExcludedRefs ??= []

  const ignore = loadIgnoreFeeds(vaultDir, schemaDir)
  const allFeedIds = new Set(
    commits
      .filter((commit) => parseCommitForFeed(commit) !== null)
      .map((commit) => commit.hash.slice(0, 12)),
  )
  for (const stale of reportIgnoreHygiene(ignore, allFeedIds)) {
    stats.warnings.push({ reason: 'stale ignore-feeds 억제(대응 feed 없음)', sha: stale.id })
  }

  return {
    // 게이트 원자재 — validate.mjs 가 여기서 검증 throw-게이트를 얹는다(파싱 자신은 검증하지 않는다).
    gate: { commits, derived, runGit, visibleDocs },
    stats,
    wire: {
      bodies: derived.bodies,
      docs: derived.docs,
      generatedAt: deriveGeneratedAt(derived.docs, items),
      ignore,
      items,
      sourceCommit,
      tags: derived.tags,
      tree: derived.tree,
    },
  }
}

/** on-demand 엔드포인트가 소비하는 pre-wire payload(검증 게이트 없이 파싱만). */
export function buildWirePayload(vault, env = 'prod') {
  return parseVault(path.resolve(vault), env, SCHEMA_DIR).wire
}

export function deriveGeneratedAt(docs, items) {
  const epoch = process.env.SOURCE_DATE_EPOCH
  if (epoch && /^\d+$/.test(epoch)) return new Date(Number.parseInt(epoch, 10) * 1000).toISOString()
  const timestamps = []
  for (const doc of docs) if (doc.updated) timestamps.push(new Date(doc.updated).toISOString())
  for (const item of items)
    if (item.ts && !Number.isNaN(Date.parse(item.ts)))
      timestamps.push(new Date(item.ts).toISOString())
  if (timestamps.length === 0) return '1970-01-01T00:00:00.000Z'
  timestamps.sort()
  return timestamps.at(-1)
}

/**
 * 얕은/부분 클론 선제 fail. 얕은 히스토리는 생성 커밋을 잘라 **문서 id 와 피드를 조용히 틀리게 만든다**
 * — 빌드는 exit 0, 스키마는 통과, 화면은 정상 렌더. 데이터만 틀린다. 그래서 여기서 시끄럽게 끊는다.
 */
function assertHistoryIntegrity(runGit, vaultDir) {
  const { partialFilter, shallow } = checkHistoryIntegrity(runGit)
  if (shallow) {
    throw new Error(
      `얕은(shallow) 히스토리입니다: ${vaultDir}\n` +
        '얕은 히스토리는 생성 커밋과 feed: 커밋을 잘라 문서 id 와 피드를 조용히 틀리게 만듭니다.\n' +
        `복구: git -C ${vaultDir} fetch --unshallow  (CI 는 actions/checkout 의 fetch-depth: 0)`,
    )
  }
  if (partialFilter) {
    throw new Error(
      `partial clone(필터 "${partialFilter}")입니다: ${vaultDir}\n` +
        'blob 이 지연 로드되면 문서 본문 검증이 조용히 어긋납니다.\n' +
        `복구: 필터 없이 다시 클론하세요 (git -C ${vaultDir} config --unset remote.origin.partialclonefilter 후 full fetch)`,
    )
  }
}

/** 성공한 조회만 캐시한다(실패는 그대로 전파 — 조용한 폴백 금지). */
function memoize(runGit) {
  const cache = new Map()
  return (args) => {
    const key = JSON.stringify(args)
    if (cache.has(key)) return cache.get(key)
    const value = runGit(args)
    cache.set(key, value)
    return value
  }
}

/**
 * vault 리포 루트의 `ignore-feeds.json`(억제 tombstone 목록)을 로드·검증한다.
 *
 * **부재 = `[]`(fail-open)** — 목록 부재는 "억제 없음"이지 "전량 억제" 가 아니다. **존재하되 스키마
 * 위반 = throw(fail-loud)** — 신뢰 못 할 억제 목록은 조용히 무시하지 않는다(malformed JSON 도 throw).
 * stale(대응 feed 없는 유효 엔트리)은 여기서 끊지 않고 hygiene 경고로만 관측한다.
 */
function loadIgnoreFeeds(vaultDir, schemaDir) {
  const ignorePath = path.join(vaultDir, 'ignore-feeds.json')
  if (!fs.existsSync(ignorePath)) return []
  const entries = JSON.parse(fs.readFileSync(ignorePath, 'utf8'))
  const errors = validateItem(
    entries,
    loadSchema(path.join(schemaDir, 'ignore-feeds.schema.json')),
    'ignore-feeds.json',
  )
  if (errors.length > 0) {
    throw new Error(
      `ignore-feeds.json 스키마 위반 ${errors.length}건 — 신뢰할 수 없는 억제 목록으로 빌드를 중단한다:\n` +
        errors.map((message) => `  - ${message}`).join('\n'),
    )
  }
  return entries
}
