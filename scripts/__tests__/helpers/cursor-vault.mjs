// v3 P2 · Task 5 — 커서 페이징 RED 공용 프리미티브. **`expect` 금지**(규범 D).
//
// DAMP 경계: 이 파일은 **사실만** 돌려준다 — "6건이어야 한다"·"중복이 0이어야 한다"·"exit 2 여야
//   한다" 는 전부 스펙 본문(`feeds.cursor-paging.test.mjs` WA·JS·QX · `cursor.cli-contract.test.mjs`
//   CR·CQ)이 **리터럴로** 단언한다. 여기서 판정하면 그 리터럴이 헬퍼로 숨어 규범 A 가 무너진다.
//   (vitest 기본 include 는 `*.test.mjs` 만 잡으므로 helpers/*.mjs 는 테스트로 수집되지 않는다 — 의도.)
//
// ★ 왜 CLI(프로세스층)를 구동하는가 — `feeds()` **모듈 API** 가 아니라:
//   ① `--after`·`--count`·`--ignore` 의 계약은 `prd.md:498-503` 이 **CLI 인자로** 못박은 것이고,
//      모듈 API 의 window 키(특히 억제 전달)는 tdd 가 확정하지 않았다. 여기서 window 키를 발명하면
//      GREEN 이 다른 이름을 고르는 순간 RED 가 "미구현" 이 아니라 "이름 불일치" 로 실패한다.
//   ② stdout 은 규범 Q 의 **층 ①(wire 실응답)** 그 자체다 — 페이지 계약을 관측할 가장 얇은 자리다.
//
// ★ `runFeedsCli` 는 판정하지 않는다(raw spawn 결과). `readFeedPage` 만 **throw** 로 진단을 남긴다 —
//   exit≠0/파싱 불가를 조용한 `null` 로 접으면 "0건 = 끝" 과 구분되지 않는다(D13·D45 가 막는 형태).
import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { commit, feedCommit, initVault, writeDoc } from './tmp-git-vault.mjs'

const SCRIPTS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const FEEDS_CLI = path.join(SCRIPTS_DIR, 'feeds.mjs')

/** 억제 목록 파일명 — **리터럴**이다(`lib/ignore.mjs` 의 `IGNORE_FEEDS_FILE` 을 import 하지 않는다). */
export const IGNORE_FILE = 'ignore-feeds.json'
/** 억제 엔트리의 감사 메타 — 리터럴. */
const IGNORE_WHEN = '2026-07-28T00:00:00Z'

const DOC_ID = '0192a000-0000-7000-8000-0000000000aa'
const DOC_REL = 'company/삼성전자'

/**
 * 9p 소유자 불일치 방어 + 결정적 빌드 — 자식 env 로만 건다(프로세스 전역 변이 금지).
 * `tracked-scan.mjs` 의 `gitEnv` 와 같은 조치다.
 */
function childEnv(extra = {}) {
  return {
    ...process.env,
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'safe.directory',
    GIT_CONFIG_VALUE_0: '*',
    SOURCE_DATE_EPOCH: '1700000000',
    ...extra,
  }
}

/**
 * `feed:` 커밋 N 건을 가진 tmp git vault 를 만든다.
 *
 * 각 feed 커밋 직전에 문서 본문을 갱신하므로 그 커밋은 **살아 있는 문서 1건을 가리킨다**
 * (`judgeFeedSurvival` 이 생존 판정 — N2). 문서는 처음부터 frontmatter `id` 를 갖는다(post-D1
 * 고속경로) — pre-D1 폴백 경로를 타면 시딩 비용이 커지고 이 파일의 주제가 흐려진다.
 *
 * @param {{ feedCount: number, suppressLatest?: number }} spec
 * @returns {{ feedIds: string[], ignorePath: string, suppressed: string[], vault: string }}
 *   `feedIds` 는 **최신순**(0 번이 가장 최근 커밋)이며 **테스트가 시딩으로 얻은 축**이다 —
 *   구현이 계산한 `nextCursor`·`items[].id` 와 **독립**이라 대조축으로 쓸 수 있다(규범 A).
 */
export function seedFeedVault({ feedCount, suppressLatest = 0 }) {
  const vault = initVault()
  writeDoc(vault, DOC_REL, { body: '## 정의\n\n초판.\n', id: DOC_ID, title: '삼성전자', type: 'company' }) // prettier-ignore
  commit(vault, 'chore: 문서 1건 생성')

  const oldestFirst = []
  for (let index = 0; index < feedCount; index += 1) {
    writeDoc(vault, DOC_REL, { body: `## 정의\n\n갱신 ${index}.\n`, id: DOC_ID, title: '삼성전자', type: 'company' }) // prettier-ignore
    const sha = feedCommit(vault, { subject: `소식 ${index}` })
    oldestFirst.push(sha.slice(0, 12))
  }
  const feedIds = [...oldestFirst].reverse()

  const suppressed = feedIds.slice(0, suppressLatest)
  const ignorePath = path.join(vault, IGNORE_FILE)
  writeFileSync(
    ignorePath,
    JSON.stringify(suppressed.map((id) => ({ id, when: IGNORE_WHEN }))),
    'utf8',
  )

  return { feedIds, ignorePath, suppressed, vault }
}

