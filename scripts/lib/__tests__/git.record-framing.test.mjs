// @vitest-environment node
//
// 커밋 레코드 프레이밍 — 저자가 쓰는 필드가 레코드 경계를 흔들 수 없어야 한다 (RF0~RF8)
//
// 배경(자기완결): 오늘 두 개의 **별개** 파서가 커밋 body(`%b` — 저자가 자유롭게 쓰는 텍스트)를
//   마지막 필드로 두고 제어문자로 레코드를 가른다.
//     · `git.mjs collectGitLog`           — 필드 `\x1f`(US) · 레코드 `\x1e`(RS)
//     · `git-walk.mjs parseCommitRecords` — 필드 `\t`(TAB)  · 레코드 `\x1e`(RS)
//   body 에 같은 바이트를 심으면 레코드 경계가 밀려 `hash` 자리에 **저자가 고른 문자열**이 들어간다.
//   그 값은 이후 `git show <hash>` 의 위치 인자로 흘러가고, `sourceCommit`·피드 item 의 제목/본문·
//   위반 메시지로도 퍼진다. 즉 프레이밍은 표현 문제가 아니라 **신뢰 경계**다.
//
// 결과 계약(GREEN 이 만족해야 할 것 — 구현 방법은 강요하지 않는다):
//   ① 두 호출 경로(`git log` · `git rev-list --format`)가 같은 프레이밍을 쓴다.
//   ② body 에 어떤 제어문자를 심어도 레코드 수가 실제 커밋 수와 같고 모든 hash 가 40-hex 다.
//   ③ 프레이밍이 깨지면 **조용한 오프셋이 아니라 throw** 다.
//   ④ 정상 입력(빈 히스토리 포함)에서는 절대 throw 하지 않는다.
//   ⑤ body 원문(탭·제어문자 포함)이 보존된다.
//
// RED 사유(케이스별 · 본 세션 실측):
//   RF0 — 🟢 seam 선단언. 모듈·export 부재가 collection error 로 접혀 "테스트 0건 = PASS" 로
//         오보고되는 것을 막는다(이 리포에서 실제로 일어난 형태다).
//   RF1 — 🔴RED(5/5 arm). 오늘 `collectGitLog` 은 3커밋 vault 를 **4레코드**로 늘리고 hash 자리에
//         `--output=PWNED`·`위조레코드` 같은 문자열을 만든다(실측). `\x1f` 만 든 payload 는 레코드
//         수를 흔들지 못하지만 **body 를 절단**하므로 그 arm 도 red 다.
//   RF2 — 🔴RED(4/5 arm). git-walk wire 의 구분자는 `\t`·`\x1e` 라 **`\x1f` 단독 payload 는 이 경로에
//         오늘도 무해**하다 — 그 arm 만 오늘 green 이고, 통합 이후에도 green 이어야 하는 pin 이다.
//         나머지 4 arm 은 body 가 `\x1e` 에서 절단된다. 한 payload 표를 두 경로에 함께 먹이는 이유가
//         이것이다: **한쪽 파서만 고친 구현**은 반대쪽 arm 에서 red 로 남는다.
//   RF3 — 🔴RED. 토큰 수가 어긋난 stdout 에서 오늘은 throw 대신 조용히 필드가 undefined 가 된다.
//   RF4 — 🔴RED. hash 자리가 40-hex 가 아니어도 오늘은 통과한다.
//   RF5 — 🟢오탐 가드. 빈 stdout 은 `''.split('\x00') === ['']`(토큰 1개)이고 잉여 토큰이 `'\n'` 이
//         **아니다**. "후행 `'\n'` 을 떼어낸 뒤 나머지를 4로 나눈다" 식 구현은 여기서 throw 한다.
//   RF6 — 🟢pin. 커밋 0건 리포는 `git log` 가 fatal 이라 파서에 닿지 않고 catch 가 `[]` 를 낸다.
//   RF7 — 🟢회귀 pin. 오늘 git-walk 은 body 를 `\t` 로 쪼갰다가 join 으로 복원한다. 프레이밍을
//         바꾸면 그 복원 코드가 사라지므로 탭 보존을 별도로 못박는다.
//   RF8 — 🟢대조군. 정상 vault 에서 두 경로의 해시가 같은 커밋 집합을 가리킨다.
//
// ★ **arity 함정**(본 세션 실측 · git 2.51.1). NUL 프레이밍 `%H%x00%aI%x00%s%x00%b%x00` 의 평평한
//   split 토큰 수는 `4n` 이 아니라 **`4n+1`** 이고 잉여 토큰은 `"\n"` 이다 — `git log` 와
//   `git rev-list --format` 양쪽 동일(1커밋 5토큰 · 3커밋 13토큰). `% 4 !== 0` 을 그대로 걸면 정상
//   입력에서 100% throw 한다. RF5 가 그 반대편(빈 입력) 오탐을 문다.
//   `%x00` 이 정식 placeholder 라는 근거는 git `Documentation/pretty-formats.adoc` 축자:
//   _"`%x00`:: `%x` followed by two hexadecimal digits is replaced with a byte with the
//   hexadecimal digits' value"_.
//
// ★ **제어문자는 반드시 이스케이프 표기**(`\x1f`·`\x1e`)로 쓴다. 원시 바이트를 소스에 박으면
//   편집기·포맷터·복붙에서 조용히 소실되어 적대적 입력이 평범한 문자열로 둔갑한다(본 세션에서
//   실제로 겪었다).
//
// 규범 A: payload·기대 subject·기대 body 는 전부 **리터럴**이다(프로덕션 상수에서 유도하지 않는다).
//   실 커밋 해시만은 리터럴일 수 없으므로 **시딩 헬퍼가 `git rev-parse` 로 낸 값**을 쓴다 — 검증
//   대상 파서와 독립한 경로다.
// 규범 N: 개수 단독 단언 금지 — 집합을 리터럴 배열로 못박는다.
// 규범 D: 시딩 헬퍼에는 `expect` 를 두지 않는다(값만 돌려준다).
import { existsSync } from 'node:fs'
import path from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'

