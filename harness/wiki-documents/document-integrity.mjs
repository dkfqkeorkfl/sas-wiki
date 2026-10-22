import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { checkAnchorExists } from '../../scripts/lib/derive.mjs'
import { parseCommitForFeed } from '../../scripts/lib/feed.mjs'
import {
  applyIgnoreFeeds,
  loadIgnoreFeeds,
  reportIgnoreHygiene,
} from '../../scripts/lib/ignore.mjs'
import {
  checkGitAvailable,
  collectGitLog,
  GIT_HISTORY_TIMEOUT_MS,
  makeGitRunner,
  memoizeGitRunner,
} from '../../scripts/lib/git.mjs'
import { collectHeadDocuments, WIKI_PREFIX } from '../../scripts/lib/head-state.mjs'
import { extractWikilinks } from '../../scripts/lib/parse.mjs'
import { assertHistoryIntegrity, parseVault } from '../../scripts/lib/parse-vault.mjs'
import { buildBody, buildFeeds, buildSummary } from '../../scripts/lib/payloads.mjs'
import { loadSchema, validateItem } from '../../scripts/lib/schema-validator.mjs'
import { auditHeadDocState } from './document-state.mjs'
import {
  checkCommitConventions,
  checkFeedResolution,
  checkInvariants,
} from './document-invariants.mjs'
import { buildReport, writeReport } from './document-report.mjs'

const SCHEMA_DIR = fileURLToPath(new URL('../../scripts/schema/', import.meta.url))
const PAYLOAD_FILES = {
  body: 'wiki_body.json',
  feeds: 'wiki_feeds.json',
  summary: 'wiki_summary.json',
}

/** 실제 문서 집행의 내부 API. 생성·조회에서는 호출하지 않는다. */
export function inspectVault({
  vault,
  env = 'prod',
  schema,
  deadlinks = 'warn',
  reportDir,
  onReport = () => {},
  snapshot: injectedSnapshot,
  runGit: injectedRunGit,
}) {
  const vaultDir = path.resolve(vault)
  const schemaDir = schema ? path.resolve(schema) : SCHEMA_DIR
  const runGit = memoizeGitRunner(
    injectedRunGit ??
      makeGitRunner(vaultDir, {
        timeoutMs: GIT_HISTORY_TIMEOUT_MS,
        killSignal: 'SIGKILL',
      }),
  )
  checkGitAvailable(runGit)
  assertHistoryIntegrity(runGit, vaultDir)
  const snapshot = injectedSnapshot ?? collectHeadDocuments(vaultDir)
  const headState = auditHeadDocState(snapshot, env, { runGit, schemaDir })
  const { context, stats, wire } = parseVault(vaultDir, env, { runGit, headState })
  const commits = collectGitLog(runGit)
  const reportPayload = buildReport({
    env,
    excluded: stats.excluded,
    invalidExcludedRefs: stats.invalidExcludedRefs,
    prunedFeeds: stats.prunedFeeds,
    sourceCommit: wire.sourceCommit,
    total: headState.visibleDocs.length + stats.excluded.length,
    unresolvedPaths: stats.unresolvedPaths,
  })
  const report =
    reportDir === undefined
      ? { error: null, jsonPath: null, txtPath: null }
      : writeReport({ dir: reportDir, env, report: reportPayload })
  // 확인 가능한 진단은 정책이 실패하기 전에 전달한다. 쓰기 실패도 이 시점에 알린다.
  onReport(reportPayload, report)

  try {
    checkCommitConventions(commits, runGit, WIKI_PREFIX)
    gateExcluded(stats.excluded, stats.invalidExcludedRefs)
    stats.deadlinks = gateDeadlinks(
      collectDeadlinks(headState.visibleDocs, context.derived),
      deadlinks,
      vaultDir,
    )
    checkFeedResolution(stats)
    const ignore = loadIgnoreFeeds(vaultDir, schemaDir)
    const allFeedIds = new Set(
      commits
        .filter((commit) => parseCommitForFeed(commit) !== null)
        .map((commit) => commit.hash.slice(0, 12)),
    )
    const summary = buildSummary({
      docs: wire.docs,
      env,
      generatedAt: wire.generatedAt,
      sourceCommit: wire.sourceCommit,
      tags: wire.tags,
      tree: wire.tree,
    })
    // count로 잘리기 전 전체 피드의 스키마·불변식을 검사한다.
    const feeds = {
      ...buildFeeds({
        env,
        generatedAt: wire.generatedAt,
        items: applyIgnoreFeeds(wire.items, ignore),
        sourceCommit: wire.sourceCommit,
      }),
      nextCursor: null,
    }
    const body = buildBody({ docs: wire.bodies, sourceCommit: wire.sourceCommit })
    validatePayloads({ body, feeds, summary }, schemaDir)
    checkInvariants(summary, feeds, body)
    for (const stale of reportIgnoreHygiene(ignore, allFeedIds)) {
      stats.warnings.push({ reason: 'stale ignore-feeds 억제(대응 feed 없음)', sha: stale.id })
    }
    if (report.error) throw new Error(`리포트 쓰기 실패: ${report.error}`)
    return { body, feeds, report, stats, summary }
  } catch (error) {
    if (report.error && !error.message.includes(report.error)) {
      throw new Error(`${error.message}\n리포트 쓰기 실패: ${report.error}`, { cause: error })
    }
    throw error
  }
}

