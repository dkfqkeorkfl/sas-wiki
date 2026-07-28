// summary **생성기** — 발행 아티팩트가 신선한지 판정하고, 어긋날 때만 다시 만든다.
//
// ★ OQ-P5-1 = A: `runSummaryGenerator` 는 예전에 CLI 파일 `scripts/summary.mjs` 에 있었다. `feeds.mjs`·
//   `wiki.mjs` 가 그것을 import 하면 엔드포인트 CLI 가 다른 CLI 를 무는 꼴이 된다(`main`·`parseCliArgs`·
//   argv 가드까지 정적 폐쇄에 딸려 온다) — P4 가 `summary()` 를 `lib/summary-endpoint.mjs` 로 옮겨 정리한
//   형태와 어긋난다. 그래서 이 함수를 CLI 밖으로 옮긴다. **재export 는 두지 않는다** — 재export 는
//   정적 import 와 같은 비용이라 분리가 무효가 된다.
//
// ★ 이 파일의 **정적** import 그래프에 파싱·렌더 툴체인이 들어오면 안 된다(규범 G). 판정에 실제로
//   필요한 일은 지문 계산 + git HEAD 조회 + 파일 두어 개 읽기뿐인데, 마크다운 렌더러를 정적으로 물면
//   "안 바뀌었나?" 한 번을 묻는 데도 그 로드 비용(수 초)을 전부 낸다 — 렌더 결과를 한 줄도 쓰지
//   않으면서. 그래서 파싱은 **재생성 분기에서만** 동적으로 연다.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  ARTIFACT_PRODUCER,
  SCHEMA_VERSION,
  artifactPath,
  feedsArtifactPath,
  readArtifact,
  reportPath,
} from './artifact.mjs'
import { writeFileAtomic } from './atomic.mjs'
import { computeInputsFingerprint } from './fingerprint.mjs'
import { makeGitRunner } from './git.mjs'
import { FEEDS_ARTIFACT_PRODUCER, REPORT_PRODUCER, buildFeedsArtifact, buildSummary } from './payloads.mjs' // prettier-ignore

/** 생산 JSON Schema 디렉토리 — 이 모듈은 scripts/lib/ 이므로 상위 scripts/schema. */
const SCHEMA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'schema')

/**
 * 3 산출물(summary·feeds·report)을 발행한다 — **판정 권위는 이 함수 하나뿐이다**(D-A).
 *
 * 신선도 스킵은 **셋 다** 같은 지문일 때만 한다(D-D) — 하나라도 모르면(부재·손상·표지 불일치) 다시
 * 만든다. 재생성 시 쓰기 순서는 **summary → feeds → report** 다(계약 · FA6) — 크래시 시 (신 summary,
 * 구 feeds) 조합만 나오고, 신선도 판정은 그 조합을 stale 로 접는다. feeds 아티팩트 쓰기 실패는
 * **산출물 실패**(throw · OQ-P5-5)다 — feeds 는 서빙 데이터이지 관측 채널이 아니다. 리포트만 실패를
 * `result.report.error` 로 흡수한다(RP4 — 관측 실패는 산출물 실패가 아니다).
 *
 * `--max-excluded` 는 **여기 없다**. 그것은 산출 방식이 아니라 **종료 코드 정책**이라 CLI 층
 * (`summary.mjs`)이 `result.excludedCount` 로 판정한다 — 이 함수는 제외를 세기만 하고 그것으로
 * 무엇을 할지는 정하지 않는다. 예전에는 구조분해에 남아 있었으나 본문에서 쓰이지 않아, 이 함수가
 * 임계를 강제한다는 **거짓 인상**만 줬다(리뷰 지적).
 *
 * @param {{ artifactPath?: string, env?: 'dev'|'prod', force?: boolean,
 *           reportDir?: string, runGit?: Function, vault: string, writeSideEffects?: boolean }} input
 */
