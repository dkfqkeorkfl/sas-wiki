#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { checkAnchorExists, derive } from './lib/derive.mjs'
import { buildFeedItems } from './lib/feed.mjs'
import {
  buildPathIndex,
  checkGitAvailable,
  checkHistoryIntegrity,
  collectDeletedDocPaths,
  collectEverDeletedDocPaths,
  collectGitLog,
  makeGitRunner,
  readIdAtCreation,
} from './lib/git.mjs'
import { checkCommitConventions, checkFeedResolution, checkInvariants } from './lib/invariants.mjs'
import {
  collectMarkdownFilesRecursive,
  derivePathAndBreadcrumb,
  extractWikilinks,
  parseMarkdownFile,
} from './lib/parse.mjs'
import { buildBody, buildFeeds, buildSummary } from './lib/payloads.mjs'
import { loadSchema, validateItem } from './lib/validate.mjs'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))

/** vault 문서의 리포 상대 경로 접두사 — lib 에 하드코딩하지 않고 주입한다(이관 가능성). */
const WIKI_PREFIX = 'vault/wiki/'

const PAYLOAD_FILES = {
  body: 'wiki_body.json',
  feeds: 'wiki_feeds.json',
  summary: 'wiki_summary.json',
}

/**
 * vault 리포 → 3 페이로드. **입력(`vault`)과 출력(`out`)이 분리돼 있다** — 예전엔 `--root` 하나가
 * 둘을 겸해 서브모듈 워킹트리에 산출물을 싸질렀다.
 *
 * @param {{ allowDeadlinks?: boolean, env?: 'dev'|'prod', out: string, schema?: string, vault: string }} options
 * @returns {{ body: object, feeds: object, stats: object, summary: object }}
 */
export function buildContent({ allowDeadlinks = false, env = 'prod', out, schema, vault }) {
  const vaultDir = path.resolve(vault)
  const outDir = path.resolve(out)
  const schemaDir = schema ? path.resolve(schema) : path.join(SCRIPT_DIR, 'schema')
  const wikiDir = path.join(vaultDir, 'vault', 'wiki')

  // 한 빌드 안에서 같은 git 질의는 같은 답을 낸다(리포는 그동안 변하지 않는다). 문서별
  // `git log --follow` 는 검증·파생·역인덱스 3곳이 각각 부르므로 캐시 없이는 프로세스 스폰이 3배다.
  const runGit = memoize(makeGitRunner(vaultDir))
  checkGitAvailable(runGit)
  assertHistoryIntegrity(runGit, vaultDir)
  const commits = collectGitLog(runGit)
  const sourceCommit = commits.length > 0 ? commits[0].hash : null
  checkCommitConventions(commits, runGit, WIKI_PREFIX)

  const parsedDocs = collectMarkdownFilesRecursive(wikiDir)
    .map((filePath) => {
      const parsed = parseMarkdownFile(filePath)
      if (!parsed) return null
      if (parsed.frontmatter.type === undefined)
        throw new Error(`type 필드가 없습니다: ${filePath}`)
      const derived = derivePathAndBreadcrumb(filePath, wikiDir)
      return { ...parsed, breadcrumb: derived.breadcrumb, relPath: derived.path }
    })
    .filter(Boolean)

  // dev/prod 분리(D2): prod 는 draft 문서를 제외한다. 이 필터는 반드시 **검증·파생·피드 이전**이다
  // — 제외 문서는 스키마 검증·역인덱스·피드에서 통째로 배제돼야 부분 누출이 없다(fail-closed 방향).
  // dev 는 전량 포함(Layer A: draft 미지정=공개는 여기가 아니라 isDraft 가 지킨다).
  const visibleDocs = env === 'dev' ? parsedDocs : parsedDocs.filter((doc) => !isDraft(doc))
  const excludedDocs = env === 'dev' ? [] : parsedDocs.filter((doc) => isDraft(doc))

  validateParsedDocs(visibleDocs, runGit, vaultDir, loadSchema(path.join(schemaDir, 'wiki-doc.schema.json'))) // prettier-ignore

  const derived = derive(visibleDocs, runGit, { wikiPrefix: WIKI_PREFIX })
  checkDeadlinks(visibleDocs, derived, allowDeadlinks, vaultDir)

  // 피드 파생에 필요한 세 좌표: (커밋, 당시경로) → id 역인덱스 · 삭제 집합 · HEAD 문서 메타.
  const headDocs = [...derived.pathToDoc.values()].map((doc) => ({
    filePath: `${WIKI_PREFIX}${doc.relPath}.md`,
    id: doc.id,
  }))
  const pathIndex = buildPathIndex(headDocs, runGit)
  const deletedPaths = collectDeletedDocPaths(runGit, {
    headPaths: new Set(headDocs.map((doc) => doc.filePath)),
    wikiPrefix: WIKI_PREFIX,
  })
  const everDeletedPaths = collectEverDeletedDocPaths(runGit, { wikiPrefix: WIKI_PREFIX })
  // prod 에서 draft 로 배제된 문서의 **전 히스토리 좌표**(`${sha}:${당시경로}`, rename 포함). 이들을
  // 가리키는 과거 feed: 커밋은 삭제된 문서와 같은 부류로 prune 된다 — draft 필터가 부재를 설명하므로
  // '해석 불가(조용한 유실 의심)'가 아니다. 이 좌표를 안 넘기면 checkFeedResolution 이 정상적 배제를
  // 유실로 오판해 빈 prod 빌드를 중단시킨다(이동한 draft 는 head 경로가 아니라 당시 경로로 참조된다).
  const excludedFeedRefs = new Set(
    buildPathIndex(
      excludedDocs.map((doc) => ({ filePath: `${WIKI_PREFIX}${doc.relPath}.md`, id: doc.frontmatter.id })), // prettier-ignore
      runGit,
    ).keys(),
  )
  const docsById = new Map()
  const headingsById = new Map()
  for (const doc of derived.pathToDoc.values()) {
    docsById.set(doc.id, {
      bodyLineOffset: doc.bodyLineOffset || 0,
      status: doc.frontmatter.status,
    })
    // disable 문서는 headings 가 없다 → 그 문서를 가리키는 피드의 anchor 는 null 로 강등된다.
    if (doc.frontmatter.status !== 'disable') headingsById.set(doc.id, doc.headingsWithLines)
  }

  const { items, stats } = buildFeedItems(commits, {
    deletedPaths,
    docsById,
    everDeletedPaths,
    excludedFeedRefs,
    headingsById,
    pathIndex,
    runGit,
    wikiPrefix: WIKI_PREFIX,
  })
  checkFeedResolution(stats)

  const generatedAt = deriveGeneratedAt(derived.docs, items)
  const summary = buildSummary({
    docs: derived.docs,
    generatedAt,
    sourceCommit,
    tags: derived.tags,
    tree: derived.tree,
  })
  const feeds = buildFeeds({ generatedAt, items, sourceCommit })
  const body = buildBody({ docs: derived.bodies, sourceCommit })

  validatePayloads({ body, feeds, summary }, schemaDir)
  checkInvariants(summary, feeds, body)

  fs.mkdirSync(outDir, { recursive: true })
  for (const [key, file] of Object.entries(PAYLOAD_FILES)) {
    fs.writeFileSync(path.join(outDir, file), JSON.stringify({ body, feeds, summary }[key]), 'utf8')
  }

  return { body, feeds, stats, summary }
}