/**
 * `runFeedsCli` 의 기본 spawn 상한(ms) — 호출부가 `timeoutMs` 를 안 주면 이 값이 적용된다(상한 없는
 * 호출을 없앤다). `helpers/runtime-load.mjs` 의 자식 spawn 기본 상한(`timeoutMs = 120_000`)과 같은
 * 값을 골라, 이 리포에 "기본 spawn 상한"의 서로 다른 매직넘버가 여럿 생기지 않게 한다.
 */
const DEFAULT_SPAWN_TIMEOUT_MS = 120_000

/**
 * `feeds.mjs` 를 자식 프로세스로 띄운다 — **판정하지 않는다**(raw spawnSync 결과 그대로).
 *
 * `after`·`count` 는 **등호 결합**으로 넘긴다. 공백 분리는 `util.parseArgs` 가 값이 `-` 로 시작하는
 * 순간 `ERR_PARSE_ARGS_INVALID_OPTION_VALUE` 로 **먼저 throw** 해 우리 검증층에 도달하지 않는다
 * (tdd §2.5-③ 실측). 층을 일부러 가르는 케이스는 `extraArgs` 로 직접 형태를 준다.
 *
 * @param {string} vault
 * @param {{ after?: string, count?: number|string, env?: string, extraArgs?: string[],
 *           ignore?: string, out?: string, spawnEnv?: object, timeoutMs?: number }} [options]
 */
export function runFeedsCli(vault, options = {}) {
  const { after, count, env = 'dev', extraArgs = [], ignore, out, spawnEnv, timeoutMs } = options
  const args = ['--vault', vault, '--env', env]
  if (count !== undefined) args.push(`--count=${count}`)
  if (after !== undefined) args.push(`--after=${after}`)
  if (ignore !== undefined) args.push('--ignore', ignore)
  if (out !== undefined) args.push('--out', out)
  args.push(...extraArgs)

  return spawnSync(process.execPath, [FEEDS_CLI, ...args], {
    encoding: 'utf8',
    env: spawnEnv ?? childEnv(),
    maxBuffer: 64 * 1024 * 1024,
    timeout: timeoutMs ?? DEFAULT_SPAWN_TIMEOUT_MS,
  })
}

/**
 * 진단용 `options` 사본 — `spawnEnv` 가 있으면 **키는 남기고 값만 마스킹**한다. 무엇이 주입됐는지는
 * 진단에 필요하지만(어떤 env 변수 이름을 넘겼는가), 값 자체는 호출부가 `process.env` 파생을 통째로
 * 넘기는 관례라 CI 로그에 자격증명이 그대로 찍힐 수 있다(자격증명 서브타입).
 */
function redactForDiagnostics(options) {
  if (options.spawnEnv === undefined) return options
  const maskedEnv = Object.fromEntries(Object.keys(options.spawnEnv).map((key) => [key, '***']))
  return { ...options, spawnEnv: maskedEnv }
}

/**
 * `runFeedsCli` 를 돌려 stdout 을 페이지 객체로 판다. **실패는 throw** 다(사실 보고 · 규범 D).
 *
 * @returns {{ items: object[], nextCursor: unknown }} 그 밖의 봉투 키도 그대로 들어 있다
 */
export function readFeedPage(vault, options = {}) {
  const result = runFeedsCli(vault, options)
  if (result.status !== 0) {
    throw new Error(
      `[RED] feeds CLI exit=${result.status} args=${JSON.stringify(redactForDiagnostics(options))}\n${(result.stderr ?? '').trim()}`,
    )
  }
  try {
    return JSON.parse(result.stdout)
  } catch (error) {
    throw new Error(
      `[RED] feeds stdout 이 JSON 이 아니다 (${error instanceof Error ? error.message : String(error)}): ${String(result.stdout).slice(0, 200)}`,
    )
  }
}

/**
 * `nextCursor === null` 이 될 때까지 페이지를 넘긴다 — **판정하지 않는다**.
 *
 * `maxPages` 를 넘기면 그 **사실만** `exhausted: false` 로 돌려준다(throw·expect 금지). 무한 루프
 * 방지는 호출부가 `exhausted` 를 단언해서 한다.
 *
 * @param {(after: string|undefined) => { items: object[], nextCursor: unknown }} runPage
 * @param {{ maxPages?: number }} [options]
 * @returns {{ cursors: unknown[], exhausted: boolean, pages: string[][] }} `pages[i]` = 그 페이지 id 배열
 */
