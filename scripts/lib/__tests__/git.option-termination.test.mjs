// @vitest-environment node
//
// 오염된 리비전의 git 옵션 승격 차단 — `getCommitDocStatuses` (OT0~OT4)
//
// 배경(자기완결): `getCommitDocStatuses` 는 `sha` 를 `git show` 의 **마지막 위치 인자**로 옵션 종료
//   없이 붙인다. 그 자리에 `--output=<경로>` 가 오면 git 이 그것을 **옵션으로 해석**해 임의 경로에
//   파일을 쓴다 — 본 세션 실측: 무방비 호출은 exit 0 으로 조용히 성공하고 표적 파일이 실제로 생긴다.
//   `--end-of-options` 를 붙이면 `fatal: option '--output=…' must come before non-option arguments`
//   이고 파일이 생기지 않는다.
//
//   인자를 배열로 넘기므로 셸 인젝션은 원천 차단돼 있다. 남은 위험은 **git 자신의 옵션 파서**뿐이고,
//   그 문을 닫는 것이 `--end-of-options` 다. 같은 리포의 다른 rev 조회 3곳은 이미 이 토큰을 쓴다 —
//   순수 신설이 아니라 **비대칭 해소**다.
//
// 결과 계약(GREEN 이 만족해야 할 것):
//   ① 낸 argv 에서 **모든 옵션이 `--end-of-options` 앞**에 있고, 그 **바로 뒤가 `sha`** 다.
//   ② `sha` 자리에 옵션 모양 문자열이 와도 **파일이 생기지 않는다**(거부 방식은 자유).
//   ③ 정상 sha 의 결과는 종전과 동일하다.
//
// RED 사유(케이스별 · 본 세션 실측):
//   OT0 — 🟢 seam 선단언. 모듈·export 부재가 collection error 로 접혀 "테스트 0건 = PASS" 로
//         오보고되는 것을 막는다.
//   OT1 — 🔴RED. 오늘 argv 는
//         `['-c','core.quotepath=false','show','--find-renames','--name-status','--format=',sha]`
//         로 `--end-of-options` 가 **아예 없다**.
//   OT2 — 🔴RED. 부재 단언(`--` 미사용)의 **존재 앵커**(`--end-of-options` 실재)가 오늘 red 다.
//         앵커 없이 부재만 물면 "둘 다 없는" 오늘 상태가 공허하게 green 이 된다.
//   OT3 — 🔴RED. 오늘 `sha = '--output=<tmp 표적>'` 호출은 throw 없이 exit 0 이고 **표적 파일이
//         실제로 생성**된다(실측).
//   OT4 — 🟢앵커. 정상 sha 판정은 오늘도 옳다. 부재 단언(OT3)이 "이 함수가 원래 아무 일도 안 한다"
//         로 공허해지는 것을 막는다.
//
// ★ **주석 앵커 규약**(GREEN 이 프로덕션 주석을 쓸 때): `--end-of-options` 는 `gitcli(7)` 과
//   `revision.c setup_revisions()` 로 근거를 단다. git-show(1)·git-rev-list(1) man page 는 이 옵션을
//   **문서화하지 않으므로** 그 man page 인용은 거짓 인용이다. `gitcli.adoc` 축자:
//   _"Because `--` disambiguates revisions and paths in some commands, it cannot be used for those
//   commands to separate options and revisions. You can use `--end-of-options` for this"_.
//
// ★ **`--` 로 대체하면 안 된다.** 값이 pathspec 이 되어 exit 0 + 빈 결과가 되고, 그 빈 결과가
//   "이 커밋은 문서를 건드리지 않았다" 로 오독된다 — 조용한 오답이라 현재 결함보다 나쁠 수 있다.
//
// ★ **파괴적 관측은 `mkdtempSync` 표적에만.** 리포 안 경로를 표적으로 쓰면 워킹트리가 더러워지고
//   다음 케이스가 그 잔재를 본다. 계약은 파일 **크기**가 아니라 **파일이 생기는가**다 — 크기는 argv
//   모양에 따라 달라지므로 단언하지 않는다.
//
// 규범 A: argv 토큰·경로·기대 판정은 전부 **리터럴**이다. 규범 B/U: 부재 단언 앞에 존재 앵커를 둔다.
// 규범 D: 시딩 헬퍼에는 `expect` 를 두지 않는다.
import { existsSync, mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'

import { cleanup, commit, initVault, writeDoc } from '../../__tests__/helpers/tmp-git-vault.mjs'

const gitModule = await import(new URL('../git.mjs', import.meta.url).href).catch((error) => ({
  __loadError: error instanceof Error ? error.message : String(error),
}))

/** 로드 실패·export 부재를 **명시적 [RED]** 로 바꾼다 — undefined 호출의 TypeError 로 위장되지 않게. */
function seam(name) {
  if (gitModule.__loadError !== undefined) {
    throw new Error(`[RED] scripts/lib/git.mjs 로드 실패: ${gitModule.__loadError}`)
  }
  if (typeof gitModule[name] !== 'function') {
    throw new Error(`[RED] scripts/lib/git.mjs 에 ${name} export 가 없다`)
  }
  return gitModule[name]
}

const getCommitDocStatuses = (...args) => seam('getCommitDocStatuses')(...args)
const makeGitRunner = (...args) => seam('makeGitRunner')(...args)
const anyMarkdown = (...args) => seam('anyMarkdown')(...args)

/** 규범 C10 — 각 케이스가 seam 존재를 먼저 단언한다. */
function expectSeamPresent() {
  expect(gitModule.__loadError, 'scripts/lib/git.mjs 로드').toBeUndefined()
  expect(typeof gitModule.getCommitDocStatuses, 'getCommitDocStatuses export').toBe('function')
  expect(typeof gitModule.makeGitRunner, 'makeGitRunner export').toBe('function')
  expect(typeof gitModule.anyMarkdown, 'anyMarkdown export').toBe('function')
}

const ID_A = '0192a000-0000-7000-8000-0000000000aa'
const ID_B = '0192b000-0000-7000-8000-0000000000bb'
const REL_PUBLIC = 'company/공개'
const REL_CONCEPT = 'concept/개념'
const CONCEPT_PATH = 'wiki/concept/개념.md'
/** 스텁 argv 관측용 리비전. 스텁은 git 을 부르지 않으므로 실재할 필요가 없다. */
const STUB_SHA = 'abc123'

const tmps = []
afterAll(() => cleanup(...tmps))

/**
 * 문서 2건 · 커밋 2건짜리 tmp vault. 둘째 커밋이 문서 1건을 추가한다.
 *
 * @returns {{ sha: string, vault: string }} sha 는 둘째 커밋(문서 1건 추가)
 */
function seedVault() {
  const vault = initVault()
  tmps.push(vault)
  writeDoc(vault, REL_PUBLIC, { id: ID_A })
  commit(vault, 'chore: 문서 1건 생성')
  writeDoc(vault, REL_CONCEPT, { id: ID_B })
  return { sha: commit(vault, 'chore: 문서 1건 추가'), vault }
}

/** argv 를 값으로 만드는 스텁 러너. git 을 부르지 않는다. */
function collectArgv(sha) {
  const calls = []
  getCommitDocStatuses(
    (args) => {
      calls.push(args)
      return ''
    },
    sha,
    anyMarkdown,
  )
  return calls
}

describe('seam 선단언 (OT0 · 🟢)', () => {
  it('OT0: `git.mjs` 가 로드되고 관측 대상 export 가 함수다 (🟢)', () => {
    // 이 못이 없으면 모듈·export 부재가 collection error 로 접혀 **테스트 0건이 PASS 로 오보고**된다.
    expectSeamPresent()
  })
})

describe('argv 는 옵션 종료 뒤에 리비전을 둔다 (OT1 · 🔴RED)', () => {
  it('OT1: `--end-of-options` 가 정확히 1회이고 **바로 뒤**가 sha 다 (🔴RED)', () => {
    expectSeamPresent()
    const calls = collectArgv(STUB_SHA)
    const argv = calls[0]

    // 앵커: 러너가 **한 번** 호출됐고 그것이 우리가 아는 그 `git show` 다(스텁이 헛돌지 않았다).
    //   git 호출 **횟수**는 비용 관측 대상이므로 늘리지 않는다 — 토큰 추가는 되고 호출 추가는 안 된다.
    expect(calls, '러너 호출 argv 목록').toHaveLength(1)
    expect(
      argv
        .filter((token) => ['--find-renames', '--name-status', 'show'].includes(token))
        .toSorted(),
      '기존 argv 계약 앵커',
    ).toEqual(['--find-renames', '--name-status', 'show'])

    // ★ **순서가 곧 계약이다.** 존재만 물면 `['show', sha, '--end-of-options']` 같은 무의미 배치가
    //   통과한다 — 그 배치에서는 sha 가 여전히 옵션으로 해석된다.
    expect(
      argv.filter((token) => token === '--end-of-options'),
      '옵션 종료 토큰 출현',
    ).toEqual(['--end-of-options'])

    const index = argv.indexOf('--end-of-options')
    expect(argv[index + 1], '옵션 종료 바로 뒤 토큰').toBe(STUB_SHA)
    expect(argv.slice(0, index), '옵션 종료 앞 구간').not.toContain(STUB_SHA)
    expect(
      argv.filter((token) => token === STUB_SHA),
      'sha 출현',
    ).toEqual([STUB_SHA])
  })
})

describe('`--` 는 대체재가 아니다 (OT2 · 🔴RED)', () => {
  it('OT2: 옵션 종료는 `--end-of-options` 이고 pathspec 구분자 `--` 를 쓰지 않는다 (🔴RED)', () => {
    expectSeamPresent()
    const argv = collectArgv(STUB_SHA)[0]

    // 존재 앵커(규범 B/U): 부재 단언 앞에 양성 대조를 둔다. 이 앵커가 없으면 "`--` 가 없다" 는
    //   **아무 방어도 없는 오늘** 상태에서 공허하게 green 이다.
    expect(argv, '옵션 종료 토큰 존재 앵커').toContain('--end-of-options')

    // `--` 로 바꾸면 값이 pathspec 이 되어 exit 0 + 빈 결과가 되고, 그것이 "변경 없음" 으로 오독된다.
    expect(argv, 'pathspec 구분자 미사용').not.toContain('--')
  })
})

describe('옵션 모양 리비전은 파일을 쓰지 못한다 (OT3 · 🔴RED)', () => {
  it('OT3: `sha` 자리에 `--output=<표적>` 이 와도 표적 파일이 생기지 않는다 (🔴RED)', () => {
    expectSeamPresent()
    const { sha, vault } = seedVault()
    const targetDir = mkdtempSync(path.join(tmpdir(), 'wiki-ot3-'))
    tmps.push(targetDir)
    const target = path.join(targetDir, 'PWNED')
    const runGit = makeGitRunner(vault)

    // 앵커: **같은 vault·같은 함수·같은 러너**가 정상 sha 로는 실제 판정을 낸다. 이게 없으면
    //   "이 함수가 원래 아무 일도 안 한다" 로도 아래 부재 단언이 통과한다.
    expect(getCommitDocStatuses(runGit, sha, anyMarkdown), '정상 sha 판정 앵커').toEqual([
      { path: CONCEPT_PATH, status: 'A' },
    ])
    expect(existsSync(target), '표적 파일 사전 부재').toBe(false)

    // 거부 방식은 자유다 — throw 하든 빈 배열이든 무관하다. **파일 부재가 계약**이다.
    try {
      getCommitDocStatuses(runGit, `--output=${target}`, anyMarkdown)
    } catch {
      // 거부(throw)는 정당한 결과다. 판정은 아래 파일 부재로 한다.
    }

    // 크기는 argv 모양에 따라 달라지므로 단언하지 않는다 — **생겼는가**만 묻는다.
    expect(existsSync(target), '표적 파일 생성 여부').toBe(false)
    expect(readdirSync(targetDir), '표적 디렉토리 잔여물').toEqual([])
  })
})

describe('정상 sha 의 판정은 종전과 같다 (OT4 · 🟢앵커)', () => {
  it('OT4: 문서 1건을 추가한 커밋은 그 경로를 `A` 로 낸다 (🟢앵커)', () => {
    expectSeamPresent()
    const { sha, vault } = seedVault()

    expect(getCommitDocStatuses(makeGitRunner(vault), sha, anyMarkdown), '커밋 문서 상태').toEqual([
      { path: CONCEPT_PATH, status: 'A' },
    ])
  })
})