/**
 * draft 판정 — dev 전용 문서인가. **OR 결합**: frontmatter 플래그(fail-open) OR `dev/` 폴더 경로
 * (fail-closed 백스톱). 신호가 늘수록 더 숨긴다(monotonic fail-safe) — 플래그를 깜빡해도 폴더가,
 * 폴더를 안 써도 플래그가 잡는다. AND 로 뒤집으면 이중 신호가 오히려 노출로 새므로 반전 금지.
 *
 * @param {{ frontmatter: { draft?: unknown }, relPath: string }} parsed
 */
function isDraft(parsed) {
  const flag = parsed.frontmatter.draft === true
  const inDevFolder = parsed.relPath === 'dev' || parsed.relPath.startsWith('dev/')
  return flag || inDevFolder
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
 * `--vault`(입력) · `--out`(출력) · `--schema` · `--allow-deadlinks`.
 *
 * **`--root` 는 거부한다** — 호환 별칭을 두지 않는다(마이그레이션 금지). 그 인자는 입력·schema·git·
 * 출력을 한꺼번에 겸하던 결함이었다.
 */
export function parseArgs(argv) {
  const options = {
    allowDeadlinks: false,
    env: null,
    out: null,
    schema: path.join(SCRIPT_DIR, 'schema'),
    vault: null,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--help' || arg === '-h') return { ...options, help: true }
    if (arg === '--allow-deadlinks') {
      options.allowDeadlinks = true
      continue
    }
    if (arg === '--root') {
      throw new Error(
        '--root 는 폐기되었습니다. 입력과 출력을 분리하세요: --vault <vault 리포> --out <출력 디렉토리>',
      )
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
    const target = { '--out': 'out', '--schema': 'schema', '--vault': 'vault' }[arg]
    if (!target) throw new Error(`알 수 없는 인자: ${arg}`)
    const value = argv[i + 1]
    if (!value) throw new Error(`${arg} 에는 디렉토리가 필요합니다`)
    options[target] = path.resolve(value)
    i += 1
  }

  // 조용한 cwd 폴백 금지 — 엉뚱한 리포를 vault 로 읽으면 산출물이 통째로 틀린다.
  if (!options.vault) throw new Error(`vault 를 지정하세요: --vault <vault 리포>\n${usage()}`)
  if (!options.out) throw new Error(`출력 위치를 지정하세요: --out <디렉토리>\n${usage()}`)

  // Layer B fail-closed: --env 미지정 → prod(draft 숨김) + 관측 가능한 warning(silent 폴백 금지).
  //   SSG "build=prod 기본" + OWASP Fail-Secure 와 같은 방향이다. 조용히 넘기면 dev 산출물을 prod 로
  //   착각해 배포하는 사고를 못 잡으므로, 방향은 prod 로 좁히되 관측은 남긴다.
  if (options.env === null) {
    options.env = 'prod'
    console.error(
      '[wiki] --env 미지정 → prod (fail-closed). dev 예제까지 포함하려면 --env dev 를 명시하세요.',
    )
  }
  return options
}

/**
 * 얕은/부분 클론 선제 fail.
 *
 * 얕은 히스토리는 생성 커밋을 잘라 **문서 id 와 피드를 조용히 틀리게 만든다** — 빌드는 exit 0,
 * 스키마는 통과, 화면은 정상 렌더. 데이터만 틀린다. 그래서 여기서 시끄럽게 끊는다.
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
 * 통계 출력 — **조용한 유실을 끝낸다.**
 *
 * 현행은 warnings 를 수집만 하고 아무도 소비하지 않았다(배열이 그대로 GC 됐다). 집계만 하고 안 내면
 * 조용한 유실이 그대로다. 대량 prune 은 삭제가 아니라 **rename 추적 실패**의 징후다.
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
  return 'Usage: node scripts/build.mjs --vault <vault repo> --out <dir> [--env dev|prod] [--schema <dir>] [--allow-deadlinks]'
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

/** 산출물 strict 검증 — 제거된 필드가 하나라도 남아 있으면 여기서 죽는다. */
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
