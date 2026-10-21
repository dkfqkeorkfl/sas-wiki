#!/usr/bin/env node
// 커밋 직전 훅 — 이번 커밋에 들어가는 위키 문서마다 문서 id 를 판단한다.
//
// 문서 id 는 한번 정해지면 바뀌면 안 되는 내부 키다. 사람이 손으로 만들면 빠뜨리거나 형식을 틀리기
// 쉬워 기계가 채우고, 한번 정해진 id 를 바꾸는 커밋은 여기서 막는다. push 직전과 CI 는 같은 판단을
// validate 로 다시 한다(ID_TAMPERED).
import { lstatSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'

import { writeFileAtomic } from './lib/atomic.mjs'
import { DOC_ID_FIELD, isDocId, judgeDocId } from './lib/doc-id.mjs'
import {
  checkGitAvailable,
  isMergeInProgress,
  isTemporaryIndex,
  listStagedDocChanges,
  makeGitRunner,
  readFrontmatterFieldChange,
  readHeadFile,
  readStagedBytes,
  underWikiPrefix,
  writeStagedFile,
} from './lib/git.mjs'
import { WIKI_PREFIX } from './lib/head-state.mjs'
import { newDocId } from './lib/new-doc-id.mjs'
import {
  extractFrontmatterField,
  hasReadableFrontmatter,
  upsertFrontmatterField,
} from './lib/parse.mjs'

// --vault 미지정 시 기본값 = 스크립트 자기 리포 루트(cwd 무관).
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// 한 바이트라도 UTF-8 이 아니면 throw 한다. 느슨하게 디코딩하면 깨진 바이트가 U+FFFD 로 바뀐 채
//   다시 쓰여 원래 바이트가 사라진다. `ignoreBOM` 은 BOM 을 지우지 않고 그대로 두게 한다.
const UTF8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })

/**
 * 인덱스에 올라간 위키 문서의 id 를 판단하고, 미등록이면 채운다.
 *
 * - 정상: 그대로 둔다.
 * - 미등록: 작업 트리에 유효한 id 가 있으면 그것을, 없으면 새로 발급한 UUIDv7 을 인덱스와 작업
 *   트리에 넣는다. 인덱스는 blob 을 직접 바꾸므로 스테이징하지 않은 변경은 커밋에 섞이지 않는다.
 * - 훼손·변경: 원래 id 를 담아 `blocked` 에 낸다. 채울 수 없는 문서도 `blocked` 다.
 *
 * `blocked` 가 하나라도 있으면 아무 파일도 고치지 않는다 — 커밋이 멈추는데 일부만 고쳐 두면 무엇이
 * 바뀌었는지 알기 어렵다.
 *
 * @param {{ updateIndex?: boolean, vault: string }} options `updateIndex:false` 면 작업 트리만 고친다
 * @returns {{ blocked: { path: string, reason: string }[], filled: { id: string, path: string }[],
 *   skipped: { path: string, reason: string }[] }}
 */
