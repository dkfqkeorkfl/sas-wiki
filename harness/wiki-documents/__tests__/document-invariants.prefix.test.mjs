import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { checkCommitConventions } from '../document-invariants.mjs'

/**
 * ★★ **이 파일에서 원시 레거시 토큰을 담는 유일한 줄이 바로 아래다** — 예외 E8 의 표적
 * (`scripts/__tests__/legacy-sweep.test.mjs` 의 레지스트리).
 *
 * 접두사 **무관성**을 증명하려면 옛 접두사를 **입력으로** 쓸 수밖에 없다 — 그것이 이 파일의 주제다.
 * E1 과 같은 형태로 한 줄에 가두고 나머지는 전부 여기서 파생시킨다.
 */
const SUBJECTS = { chore: 'chore: 제목', feed: 'feed: 제목', legacy: 'cwiki: 제목' }

/** sha → `git show --name-status` stdout. 기존 `invariants.feed-only.test.mjs:36` 패턴 재사용. */
function stubGitStatuses(byHash) {
  return (args) => (args.includes('show') ? (byHash[args.at(-1)] ?? '') : '')
}

/** throw 메시지에서 **subject 만** 지운다 — 접두사가 아니라 *그 밖의 모든 것*이 같은지 보기 위해. */
function violationShape(commits, runGit) {
  try {
    checkCommitConventions(commits, runGit, 'wiki/')
    return { threw: false }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const masked = commits.reduce((text, commit) => text.replaceAll(commit.subject, '<subject>'), message) // prettier-ignore
    return { message: masked, threw: true }
  }
}

describe('컨벤션 검사의 접두사 무관성 (FS4 pair)', () => {
  it('FS4: 같은 statuses 면 접두사가 달라도 throw 여부와 진단이 같다', () => {
    // ★ FO1·FO2·FO5 와 **중복이지만 축이 다르다** — FO 는 *per-kind 규칙 소멸*이 주제이고, 여기는
    //   *접두사 무관성*(치환 안전성)이 주제다. REFACTOR 에서 합치지 않는다(합치면 Task 5 의 안전
    //   근거가 FO 파일에 숨는다 — §10.3-4).
    const subjects = [SUBJECTS.legacy, SUBJECTS.chore, SUBJECTS.feed]

    // ① A+D(문서 id 소실 시그니처) — 셋 다 throw 하고 진단이 같다.
    const violating = subjects.map((subject) =>
      violationShape(
        [{ hash: 'c0ffee00fs4a', subject }],
        stubGitStatuses({ c0ffee00fs4a: ['A\twiki/tech/x.md', 'D\twiki/company/y.md'].join('\n') }),
      ),
    )
    // 앵커(양극성 ①): 실제로 throw 했고 메시지가 비어 있지 않다 — "전부 통과" 구현 배제.
    expect(violating.map((shape) => shape.threw)).toEqual([true, true, true])
    expect(violating[0].message).toMatch(/컨벤션 위반/)
    expect(new Set(violating.map((shape) => shape.message)).size).toBe(1)

    // ② M 만(단순 수정) — 셋 다 통과한다. 앵커(양극성 ②): "전부 실패" 구현 배제.
    const clean = subjects.map((subject) =>
      violationShape(
        [{ hash: 'c0ffee00fs4b', subject }],
        stubGitStatuses({ c0ffee00fs4b: 'M\twiki/company/a.md' }),
      ),
    )
    expect(clean.map((shape) => shape.threw)).toEqual([false, false, false])
  })
})
