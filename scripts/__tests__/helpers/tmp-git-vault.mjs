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

/**
 * `feed:` 커밋 원자 — subject + `Keywords`/`Importance` trailer + **author-date 통제**.
 *
 * feeds 바운디드 워크(P5 git-walk) RED 시딩용이다. 기존 `commit` 은 generic subject 만 지원하고
 * author-date 를 통제하지 못해(tick +60 자동) 워크순서=author-date 로 강제된다 — 그러면 "git
 * 워크순서 ≠ author-date → JS 재정렬 권위"(GW3) 를 시딩으로 재현할 수 없다. 이 원자는:
 *   · subject → `feed: <subject>` (feed.mjs FEED_SUBJECT_RE 매칭)
 *   · keywords/importance → 커밋 body 하단 trailer(`Keywords: …`·`Importance: …`, feed.mjs extractTrailers)
 *   · **date 를 GIT_AUTHOR_DATE/COMMITTER_DATE 로 그대로 주입**(피드 ts = author-date = `%aI`).
 *     date 미지정이면 결정적 `nextDate()` (commit 과 동일 tick 계열).
 *
 * 스테이징 전량을 커밋하므로, 호출 **전에** `writeDoc`/`git mv`/`git rm` 등으로 vault 문서를 건드려
 * 두면 그 문서를 가리키는 피드가 된다(feed.mjs 의 diff→docs 해석 계약). HEAD 해시를 돌려준다
 * (feedId = `hash.slice(0, 12)`).
 *
 * @param {string} cwd vault 루트
 * @param {{ date?: string, importance?: 'breaking'|'highlight'|'normal', keywords?: string[], subject: string }} spec
 */
export function feedCommit(cwd, { date, importance = 'normal', keywords = [], subject } = {}) {
  const when = date ?? nextDate()
  const trailers = []
  if (keywords.length > 0) trailers.push(`Keywords: ${keywords.join(', ')}`)
  trailers.push(`Importance: ${importance}`)
  const message = `feed: ${subject}\n\n본문 문단이다.\n\n${trailers.join('\n')}`
  git(cwd, ['add', '-A'])
  git(cwd, ['commit', '--no-gpg-sign', '-m', message], {
    GIT_AUTHOR_DATE: when,
    GIT_COMMITTER_DATE: when,
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
 * `<wikiRoot>/<rel>.md` 를 쓴다.
 *
 * `id` 를 주면 frontmatter 에 `id: "<id>"`(따옴표 스칼라 — parse.mjs:199 분기)로 넣는다.
 * `id` 를 생략하면 **pre-id 문서**(생성 blob 에 id 부재)를 시뮬레이션한다. type/status/body 는 기본 유효.
 *
 * `wikiRoot` 는 **리터럴 기본값**이다 — `parse-vault.mjs` 의 `WIKI_PREFIX` 를 import 하지 않는다
 * (자기참조 공허성 금지 · tdd §2.3 규범 A). 드리프트 감지는 트립와이어 스펙
 * `scripts/lib/__tests__/git.doc-predicates.test.mjs` 의 PR5 가 담당한다.
 *
 * **RED 단계 기본값은 이관 전 루트(`'vault/wiki'`)** 다. GREEN(P1 Task 8)이 `'wiki'` 로 뒤집는다 —
 * RED 커밋 시점에 뒤집으면 기존 스펙 다수가 함께 깨져 RED 신호가 흐려지기 때문이다(메인 세션 결정).
 * 그래서 **루트 이관을 다루는 신규 스펙은 새 루트든 옛 루트든 `wikiRoot` 를 항상 명시**한다 —
 * 기본값이 뒤집혀도 그 스펙들은 영향받지 않는다.
 */
export function writeDoc(
  root,
  rel,
  {
    body = '## 정의\n\n본문 문단이다.\n',
    id,
    status = 'active',
    title,
    type = 'concept',
    wikiRoot = 'vault/wiki',
  } = {},
) {
  const full = path.join(root, ...wikiRoot.split('/'), `${rel}.md`)
  mkdirSync(path.dirname(full), { recursive: true })
  const fm = [
    '---',
    `title: ${title ?? rel.split('/').at(-1)}`,
    `type: ${type}`,
    `status: ${status}`,
  ]
  if (id !== undefined) fm.push(`id: "${id}"`)
  fm.push('---', '', body)
  writeFileSync(full, fm.join('\n'))
  return full
}

/** `<wikiRoot>/<rel>.md` 를 읽는다. `wikiRoot` 계약은 `writeDoc` 과 동일(리터럴 기본값·RED 단계 옛 루트). */
export function readDoc(root, rel, { wikiRoot = 'vault/wiki' } = {}) {
  return readFileSync(path.join(root, ...wikiRoot.split('/'), `${rel}.md`), 'utf8')
}