export function checkDocIds({ updateIndex = true, vault }) {
  const vaultDir = path.resolve(vault)
  const runGit = makeGitRunner(vaultDir)
  checkGitAvailable(runGit)

  // 병합 커밋에 훅의 수정을 섞지 않는다 — 판단·차단은 하되 채우지는 않는다.
  const merging = isMergeInProgress(runGit)
  const blocked = []
  const skipped = []
  const plans = []
  for (const change of listStagedDocChanges(runGit, { isDocPath: underWikiPrefix(WIKI_PREFIX) })) {
    const staged = decodeUtf8(readStagedBytes(runGit, change.path))
    if (staged === null) {
      blocked.push({
        path: change.path,
        reason: 'UTF-8 이 아닙니다 — UTF-8 로 저장해 다시 커밋하세요',
      })
      continue
    }

    // frontmatter 가 해석되지 않으면 id 줄이 멀쩡해도 id 를 읽을 수 없다(검증기도 문서로 보지 않는다).
    //   id 를 되돌리라고 하면 틀린 안내가 되므로 먼저 가른다.
    if (!hasReadableFrontmatter(staged)) {
      blocked.push({ path: change.path, reason: UNREADABLE_FRONTMATTER })
      continue
    }

    const headPath = change.oldPath ?? change.path
    const [before, after] = readFrontmatterFieldChange(runGit, change.path, {
      contents: staged,
      headPath,
      pattern: DOC_ID_FIELD,
    })
    const verdict = judgeDocId([before, after])
    if (verdict === 'changed' || verdict === 'damaged') {
      blocked.push({ path: change.path, reason: blockReason(runGit, headPath, verdict, before, after) }) // prettier-ignore
    } else if (verdict === 'unregistered') {
      if (merging) {
        skipped.push({
          path: change.path,
          reason:
            '병합 중이라 채우지 않습니다 — 병합 커밋 뒤 이 문서에 빈 `id:` 줄을 넣고 git add 해 커밋하면 채워집니다',
        })
        continue
      }
      const plan = planFill(vaultDir, change.path, staged)
      if (typeof plan === 'string') blocked.push({ path: change.path, reason: plan })
      else plans.push(plan)
    }
  }
  if (blocked.length > 0) return { blocked, filled: [], skipped }

  for (const plan of plans) {
    // 작업 트리를 먼저 쓴다. 인덱스를 먼저 쓰고 작업 트리 쓰기가 실패하면, 다음 실행은 인덱스에 id 가
    //   있어 건너뛰고 작업 트리에는 id 가 없는 채로 남아 다음 `git add` 가 id 를 지운다.
    if (plan.worktree !== null) writeFileAtomic(plan.absPath, plan.worktree, { mode: plan.mode })
    if (updateIndex) writeStagedFile(runGit, plan.path, plan.staged)
  }
  return { blocked, filled: plans.map(({ id, path: docPath }) => ({ id, path: docPath })), skipped }
}

const UNREADABLE_FRONTMATTER =
  'frontmatter 가 없거나 해석되지 않습니다(BOM·최상위 들여쓰기·닫는 --- 를 확인하세요) — 고쳐 다시 커밋하세요'

/**
 * 훼손·변경 문서를 막는 사유. 이번 커밋이 아니라 이미 커밋된 이력에서 바뀐 것이면(훅을 건너뛴 커밋)
 * 원래 id 로 되돌려도 다시 변경이 되므로, 정정 방법을 가리킨다.
 */
function blockReason(runGit, headPath, verdict, before, after) {
  const head = readHeadFile(runGit, headPath)
  const atHead = head === undefined ? undefined : extractFrontmatterField(head, DOC_ID_FIELD)
  if (atHead === after) {
    return (
      `id 변경이 이미 이력에 있습니다(${before} → ${after ?? '없음'}) — 이 커밋에서 바꾼 것이 아닙니다. ` +
      'README 의 "id 를 고쳐야 할 때" 에서 이미 push 한 id 의 정정 방법을 따르세요'
    )
  }
  return verdict === 'changed'
    ? `id 는 바꿀 수 없습니다(${before} → ${after}) — 원래 id ${before} 로 되돌리세요`
    : `id 가 지워졌거나 형식이 틀렸습니다 — 원래 id ${before} 로 되돌리세요`
}

/**
 * 미등록 문서에 넣을 id 와 고친 내용. 채울 수 없으면 그 사유(문자열).
 *
 * 고친 결과를 다시 읽어 넣은 id 가 그대로 읽힐 때만 쓴다 — 빈 `id:` 아래 들여쓴 블록이 있으면 그
 * 줄만 바꿔도 frontmatter 가 해석되지 않게 된다.
 */
