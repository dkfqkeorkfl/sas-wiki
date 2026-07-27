// @vitest-environment node
//
// P1 · RED — 경로 술어 계약 · 상수 트립와이어 (tdd §3.6 PR1~PR6)
//
// 이 파일이 무는 것: **"경로 prefix 는 HEAD 상태 개념"** 이라는 이 phase 의 지배 원칙을 코드 표면에
//   고정한다. 히스토리 계층은 `anyMarkdown`(prefix 없음), 계약 계층은 `underWikiPrefix(prefix)` 다.
//
// RED 사유(의도한 미구현 — 리포 상태와 무관하다):
//   ① `anyMarkdown` · `underWikiPrefix` 가 `git.mjs` 에 **없다**(P1 Task 3 이 export 한다) → 호출 TypeError.
//   ② `WIKI_PREFIX` 가 아직 `'vault/wiki/'` 다(P1 Task 7 이 `'wiki/'` 로 바꾼다).
//   ③ `getCommitDocStatuses` 의 3번째 인자가 아직 **prefix 문자열**이고 `diffMerges` 옵션 개념이 없다.
//
// **namespace import 를 쓰는 이유**: 없는 이름을 named import 하면 ESM 링크가 파일을 통째로 죽여
//   (collection error → "테스트 0건") 케이스별 red 사유가 사라진다. namespace 로 받으면 PR1~PR6 이
//   **각각** red 가 되어, 어느 계약이 비었는지 실행 결과만 보고 알 수 있다.
//
// 규범 A(자기참조 공허성 금지 · tdd §2.3): 입력 경로는 전부 **리터럴**이다. 구현 상수에서 만들지
//   않는다. 유일한 예외가 **PR5 트립와이어** — `WIKI_PREFIX` 를 리터럴 `'wiki/'` 와 대조한다.
//   상수가 바뀌면 여기가 **먼저** red 가 되어 "다른 파일의 리터럴 픽스처도 함께 갱신하라"고 말한다.
//   한 곳만 묶고 나머지를 전부 리터럴로 두는 것이 드리프트 동반(=자기참조 공허성)을 막는 구조다.
import { describe, expect, it } from 'vitest'

import { WIKI_PREFIX } from '../head-state.mjs'
// 술어 export 부재를 **케이스별** red 로 만들기 위한 namespace 수입(위 주석 참조).
import * as gitModule from '../git.mjs'

/** `git show --name-status --format=` 의 실제 출력 형태(위키 문서 1건 + 위키 밖 .md 1건). */
const SHOW_OUT = ['M\twiki/company/삼성.md', 'A\tREADME.md'].join('\n')

/** args 를 관측하는 stub 러너 — 실 git 불요(빠르고 결정적). 규범 D: 헬퍼에 expect 를 넣지 않는다. */
function recordingRunner(calls, stdout = SHOW_OUT) {
  return (args) => {
    calls.push(args)
    return stdout
  }
}

describe('anyMarkdown — 히스토리 계층 술어(prefix 금지) (PR1·PR2)', () => {
  // 옛 루트를 통과시킨다는 것이 이 술어의 존재 이유다. 이관 전 경로를 못 보면 그 시절 피드·삭제
  // 이력이 통째로 사라진다(prefix 를 히스토리에 걸었을 때의 실패 모드).
  it.each([
    'wiki/company/삼성.md',
    'vault/wiki/company/삼성.md',
    'README.md',
    'docs/release.md',
    'wiki/dev/실험.md',
  ])('PR1: `%s` 를 문서 후보로 통과시킨다', (filePath) => {
    expect(gitModule.anyMarkdown(filePath)).toBe(true)
  })

  it.each([
    'scripts/lib/git.mjs',
    'wiki/company/삼성.md.txt',
    'wiki/company/삼성',
    'ignore-feeds.json',
  ])('PR2: `%s` 는 차단한다(항상 true 인 구현 배제)', (filePath) => {
    expect(gitModule.anyMarkdown(filePath)).toBe(false)
  })
})

