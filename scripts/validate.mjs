#!/usr/bin/env node
// vault 무결성 **검증 전용** CLI (구 build.mjs). JSON 을 생산하지 않는다 — dev 는 미들웨어 on-demand,
// prod 는 미래 서버가 생산한다. 여기서는 payload 를 in-memory 로만 조립해 게이트(컨벤션·id 유일·불변·
// 데드링크·산출물 스키마·불변식)를 전량 실행하고, 통과 시 exit 0 / 위반 시 throw→exit 1(fail-loud).
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { checkAnchorExists } from './lib/derive.mjs'
import {
  anyMarkdown,
  collectDeletedDocEvents,
  readIdAtCreation,
  readIdAtDeletion,
} from './lib/git.mjs'
import { applyIgnoreFeeds } from './lib/ignore.mjs'
import { checkCommitConventions, checkFeedResolution, checkInvariants } from './lib/invariants.mjs'
import { collectMarkdownFilesRecursive, extractWikilinks, parseMarkdownFile } from './lib/parse.mjs'
import { parseVault, WIKI_PREFIX } from './lib/parse-vault.mjs'
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
export function buildContent({ deadlinks = 'warn', env = 'prod', schema, vault }) {
  const vaultDir = path.resolve(vault)
  const schemaDir = schema ? path.resolve(schema) : SCHEMA_DIR

  const { gate, stats, wire } = parseVault(vaultDir, env, schemaDir)
  checkCommitConventions(gate.commits, gate.runGit, WIKI_PREFIX)
  validateParsedDocs(gate.visibleDocs, gate.runGit, vaultDir, loadSchema(path.join(schemaDir, 'wiki-doc.schema.json'))) // prettier-ignore
  stats.deadlinks = checkDeadlinks(gate.visibleDocs, gate.derived, deadlinks, vaultDir)
  checkFeedResolution(stats)
  checkStrayDocs(vaultDir)
  checkDeletedIdReuse(gate)

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
 * `--vault`(선택, 기본 REPO_ROOT) · `--env dev|prod` · `--schema` · `--deadlinks ignore|warn|error`.
 *
 * **`--out`/`--root` 은 거부한다** — validate.mjs 는 JSON 을 생산하지 않으므로 출력 인자가 없다(호환
 * 별칭·마이그레이션 금지). 옛 스크립트가 넘기면 시끄럽게 끊어 오배선을 드러낸다.
 */
export function parseArgs(argv) {
  const options = { deadlinks: 'warn', env: null, schema: SCHEMA_DIR, vault: null }

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

function checkDeadlinks(parsedDocs, derived, severity, vaultDir) {
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
 * **삭제된 문서의 id 를 다른 문서가 물려받는 것**을 막는다.
 *
 * 기존 두 게이트는 이 구멍을 못 봤다: 유일성은 HEAD 기준이라 이미 지워진 문서와는 안 겹치고,
 * 불변성은 각 문서의 *자기* 생성 blob 과만 대조한다. 그 사이로 「A(id X) 삭제 → 무관한 B 가
 * id X 로 생성」이 통과하면, A 를 가리키던 **과거 피드가 B 로 연결**된다. 피드가 곧 변경이력인
 * 제품에서 이는 조용한 오귀속이다.
 *
 * **규칙은 하나, 면제는 없다**: 삭제된 문서가 갖고 있던 id 를 지금 살아 있는 문서가 갖고 있으면
 * 위반이다.
 *
 * 예외를 두지 않는 이유 —
 *  - *이동* 은 삭제가 아니다. `collectDeletedDocEvents` 가 `--find-renames` 를 못박아 rename 을
 *    `R` 로 잡으므로 애초에 이 목록에 들어오지 않는다(로컬 `diff.renames=false` 도 무력화).
 *  - *같은 경로 재생성* 은 복원이 아니다. 데이터 계약(`README` · 문서 id)이 "지운 경로에 다시 문서를
 *    만들면 그건 복원이 아니라 새 문서다" 라고
 *    못박는다. 경로는 정체성이 아니며, 삭제는 그 문서의 피드를 prune 한다 — 같은 경로에 옛 id 를
 *    다시 쓰면 prune 된 이력이 새 내용 위로 되살아나 오귀속된다.
 *
 * 초판은 이 자리에 경로 기반 면제 두 개(rename 계보·현재 살아 있는 경로)를 뒀는데, 둘 다 sha 를
 * 버린 **경로 문자열** 비교라 재생성된 문서가 자기 자신을 면제했다(3차 감사). 경로로 정체성을
 * 판정하려 한 것이 오류의 뿌리다 — 이제 id 만 본다.
 */
function checkDeletedIdReuse({ derived, runGit }) {
  const livePathById = new Map(
    [...derived.pathToDoc.values()].map((doc) => [doc.id, `${WIKI_PREFIX}${doc.relPath}.md`]),
  )

  const violations = []
  for (const event of collectDeletedDocEvents(runGit, { isDocPath: anyMarkdown })) {
    const deletedId = readIdAtDeletion(runGit, event)
    if (deletedId === null) continue // pre-id era — 대조할 id 가 없다
    const livePath = livePathById.get(deletedId)
    if (livePath !== undefined) {
      violations.push({ deletedPath: event.path, id: deletedId, livePath })
    }
  }
  if (violations.length === 0) return

  const detail = violations
    .map((entry) => `  - id ${entry.id}: 삭제된 ${entry.deletedPath} → 현재 ${entry.livePath}`)
    .join('\n')
  throw new Error(
    `삭제된 문서의 id 재사용 ${violations.length}건 — 과거 피드가 다른 문서로 연결된다:\n${detail}\n` +
      `  해결: 새 문서에 새 UUIDv7 을 부여한다 — 삭제된 경로의 재생성은 계약상 새 문서다\n` +
      `        (README · 문서 id). 문서를 *이동* 한 것이라면 삭제·재생성이 아니라\n` +
      `        rename 으로 커밋해야 계보가 이어진다.`,
  )
}

/**
 * wiki 아래에 **문서로 해석되지 않는 .md** 가 있으면 중단한다.
 *
 * `parseVault` 는 서빙 경로(요청마다 실행)라 이런 파일을 건너뛴다 — 오타 하나로 위키 전체가 죽으면
 * 안 되기 때문이다. 그 대신 조용한 누락을 여기서 막는다: 저자는 올렸다고 믿는데 독자에겐 없는
 * 상태가 가장 늦게 발견되는 결함이다.
 *
 * `checkFeedResolution` **뒤에** 놓는다 — 그 파일을 가리키는 feed 가 있으면 sha 를 담은 미해석
 * 진단이 더 구체적이므로 먼저 나가야 하고, 여기서는 **아무도 안 건드린 stray** 를 담당한다.
 */
function checkStrayDocs(vaultDir) {
  const wikiDir = path.join(vaultDir, ...WIKI_PREFIX.split('/').filter(Boolean))
  const stray = collectMarkdownFilesRecursive(wikiDir).filter(
    (filePath) => !parseMarkdownFile(filePath),
  )
  if (stray.length === 0) return
  const detail = stray.map((filePath) => `  - ${path.relative(vaultDir, filePath)}`).join('\n')
  throw new Error(
    `frontmatter 가 없어 문서로 해석되지 않는 파일 ${stray.length}건 — 조용히 누락되지 않도록 중단한다:\n${detail}`,
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