function planFill(vaultDir, relPath, staged) {
  const absPath = path.join(vaultDir, ...relPath.split('/'))
  // 작업 트리는 일반 파일일 때만 고친다. 없거나 심볼릭 링크 등이면 인덱스만 채운다 — 링크를 따라가
  //   쓰면 링크가 일반 파일로 바뀐다.
  const entry = lstatSync(absPath, { throwIfNoEntry: false })
  const isFile = entry?.isFile() === true
  const worktree = isFile ? decodeUtf8(readFileSync(absPath)) : null
  if (isFile && worktree === null) {
    return '작업 트리 파일이 UTF-8 이 아닙니다 — UTF-8 로 저장해 다시 커밋하세요'
  }
  const worktreeId = worktree === null ? undefined : extractFrontmatterField(worktree, DOC_ID_FIELD)
  const id = isDocId(worktreeId) ? worktreeId : newDocId()
  const line = `id: '${id}'`

  const nextStaged = fillLine(staged, line, id)
  if (nextStaged === null) {
    return 'id 를 넣으면 frontmatter 가 깨집니다(빈 id: 줄 아래 들여쓴 블록) — id 줄을 지우고 다시 커밋하세요'
  }
  let nextWorktree = null
  if (worktree !== null && !isDocId(worktreeId)) {
    nextWorktree = fillLine(worktree, line, id)
    if (nextWorktree === null) return `작업 트리 문서: ${UNREADABLE_FRONTMATTER}`
  }
  return {
    absPath,
    id,
    mode: worktree === null ? undefined : entry.mode & 0o7777,
    path: relPath,
    staged: nextStaged,
    worktree: nextWorktree,
  }
}

function fillLine(markdown, line, id) {
  const next = upsertFrontmatterField(markdown, DOC_ID_FIELD, line)
  return next !== null && extractFrontmatterField(next, DOC_ID_FIELD) === id ? next : null
}

function decodeUtf8(bytes) {
  try {
    return UTF8.decode(bytes)
  } catch {
    return null
  }
}

export async function main(argv = process.argv.slice(2)) {
  let values
  try {
    ;({ values } = parseArgs({
      allowPositionals: false,
      args: argv,
      options: {
        help: { short: 'h', type: 'boolean' },
        vault: { type: 'string' },
      },
    }))
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 2
    return
  }
  if (values.help) {
    console.log(usage())
    return
  }

  const vault = path.resolve(values.vault ?? REPO_ROOT)
  const updateIndex = !isTemporaryIndex(makeGitRunner(vault), {
    cwd: process.cwd(),
    indexFile: process.env.GIT_INDEX_FILE,
  })
  const { blocked, filled, skipped } = checkDocIds({ updateIndex, vault })

  for (const entry of filled) console.log(`[wiki] check-doc-ids ${entry.path} id=${entry.id}`)
  for (const entry of skipped) {
    console.error(`[wiki] check-doc-ids ${entry.path} 건너뜀: ${entry.reason}`)
  }
  if (blocked.length > 0) {
    for (const entry of blocked)
      console.error(`[wiki] check-doc-ids ${entry.path}: ${entry.reason}`)
    console.error('[wiki] check-doc-ids 커밋을 멈췄습니다. 위 문서를 고친 뒤 다시 커밋하세요.')
    process.exitCode = 1
    return
  }
  if (!updateIndex && filled.length > 0) {
    // 경로 지정 커밋의 임시 인덱스에 쓰면 커밋에만 들어가고 저장소 인덱스에는 남지 않아 다음
    //   커밋이 id 를 지운다. 그래서 작업 트리에만 넣고 여기서 커밋을 멈춘다.
    console.error(
      '[wiki] check-doc-ids 경로 지정 커밋에서는 인덱스를 고칠 수 없어 작업 트리에만 id 를 넣었습니다.\n' +
        `  → git add -- ${filled.map((entry) => shellQuote(`:(top)${entry.path}`)).join(' ')} 후 다시 커밋하세요.`,
    )
    process.exitCode = 1
  }
}

/** 셸에 그대로 붙여 넣을 수 있게 작은따옴표로 감싼다. */
function shellQuote(text) {
  return `'${text.replaceAll("'", "'\\''")}'`
}

function usage() {
  return 'Usage: node scripts/check-doc-ids.mjs [--vault <vault repo>]'
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