describe('underWikiPrefix — 계약 계층 술어(현재 prefix) (PR3·PR4)', () => {
  it.each(['wiki/company/삼성.md', 'wiki/dev/실험.md', 'wiki/a/b/c/d.md'])(
    'PR3: `%s` 는 현행 계약 경로 안이다(draft·깊은 계층 포함 · D15)',
    (filePath) => {
      expect(gitModule.underWikiPrefix('wiki/')(filePath)).toBe(true)
    },
  )

  // `'vault/wiki/…'` 차단이 CN1(이관 이전 커밋 grandfathering)의 **전제**다. 이게 통과해 버리면
  // `statuses.length === 0 → skip` 이 애초에 발동하지 않아 CN1 이 공허해진다.
  it.each(['vault/wiki/company/삼성.md', 'wikix/a.md', 'wiki/a.txt', 'README.md', 'docs/x.md'])(
    'PR4: `%s` 는 현행 계약 경로 밖이다',
    (filePath) => {
      expect(gitModule.underWikiPrefix('wiki/')(filePath)).toBe(false)
    },
  )
})

describe('상수·레거시 (PR5 트립와이어)', () => {
  it('PR5a: WIKI_PREFIX 가 리터럴 `wiki/` 다 (리터럴 픽스처 전체의 드리프트 감지기)', () => {
    // 이 단언이 red 면 상수가 아직 안 바뀐 것이고, GREEN 이후에 red 가 되면 **누가 상수를 바꿨다**는
    // 뜻이다 — 그때는 이 phase 의 리터럴 픽스처(MV·MG·CN·DL·EP·PR)를 함께 갱신해야 한다.
    expect(WIKI_PREFIX).toBe('wiki/')
  })

  it('PR5b: isWikiDocPath 는 git.mjs 가 export 하지 않는다 (레거시 소거 pin · D16)', () => {
    const exported = Object.keys(gitModule)

    // 규범 B: 부재 단언 앞에 **존재** 단언. 모듈이 통째로 비면 부재는 공허하게 참이 된다.
    expect(exported).toContain('getCommitDocStatuses')
    expect(exported).toContain('collectEverDeletedDocPaths')
    expect(exported).not.toContain('isWikiDocPath')
  })
})

describe('getCommitDocStatuses — 술어 주입 · diffMerges 옵션 (PR6)', () => {
  it('PR6a: 3번째 인자로 받은 **술어**가 문서 판정 주체다', () => {
    const calls = []

    const statuses = gitModule.getCommitDocStatuses(
      recordingRunner(calls),
      'abc123',
      (filePath) => filePath.startsWith('wiki/') && filePath.endsWith('.md'),
    )

    // 술어가 통과시킨 1건만 남는다 — 술어를 무시하고 내부 prefix 로 거르면 0건(현행)이라 red.
    expect(statuses).toEqual([{ path: 'wiki/company/삼성.md', status: 'M' }])
  })

  it('PR6b: `{ diffMerges: "first-parent" }` 를 주면 그 플래그를 붙인다', () => {
    const calls = []

    gitModule.getCommitDocStatuses(recordingRunner(calls), 'abc123', () => true, {
      diffMerges: 'first-parent',
    })

    // 규범 B: 존재 단언(실제 호출이 있었다) 뒤에 내용 단언.
    expect(calls).toHaveLength(1)
    expect(calls[0]).toContain('show')
    expect(calls[0]).toContain('--diff-merges=first-parent')
  })

  it('PR6c: 옵션 미지정이면 `--diff-merges` 를 **붙이지 않는다**(공유 함수 기본값 금지)', () => {
    // plan GOTCHA 를 구조로 고정한다: 공유 함수에 diffMerges 기본값을 박으면 병합이 브랜치 전체를
    // 한 커밋의 저작으로 이중계상해 컨벤션 오탐이 난다(FP4 가 그 상황을 문다).
    const calls = []

    gitModule.getCommitDocStatuses(recordingRunner(calls), 'abc123', () => true)

    // 규범 B: 부재 단언 앞에 존재 단언 — 호출 자체가 없으면 "플래그 0개"는 공허하게 참이다.
    expect(calls).toHaveLength(1)
    expect(calls[0]).toContain('show')
    expect(calls[0].at(-1)).toBe('abc123')
    expect(calls[0].filter((arg) => String(arg).startsWith('--diff-merges'))).toEqual([])
  })

  it('PR6d: rename 탐지를 **항상 명시**한다(config 에 맡기지 않는다)', () => {
    // MIRROR: RENAME_DETECTION_EXPLICIT(git.mjs:110-117) — `diff.renames=false` 를 로컬에 설정한
    // 사람의 환경에서 정당한 이동이 삭제로 보이면 게이트의 의미가 그 사람 환경에 따라 달라진다.
    const calls = []

    gitModule.getCommitDocStatuses(recordingRunner(calls), 'abc123', () => true)

    expect(calls).toHaveLength(1)
    expect(calls[0]).toContain('--find-renames')
    expect(calls[0]).toContain('--name-status')
  })
})
