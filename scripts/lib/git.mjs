import { execFileSync, spawnSync } from 'node:child_process'

import { parseFrontmatterYaml } from './parse.mjs'

// `--name-status` 의 상태줄. rename/copy 는 `R100\told\tnew`(탭 2개), A/M/D 는 `M\tpath`(탭 1개).
// 커밋 헤더줄(`<hash>\t<date>`)은 소문자 hex 로 시작하므로 이 패턴에 걸리지 않는다.
const STATUS_LINE_RE = /^([A-Z])(\d*)\t(.+)$/

// 한글 경로가 octal escape(`"vault/wiki/company/\354\202\274…"`)로 나오면 역인덱스 키가 통째로
// 어긋난다 — 모든 경로 조회 호출에 붙인다.
const QUOTEPATH_OFF = ['-c', 'core.quotepath=false']

/**
 * (커밋, 당시경로) → 현재 문서 id 역인덱스.
 *
 * 피드 커밋의 diff 경로는 **그 커밋 당시의 경로**다. 문서가 이후 이동했다면 현재 경로로는 절대
 * 조회되지 않는다 — 이 역인덱스가 없으면 이동한 문서의 과거 피드가 **에러 없이 사라진다**.
 *
 * @param {{ filePath: string, id: string }[]} docs HEAD 문서(리포 상대 posix 경로 + 문서 id)
 * @param {(args: string[]) => string} runGit
 * @returns {Map<string, string>} `${sha}:${당시경로}` → docId
 */
export function buildPathIndex(docs, runGit) {
  const index = new Map()
  for (const doc of docs) {
    for (const entry of getFileHistory(runGit, doc.filePath)) {
      index.set(`${entry.sha}:${entry.pathAtCommit}`, doc.id)
      // rename(R) 의 옛 경로는 **같은 문서**다 → 색인한다. copy(C) 의 원본은 지금도 살아 있는
      // **다른 문서**이므로 색인하면 그 문서의 커밋을 엉뚱한 id 로 해석하게 된다.
      if (entry.status === 'R' && entry.oldPath) index.set(`${entry.sha}:${entry.oldPath}`, doc.id)
    }
  }
  return index
}

