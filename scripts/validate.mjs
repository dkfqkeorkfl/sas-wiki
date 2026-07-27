#!/usr/bin/env node
// vault 무결성 **검증 전용** CLI (구 build.mjs). JSON 을 생산하지 않는다 — dev 는 미들웨어 on-demand,
// prod 는 미래 서버가 생산한다. 여기서는 payload 를 in-memory 로만 조립해 게이트(컨벤션·id 유일·불변·
// 데드링크·산출물 스키마·불변식)를 전량 실행하고, 통과 시 exit 0 / 위반 시 throw→exit 1(fail-loud).
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { checkAnchorExists } from './lib/derive.mjs'
import { computeInputsFingerprint } from './lib/fingerprint.mjs'
import { applyIgnoreFeeds } from './lib/ignore.mjs'
import { checkCommitConventions, checkFeedResolution, checkInvariants } from './lib/invariants.mjs'
import { extractWikilinks } from './lib/parse.mjs'
import { WIKI_PREFIX } from './lib/head-state.mjs'
import { parseVault } from './lib/parse-vault.mjs'
import { buildBody, buildFeeds, buildSummary } from './lib/payloads.mjs'
import { loadSchema, validateItem } from './lib/validate.mjs'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const SCHEMA_DIR = path.join(SCRIPT_DIR, 'schema')
// --vault 미지정 시 기본값 = 스크립트 자기 리포 루트(scripts/ 의 상위). cwd 무관(import.meta.url 파생).
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..')

/** payload key → 생산 JSON 파일명(산출물 스키마 검증의 key 매핑·에러 라벨용 — 파일을 쓰지는 않는다). */
const PAYLOAD_FILES = {
  body: 'wiki_body.json',
  feeds: 'wiki_feeds.json',
  summary: 'wiki_summary.json',
}

/**
 * vault 무결성 검증 — parseVault(파싱) 위에 **모든 검증 게이트**를 얹는다(JSON 쓰기는 없다).
 *
 * 레이어 분리(검증 / read-path=파싱): parseVault 는 순수 파싱만 하고, throw-게이트는 여기서만 돈다.
 * 순서는 conventions→schema→deadlinks→feedResolution 를 보존한다(컨벤션 위반이 unresolved-feed 보다
 * 먼저 진단돼야 한다). 반환은 in-memory 3 payload — 소비/쓰기는 하지 않는다(검증용).
 *
 * @param {{ deadlinks?: 'ignore'|'warn'|'error', env?: 'dev'|'prod', schema?: string, vault: string }} options
 * @returns {{ body: object, feeds: object, stats: object, summary: object }}
 */
export function buildContent({ deadlinks = 'warn', env = 'prod', maxExcluded = 0, schema, vault }) {
  const vaultDir = path.resolve(vault)
  const schemaDir = schema ? path.resolve(schema) : SCHEMA_DIR

  const { gate, stats, wire } = parseVault(vaultDir, env, schemaDir, { deepDocGate: true })
  checkCommitConventions(gate.commits, gate.runGit, WIKI_PREFIX)
  gateExcluded(stats.excluded ?? [], maxExcluded, stats.invalidExcludedRefs ?? [])
  const deadlinkReport = collectDeadlinks(gate.visibleDocs, gate.derived)
  stats.deadlinks = gateDeadlinks(deadlinkReport, deadlinks, vaultDir)
  checkFeedResolution(stats)

  const feedItems = applyIgnoreFeeds(wire.items, wire.ignore)
  const inputsFingerprint = computeInputsFingerprint({
    env,
    sourceCommit: wire.sourceCommit,
    vaultDir,
  })
  const summary = buildSummary({
    docs: wire.docs,
    generatedAt: wire.generatedAt,
    inputsFingerprint,
    sourceCommit: wire.sourceCommit,
    tags: wire.tags,
    tree: wire.tree,
  })
  const feeds = buildFeeds({
    generatedAt: wire.generatedAt,
    items: feedItems,
    sourceCommit: wire.sourceCommit,
  })
  const body = buildBody({ docs: wire.bodies, sourceCommit: wire.sourceCommit })

  validatePayloads({ body, feeds, summary }, schemaDir)
  checkInvariants(summary, feeds, body)

  return { body, feeds, stats, summary }
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv)
  if (options.help) {
    console.log(usage())
    return
  }
  const { body, feeds, stats, summary } = buildContent(options)
  reportStats({ body, feeds, stats, summary })
}

