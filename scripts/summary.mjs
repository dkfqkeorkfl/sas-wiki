#!/usr/bin/env node
// summary **생성기 CLI** — 발행 아티팩트가 신선한지 판정하고, 어긋날 때만 다시 만든다.
//
// ★ 이 파일의 **정적** import 그래프에 파싱·렌더 툴체인이 들어오면 안 된다.
//   판정에 실제로 필요한 일은 지문 계산 + git HEAD 조회 + 파일 한 개 읽기뿐인데, 마크다운 렌더러를
//   정적으로 물면 "안 바뀌었나?" 한 번을 묻는 데도 그 로드 비용(수 초)을 전부 낸다 — 렌더 결과를
//   한 줄도 쓰지 않으면서. 그래서 파싱은 **재생성 분기에서만** 동적으로 연다. 순수 엔드포인트
//   `summary(vault, env)` 는 같은 이유로 `lib/summary-endpoint.mjs` 로 나갔다(여기서 재export 하면
//   정적 import 와 같은 비용이라 분리가 무효가 된다).
//   이 규칙은 산문이 아니라 정적 import 그래프 테스트가 지킨다.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { ARTIFACT_PRODUCER, SCHEMA_VERSION, artifactPath, readArtifact } from './lib/artifact.mjs'
import { writeFileAtomic } from './lib/atomic.mjs'
import { computeInputsFingerprint } from './lib/fingerprint.mjs'
import { makeGitRunner } from './lib/git.mjs'
import { buildSummary } from './lib/payloads.mjs'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..')
const SCHEMA_DIR = path.join(SCRIPT_DIR, 'schema')

export async function runSummaryGenerator({
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
  // 반환 키는 `cachePath` 로 남는다(호출 계약) — 가리키는 파일은 캐시가 아니라 발행 아티팩트다.
  const effectiveCachePath = cachePath ?? artifactPath(vaultDir, env)
  const effectiveReportDir = reportDir ?? path.join(vaultDir, 'logs')
  const reportJsonPath = path.join(effectiveReportDir, 'summary.report.json')
  const reportTxtPath = path.join(effectiveReportDir, 'summary.report.txt')
  const git = runGit ?? makeGitRunner(vaultDir)
  const sourceCommit = git(['rev-parse', 'HEAD']).trim()
  const inputsFingerprint = computeInputsFingerprint({ env, sourceCommit, vaultDir })

  // 스킵은 **아티팩트와 리포트가 둘 다** 이 지문의 것일 때만 한다.
  //
  // 리포트가 없거나 지문이 어긋나면 제외 건수를 알 방법이 없는데, 예전에는 그것을 `?? 0` 으로 메워
  // `status: 'clean'` 을 돌려줬다 — 문서 2건이 제외된 vault 가 "깨끗함" 으로 보고되고 `--max-excluded 0`
  // 게이트가 exit 3 → exit 0 으로 뒤집혔다(실측). 리포트 쓰기 실패는 산출물 실패가 아니라는 원칙(D-F ·
  // RP4)이 바로 이 상태를 **정상적으로** 만들어내므로 가정이 아니라 실제 조건이다.
  //
  // 그래서 "모르면 다시 만든다". 관측을 잃은 대가는 재생성 비용이지 거짓 보고가 아니다.
  if (writeSideEffects && !force) {
    const artifact = readArtifact({
      expect: {
        env,
        inputsFingerprint,
        producer: ARTIFACT_PRODUCER,
        schemaVersion: SCHEMA_VERSION,
      },
      path: effectiveCachePath,
    })
    // 리포트에는 발행 봉투가 없다 — 관측 채널이라 `producer`·`env` 를 싣지 않는다. 그래서
    //   `readArtifact` 의 검증 대상이 아니고, 여기서 지문 한 축만 대조한다. **못 읽으면 "모른다"**
    //   이고, 모르면 위 원칙대로 다시 만든다(부재·쓰레기·구세대를 구분할 이유가 없다).
    let report = null
    if (artifact.fresh) {
      try {
        const parsed = JSON.parse(fs.readFileSync(reportJsonPath, 'utf8'))
        if (parsed.inputsFingerprint === inputsFingerprint) report = parsed
      } catch {
        report = null
      }
    }

    if (artifact.fresh && report) {
      const excludedCount = report.summary?.excluded ?? 0
      return {
        cachePath: effectiveCachePath,
        excluded: report.excluded ?? [],
        excludedCount,
        inputsFingerprint,
        payload: artifact.payload,
        regenerated: false,
        report: { error: null, jsonPath: reportJsonPath, txtPath: reportTxtPath },
        sourceCommit,
        status: excludedCount > 0 ? 'partial' : 'clean',
      }
    }
  }

  // ★ 여기서 비로소 파싱·렌더 툴체인을 연다(위 헤더 주석 참조). 판정만 하고 끝나는 실행은 이 줄에
  //   도달하지 않으므로 그 비용을 내지 않는다.
  const { parseVault } = await import('./lib/parse-vault.mjs')
  const parsed = parseVault(vaultDir, env, SCHEMA_DIR, { deepDocGate: true, runGit: git })
  const payload = buildSummary({
    docs: parsed.wire.docs,
    env,
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
    writeFileAtomic(reportJsonPath, `${JSON.stringify(report, null, 2)}\n`)
    writeFileAtomic(reportTxtPath, formatReportText(report))
    result.report = { error: null, jsonPath: reportJsonPath, txtPath: reportTxtPath }
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
    const result = await runSummaryGenerator(options)
    if (options.status) {
      process.stdout.write(`${JSON.stringify(statusPayload(result, options.env))}\n`)
    } else {
      process.stdout.write(`${JSON.stringify(result.payload)}\n`)
    }
    // `--stdout` 은 **아무것도 쓰지 않는다**(side-effect-free 질의). 그런데도 산출물 경로를 찍으면
    //   "저 파일이 갱신됐다" 는 거짓을 말하게 된다 — 실제로는 그 경로가 옛 세대 그대로다.
    if (!options.writeSideEffects) {
      console.error(
        `[wiki] summary computed status=${result.status} excluded=${result.excludedCount} (--stdout: 아티팩트·리포트 미기록)`,
      )
    } else if (result.regenerated) {
      console.error(
        `[wiki] summary regenerated status=${result.status} excluded=${result.excludedCount} artifact=${result.cachePath}`,
      )
    } else {
      console.error(
        `[wiki] summary artifact hit excluded=${result.excludedCount} artifact=${result.cachePath}`,
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

/**
 * `--status` 출력 — **소비자 계약**이다.
 *
 * `artifactPath` 와 `env` 를 실어 보내는 이유: 소비자가 그 둘을 **직접 만들지 않게** 하기 위해서다.
 * 경로를 소비자가 조립하면 파일명 리터럴이 두 리포에 중복되고, env 를 소비자가 재기입하면 독자의
 * 기대값이 생성기의 실제 발행과 조용히 어긋난다.
 */
function statusPayload(result, env) {
  return {
    artifactPath: result.cachePath,
    env,
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
