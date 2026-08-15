// git plumbing 사실 수집기 — RED-A(임시 클론)·RED-B(실 서브모듈) 공용.
//
// DAMP 경계: 이 파일은 **사실(fact)만 캔다. expect 를 절대 넣지 않는다.**
// 단언을 헬퍼에 숨기면 어느 계약이 깨졌는지 스펙 본문만 보고 알 수 없다.
// (vitest include 패턴 `scripts/wiki/**/*.{test,spec}.{mjs,ts}` 에 안 걸리므로 스위트로 수집되지 않는다 — 의도.)
import { execFileSync } from 'node:child_process'

/** vault 문서의 리포 상대 경로 접두사. 이 모듈 안에서만 쓴다(`isVaultDoc` 이 유일한 소비자). */
const VAULT_PREFIX = 'wiki/'

const FIELD = String.fromCodePoint(31) // unit separator — 커밋 필드 구분(본문 개행에 안전)
const RECORD = String.fromCodePoint(30) // record separator — 커밋 구분

/**
 * git 실행기 — **모든 호출이 `-C repoDir` 를 갖도록 구조적으로 강제한다.**
 *
 * `-C` 를 빼먹으면 서브모듈 디렉토리가 아니라 **슈퍼프로젝트의 답**이 나온다.
 * 슈퍼프로젝트는 항상 non-shallow 이므로 `--is-shallow-repository` 가 늘 'false' 가 되어
 * shallow 가드가 통째로 무력화된다 — 이 phase 의 최대 단일 실패점이다.
 * `core.quotepath=false` 는 한글 경로(`wiki/company/삼성전자.md`)를 octal escape 없이 그대로 낸다
 * (`lib/git.mjs:45` 선례). 빠뜨리면 경로 비교가 전부 빗나가고 단언이 조용히 거짓이 된다.
 */
export function git(repoDir, args) {
  return gitRaw(repoDir, args).trim()
}

/** vault 문서 경로인가(HEAD 트리·diff 경로 공용 술어). */
export function isVaultDoc(relPath) {
  return typeof relPath === 'string' && relPath.startsWith(VAULT_PREFIX) && relPath.endsWith('.md')
}

/**
 * 리포의 히스토리·HEAD 사실을 한 번에 수집한다.
 *
 * @param {string} repoDir  대상 리포(서브모듈 워크트리 또는 임시 클론)
 * @param {{ rootSha: string }} options
 *   rootSha — 완전성 앵커로 존재를 확인할 커밋. 호출자가 대상 리포의 루트 SHA 를 주입한다.
 */
export function readVaultFacts(repoDir, { rootSha } = {}) {
  if (!rootSha) throw new Error('readVaultFacts requires rootSha')
  const mdFiles = readHeadVaultFiles(repoDir)
  return {
    /** { sha, subject, body, changes: [{ status, path, newPath? }] }[] — newest-first */
    commits: readCommits(repoDir),
    /** HEAD 문서의 frontmatter 최소 파싱 */
    docs: mdFiles.map((relPath) => readDoc(repoDir, relPath)),
    /** 알려진 루트 커밋이 실재하는가(= 히스토리 절단 없음) */
    hasRootCommit: gitOk(repoDir, ['cat-file', '-e', `${rootSha}^{commit}`]),
    /** `rev-parse --is-shallow-repository` 원문('true' | 'false') */
    isShallow: git(repoDir, ['rev-parse', '--is-shallow-repository']),
    /** HEAD 의 wiki/**\/*.md (repo 상대 posix 경로, 정렬됨) */
    mdFiles,
    /** partial clone 필터(`--filter=blob:none` 등). 없으면 '' */
    partialFilter: tryGit(repoDir, ['config', '--get', 'remote.origin.partialclonefilter']),
  }
}

function gitOk(repoDir, args) {
  try {
    gitRaw(repoDir, args)
    return true
  } catch {
    return false
  }
}