export function collectPages(runPage, { maxPages = 20 } = {}) {
  const cursors = []
  const pages = []
  let after
  let exhausted = false

  for (let index = 0; index < maxPages; index += 1) {
    const page = runPage(after)
    pages.push((page.items ?? []).map((item) => item.id))
    const next = page.nextCursor ?? null
    cursors.push(next)
    if (next === null) {
      exhausted = true
      break
    }
    after = next
  }

  return { cursors, exhausted, pages }
}

/**
 * PATH 앞에 끼울 **느린 `git`** 래퍼 디렉토리를 만든다 — WA11(D23 spawn 타임아웃)용.
 *
 * ★ 왜 함수 러너 주입(`makeSlowGitRunner`)이 아닌가: D23 타임아웃이 걸리는 자리는
 *   `makeGitRunner`(`lib/git.mjs`)의 **spawn 옵션**이다. 러너를 주입하면 그 spawn 을 **통째로
 *   우회**해 타임아웃이 있든 없든 같은 결과가 나온다 — 즉 케이스가 공허해진다. 그래서 실제 spawn 이
 *   느려지도록 PATH 층에서 지연시킨다. `git-count-shim.mjs` 와 같은 기법(자기 재귀 회피 포함)이다.
 *
 * **벽시계를 게이트로 걸지 않는다**(규범 E) — 지연은 "느리다" 를 재려는 것이 아니라 타임아웃 동작을
 *   **결정적으로 발동**시키는 장치다. 판정은 호출부가 「자식이 스스로 끝났는가」로 한다.
 *
 * @param {number} delaySeconds
 * @returns {{ binDir: string, env: (base?: object) => object, root: string }}
 */
export function makeSlowGitShim(delaySeconds) {
  const root = mkdtempSync(path.join(tmpdir(), 'wiki-slowgit-'))
  const binDir = path.join(root, 'bin')
  mkdirSync(binDir, { recursive: true })

  const wrapper = [
    '#!/bin/sh',
    `SHIM=${JSON.stringify(binDir)}`,
    'CLEAN_PATH=$(printf %s "$PATH" | tr ":" "\\n" | grep -v -x -F "$SHIM" | paste -sd: -)',
    'REAL=$(PATH="$CLEAN_PATH" command -v git)',
    `sleep ${Number(delaySeconds)}`,
    'exec "$REAL" "$@"',
    '',
  ].join('\n')

  const gitPath = path.join(binDir, 'git')
  writeFileSync(gitPath, wrapper)
  chmodSync(gitPath, 0o755)

  return {
    binDir,
    env: (base = childEnv()) => ({ ...base, PATH: `${binDir}${path.delimiter}${base.PATH}` }),
    root,
  }
}

/**
 * `execFileSync` 극성을 그대로 가진 **실 git 러너** — 비0 종료는 throw 다(`makeGitRunner` 와 같은 형태).
 *
 * 프로덕션 `makeGitRunner` 를 import 하지 않는다: 주입 seam 의 계약(“무엇을 넘기면 무엇이 오는가”)을
 * 프로덕션에서 유도하면 구현이 어떤 형태를 쓰든 통과한다(규범 A).
 */
export function makeRealGitRunner(cwd) {
  return (args) =>
    execFileSync('git', args, { cwd, encoding: 'utf8', env: childEnv(), stdio: ['ignore', 'pipe', 'pipe'] }) // prettier-ignore
}

/** 커밋 2건짜리 최소 tmp 리포(vault 아님). CR9 의 refname 그림자 실험대다. */
export function initTinyRepo() {
  const repo = mkdtempSync(path.join(tmpdir(), 'wiki-cursor-repo-'))
  const run = (args) =>
    execFileSync('git', args, {
      cwd: repo,
      encoding: 'utf8',
      env: childEnv({
        GIT_AUTHOR_EMAIL: 'bot@sas.wiki',
        GIT_AUTHOR_NAME: 'SAS Wiki Bot',
        GIT_COMMITTER_EMAIL: 'bot@sas.wiki',
        GIT_COMMITTER_NAME: 'SAS Wiki Bot',
      }),
    }).trim()

  run(['init', '-q', '.'])
  run(['commit', '-q', '--allow-empty', '--no-gpg-sign', '-m', 'c1'])
  const first = run(['rev-parse', 'HEAD'])
  run(['commit', '-q', '--allow-empty', '--no-gpg-sign', '-m', 'c2'])
  const second = run(['rev-parse', 'HEAD'])

  return { first, git: run, repo, second }
}