function collectDeadlinks(parsedDocs, derived) {
  const { pathToDoc, resolveTargetPath } = derived
  const deadlinks = []
  const ambiguous = []
  for (const doc of parsedDocs) {
    for (const link of extractWikilinks(doc.body)) {
      if (!link.targetRaw) {
        if (link.anchorRaw && !checkAnchorExists(pathToDoc, doc.relPath, link.anchorRaw)) {
          deadlinks.push({
            anchor: link.anchorRaw,
            from: doc.filePath,
            reason: '대상 앵커 없음',
            target: doc.relPath,
          })
        }
        continue
      }
      const resolved = resolveTargetPath(link.targetRaw)
      if (resolved.ambiguous) {
        ambiguous.push({
          anchor: link.anchorRaw,
          from: doc.filePath,
          reason: '동명 문서 충돌',
          target: link.targetRaw,
        })
        continue
      }
      if (!resolved.path) {
        deadlinks.push({
          anchor: link.anchorRaw,
          from: doc.filePath,
          reason: '대상 문서 없음',
          target: link.targetRaw,
        })
        continue
      }
      if (link.anchorRaw && !checkAnchorExists(pathToDoc, resolved.path, link.anchorRaw)) {
        deadlinks.push({
          anchor: link.anchorRaw,
          from: doc.filePath,
          reason: '대상 앵커 없음',
          target: link.targetRaw,
        })
      }
    }
  }
  return { ambiguous, deadlinks }
}

function gateDeadlinks({ ambiguous, deadlinks }, severity, vaultDir) {
  if (ambiguous.length > 0) throw new Error(formatDeadlinks(ambiguous, vaultDir, '동명 문서 충돌'))
  if (severity === 'ignore') return []
  if (deadlinks.length === 0 || severity === 'warn') return deadlinks
  throw new Error(
    `${formatDeadlinks(deadlinks, vaultDir, `데드링크 ${deadlinks.length}건 발견`)}\n내부 deadlinks 정책을 warn 또는 ignore로 지정할 수 있습니다.`,
  )
}

function formatDeadlinks(deadlinks, vaultDir, header) {
  const detail = deadlinks
    .map(
      (dead) =>
        `  - ${path.relative(vaultDir, dead.from)} -> [[${dead.target}${dead.anchor ? `#${dead.anchor}` : ''}]] (${dead.reason})`,
    )
    .join('\n')
  return `${header}:\n${detail}`
}

function gateExcluded(excluded, invalidRefs) {
  if (excluded.length === 0) return
  const detail = excluded
    .map((entry) => `  - ${entry.path}: ${entry.reasonCode} ${entry.message}`)
    .join('\n')
  const refs = invalidRefs
    .map((entry) => `    - ${String(entry.sha).slice(0, 12)} ${entry.path}`)
    .join('\n')
  const refDetail = refs === '' ? '' : `\n  이 문서를 가리킨 feed 커밋:\n${refs}`
  throw new Error(
    `문서 제외 ${excluded.length}건이 허용치 0건을 초과했습니다:\n${detail}${refDetail}`,
  )
}

function validatePayloads(payloads, schemaDir) {
  const violations = []
  for (const [key, file] of Object.entries(PAYLOAD_FILES)) {
    const errors = validateItem(
      payloads[key],
      loadSchema(path.join(schemaDir, `${key}.schema.json`)),
      `$${file}`,
    )
    if (errors.length > 0)
      violations.push(`  - ${file}:\n${errors.map((error) => `      * ${error}`).join('\n')}`)
  }
  if (violations.length > 0)
    throw new Error(`산출물 스키마 위반 ${violations.length}건:\n${violations.join('\n')}`)
}