function gitRaw(repoDir, args) {
  return execFileSync('git', ['-C', repoDir, '-c', 'core.quotepath=false', ...args], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

function parseCommitRecord(record) {
  const [sha = '', subject = '', body = '', tail = ''] = record.split(FIELD)
  return {
    body: body.trim(),
    changes: parseNameStatus(tail),
    sha: sha.trim(),
    subject: subject.trim(),
  }
}

/** frontmatter 최소 파싱 — 최상위(들여쓰기 0) 키만. `meta:` 하위 2칸 들여쓰기는 의도적으로 무시. */
function parseFrontmatter(content) {
  const lines = content.split(/\r?\n/)
  if (lines[0]?.trim() !== '---') return {}
  const out = {}
  for (const line of lines.slice(1)) {
    if (line.trim() === '---') break
    const matched = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/)
    if (matched) out[matched[1]] = matched[2].trim()
  }
  return out
}

/**
 * git 이 `-z` 없이 `--name-status` 를 낼 때 **제어문자·따옴표·역슬래시가 든 경로**를 C-quote
 * (`"…"` + 이스케이프)로 감싼다(`quote.c` `quote_c_style` — git 문서 `git-config.adoc`
 * `core.quotePath`: _"double-quotes, backslash and control characters are always escaped
 * regardless of the setting"_). `gitRaw` 가 이미 켜 둔 `core.quotepath=false` 는 **8비트(비-ASCII)
 * 바이트만** 면제한다(한글 경로가 quote 없이 그대로 나오는 이유) — 탭·개행·백슬래시·따옴표는
 * **config 로 끌 수 없이 무조건** quote 된다. 이 경로를 그대로 쓰면 `path`/`newPath` 가 실제
 * 파일명이 아니라 이 quote 문자열 그대로(`"wiki/tab\tfile.md"` 같은 리터럴) 남아 `isVaultDoc` 의
 * `wiki/` 접두 매칭이 깨지고, 그 문서가 조용히 해석에서 빠진다.
 *
 * `-z`(NUL 구분자 — `tracked-scan.mjs` 의 `lsFiles` 가 쓰는 관례)를 여기도 쓸 수는 있다(실측: RECORD
 * 경계 자체는 안 깨진다). 그러나 이 리포는 `readCommits` 가 **여러 커밋을 한 스트림에 묶는 커스텀
 * RECORD/FIELD 포맷**을 쓰고, `-z` 를 켜면 그 포맷의 커밋 헤더 종료가 NUL 로 바뀌면서(실측:
 * `%H`…필드 뒤에 NUL **과** 커밋/diff 사이 전통적 개행이 **함께** 남는다) `--name-status` 항목도
 * NUL 구분(rename 은 `상태\0옛경로\0새경로\0`)으로 형태가 바뀐다 — `readCommits` **와**
 * `parseCommitRecord` 양쪽을 다시 짜야 하는 더 넓은 변경이라, 이 G 항목의 국소 범위를 넘는다.
 * 그래서 와이어 프레이밍은 그대로 두고 **quote 를 여기서 직접 해제**한다 — 결함의 원인(quote 를
 * 안 푸는 것)을 정확히 닫으면서 변경을 이 함수 안에 가둔다.
 */
function unquoteGitPath(field) {
  if (field === undefined || field.length < 2 || field[0] !== '"' || field.at(-1) !== '"')
    return field
  const inner = field.slice(1, -1)
  // git quote.c 의 named escape 집합 — 전부 단일 바이트다.
  const NAMED_ESCAPES = {
    '"': 0x22,
    '\\': 0x5c,
    a: 0x07,
    b: 0x08,
    f: 0x0c,
    n: 0x0a,
    r: 0x0d,
    t: 0x09,
    v: 0x0b,
  }
  const bytes = []
  for (let index = 0; index < inner.length; index += 1) {
    const char = inner[index]
    if (char !== '\\') {
      bytes.push(...Buffer.from(char, 'utf8'))
      continue
    }
    const next = inner[index + 1]
    if (next !== undefined && next in NAMED_ESCAPES) {
      bytes.push(NAMED_ESCAPES[next])
      index += 1
      continue
    }
    // `core.quotepath=false` 인 이 리포에서는 실전에 등장하지 않는 경로(비-ASCII 바이트는 quote 자체가
    //   면제된다)지만, quote.c 는 8비트 바이트를 8진 3자리로도 이스케이프한다 — 방어적으로 지원한다.
    const octal = inner.slice(index + 1, index + 4)
    if (/^[0-7]{3}$/.test(octal)) {
      bytes.push(Number.parseInt(octal, 8))
      index += 3
      continue
    }
    bytes.push(...Buffer.from(char, 'utf8')) // 알 수 없는 이스케이프 — 백슬래시 자신을 원문 그대로 보존
  }
  return Buffer.from(bytes).toString('utf8')
}

/** `--name-status -M` 라인 파싱. `-M` 은 rename 검출을 명시한다(diff.renames 설정 의존 = 비결정 방지). */
function parseNameStatus(tail) {
  return tail
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [status, first, second] = line.split('\t')
      const code = status.charAt(0) // R100 · C075 → R · C
      if (code === 'R' || code === 'C') {
        return { newPath: unquoteGitPath(second), path: unquoteGitPath(first), status: code }
      }
      return { path: unquoteGitPath(first), status: code }
    })
}