import { cleanup, commit, git, initVault, writeDoc } from '../../__tests__/helpers/tmp-git-vault.mjs' // prettier-ignore

const gitModule = await import(new URL('../git.mjs', import.meta.url).href).catch((error) => ({
  __loadError: error instanceof Error ? error.message : String(error),
}))
const walkModule = await import(new URL('../git-walk.mjs', import.meta.url).href).catch(
  (error) => ({ __loadError: error instanceof Error ? error.message : String(error) }),
)

/** 로드 실패·export 부재를 **명시적 [RED]** 로 바꾼다 — undefined 호출의 TypeError 로 위장되지 않게. */
function seam(module, name, label) {
  if (module.__loadError !== undefined) {
    throw new Error(`[RED] ${label} 로드 실패: ${module.__loadError}`)
  }
  if (typeof module[name] !== 'function')
    throw new Error(`[RED] ${label} 에 ${name} export 가 없다`)
  return module[name]
}

const collectGitLog = (...args) => seam(gitModule, 'collectGitLog', 'scripts/lib/git.mjs')(...args)
const makeGitRunner = (...args) => seam(gitModule, 'makeGitRunner', 'scripts/lib/git.mjs')(...args)
const collectFeedItems = (...args) =>
  seam(walkModule, 'collectFeedItems', 'scripts/lib/git-walk.mjs')(...args)

/** 규범 C10 — 각 케이스가 seam 존재를 먼저 단언한다. */
function expectSeamPresent() {
  expect(gitModule.__loadError, 'scripts/lib/git.mjs 로드').toBeUndefined()
  expect(walkModule.__loadError, 'scripts/lib/git-walk.mjs 로드').toBeUndefined()
  expect(typeof gitModule.collectGitLog, 'collectGitLog export').toBe('function')
  expect(typeof gitModule.makeGitRunner, 'makeGitRunner export').toBe('function')
  expect(typeof walkModule.collectFeedItems, 'collectFeedItems export').toBe('function')
}

const ID_A = '0192a000-0000-7000-8000-0000000000aa'
const ID_B = '0192b000-0000-7000-8000-0000000000bb'
const REL_PUBLIC = 'company/공개'
const REL_CONCEPT = 'concept/개념'