/**
 * `--vault`(선택, 기본 REPO_ROOT) · `--env dev|prod` · `--schema` · `--deadlinks ignore|warn|error`.
 *
 * **`--out`/`--root` 은 거부한다** — validate.mjs 는 JSON 을 생산하지 않으므로 출력 인자가 없다(호환
 * 별칭·마이그레이션 금지). 옛 스크립트가 넘기면 시끄럽게 끊어 오배선을 드러낸다.
 */
export function parseArgs(argv) {
  const options = { deadlinks: 'warn', env: null, maxExcluded: 0, schema: SCHEMA_DIR, vault: null }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--help' || arg === '-h') return { ...options, help: true }
    if (arg === '--out') {
      throw new Error(
        '--out 는 제거되었습니다: validate.mjs 는 무결성 검증 전용이며 JSON 을 생산하지 않습니다.',
      )
    }
    if (arg === '--root') {
      throw new Error('--root 는 폐기되었습니다. --vault <vault 리포> 를 쓰세요.')
    }
    if (arg === '--env') {
      const value = argv[i + 1]
      if (!value) throw new Error('--env 에는 dev 또는 prod 값이 필요합니다')
      if (value !== 'dev' && value !== 'prod') {
        throw new Error(`알 수 없는 --env 값: "${value}" — dev|prod 만 허용합니다`)
      }
      options.env = value
      i += 1
      continue
    }
    if (arg === '--deadlinks') {
      const value = argv[i + 1]
      if (!value) throw new Error('--deadlinks 에는 ignore, warn, error 중 하나가 필요합니다')
      if (!['ignore', 'warn', 'error'].includes(value)) {
        throw new Error(`알 수 없는 --deadlinks 값: "${value}" — ignore|warn|error 만 허용합니다`)
      }
      options.deadlinks = value
      i += 1
      continue
    }
    if (arg === '--max-excluded') {
      const value = argv[i + 1]
      if (!value || !/^\d+$/u.test(value)) {
        throw new Error('--max-excluded 에는 0 이상의 정수가 필요합니다')
      }
      options.maxExcluded = Number.parseInt(value, 10)
      i += 1
      continue
    }
    const target = { '--schema': 'schema', '--vault': 'vault' }[arg]
    if (!target) throw new Error(`알 수 없는 인자: ${arg}`)
    const value = argv[i + 1]
    if (!value) throw new Error(`${arg} 에는 디렉토리가 필요합니다`)
    options[target] = path.resolve(value)
    i += 1
  }

  // --vault 미지정 → 스크립트 자기 리포 루트(REPO_ROOT). cwd 폴백이 아니라 import.meta.url 파생이라
  // 엉뚱한 리포를 읽지 않는다(cwd 무관·결정적). 다른 vault 는 --vault 로 override.
  if (!options.vault) options.vault = REPO_ROOT

  // Layer B fail-closed: --env 미지정 → prod(draft 숨김) + 관측 가능한 warning(silent 폴백 금지).
  if (options.env === null) {
    options.env = 'prod'
    console.error(
      '[wiki] --env 미지정 → prod (fail-closed). dev 예제까지 포함하려면 --env dev 를 명시하세요.',
    )
  }
  return options
}

function collectDeadlinks(parsedDocs, derived) {
  const { pathToDoc, resolveTargetPath } = derived
  const deadlinks = []
  const ambiguous = []
  for (const doc of parsedDocs) {
    for (const link of extractWikilinks(doc.body)) {
      if (!link.targetRaw) {
        if (link.anchorRaw && !checkAnchorExists(pathToDoc, doc.relPath, link.anchorRaw)) {
          deadlinks.push({ anchor: link.anchorRaw, from: doc.filePath, reason: '대상 앵커 없음', target: doc.relPath }) // prettier-ignore
        }
        continue
      }
      const resolved = resolveTargetPath(link.targetRaw)
      if (resolved.ambiguous) {
        ambiguous.push({ anchor: link.anchorRaw, from: doc.filePath, reason: '동명 문서 충돌', target: link.targetRaw }) // prettier-ignore
        continue
      }
      if (!resolved.path) {
        deadlinks.push({ anchor: link.anchorRaw, from: doc.filePath, reason: '대상 문서 없음', target: link.targetRaw }) // prettier-ignore
        continue
      }
      if (link.anchorRaw && !checkAnchorExists(pathToDoc, resolved.path, link.anchorRaw)) {
        deadlinks.push({ anchor: link.anchorRaw, from: doc.filePath, reason: '대상 앵커 없음', target: link.targetRaw }) // prettier-ignore
      }
    }
  }
  return { ambiguous, deadlinks }
}

