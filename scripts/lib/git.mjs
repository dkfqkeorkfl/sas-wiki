import { execFileSync } from 'node:child_process'

import { parseFrontmatterYaml } from './parse.mjs'

// `--name-status` 의 상태줄. rename/copy 는 `R100\told\tnew`(탭 2개), A/M/D 는 `M\tpath`(탭 1개).
// 커밋 헤더줄(`<hash>\t<date>`)은 소문자 hex 로 시작하므로 이 패턴에 걸리지 않는다.
const STATUS_LINE_RE = /^([A-Z])(\d*)\t(.+)$/

// 한글 경로가 octal escape(`"wiki/company/\354\202\274…"`)로 나오면 역인덱스 키가 통째로
// 어긋난다 — 모든 경로 조회 호출에 붙인다.
const QUOTEPATH_OFF = ['-c', 'core.quotepath=false']

// `%x00` 은 git `Documentation/pretty-formats.adoc` 이 규정한 바이트 값 placeholder 다. 모든 필드
// 사이에 이것을 두면 **저자가 쓰는 커밋 텍스트가 레코드 구분자가 되지 못한다** — 커밋 메시지에 담을
// 수 있는 제어문자(US·RS·TAB 등)를 구분자로 쓰면 body 한 줄로 경계를 밀어 `hash` 자리를 탈취할 수
// 있고, 그 값이 뒤이어 `git show <hash>` 의 위치 인자로 흘러간다.
//
// `-z` 로 대체할 수 없다 — `git rev-list -z --format=…` 은 fatal 이라 `git log` 경로와 갈라진다.
// 두 경로가 공유할 수 있는 앵커는 `%x00` placeholder 뿐이다.
export const COMMIT_RECORD_FORMAT = '%H%x00%aI%x00%s%x00%b%x00'

const COMMIT_HASH_RE = /^[0-9a-f]{40}$/u
const COMMIT_HEADER_RE = /^\r?\n?(?:commit [0-9a-f]{40}\r?\n)?/u

/** 히스토리 계층 술어 — 경로 prefix 는 HEAD 상태 개념이라 과거 경로에 걸면 안 된다. */
export const anyMarkdown = (filePath) => filePath.endsWith('.md')

/** 계약 계층 술어 — "지금 규약의 경로" 안에 있는가. */
export const underWikiPrefix = (wikiPrefix) => (filePath) =>
  filePath.startsWith(wikiPrefix) && filePath.endsWith('.md')

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
 *
 * partial clone 필터는 **promisor remote 의 이름으로** 찾는다 — `remote.origin.partialclonefilter`
 * 하나만 보면 origin 이 아닌 다른 이름의 remote 를 promisor 로 쓰는 클론을 놓친다. git 의
 * partial-clone 문서(Documentation/technical/partial-clone.txt)는 이렇게 규정한다:
 * _"a partial clone [...] has 'extensions.partialClone' set to the name of its promisor remote"_
 * — 즉 `extensions.partialClone` 이 **어느 remote 가 promisor 인지**를 담는 저장소 단위 플래그다.
 * 미설정이면(보통의 origin 클론) 그 값이 비어 `origin` 으로 자연히 대체돼 예전과 같은 조회가 된다.
 */
export function checkHistoryIntegrity(runGit) {
  const shallow = tryGit(runGit, ['rev-parse', '--is-shallow-repository']).trim() === 'true'
  const promisorRemote = tryGit(runGit, ['config', '--get', 'extensions.partialClone']).trim()
  const filterRemote = promisorRemote || 'origin'
  const partialFilter = tryGit(runGit, [
    'config',
    '--get',
    `remote.${filterRemote}.partialclonefilter`,
  ]).trim()
  return { partialFilter, shallow }
}