/** `git log` 는 최신 커밋을 먼저 낸다 — 이 배열의 순서가 곧 기대 순서다. */
const LOG_SUBJECTS = ['feed: 셋째 소식', 'feed: 둘째 소식', 'feed: 첫 소식']
const FEED_TITLES = ['셋째 소식', '둘째 소식', '첫 소식']
/** payload 를 심은 커밋. `git log` 의 subject 와 피드 item 의 title 은 `feed: ` 접두사만큼 다르다. */
const HOSTILE_SUBJECT = 'feed: 둘째 소식'
const HOSTILE_TITLE = '둘째 소식'
/** 주입이 성공하면 파서가 만들어낼 가짜 값. 이것이 결과에 보이면 경계가 밀린 것이다. */
const FORGED_TITLE = '위조 제목'

const BENIGN_BODY = '둘째 본문이다.'
const TAB_TITLE = '탭 소식'
const TAB_BODY = '항목\t값\n둘째\t값2'

/**
 * 적대적 payload 표 — 각 문자열은 커밋 **body** 에 그대로 심는다.
 *
 * 한 payload 가 두 wire(US/RS · TAB/RS)를 동시에 문다. `git commit` 은 NUL 만 거부하고
 * US(`\x1f`)·RS(`\x1e`)·TAB 은 커밋 메시지에 그대로 담는다(본 세션 실측).
 */
const HOSTILE_BODIES = [
  ['US 단독', '본문\x1f위조필드'],
  ['RS 단독', '본문\x1e위조레코드'],
  [
    'TAB+RS (git-walk wire)',
    '본문\x1efakehash-injected\t2020-01-01T00:00:00+00:00\t위조 제목\t위조 본문',
  ],
  [
    'US+RS 조합 + 옵션 페이로드',
    '본문\x1f\x1e--output=PWNED\x1f2020-01-01T00:00:00+00:00\x1f위조 제목\x1f위조 본문',
  ],
  [
    '40-hex 위장 해시',
    '본문\x1e0000000000000000000000000000000000000000\t2020-01-01T00:00:00+00:00\t위조 제목\t위조 본문',
  ],
]

const tmps = []
afterAll(() => cleanup(...tmps))

/**
 * `feed:` 커밋 3건짜리 tmp vault. **둘째 커밋의 body 에만** `body` 를 심는다.
 *
 * 정상 커밋을 앞뒤로 두는 이유: 경계가 밀리면 주입 레코드가 **정상 레코드 사이에** 끼어들어,
 * "레코드가 늘었다" 와 "정상 레코드가 깨졌다" 를 함께 관측할 수 있다.
 *
 * @returns {{ shas: string[], vault: string }} shas 는 오래된 순(첫·둘째·셋째)
 */
function seedVault(body) {
  const vault = initVault()
  tmps.push(vault)
  writeDoc(vault, REL_PUBLIC, { id: ID_A })
  const first = commit(vault, 'feed: 첫 소식\n\n첫 본문이다.\n\nImportance: normal')
  writeDoc(vault, REL_CONCEPT, { id: ID_B })
  const second = commit(vault, `feed: 둘째 소식\n\n${body}\n\nImportance: normal`)
  writeDoc(vault, REL_PUBLIC, { body: '## 정의\n\n갱신.\n', id: ID_A })
  const third = commit(vault, 'feed: 셋째 소식\n\n셋째 본문이다.\n\nImportance: normal')
  return { shas: [first, second, third], vault }
}

describe('seam 선단언 (RF0 · 🟢)', () => {
  it('RF0: `git.mjs`·`git-walk.mjs` 가 로드되고 관측 대상 export 가 함수다 (🟢)', () => {
    // 이 못이 없으면 모듈·export 부재가 collection error 로 접혀 **테스트 0건이 PASS 로 오보고**된다.
    expectSeamPresent()
  })
})