function gateDeadlinks({ ambiguous, deadlinks }, severity, vaultDir) {
  if (ambiguous.length > 0) {
    throw new Error(formatDeadlinks(ambiguous, vaultDir, '동명 문서 충돌'))
  }
  if (severity === 'ignore') return []
  if (deadlinks.length === 0 || severity === 'warn') return deadlinks
  throw new Error(
    `${formatDeadlinks(deadlinks, vaultDir, `데드링크 ${deadlinks.length}건 발견`)}\n` +
      '  → 완화하려면 --deadlinks warn 또는 --deadlinks ignore 를 사용하세요.',
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

/**
 * 제외 게이트 — 문서 단위 제외가 허용치를 넘으면 중단한다.
 *
 * **참조 sha 를 함께 싣는 이유**: 제외 모델 이전에는 깨진 문서를 가리킨 feed 가 `unresolved` 로
 * 분류돼 `checkFeedResolution` 이 **"어느 커밋이" 그것을 가리켰는지**(sha)를 진단에 담았다. 제외
 * 모델로 옮기면서 그 정보를 잃으면 저자는 "문서가 깨졌다" 만 알고 **어느 발행이 그것을 참조하는지**
 * 는 모른다 — 피드가 커밋 감사추적인 제품에서 그건 진단의 절반을 버리는 것이다. `invalidExcludedRefs`
 * 가 그 seam 이다.
 */
function gateExcluded(excluded, maxExcluded, invalidRefs = []) {
  if (excluded.length <= maxExcluded) return
  const detail = excluded
    .map((entry) => `  - ${entry.path}: ${entry.reasonCode} ${entry.message}`)
    .join('\n')
  const refs = invalidRefs
    .map((entry) => `    - ${String(entry.sha).slice(0, 12)} ${entry.path}`)
    .join('\n')
  const refDetail = refs === '' ? '' : `\n  이 문서를 가리킨 feed 커밋:\n${refs}`
  throw new Error(
    `문서 제외 ${excluded.length}건이 허용치 ${maxExcluded}건을 초과했습니다:\n${detail}${refDetail}`,
  )
}

/**
 * 통계 출력 — 조용한 유실을 끝낸다(검증 통과 시 요약). 대량 prune 은 삭제가 아니라 rename 추적 실패의 징후다.
 */
function reportStats({ body, feeds, stats, summary }) {
  console.log(
    `[wiki] docs=${summary.docs.length} body=${Object.keys(body.docs).length} feeds=${feeds.items.length}` +
      ` prune=${stats.prunedDocRefs} prunedFeeds=${stats.prunedFeeds}` +
      ` unresolved=${stats.unresolvedPaths.length}` +
      ` warnings=${stats.warnings.length + stats.unpublishedFeedCommits.length + stats.deadlinks.length}`,
  )
  for (const entry of stats.unresolvedPaths) {
    console.log(`[wiki]   unresolved: ${entry.sha.slice(0, 12)} ${entry.path}`)
  }
  for (const entry of stats.unpublishedFeedCommits) {
    console.log(`[wiki]   unpublished-feed: ${entry.sha.slice(0, 12)} "${entry.subject}"`)
  }
  for (const entry of stats.deadlinks) {
    console.log(
      `[wiki]   deadlink: ${path.relative(process.cwd(), entry.from)} -> [[${entry.target}${entry.anchor ? `#${entry.anchor}` : ''}]] (${entry.reason})`,
    )
  }
  for (const entry of stats.warnings) {
    console.log(`[wiki]   warning: ${entry.sha.slice(0, 12)} ${entry.reason}`)
  }
}

function usage() {
  return 'Usage: node scripts/validate.mjs [--vault <vault repo>] [--env dev|prod] [--schema <dir>] [--deadlinks ignore|warn|error]'
}

/** 산출물 strict 검증 — 제거된 필드가 하나라도 남아 있으면 여기서 죽는다(in-memory payload 대상). */
function validatePayloads(payloads, schemaDir) {
  const violations = []
  for (const [key, file] of Object.entries(PAYLOAD_FILES)) {
    const schema = loadSchema(path.join(schemaDir, `${key}.schema.json`))
    const errors = validateItem(payloads[key], schema, `$${file}`)
    if (errors.length > 0) violations.push(`  - ${file}:\n${errors.map((e) => `      * ${e}`).join('\n')}`) // prettier-ignore
  }
  if (violations.length > 0) {
    throw new Error(`산출물 스키마 위반 ${violations.length}건:\n${violations.join('\n')}`)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
