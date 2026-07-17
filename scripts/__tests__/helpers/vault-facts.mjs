// git plumbing 사실 수집기 — RED-A(임시 클론)·RED-B(실 서브모듈) 공용.
//
// DAMP 경계: 이 파일은 **사실(fact)만 캔다. expect 를 절대 넣지 않는다.**
// 단언을 헬퍼에 숨기면 어느 계약이 깨졌는지 스펙 본문만 보고 알 수 없다.
// (vitest include 패턴 `scripts/wiki/**/*.{test,spec}.{mjs,ts}` 에 안 걸리므로 스위트로 수집되지 않는다 — 의도.)
import { execFileSync } from 'node:child_process'

/** vault 문서의 리포 상대 경로 접두사. 이 모듈 안에서만 쓴다(`isVaultDoc` 이 유일한 소비자). */
const VAULT_PREFIX = 'vault/wiki/'

const FIELD = String.fromCodePoint(31) // unit separator — 커밋 필드 구분(본문 개행에 안전)
const RECORD = String.fromCodePoint(30) // record separator — 커밋 구분

/**
 * git 실행기 — **모든 호출이 `-C repoDir` 를 갖도록 구조적으로 강제한다.**
 *
 * `-C` 를 빼먹으면 서브모듈 디렉토리가 아니라 **슈퍼프로젝트의 답**이 나온다.
 * 슈퍼프로젝트는 항상 non-shallow 이므로 `--is-shallow-repository` 가 늘 'false' 가 되어
 * shallow 가드가 통째로 무력화된다 — 이 phase 의 최대 단일 실패점이다.
 * `core.quotepath=false` 는 한글 경로(`vault/wiki/company/삼성전자.md`)를 octal escape 없이 그대로 낸다
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
    /** HEAD 의 vault/wiki/**\/*.md (repo 상대 posix 경로, 정렬됨) */
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

/** `--name-status -M` 라인 파싱. `-M` 은 rename 검출을 명시한다(diff.renames 설정 의존 = 비결정 방지). */
function parseNameStatus(tail) {
  return tail
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [status, first, second] = line.split('\t')
      const code = status.charAt(0) // R100 · C075 → R · C
      if (code === 'R' || code === 'C') return { newPath: second, path: first, status: code }
      return { path: first, status: code }
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

/** 값이 없으면 git 이 exit 1 로 끝나는 조회(config --get 등) → '' 로 정규화. */
function tryGit(repoDir, args) {
  try {
    return git(repoDir, args)
  } catch {
    return ''
  }
}