describe('collectGitLog — 적대적 body 가 레코드 경계를 흔들지 못한다 (RF1 · 🔴RED)', () => {
  it.each(HOSTILE_BODIES)(
    'RF1: %s payload 를 심어도 3레코드 · 40-hex hash · body 원문 보존이다 (🔴RED)',
    (_label, payload) => {
      expectSeamPresent()
      const { shas, vault } = seedVault(payload)

      const records = collectGitLog(makeGitRunner(vault))
      const subjects = records.map((record) => record.subject)

      // ① 앵커: 정상 커밋 3건의 subject 가 실제로 나온다 — 픽스처가 비어서 통과하는 것을 배제한다.
      expect(
        subjects.filter((subject) => LOG_SUBJECTS.includes(subject)),
        '정상 커밋 subject 앵커',
      ).toEqual(LOG_SUBJECTS)

      // ② 레코드 수 = 실제 커밋 수 · ④ 위조 subject 부재 — 집합을 순서까지 리터럴로 못박는다(규범 N).
      expect(subjects, '레코드 subject 전체').toEqual(LOG_SUBJECTS)
      expect(subjects, '위조 subject 부재').not.toContain(FORGED_TITLE)

      // ③ hash 는 git 이 낸 40-hex 이고, 실제 커밋 해시 집합과 정확히 같다.
      expect(
        records.map((record) => /^[0-9a-f]{40}$/u.test(record.hash)),
        'hash 40-hex 형태',
      ).toEqual(records.map(() => true))
      expect(records.map((record) => record.hash).toSorted(), 'hash 집합').toEqual(
        [...shas].toSorted(),
      )

      // ⑤ body 원문 보존. `\x1f` 단독 payload 는 레코드 수를 흔들지 못하지만 US wire 에서 body 를
      //   잘라낸다 — 이 단언이 그 arm 을 공허하지 않게 만든다.
      const hostile = records.find((record) => record.subject === HOSTILE_SUBJECT)
      expect(hostile?.body, '적대적 body 원문 보존').toContain(payload)
    },
  )
})

describe('collectFeedItems — 같은 payload 가 git-walk 경로도 흔들지 못한다 (RF2 · 🔴RED)', () => {
  it.each(HOSTILE_BODIES)(
    'RF2: %s payload 를 심어도 feed 3건 · 실 sha prefix · body 원문 보존이다 (🔴RED · `US 단독` arm 은 오늘도 green)',
    (_label, payload) => {
      expectSeamPresent()
      const { shas, vault } = seedVault(payload)

      const { items } = collectFeedItems(vault, { env: 'dev' })
      const titles = items.map((item) => item.title)

      // 앵커: 정상 feed 3건이 실제로 나온다(픽스처가 피드를 만들긴 했는지 먼저 증명).
      expect(
        titles.filter((title) => FEED_TITLES.includes(title)),
        '정상 feed title 앵커',
      ).toEqual(FEED_TITLES)

      expect(titles, 'feed item title 전체').toEqual(FEED_TITLES)
      expect(titles, '위조 제목이 피드로 새지 않는다').not.toContain(FORGED_TITLE)

      // feed id 는 커밋 해시 앞 12자다 — 실제 커밋 집합과 정확히 일치해야 한다.
      expect(items.map((item) => item.id).toSorted(), 'feed id 집합').toEqual(
        shas.map((sha) => sha.slice(0, 12)).toSorted(),
      )

      expect(
        items.find((item) => item.title === HOSTILE_TITLE)?.body,
        '적대적 body 원문 보존',
      ).toBe(payload)
    },
  )
})

describe('프레이밍 파손은 조용한 오프셋이 아니라 throw 다 (RF3·RF4 · 🔴RED)', () => {
  it('RF3: 토큰 수가 어긋난 stdout 은 throw 한다 (🔴RED)', () => {
    expectSeamPresent()
    // 토큰 3개 — NUL 프레이밍의 정상 토큰 수는 `4n+1` 이다. hash 자리는 **정상 40-hex** 라서
    //   형태 단언만으로는 이 파손을 가를 수 없다. arity 가 그 사각을 덮는지 묻는 케이스다.
    const BROKEN = `${'0'.repeat(40)}\x002026-01-01T00:00:00+00:00\x00제목`

    expect(() => collectGitLog(() => BROKEN), '프레이밍 파손').toThrow()
  })

  it('RF4: hash 자리가 40-hex 가 아니면 throw 한다 (🔴RED)', () => {
    expectSeamPresent()
    // 토큰 수는 5개(=`4n+1`)로 **맞다** — 형태 단언이 arity 의 사각을 덮는지 묻는 반대 방향 케이스다.
    const BAD_HASH = 'nothex\x002026-01-01T00:00:00+00:00\x00제목\x00본문\x00\n'

    expect(() => collectGitLog(() => BAD_HASH), 'hash 형태 위반').toThrow()
  })
})