function readCommits(repoDir) {
  const format = `${RECORD}%H${FIELD}%s${FIELD}%b${FIELD}`
  const raw = tryGit(repoDir, ['log', '-M', '--name-status', `--format=${format}`, 'HEAD'])
  return raw
    .split(RECORD)
    .filter((record) => record.trim() !== '')
    .map(parseCommitRecord)
}

function readDoc(repoDir, relPath) {
  const front = parseFrontmatter(gitRaw(repoDir, ['show', `HEAD:${relPath}`]))
  return {
    path: relPath,
    status: front.status ?? null,
    title: front.title ?? null,
    type: front.type ?? null,
  }
}

function readHeadVaultFiles(repoDir) {
  return tryGit(repoDir, ['ls-tree', '-r', '--name-only', 'HEAD'])
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((relPath) => isVaultDoc(relPath))
    .toSorted()
}

/**
 * git 이 **"값 없음"으로 정상 종료**하는 조회(`config --get` 등)만 `''` 로 정규화한다.
 *
 * `git-config` 문서(`git-config.adoc`): _"If the key does not exist, the command will exit with
 * non-zero error code"_ — 그 코드는 **1** 이다(실측: `git config --get <없는키>` → exit 1, stderr
 * 없음). 이 함수가 정규화하는 것은 정확히 이 경로뿐이다.
 *
 * 그 밖의 실패(리포 손상 · 권한 · git 부재 · 인자 오류 — git 의 `fatal:` 급 오류는 보통 exit 128)는
 * "값이 없다"와 **다른 사건**이라 그대로 던진다. 두 실패를 같은 `''` 로 접으면 손상된 히스토리가
 * "정상인데 이 조회만 값이 없다"로 위장된다 — 예: 빈 리포에서 `git log HEAD` 는 HEAD 가 아직 아무
 * 커밋도 가리키지 않아 exit **128**(`fatal: ambiguous argument 'HEAD'`)로 죽는다(실측). 이 함수를 부르는
 * `readCommits` 는 그 128 을 그대로 위로 던져야 한다 — `readVaultFacts` 가 `rootSha` 를 **필수**로
 * 요구하는 것 자체가 "호출자는 이미 커밋이 있는 히스토리를 안다"는 전제이므로, 그 전제가 깨진
 * 상태(히스토리가 아예 없거나 예상과 다르게 손상됨)를 `[]`(정상적인 "커밋 0건")로 위장하면 안 된다.
 */
function tryGit(repoDir, args) {
  try {
    return git(repoDir, args)
  } catch (error) {
    if (error?.status === 1) return ''
    throw error
  }
}
