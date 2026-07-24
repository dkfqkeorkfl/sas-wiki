#!/usr/bin/env node
// vault 무결성 **검증 전용** CLI (구 build.mjs). JSON 을 생산하지 않는다 — dev 는 미들웨어 on-demand,
// prod 는 미래 서버가 생산한다. 여기서는 payload 를 in-memory 로만 조립해 게이트(컨벤션·id 유일·불변·
// 데드링크·산출물 스키마·불변식)를 전량 실행하고, 통과 시 exit 0 / 위반 시 throw→exit 1(fail-loud).
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { checkAnchorExists } from './lib/derive.mjs'
import { readIdAtCreation } from './lib/git.mjs'
import { applyIgnoreFeeds } from './lib/ignore.mjs'
import { checkCommitConventions, checkFeedResolution, checkInvariants } from './lib/invariants.mjs'
import { extractWikilinks } from './lib/parse.mjs'
import { parseVault, WIKI_PREFIX } from './lib/parse-vault.mjs'
import { buildBody, buildFeeds, buildSummary } from './lib/payloads.mjs'
import { loadSchema, validateItem } from './lib/validate.mjs'

const SCHEMA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'schema')

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
 * @param {{ allowDeadlinks?: boolean, env?: 'dev'|'prod', schema?: string, vault: string }} options
 * @returns {{ body: object, feeds: object, stats: object, summary: object }}
 */
