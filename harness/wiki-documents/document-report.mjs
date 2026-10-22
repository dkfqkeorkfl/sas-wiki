import path from 'node:path'

import { SCHEMA_VERSION } from '../../scripts/lib/artifact.mjs'
import { writeFileAtomic } from '../../scripts/lib/atomic.mjs'

export function buildReport({
  env,
  excluded,
  invalidExcludedRefs,
  prunedFeeds,
  sourceCommit,
  total,
  unresolvedPaths,
}) {
  return {
    env,
    excluded,
    generatedAt: new Date().toISOString(),
    invalidExcludedRefs,
    prunedFeeds,
    schemaVersion: SCHEMA_VERSION,
    sourceCommit,
    summary: { excluded: excluded.length, included: total - excluded.length, total },
    unresolvedPaths,
  }
}

/** 실패 사실을 호출자에게 돌려 보고·정책 실패 모두에서 관측하게 한다. */
export function writeReport({ dir, env, report }) {
  const jsonPath = path.join(dir, `summary.report.${env}.json`)
  const txtPath = path.join(dir, `summary.report.${env}.txt`)
  try {
    writeFileAtomic(jsonPath, `${JSON.stringify(report, null, 2)}\n`)
    writeFileAtomic(txtPath, formatReportText(report))
    return { error: null, jsonPath, txtPath }
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
      jsonPath: null,
      txtPath: null,
    }
  }
}

function formatReportText(report) {
  const lines = [
    `summary report ${report.generatedAt}`,
    `sourceCommit: ${report.sourceCommit}`,
    `env: ${report.env}`,
    `total=${report.summary.total} included=${report.summary.included} excluded=${report.summary.excluded}`,
    `prunedFeeds=${report.prunedFeeds} unresolvedPaths=${report.unresolvedPaths.length} invalidExcludedRefs=${report.invalidExcludedRefs.length}`,
  ]
  for (const entry of report.excluded) {
    lines.push(`- ${entry.reasonCode} ${entry.path} ${entry.id ?? 'null'} ${entry.message}`)
  }
  for (const entry of report.unresolvedPaths) {
    lines.push(`- unresolved: ${String(entry.sha).slice(0, 12)} ${entry.path}`)
  }
  return `${lines.join('\n')}\n`
}
