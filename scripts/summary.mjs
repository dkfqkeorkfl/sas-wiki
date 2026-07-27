#!/usr/bin/env node
// summary 엔드포인트 + 생성기 CLI. 순수 export 는 유지하고, CLI 는 cache/summary.json 을 발행한다.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { writeFileAtomic } from './lib/atomic.mjs'
import { computeInputsFingerprint } from './lib/fingerprint.mjs'
import { makeGitRunner } from './lib/git.mjs'
import { buildWirePayload, parseVault } from './lib/parse-vault.mjs'
import { buildSummary } from './lib/payloads.mjs'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..')
const SCHEMA_DIR = path.join(SCRIPT_DIR, 'schema')

export function summary(vault, env = 'prod') {
  const vaultDir = path.resolve(vault)
  const payload = buildWirePayload(vaultDir, env)
  const inputsFingerprint = computeInputsFingerprint({
    env,
    sourceCommit: payload.sourceCommit,
    vaultDir,
  })
  return buildSummary({
    docs: payload.docs,
    generatedAt: payload.generatedAt,
    inputsFingerprint,
    sourceCommit: payload.sourceCommit,
    tags: payload.tags,
    tree: payload.tree,
  })
}

export function runSummaryGenerator({
  cachePath,
  env = 'prod',
  force = false,
  maxExcluded,
  reportDir,
  runGit,
  vault,
  writeSideEffects = true,
}) {
  const vaultDir = path.resolve(vault)
  const effectiveCachePath = cachePath ?? path.join(vaultDir, 'cache', 'summary.json')
  const effectiveReportDir = reportDir ?? path.join(vaultDir, 'logs')
  const git = runGit ?? makeGitRunner(vaultDir)
  const sourceCommit = git(['rev-parse', 'HEAD']).trim()
  const inputsFingerprint = computeInputsFingerprint({ env, sourceCommit, vaultDir })

  // 스킵은 **캐시와 리포트가 둘 다** 이 지문의 것일 때만 한다.
  //
  // 리포트가 없거나 지문이 어긋나면 제외 건수를 알 방법이 없는데, 예전에는 그것을 `?? 0` 으로 메워
  // `status: 'clean'` 을 돌려줬다 — 문서 2건이 제외된 vault 가 "깨끗함" 으로 보고되고 `--max-excluded 0`
  // 게이트가 exit 3 → exit 0 으로 뒤집혔다(실측). 리포트 쓰기 실패는 산출물 실패가 아니라는 원칙(D-F ·
  // RP4)이 바로 이 상태를 **정상적으로** 만들어내므로 가정이 아니라 실제 조건이다.
  //
  // 그래서 "모르면 다시 만든다". 관측을 잃은 대가는 재생성 비용이지 거짓 보고가 아니다.
  if (writeSideEffects && !force) {
    const cached = readFreshCache(effectiveCachePath, inputsFingerprint)
    const report = cached ? readMatchingReport(effectiveReportDir, inputsFingerprint) : null
    if (cached && report) {
      const excludedCount = report.summary?.excluded ?? 0
      return {
        cachePath: effectiveCachePath,
        excluded: report.excluded ?? [],
        excludedCount,
        inputsFingerprint,
        payload: cached,
        regenerated: false,
        report: {
          error: null,
          jsonPath: path.join(effectiveReportDir, 'summary.report.json'),
          txtPath: path.join(effectiveReportDir, 'summary.report.txt'),
        },
        sourceCommit,
        status: excludedCount > 0 ? 'partial' : 'clean',
      }
    }
  }

  const parsed = parseVault(vaultDir, env, SCHEMA_DIR, { deepDocGate: true, runGit: git })
  const payload = buildSummary({
    docs: parsed.wire.docs,
    generatedAt: parsed.wire.generatedAt,
    inputsFingerprint,
    sourceCommit: parsed.wire.sourceCommit,
    tags: parsed.wire.tags,
    tree: parsed.wire.tree,
  })
  const excluded = parsed.stats.excluded ?? []
  const result = {
    cachePath: effectiveCachePath,
    excluded,
    excludedCount: excluded.length,
    inputsFingerprint,
    payload,
    regenerated: true,
    report: { error: null, jsonPath: null, txtPath: null },
    sourceCommit,
    status: excluded.length > 0 ? 'partial' : 'clean',
  }

  if (!writeSideEffects) return result

  writeFileAtomic(effectiveCachePath, `${JSON.stringify(payload)}\n`)
  const report = buildReport({
    env,
    excluded,
    inputsFingerprint,
    regenerated: true,
    sourceCommit,
    total: parsed.gate.visibleDocs.length + excluded.length,
  })
  try {
    fs.mkdirSync(effectiveReportDir, { recursive: true })
    const jsonPath = path.join(effectiveReportDir, 'summary.report.json')
    const txtPath = path.join(effectiveReportDir, 'summary.report.txt')
    writeFileAtomic(jsonPath, `${JSON.stringify(report, null, 2)}\n`)
    writeFileAtomic(txtPath, formatReportText(report))
    result.report = { error: null, jsonPath, txtPath }
  } catch (error) {
    result.report = {
      error: error instanceof Error ? error.message : String(error),
      jsonPath: null,
      txtPath: null,
    }
  }
  return result
}