export function buildContent({ allowDeadlinks = false, env = 'prod', schema, vault }) {
  const vaultDir = path.resolve(vault)
  const schemaDir = schema ? path.resolve(schema) : SCHEMA_DIR

  const { gate, stats, wire } = parseVault(vaultDir, env, schemaDir)
  checkCommitConventions(gate.commits, gate.runGit, WIKI_PREFIX)
  validateParsedDocs(gate.visibleDocs, gate.runGit, vaultDir, loadSchema(path.join(schemaDir, 'wiki-doc.schema.json'))) // prettier-ignore
  checkDeadlinks(gate.visibleDocs, gate.derived, allowDeadlinks, vaultDir)
  checkFeedResolution(stats)

  const feedItems = applyIgnoreFeeds(wire.items, wire.ignore)
  const summary = buildSummary({
    docs: wire.docs,
    generatedAt: wire.generatedAt,
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
 * `--vault`(필수) · `--env dev|prod` · `--schema` · `--allow-deadlinks`.
 *
 * **`--out`/`--root` 은 거부한다** — validate.mjs 는 JSON 을 생산하지 않으므로 출력 인자가 없다(호환
 * 별칭·마이그레이션 금지). 옛 스크립트가 넘기면 시끄럽게 끊어 오배선을 드러낸다.
 */
export function parseArgs(argv) {
  const options = { allowDeadlinks: false, env: null, schema: SCHEMA_DIR, vault: null }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--help' || arg === '-h') return { ...options, help: true }
    if (arg === '--allow-deadlinks') {
      options.allowDeadlinks = true
      continue
    }
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
    const target = { '--schema': 'schema', '--vault': 'vault' }[arg]
    if (!target) throw new Error(`알 수 없는 인자: ${arg}`)
    const value = argv[i + 1]
    if (!value) throw new Error(`${arg} 에는 디렉토리가 필요합니다`)
    options[target] = path.resolve(value)
    i += 1
  }

  // 조용한 cwd 폴백 금지 — 엉뚱한 리포를 vault 로 읽으면 검증 대상이 통째로 틀린다.
  if (!options.vault) throw new Error(`vault 를 지정하세요: --vault <vault 리포>\n${usage()}`)

  // Layer B fail-closed: --env 미지정 → prod(draft 숨김) + 관측 가능한 warning(silent 폴백 금지).
  if (options.env === null) {
    options.env = 'prod'
    console.error(
      '[wiki] --env 미지정 → prod (fail-closed). dev 예제까지 포함하려면 --env dev 를 명시하세요.',
    )
  }
  return options
}

function checkDeadlinks(parsedDocs, derived, allowDeadlinks, vaultDir) {
  const { pathToDoc, resolveTargetPath } = derived
  const deadlinks = []
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
        deadlinks.push({ anchor: link.anchorRaw, from: doc.filePath, reason: '동명 문서 충돌', target: link.targetRaw }) // prettier-ignore
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
  if (deadlinks.length === 0 || allowDeadlinks) return
  const detail = deadlinks
    .map(
      (dead) =>
        `  - ${path.relative(vaultDir, dead.from)} -> [[${dead.target}${dead.anchor ? `#${dead.anchor}` : ''}]] (${dead.reason})`,
    )
    .join('\n')
  throw new Error(`데드링크 ${deadlinks.length}건 발견:\n${detail}`)
}

/**
 * 통계 출력 — 조용한 유실을 끝낸다(검증 통과 시 요약). 대량 prune 은 삭제가 아니라 rename 추적 실패의 징후다.
 */
function reportStats({ body, feeds, stats, summary }) {
  console.log(
    `[wiki] docs=${summary.docs.length} body=${Object.keys(body.docs).length} feeds=${feeds.items.length}` +
      ` prune=${stats.prunedDocRefs} prunedFeeds=${stats.prunedFeeds}` +
      ` unresolved=${stats.unresolvedPaths.length}` +
      ` warnings=${stats.warnings.length + stats.offConventionCommits.length}`,
  )
  for (const entry of stats.unresolvedPaths) {
    console.log(`[wiki]   unresolved: ${entry.sha.slice(0, 12)} ${entry.path}`)
  }
  for (const entry of stats.offConventionCommits) {
    console.log(`[wiki]   off-convention: ${entry.sha.slice(0, 12)} "${entry.subject}"`)
  }
  for (const entry of stats.warnings) {
    console.log(`[wiki]   warning: ${entry.sha.slice(0, 12)} ${entry.reason}`)
  }
}

function usage() {
  return 'Usage: node scripts/validate.mjs --vault <vault repo> [--env dev|prod] [--schema <dir>] [--allow-deadlinks]'
}

function validateParsedDocs(parsedDocs, runGit, vaultDir, wikiSchema) {
  const allErrors = []
  for (const parsed of parsedDocs) {
    // 무결성 3게이트: 형식·유일은 스키마 pattern + derive 가, presence 는 스키마 required(id) 가 잡는다.
    // 여기서 frontmatter id 를 그대로 검증한다 — git-hash 를 주입해 덮지 않는다(그러면 missing id 가
    // 조용히 구제되고 저작 UUIDv7 이 산출물로 흐르지 못한다).
    const errors = validateItem(parsed.frontmatter, wikiSchema, path.relative(vaultDir, parsed.filePath)) // prettier-ignore
    if ('created' in parsed.frontmatter || 'updated' in parsed.frontmatter) {
      errors.push('created/updated는 frontmatter에서 제거되었습니다(git 히스토리 유도).')
    }
    // 불변 게이트: 생성 커밋 blob 의 id 와 HEAD frontmatter id 를 대조한다. 생성 시점 id 부재(pre-id
    // era)는 null → PASS(false-fail 금지). 있는데 다르면 사후 변조 → fail.
    const idAtCreation = readIdAtCreation(runGit, `${WIKI_PREFIX}${parsed.relPath}.md`)
    if (idAtCreation !== null && idAtCreation !== parsed.frontmatter.id) {
      errors.push(
        `id 사후 변조: 생성 시점 id(${idAtCreation}) ≠ 현재 frontmatter id(${parsed.frontmatter.id})`,
      )
    }
    if (errors.length > 0) allErrors.push({ errors, file: parsed.filePath })
  }
  if (allErrors.length === 0) return
  const detail = allErrors
    .map(
      (entry) =>
        `  - ${path.relative(vaultDir, entry.file)}:\n${entry.errors.map((message) => `      * ${message}`).join('\n')}`,
    )
    .join('\n')
  throw new Error(`스키마 위반 ${allErrors.length}건 발견:\n${detail}`)
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