/** 과거에 한 번이라도 삭제된 vault 문서 경로. HEAD 재생성 여부와 무관하게 feed prune 설명에 쓴다. */
export function collectEverDeletedDocPaths(runGit, { isDocPath }) {
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
    if (!isDocPath(filePath)) continue
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
export function collectDeletedDocEvents(runGit, { isDocPath }) {
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
    if (!isDocPath(filePath)) continue
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
  let raw
  try {
    raw = runGit(['log', `--format=${COMMIT_RECORD_FORMAT}`, '--date=iso-strict'])
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (/does not have any commits yet|unknown revision/i.test(message)) return []
    throw error
  }
  return parseCommitRecords(raw)
}

/**
 * `%H%x00%aI%x00%s%x00%b%x00` 출력의 공용 파서.
 *
 * git 은 마지막 NUL 뒤에 개행을 붙이므로 split 결과는 레코드당 4토큰과 잉여 1토큰이다. 빈 stdout
 * 은 그 잉여 토큰만 가진다. `git rev-list --format` 이 붙이는 `commit <hash>` 헤더와 레코드 사이
 * 개행은 hash 토큰에서 제거하되, arity 와 40-hex hash 가 깨지면 조용히 필드를 밀지 않고 멈춘다.
 */
export function parseCommitRecords(raw) {
  if (raw === '') return []

  const tokens = raw.split('\x00')
  if (tokens.length % 4 !== 1) {
    throw new Error(`git 커밋 레코드 프레이밍이 올바르지 않습니다: 토큰 ${tokens.length}개`)
  }

  const trailer = tokens.pop()
  if (trailer !== '\n' && trailer !== '\r\n' && trailer !== '') {
    throw new Error('git 커밋 레코드 프레이밍이 올바르지 않습니다: 잘못된 후행 데이터')
  }

  const records = []
  for (let index = 0; index < tokens.length; index += 4) {
    const hash = tokens[index].replace(COMMIT_HEADER_RE, '')
    if (!COMMIT_HASH_RE.test(hash)) {
      throw new Error(`git 커밋 hash 형식이 올바르지 않습니다: ${hash}`)
    }
    records.push({
      authorDate: tokens[index + 1],
      body: tokens[index + 3].replace(/^\n+/, '').replace(/\s+$/u, ''),
      hash,
      subject: tokens[index + 2] || '',
    })
  }
  return records
}

/**
 * 단일 커밋의 vault 문서 상태. rename 은 `{ status:'R', oldPath, path }` 로 낸다.
 *
 * 컨벤션 검사는 커밋 전체의 A/D/R 을 봐야 한다. `git log --follow` 는 문서 단위라 여기엔 맞지 않고,
 * `git show --name-status` 가 커밋 당시의 실제 판정을 그대로 준다.
 *
 * @returns {{ oldPath?: string, path: string, status: string }[]}
 */
export function getCommitDocStatuses(runGit, sha, isDocPath, { diffMerges } = {}) {
  const raw = tryGit(runGit, [
    ...QUOTEPATH_OFF,
    'show',
    '--find-renames',
    ...(diffMerges ? [`--diff-merges=${diffMerges}`] : []),
    '--name-status',
    '--format=',
    // ★ `sha` 는 마지막 **위치 인자**라 옵션 종료 없이는 `--output=<경로>` 같은 값이 옵션으로 승격해
    //   git 이 임의 경로에 파일을 쓴다(실측: 파일 생성 + exit 0). `--` 로는 대체할 수 없다 — 값이
    //   pathspec 이 되어 exit 0 + 빈 결과가 되고, 그 빈 결과가 "변경 없음"으로 오독된다.
    //   `gitcli(7)` 이 이 용도로 `--end-of-options` 를 규정하며, `git-show(1)`·`git-rev-list(1)`
    //   man page 에는 없지만 git 의 `revision.c setup_revisions()` 가 리비전을 받는 명령 전반에서
    //   처리한다.
    '--end-of-options',
    sha,
  ])
  const statuses = []
  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(STATUS_LINE_RE)
    if (!match) continue
    const code = match[1]
    const paths = match[3].split('\t')
    const filePath = paths.at(-1)
    if (!isDocPath(filePath)) continue
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

/**
 * vault 를 cwd 로 고정한 git 러너. 비0 종료는 **throw** 다(`execFileSync` 극성 그대로).
 *
 * ★ **`timeoutMs` 가 D23 의 spawn 타임아웃 자리다**(v3 P2). 미지정이면 옵션 자체를 붙이지 않아
 * 오늘과 **바이트 동일한 동작**이다 — Node `child_process` 의 `timeout` 기본값이 `undefined` 이고
 * (문서 축자: _"the maximum amount of time the process is allowed to run. **Default:**
 * `undefined`"_), 값을 정하는 것은 이 커밋이 아니라 **실측**이다.
 *
 * 값을 채울 때의 구조적 제약은 하나다 — **`SCRIPT_TIMEOUT_MS`(webfront `dev/wiki-backend/
 * plugin.ts:22` = 30초) 미만**이어야 한다. 그래야 서버가 자기 상한에 먼저 걸려 500 을 내는 대신
 * 스크립트가 스스로 끝내 의미 있는 에러를 낼 수 있다.
 *
 * ★ `killSignal` 기본은 `SIGTERM`(문서)이고 **포착 가능한 신호**다 — "타임아웃 = 즉시 회수" 를
 * 가정하지 않는다.
 *
 * @param {string} cwd
 * @param {{ timeoutMs?: number }} [options]
 */
export function makeGitRunner(cwd, { timeoutMs } = {}) {
  return (args) =>
    execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
      ...(timeoutMs === undefined ? {} : { timeout: timeoutMs }),
    })
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

/**
 * `config --get` 이 "값이 없다" 로 끝내는 실패인가 — exit 1 · stderr 없음이 그 계약이다.
 *
 * F-20: 예전엔 `tryGit` 이 **모든** 예외를 흡수했다. 그러면 고장난 git 러너의 실패가 "삭제된 적
 * 없음" 으로 둔갑해 피드 사유가 `deleted` → `unresolved` 로 뒤집히고 fail-closed 드랍이 된다
 * (AG4). 여기서 흡수 범위를 이 한 가지 알려진 양성 실패로만 좁힌다.
 */
function isBenignConfigMiss(args, error) {
  return args[0] === 'config' && error?.status === 1 && !error?.stderr
}

/**
 * **아직 커밋이 없는 리포**도 양성 실패다 — "삭제 이력이 없다" 가 참인 상태이지 고장이 아니다.
 *
 * 이 조건이 빠져 있었다(리뷰 실측): F-20 이 흡수 범위를 `config --get` 하나로 좁혔는데, 같은 phase 가
 * 얕은 티어를 없애면서(D-I) `collectDeletedDocEvents`·`collectEverDeletedDocPaths` 가 **서빙 경로에서도
 * 항상** 돌게 됐다. 예전엔 얕은 티어라 그 블록이 스킵돼 문제가 드러나지 않았고, `tryGit` 의 catch-all
 * 이 이 케이스를 우연히 덮고 있었다. 둘이 겹치면서 커밋 0건 vault 에서 `parseVault` 전체가 죽는다
 * (재현 확인). 형제 함수들(`collectGitLog:160`·`getFileHistory:247`·`revListFeedCandidates`)은 전부
 * 자체 try/catch 로 같은 패턴을 이미 막고 있었다 — 여기만 그 방어가 없었다.
 *
 * **범위는 여전히 좁다**: 고장난 러너·권한 오류·잘못된 인자는 그대로 던진다(F-20 의 취지 유지).
 */
function isEmptyHistory(error) {
  const text = `${error?.message ?? ''}\n${typeof error?.stderr === 'string' ? error.stderr : ''}`
  return /does not have any commits yet|unknown revision|bad revision/iu.test(text)
}

/**
 * 알려진 양성 실패(`config --get` 값 없음)만 `''` 로 흡수한다 — 그 외는 rethrow(F-20).
 *
 * rethrow 시 `stderr` 를 메시지에 합친다 — `execFileSync` 실패의 `message` 는 종종 원인을 담지
 * 않고(`Command failed: …`) 실제 사유는 `stderr` 에 있다. 합치지 않으면 "고장났다" 는 알아도
 * "왜" 는 알 수 없다.
 */
function tryGit(runGit, args) {
  try {
    return runGit(args)
  } catch (error) {
    if (isBenignConfigMiss(args, error) || isEmptyHistory(error)) return ''
    const message = error instanceof Error ? error.message : String(error)
    const stderr = typeof error?.stderr === 'string' && error.stderr ? `\n${error.stderr}` : ''
    throw new Error(`${message}${stderr}`, { cause: error })
  }
}