export async function main(argv = process.argv.slice(2)) {
  let options
  try {
    options = parseCliArgs(argv)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 2
    return
  }

  try {
    const result = runSummaryGenerator(options)
    if (options.status) {
      process.stdout.write(`${JSON.stringify(statusPayload(result))}\n`)
    } else {
      process.stdout.write(`${JSON.stringify(result.payload)}\n`)
    }
    // `--stdout` 은 **아무것도 쓰지 않는다**(side-effect-free 질의). 그런데도 `cache=<경로>` 를 찍으면
    //   "저 파일이 갱신됐다" 는 거짓을 말하게 된다 — 실제로는 그 경로가 옛 세대 그대로다.
    if (!options.writeSideEffects) {
      console.error(
        `[wiki] summary computed status=${result.status} excluded=${result.excludedCount} (--stdout: 캐시·리포트 미기록)`,
      )
    } else if (result.regenerated) {
      console.error(
        `[wiki] summary regenerated status=${result.status} excluded=${result.excludedCount} cache=${result.cachePath}`,
      )
    } else {
      console.error(
        `[wiki] summary cache hit excluded=${result.excludedCount} cache=${result.cachePath}`,
      )
    }
    if (result.report.error) console.error(`[wiki] report error: ${result.report.error}`)
    if (typeof options.maxExcluded === 'number' && result.excludedCount > options.maxExcluded) {
      process.exitCode = 3
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}

function parseCliArgs(argv) {
  const options = { env: 'prod', vault: REPO_ROOT, writeSideEffects: true }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const [name, inlineValue] = arg.split('=', 2)
    const readValue = () => {
      if (inlineValue !== undefined) return inlineValue
      const value = argv[i + 1]
      if (value === undefined) throw new Error(`${arg} 값이 필요합니다`)
      i += 1
      return value
    }
    if (arg === '--stdout') {
      options.writeSideEffects = false
      continue
    }
    if (arg === '--status') {
      options.status = true
      continue
    }
    if (arg === '--force') {
      options.force = true
      continue
    }
    if (name === '--vault') {
      options.vault = path.resolve(readValue())
      continue
    }
    if (name === '--env') {
      const value = readValue()
      if (value !== 'dev' && value !== 'prod') {
        throw new Error(`알 수 없는 --env 값: "${value}" — dev|prod 만 허용합니다`)
      }
      options.env = value
      continue
    }
    if (name === '--out') {
      options.cachePath = path.resolve(readValue())
      continue
    }
    if (name === '--max-excluded') {
      const raw = readValue()
      if (!/^\d+$/u.test(raw)) throw new Error('--max-excluded 에는 0 이상의 정수가 필요합니다')
      options.maxExcluded = Number.parseInt(raw, 10)
      continue
    }
    throw new Error(`알 수 없는 인자: ${arg}`)
  }
  return options
}

function readFreshCache(cachePath, inputsFingerprint) {
  try {
    const payload = JSON.parse(fs.readFileSync(cachePath, 'utf8'))
    return payload.inputsFingerprint === inputsFingerprint ? payload : null
  } catch {
    return null
  }
}

function readMatchingReport(reportDir, inputsFingerprint) {
  try {
    const report = JSON.parse(fs.readFileSync(path.join(reportDir, 'summary.report.json'), 'utf8'))
    return report.inputsFingerprint === inputsFingerprint ? report : null
  } catch {
    return null
  }
}

function buildReport({ env, excluded, inputsFingerprint, regenerated, sourceCommit, total }) {
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    inputsFingerprint,
    sourceCommit,
    inputs: { env },
    regenerated,
    summary: { excluded: excluded.length, included: total - excluded.length, total },
    excluded,
  }
}

function formatReportText(report) {
  const lines = [
    `summary report ${report.generatedAt}`,
    `inputsFingerprint: ${report.inputsFingerprint}`,
    `sourceCommit: ${report.sourceCommit}`,
    `env: ${report.inputs.env}`,
    `regenerated: ${report.regenerated}`,
    `total=${report.summary.total} included=${report.summary.included} excluded=${report.summary.excluded}`,
  ]
  for (const entry of report.excluded) {
    lines.push(`- ${entry.reasonCode} ${entry.path} ${entry.id ?? 'null'} ${entry.message}`)
  }
  return `${lines.join('\n')}\n`
}

function statusPayload(result) {
  return {
    cachePath: result.cachePath,
    excludedCount: result.excludedCount,
    inputsFingerprint: result.inputsFingerprint,
    regenerated: result.regenerated,
    reportPath: result.report.jsonPath,
    status: result.status,
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