export async function runSummaryGenerator({
  // `--out` 로 들어오는 경로 **덮어쓰기**다(미지정이면 아래에서 파생한다). 같은 이름의 import 를
  //   가리지 않도록 지역 이름만 바꿔 받는다 — 옵션 키 자체는 반환 키·`--status` 와 같은 낱말이다.
  artifactPath: artifactPathOverride,
  env = 'prod',
  force = false,
  reportDir,
  runGit,
  vault,
  writeSideEffects = true,
}) {
  const vaultDir = path.resolve(vault)
  const effectiveArtifactPath = artifactPathOverride ?? artifactPath(vaultDir, env)
  // ★ GN5 sibling-path 판정(메인 세션 승인 · 원장에 없던 결정이므로 사유를 여기 남긴다):
  //   feeds 아티팩트는 summary 와 **한 세트로 co-derive** 된다(D-C) — 기본은 vault 기준 경로다.
  //   `--out`(artifactPath override)으로 summary 를 vault 밖 임의 경로에 쓰게 하면, feeds 도 그
  //   **형제 경로**(같은 디렉토리)에 나란히 쓴다 — vault 밖으로 재배치된 산출물 세트가 vault/cache
  //   에 반쪽(feeds 만)을 남기지 않게 하기 위해서다. 이 규칙이 없으면 override 요청이 있어도 매번
  //   `<vaultDir>/cache/` 를 건드리게 되어, "이 요청은 산출물을 딴 곳에 두고 싶다" 는 호출자 의도와
  //   `<vault>/cache/` 를 만들지 않는다는 기존 계약(P3-era GN5)이 동시에 깨진다. report 는 `reportDir`
  //   이 이미 같은 패턴(override 시 그 디렉토리, 아니면 vault 기준)을 쓰므로 대칭이다.
  const effectiveFeedsArtifactPath = artifactPathOverride
    ? path.join(path.dirname(effectiveArtifactPath), `feeds.${env}.json`)
    : feedsArtifactPath(vaultDir, env)
  const reportJsonPath = reportDir
    ? path.join(reportDir, `summary.report.${env}.json`)
    : reportPath(vaultDir, env, 'json')
  const reportTxtPath = reportDir
    ? path.join(reportDir, `summary.report.${env}.txt`)
    : reportPath(vaultDir, env, 'txt')
  const effectiveReportDir = path.dirname(reportJsonPath)
  const git = runGit ?? makeGitRunner(vaultDir)
  const sourceCommit = git(['rev-parse', 'HEAD']).trim()
  const inputsFingerprint = computeInputsFingerprint({ env, sourceCommit, vaultDir })

  // 스킵은 **세 산출물이 전부** 이 지문의 것일 때만 한다(D-D 확장).
  //
  // 산출물 하나라도 없거나 어긋나면 제외 건수·feeds 항목을 알 방법이 없는데, 예전에는(P3) 리포트
  // 부재를 `?? 0` 으로 메워 `status: 'clean'` 을 돌려줬다 — 문서 2건이 제외된 vault 가 "깨끗함" 으로
  // 보고되고 `--max-excluded 0` 게이트가 exit 3 → exit 0 으로 뒤집혔다(실측). "모르면 다시 만든다."
  if (writeSideEffects && !force) {
    const expectSummary = {
      env,
      inputsFingerprint,
      producer: ARTIFACT_PRODUCER,
      schemaVersion: SCHEMA_VERSION,
    }
    const artifact = readArtifact({ expect: expectSummary, path: effectiveArtifactPath })
    const feedsArtifact = readArtifact({
      expect: { ...expectSummary, producer: FEEDS_ARTIFACT_PRODUCER },
      path: effectiveFeedsArtifactPath,
    })
    // 리포트도 **같은 독자**(`readArtifact`)를 탄다(F-27) — "실패를 stale 로 접는" 규율이 세 곳에서
    //   각자 살지 않는다.
    const reportArtifact =
      artifact.fresh && feedsArtifact.fresh
        ? readArtifact({
            expect: { ...expectSummary, producer: REPORT_PRODUCER },
            path: reportJsonPath,
          })
        : { fresh: false, reason: 'skipped' }

    if (artifact.fresh && feedsArtifact.fresh && reportArtifact.fresh) {
      const report = reportArtifact.payload
      const excludedCount = report.summary?.excluded ?? 0
      return {
        artifactPath: effectiveArtifactPath,
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
  const { parseVault } = await import('./parse-vault.mjs')
  // P5 Task 9(D-I) — parseVault 는 이제 항상 깊은 티어다(얕은 티어 선택 스위치를 제거했다).
  const parsed = parseVault(vaultDir, env, SCHEMA_DIR, { runGit: git })
  const payload = buildSummary({
    docs: parsed.wire.docs,
    env,
    generatedAt: parsed.wire.generatedAt,
    inputsFingerprint,
    sourceCommit: parsed.wire.sourceCommit,
    tags: parsed.wire.tags,
    tree: parsed.wire.tree,
  })
  const feedsPayload = buildFeedsArtifact({
    env,
    generatedAt: parsed.wire.generatedAt,
    inputsFingerprint,
    // ★ **억제 전 전량**이다(D-C). 억제 필터는 서빙 시점(`feeds.mjs`)의 몫이지 이 단계의 몫이 아니다.
    items: parsed.wire.items,
    sourceCommit: parsed.wire.sourceCommit,
  })
  const excluded = parsed.stats.excluded ?? []
  const result = {
    artifactPath: effectiveArtifactPath,
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

  // ★ 쓰기 순서는 계약이다: summary → feeds → report. 크래시(또는 feeds 쓰기 실패)가 나면 (신 summary,
  //   구/부재 feeds) 조합만 발생하고, 위 3중 신선도 판정이 그 조합을 stale 로 접어 다음 호출이 다시
  //   만든다. **feeds 쓰기 실패는 여기서 흡수하지 않는다** — OQ-P5-5: feeds 는 서빙 데이터라 산출물
  //   실패(throw)와 같은 극성이어야 한다. 리포트만 아래에서 예외로 흡수한다.
  writeFileAtomic(effectiveArtifactPath, `${JSON.stringify(payload)}\n`)
  writeFileAtomic(effectiveFeedsArtifactPath, `${JSON.stringify(feedsPayload)}\n`)

  const report = buildReport({
    env,
    excluded,
    // ★ Task 10(F-17) — prune 진단은 **리포트에만** 싣는다(아티팩트가 아니다). 부정 정보(무엇이
    //   버려졌는가)를 발행 아티팩트에 실으면 D-C·D-B 가 근절한 누출이 관측 채널로 되돌아온다 — 여기는
    //   readArtifact 가 신선도만 재는 별도 발행물(REPORT_PRODUCER)이라 안전하다.
    invalidExcludedRefs: parsed.stats.invalidExcludedRefs ?? [],
    inputsFingerprint,
    prunedFeeds: parsed.stats.prunedFeeds ?? 0,
    regenerated: true,
    sourceCommit,
    total: parsed.gate.visibleDocs.length + excluded.length,
    unresolvedPaths: parsed.stats.unresolvedPaths ?? [],
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

/**
 * 리포트 봉투 — **발행 봉투**(`producer`·top-level `env`)를 실어 `readArtifact` 를 태운다(F-27).
 * OQ-P5-3=a: `inputs.env` 중첩을 top-level `env` 로 대체하고 **`inputs` 는 남기지 않는다**(레거시
 * 미보존). OQ-P5-4=a: 자체 리터럴 대신 **공용 `SCHEMA_VERSION`** 을 쓴다.
 */
function buildReport({
  env,
  excluded,
  invalidExcludedRefs,
  inputsFingerprint,
  prunedFeeds,
  regenerated,
  sourceCommit,
  total,
  unresolvedPaths,
}) {
  return {
    env,
    excluded,
    generatedAt: new Date().toISOString(),
    // ★ Task 10(F-17) — prune 진단 3키. `unresolvedPaths`(fail-closed 드랍된 feed 참조)·
    //   `invalidExcludedRefs`(제외된 문서를 가리킨 feed 참조)·`prunedFeeds`(생존하지 못한 feed 수).
    invalidExcludedRefs,
    inputsFingerprint,
    producer: REPORT_PRODUCER,
    prunedFeeds,
    regenerated,
    schemaVersion: SCHEMA_VERSION,
    sourceCommit,
    summary: { excluded: excluded.length, included: total - excluded.length, total },
    unresolvedPaths,
  }
}

function formatReportText(report) {
  const lines = [
    `summary report ${report.generatedAt}`,
    `producer: ${report.producer}`,
    `inputsFingerprint: ${report.inputsFingerprint}`,
    `sourceCommit: ${report.sourceCommit}`,
    `env: ${report.env}`,
    `regenerated: ${report.regenerated}`,
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
