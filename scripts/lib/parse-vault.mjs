import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { derive } from './derive.mjs'
import { parseCommitForFeed } from './feed.mjs'
import { collectFeedItems } from './git-walk.mjs'
import { checkGitAvailable, checkHistoryIntegrity, collectGitLog, makeGitRunner } from './git.mjs'
import { WIKI_PREFIX, loadHeadDocState } from './head-state.mjs'
import { reportIgnoreHygiene } from './ignore.mjs'
import { loadSchema, validateItem } from './validate.mjs'

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
  // 한 파싱 안에서 같은 git 질의는 같은 답을 낸다(리포는 그동안 변하지 않는다). 문서별
  // `git log --follow` 는 검증·파생·역인덱스 3곳이 각각 부르므로 캐시 없이는 프로세스 스폰이 3배다.
  const runGit = memoize(injectedRunGit ?? makeGitRunner(vaultDir))
  checkGitAvailable(runGit)
  assertHistoryIntegrity(runGit, vaultDir)
  const commits = collectGitLog(runGit)
  const sourceCommit = commits.length > 0 ? commits[0].hash : null

  const headState = loadHeadDocState(vaultDir, env, { deepDocGate, runGit, schemaDir })
  const derived = derive(headState.visibleDocs, runGit, { wikiPrefix: WIKI_PREFIX })
  const { items, stats } = collectFeedItems(vaultDir, { env, headState, runGit })
  stats.excluded = headState.excluded
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
    gate: { commits, derived, runGit, visibleDocs: headState.visibleDocs },
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