describe('정상 입력은 절대 throw 하지 않는다 (RF5·RF6 · 🟢오탐 가드)', () => {
  it('RF5: 빈 stdout 은 `[]` 이고 throw 하지 않는다 (🟢오탐 가드)', () => {
    expectSeamPresent()
    // ★ 빈 입력의 잉여 토큰은 `'\n'` 이 **아니다** — `''.split('\x00')` 은 `['']`(토큰 1개)다.
    //   "후행 `'\n'` 을 떼어낸 뒤 나머지를 4로 나눈다" 식 구현은 여기서 throw 한다.
    expect(() => collectGitLog(() => ''), '빈 stdout').not.toThrow()
    expect(
      collectGitLog(() => ''),
      '빈 stdout 결과',
    ).toEqual([])
  })

  it('RF6: 커밋 0건 리포는 `[]` 이고 throw 하지 않는다 (🟢pin)', () => {
    expectSeamPresent()
    const vault = initVault()
    tmps.push(vault)

    // 앵커: 이 vault 는 실제 git 리포이고 커밋이 0건이다(엉뚱한 디렉토리로 통과하는 것을 배제).
    expect(existsSync(path.join(vault, '.git')), '.git 존재').toBe(true)
    expect(() => git(vault, ['rev-parse', 'HEAD']), '커밋 0건').toThrow()

    // `git log` 가 fatal 로 죽고 catch 가 `[]` 를 낸다 — 파서에 닿지도 않는 경로의 보존 못이다.
    expect(() => collectGitLog(makeGitRunner(vault)), '커밋 0건 리포').not.toThrow()
    expect(collectGitLog(makeGitRunner(vault)), '커밋 0건 로그').toEqual([])
  })
})

describe('body 원문은 탭까지 보존된다 (RF7 · 🟢회귀 pin)', () => {
  it('RF7: 탭이 든 body 가 두 경로 모두에서 원문 그대로 나온다 (🟢회귀 pin)', () => {
    expectSeamPresent()
    // 오늘 git-walk 은 필드 구분자가 `\t` 라 body 를 쪼갰다가 join 으로 되붙인다. 프레이밍을 바꾸면
    //   그 복원 코드가 사라진다 — 사라져도 결과가 같아야 함을 여기서 못박는다.
    const vault = initVault()
    tmps.push(vault)
    writeDoc(vault, REL_PUBLIC, { id: ID_A })
    commit(vault, `feed: ${TAB_TITLE}\n\n${TAB_BODY}\n\nImportance: normal`)

    const records = collectGitLog(makeGitRunner(vault))
    expect(
      records.map((record) => record.subject),
      '레코드 subject',
    ).toEqual([`feed: ${TAB_TITLE}`])
    expect(records[0].body, 'collectGitLog body 의 탭').toBe(`${TAB_BODY}\n\nImportance: normal`)

    const { items } = collectFeedItems(vault, { env: 'dev' })
    expect(
      items.map((item) => item.title),
      'feed title',
    ).toEqual([TAB_TITLE])
    expect(items[0].body, 'feed body 의 탭').toBe(TAB_BODY)
  })
})

describe('정상 vault 에서 두 경로가 같은 커밋을 가리킨다 (RF8 · 🟢대조군)', () => {
  it('RF8: `collectGitLog` 해시 집합이 피드 경로가 워크한 커밋을 전부 덮는다 (🟢대조군)', () => {
    expectSeamPresent()
    const { shas, vault } = seedVault(BENIGN_BODY)

    const records = collectGitLog(makeGitRunner(vault))
    expect(records.map((record) => record.hash).toSorted(), 'log hash 집합').toEqual(
      [...shas].toSorted(),
    )
    expect(
      records.map((record) => /^[0-9a-f]{40}$/u.test(record.hash)),
      'log hash 40-hex 형태',
    ).toEqual(records.map(() => true))

    const { items } = collectFeedItems(vault, { env: 'dev' })
    const logPrefixes = new Set(records.map((record) => record.hash.slice(0, 12)))

    expect(items.map((item) => item.id).toSorted(), 'feed id 집합').toEqual(
      shas.map((sha) => sha.slice(0, 12)).toSorted(),
    )
    expect(
      items.map((item) => logPrefixes.has(item.id)),
      '피드 id 가 log 해시에 전부 포함된다',
    ).toEqual(items.map(() => true))
  })
})
