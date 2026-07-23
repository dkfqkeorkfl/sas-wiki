// 실 git tmp vault 시딩 프리미티브 — frontmatter UUIDv7 doc-id 무결성 RED 공용 (P1 Task 2·3·4).
//
// DAMP 경계: 이 파일은 **정상 시딩 원자만** 제공한다(`expect` 없음). 결함(id 부재·사후 변조·중복)은
//   각 스펙 본문에서 **딱 한 곳만** 주입한다 → 무엇이 틀렸는지가 스펙에 보인다.
//   (vitest 기본 include 는 `*.test.mjs` 만 잡으므로 helpers/*.mjs 는 테스트로 수집되지 않는다 — 의도.)
//
// 결정성: git t/test-lib.sh test_tick 관례(고정 시각·identity). ~/.gitconfig 누출은 vitest.config.js 의
//   GIT_CONFIG_GLOBAL=/dev/null 이 막지만, identity 는 여기서 명시 주입한다(CI 무-identity 환경 재현).
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const NAME = 'SAS Wiki Bot'
const EMAIL = 'bot@sas.wiki'
let tick = 1_136_239_445

export function git(cwd, args, extraEnv = {}) {
  return execFileSync('git', ['-c', 'core.quotepath=false', ...args], {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_EMAIL: EMAIL,
      GIT_AUTHOR_NAME: NAME,
      GIT_COMMITTER_EMAIL: EMAIL,
      GIT_COMMITTER_NAME: NAME,
      ...extraEnv,
    },
  }).trim()
}

function nextDate() {
  tick += 60
  return `${tick} +0000`
}

/** 스테이징 전량 + 결정적 날짜 커밋. HEAD 해시를 돌려준다. */
export function commit(cwd, message) {
  const date = nextDate()
  git(cwd, ['add', '-A'])
  git(cwd, ['commit', '--no-gpg-sign', '-m', message], {
    GIT_AUTHOR_DATE: date,
    GIT_COMMITTER_DATE: date,
  })
  return git(cwd, ['rev-parse', 'HEAD'])
}

export function initVault() {
  const vault = mkdtempSync(path.join(tmpdir(), 'wiki-red-'))
  git(vault, ['init', '-q'])
  return vault
}

export function makeOut() {
  return mkdtempSync(path.join(tmpdir(), 'wiki-red-out-'))
}

export function cleanup(...dirs) {
  for (const dir of dirs) if (dir) rmSync(dir, { force: true, recursive: true })
}

/**
 * vault/wiki/<rel>.md 를 쓴다.
 *
 * `id` 를 주면 frontmatter 에 `id: "<id>"`(따옴표 스칼라 — parse.mjs:199 분기)로 넣는다.
 * `id` 를 생략하면 **pre-id 문서**(생성 blob 에 id 부재)를 시뮬레이션한다. type/status/body 는 기본 유효.
 */
export function writeDoc(
  root,
  rel,
  { body = '## 정의\n\n본문 문단이다.\n', id, status = 'active', title, type = 'concept' } = {},
) {
  const full = path.join(root, 'vault', 'wiki', `${rel}.md`)
  mkdirSync(path.dirname(full), { recursive: true })
  const fm = ['---', `title: ${title ?? rel.split('/').at(-1)}`, `type: ${type}`, `status: ${status}`]
  if (id !== undefined) fm.push(`id: "${id}"`)
  fm.push('---', '', body)
  writeFileSync(full, fm.join('\n'))
  return full
}

export function readDoc(root, rel) {
  return readFileSync(path.join(root, 'vault', 'wiki', `${rel}.md`), 'utf8')
}