export function checkGitAvailable(runGit) {
  try {
    runGit(['--version'])
    runGit(['rev-parse', '--git-dir'])
    return true
  } catch (error) {
    throw new Error(
      `git CLI 또는 저장소를 사용할 수 없습니다: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

/**
 * 히스토리 완전성 판정 — 얕은/부분 클론은 **조용히 틀린 데이터**를 만든다.
 *
 * shallow 면 생성 커밋이 잘려 문서 id 가 바뀌고 `feed:` 커밋이 사라진다. 에러 없이.
 */
export function checkHistoryIntegrity(runGit) {
  const shallow = tryGit(runGit, ['rev-parse', '--is-shallow-repository']).trim() === 'true'
  const partialFilter = tryGit(runGit, [
    'config',
    '--get',
    'remote.origin.partialclonefilter',
  ]).trim()
  return { partialFilter, shallow }
}

/**
 * 과거에 삭제되어 HEAD 에 없는 vault 문서 경로.
 *
 * HEAD 대조가 필수다 — `D` 만 긁으면 **삭제 후 같은 경로에 재생성된** 살아 있는 문서까지 prune 된다.
 */
export function collectDeletedDocPaths(runGit, { headPaths, wikiPrefix }) {
  const raw = tryGit(runGit, [
    ...QUOTEPATH_OFF,
    'log',
    '--diff-filter=D',
    '--name-status',
    '--format=',
  ])
  const deleted = new Set()
  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(STATUS_LINE_RE)
    if (!match || match[1] !== 'D') continue
    const filePath = match[3].split('\t').at(-1)
    if (!filePath.startsWith(wikiPrefix) || !filePath.endsWith('.md')) continue
    if (headPaths.has(filePath)) continue
    deleted.add(filePath)
  }
  return deleted
}

/** 과거에 한 번이라도 삭제된 vault 문서 경로. HEAD 재생성 여부와 무관하게 feed prune 설명에 쓴다. */
export function collectEverDeletedDocPaths(runGit, { wikiPrefix }) {
  const raw = tryGit(runGit, [
    ...QUOTEPATH_OFF,
    'log',
    '--diff-filter=D',
    '--name-status',
    '--format=',
  ])
  const deleted = new Set()
  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(STATUS_LINE_RE)
    if (!match || match[1] !== 'D') continue
    const filePath = match[3].split('\t').at(-1)
    if (!isWikiDocPath(filePath, wikiPrefix)) continue
    deleted.add(filePath)
  }
  return deleted
}

/**
 * 문서 **삭제 이벤트** 목록 — `{ path, sha }`(그 문서가 지워진 커밋). 한 경로가 여러 번 살고
 * 죽었다면 이벤트도 여러 건이다.
 *
 * `--find-renames` 를 **명시**한다. 이동은 삭제가 아니므로 `R` 로 잡혀 여기 들어오면 안 되는데,
 * `diff.renames=false` 는 사용자가 로컬에 설정할 수 있는 값이라 config 에 맡기면 게이트의 의미가
 * 그 사람 환경에 따라 달라진다(정당한 `git mv` 가 삭제로 보인다). 커맨드라인 플래그가 config 를
 * 이기므로 여기서 못박는다 — `getFileHistory` 가 이미 같은 이유로 같은 플래그를 쓴다.
 */
export function collectDeletedDocEvents(runGit, { wikiPrefix }) {
  const raw = tryGit(runGit, [
    ...QUOTEPATH_OFF,
    'log',
    '--diff-filter=D',
    '--find-renames',
    '--name-status',
    '--format=%H',
  ])
  const events = []
  let sha = null
  for (const line of raw.split(/\r?\n/)) {
    if (line.trim() === '') continue
    const match = line.match(STATUS_LINE_RE)
    if (!match) {
      sha = line.trim()
      continue
    }
    if (match[1] !== 'D' || sha === null) continue
    const filePath = match[3].split('\t').at(-1)
    if (!isWikiDocPath(filePath, wikiPrefix)) continue
    events.push({ path: filePath, sha })
  }
  return events
}

/**
 * 삭제 **직전** blob 의 frontmatter id — 즉 *지워진 그 문서* 의 id.
 *
 * `readIdAtCreation` 을 쓰면 안 된다: 그것은 `getFileHistory` 를 타고, 그 함수는 생성 커밋에서
 * 끊으므로 **삭제 후 재생성된 경로에서는 새 문서의 id** 를 돌려준다(의도된 동작 — 재생성은 새
 * 문서다). 삭제된 쪽의 id 를 알아야 하는 이 게이트에는 정반대 값이다.
 *
 * @returns {string|null} id. frontmatter·id 가 없으면 null(pre-id era).
 */
export function readIdAtDeletion(runGit, { path: relFilePath, sha }) {
  let blob
  try {
    blob = runGit([...QUOTEPATH_OFF, 'show', `${sha}^:${relFilePath}`])
  } catch (error) {
    // 조회 실패를 null(=pre-id era = 면제)로 삼키면 게이트가 조용히 꺼진다 — 멈춘다(H6 와 같은 규칙).
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`삭제 직전 blob 을 읽지 못했습니다(${relFilePath} @ ${sha}^): ${message}`, {
      cause: error,
    })
  }
  const match = blob.match(/^---\r?\n([\s\S]*?)\r?\n---/u)
  if (!match) return null
  const id = parseFrontmatterYaml(match[1], relFilePath).id
  return id === undefined ? null : id
}

export function collectGitLog(runGit) {
  const sep = String.fromCodePoint(31)
  const end = String.fromCodePoint(30)
  const format = ['%H', '%aI', '%s', '%b'].join(sep) + end
  let raw
  try {
    raw = runGit(['log', `--format=${format}`, '--date=iso-strict'])
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (/does not have any commits yet|unknown revision/i.test(message)) return []
    throw error
  }
  return raw
    .split(end)
    .map((record) => record.replace(/^\r?\n/, ''))
    .filter((record) => record.trim() !== '')
    .map((record) => {
      const [hash, authorDate, subject, body] = record.split(sep)
      return {
        authorDate,
        body: (body || '').replace(/^\n+/, '').replace(/\s+$/, ''),
        hash,
        subject: subject || '',
      }
    })
}

export function getCommitDiffHunks(runGit, hash) {
  let raw
  try {
    raw = runGit([...QUOTEPATH_OFF, 'show', '--unified=0', '--format=', hash])
  } catch {
    // diff 조회 실패 시 빈 결과 → 호출부(deriveAnchorsForFile)가 앵커 null 로 폴백.
    return {}
  }

  const fileHunks = {}
  let currentFile = null
  for (const line of raw.split(/\r?\n/)) {
    const fileMatch = line.match(/^\+\+\+ b\/(.+)$/)
    if (fileMatch) {
      currentFile = fileMatch[1]
      fileHunks[currentFile] ||= []
      continue
    }
    const hunkMatch = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/)
    if (hunkMatch && currentFile) {
      fileHunks[currentFile].push({
        lineCount: Math.max(hunkMatch[2] === undefined ? 1 : Number.parseInt(hunkMatch[2], 10), 1),
        startLine: Number.parseInt(hunkMatch[1], 10),
      })
    }
  }
  return fileHunks
}

/**
 * 단일 커밋의 vault 문서 상태. rename 은 `{ status:'R', oldPath, path }` 로 낸다.
 *
 * 컨벤션 검사는 커밋 전체의 A/D/R 을 봐야 한다. `git log --follow` 는 문서 단위라 여기엔 맞지 않고,
 * `git show --name-status` 가 커밋 당시의 실제 판정을 그대로 준다.
 *
 * @returns {{ oldPath?: string, path: string, status: string }[]}
 */
export function getCommitDocStatuses(runGit, sha, wikiPrefix) {
  const raw = tryGit(runGit, [
    ...QUOTEPATH_OFF,
    'show',
    '--find-renames',
    '--name-status',
    '--format=',
    sha,
  ])
  const statuses = []
  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(STATUS_LINE_RE)
    if (!match) continue
    const code = match[1]
    const paths = match[3].split('\t')
    const filePath = paths.at(-1)
    if (!isWikiDocPath(filePath, wikiPrefix)) continue
    const entry = { path: filePath, status: code }
    if ((code === 'R' || code === 'C') && paths.length > 1) entry.oldPath = paths[0]
    statuses.push(entry)
  }
  return statuses
}

/**
 * 문서의 생성 커밋·최신 커밋. `getFileHistory` 위의 얇은 래퍼다(중복 `git log` 호출 금지).
 *
 * **id = 가장 최근 `A`(추가) 커밋** — "가장 오래된 커밋"이 아니다. 삭제 후 같은 경로에 새 문서를
 * 만들면 그것은 **새 문서**이고(README · 문서 id), 옛 생성 해시를 부활시키면 과거 피드가 엉뚱한
 * 새 문서를 가리킨다.
 */
export function getFileCommitDates(runGit, relFilePath) {
  const history = getFileHistory(runGit, relFilePath)
  if (history.length === 0) return { created: null, hash: null, updated: null }
  const addition = history.find((entry) => isCreation(entry)) ?? history.at(-1)
  return { created: addition.ts, hash: addition.sha, updated: history[0].ts }
}

/**
 * 문서 하나의 커밋 히스토리 — **당시 경로**를 포함한다(최신순).
 *
 * `--follow` 는 단일 경로에만 동작한다(git 제약) → 문서마다 호출한다.
 *
 * @returns {{ oldPath?: string, pathAtCommit: string, sha: string, status: string, ts: string }[]}
 */
export function getFileHistory(runGit, relFilePath) {
  let raw
  try {
    raw = runGit([
      ...QUOTEPATH_OFF,
      'log',
      '--follow',
      '--find-renames',
      '--name-status',
      '--format=%H%x09%aI',
      '--',
      relFilePath,
    ])
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (/does not have any commits yet|unknown revision/i.test(message)) return []
    throw error
  }

  const history = []
  let header = null
  for (const line of raw.split(/\r?\n/)) {
    if (line.trim() === '') continue
    const status = line.match(STATUS_LINE_RE)
    if (status && header) {
      const code = status[1]
      const paths = status[3].split('\t')
      const entry = { pathAtCommit: paths.at(-1), sha: header.sha, status: code, ts: header.ts }
      if ((code === 'R' || code === 'C') && paths.length > 1) entry.oldPath = paths[0]
      history.push(entry)
      // 생성 커밋에서 끊는다. 그 이전은 **이 문서의 히스토리가 아니다** —
      // `--follow` 는 내부적으로 copy 탐지(find_copies_harder)를 켜므로, 비슷한 문서를 새로 만들면
      // 그 add 를 기존 문서로부터의 `C`(copy)로 보고 **남의 히스토리를 계속 따라간다**.
      // 자르지 않으면 (a) 새 문서가 남의 생성 해시(=id)를 물려받고 (b) 역인덱스가 남의 커밋을
      // 이 문서로 매핑한다. 삭제 후 재생성도 같은 규칙으로 **새 문서**가 된다(README · 문서 id).
      if (isCreation(entry)) break
      continue
    }
    const [sha, ts] = line.split('\t')
    header = { sha, ts }
  }
  return history
}

/**
 * 문서의 **생성 커밋 blob** frontmatter 에서 id 를 읽는다 — 불변 게이트 원자재.
 *
 * HEAD 가 아니라 생성 시점 blob 을 본다(사후 삽입·변조 무시). 생성 blob 에 id 가 없으면
 * (pre-id era — 마이그레이션 전 생성분) `null` 을 돌려준다. 그래야 불변 게이트가 pre-id 문서를
 * "차이"로 오판해 마이그레이션 전 전 문서를 false-fail 시키는 일이 없다.
 *
 * @returns {null | string} 생성 blob frontmatter 의 id, 없으면 null
 */
export function readIdAtCreation(runGit, relFilePath) {
  const history = getFileHistory(runGit, relFilePath)
  if (history.length === 0) return null
  const creation = history.find((entry) => isCreation(entry)) ?? history.at(-1)
  let blob
  try {
    blob = runGit([...QUOTEPATH_OFF, 'show', `${creation.sha}:${creation.pathAtCommit}`])
  } catch (error) {
    // 생성 blob 을 못 읽으면 **멈춘다**. null 은 호출부(validate.mjs)에서 "pre-id era 문서 = 불변
    //   검사 면제" 를 뜻하므로, 여기서 null 을 돌려주면 *조회 실패* 가 *면제* 로 둔갑해 제품 핵심
    //   보증(생성 시점 id 불변)이 조용히 꺼진다. presence 는 스키마가 잡지만 **불변은 여기뿐**이다.
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`생성 blob 을 읽지 못했습니다(${relFilePath} @ ${creation.sha}): ${message}`, {
      cause: error,
    })
  }
  const match = blob.match(/^---\r?\n([\s\S]*?)\r?\n---/u)
  if (!match) return null
  const id = parseFrontmatterYaml(match[1], relFilePath).id
  return id === undefined ? null : id
}

export function makeGitRunner(cwd) {
  return (args) =>
    execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
}

/**
 * 여러 git object ref 를 `git cat-file --batch` 한 번으로 읽는다.
 *
 * @param {string} cwd git repository root
 * @param {string[]} refs object refs such as `${sha}:vault/wiki/a.md`
 * @returns {Map<string, string|null>} ref -> blob text, missing/non-blob -> null
 */
export function catFileBatch(cwd, refs) {
  const out = new Map()
  if (refs.length === 0) return out

  const child = spawnSync('git', ['cat-file', '--batch'], {
    cwd,
    input: `${refs.join('\n')}\n`,
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  if (child.status !== 0) {
    throw new Error(
      `git cat-file --batch 실패: ${child.stderr ? child.stderr.toString('utf8') : ''}`.trim(),
    )
  }

  const buffer = child.stdout
  let offset = 0
  for (const ref of refs) {
    const lineEnd = buffer.indexOf(0x0a, offset)
    if (lineEnd === -1) {
      out.set(ref, null)
      break
    }

    const header = buffer.subarray(offset, lineEnd).toString('utf8')
    offset = lineEnd + 1
    if (header.endsWith(' missing')) {
      out.set(ref, null)
      continue
    }

    const match = header.match(/ (blob) (\d+)$/u)
    if (!match) {
      out.set(ref, null)
      continue
    }

    const size = Number.parseInt(match[2], 10)
    out.set(ref, buffer.subarray(offset, offset + size).toString('utf8'))
    offset += size
    if (buffer[offset] === 0x0a) offset += 1
  }

  return out
}

/**
 * 이 커밋에서 문서가 **생겨났는가**.
 *
 * `A`(추가)뿐 아니라 `C`(copy)도 생성이다 — copy 는 원본이 **지금도 살아 있는 다른 문서**라는
 * 뜻이므로, 복사본은 그 순간 태어난 새 문서다. rename(`R`)만이 "같은 문서가 옮겨졌다"를 뜻한다.
 */
function isCreation(entry) {
  return entry.status === 'A' || entry.status === 'C'
}

function isWikiDocPath(filePath, wikiPrefix) {
  return filePath.startsWith(wikiPrefix) && filePath.endsWith('.md')
}

/** 값이 없으면 git 이 exit 1 로 끝나는 조회(`config --get` 등) → '' 로 정규화. */
function tryGit(runGit, args) {
  try {
    return runGit(args)
  } catch {
    return ''
  }
}
