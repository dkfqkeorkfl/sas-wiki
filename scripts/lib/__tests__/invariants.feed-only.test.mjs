// @vitest-environment node
//
// P2 · Task 5 — 커밋 컨벤션을 `feed:` 하나로 (`invariants.mjs:checkCommitConventions`) — tdd §3.5 (FO1~FO8)
//
// 무엇이 바뀌는가: 컨벤션이 3종(`cwiki`/`uwiki`/`feed`)인데 기계는 `feed:` 만 읽는다 — 나머지는 **죽은
//   규칙**이다(D6). per-kind 규칙(cwiki 1-add · uwiki/feed no-add)을 지우고, **A+D 동시 발생 가드는
//   접두사 무관 전 커밋**에 적용한다. 옛 `cwiki:`/`uwiki:` 커밋은 일반 커밋으로 자연 소화된다.
//
// **지우면 안 되는 것 (FO7 · CX9 · plan Risks 3위)**: `invariants.mjs:25` 의
//   `statuses.length === 0 → continue`(이관 이전 커밋 면제). 지우면 옛 커밋 7건이 빌드를 죽이고,
//   히스토리 재작성이 금지된 이상 **고칠 수도 없다.**
//
// RED 사유(라벨별):
//   FO1 pin        — 지금도 통과. GREEN 이 A+D 규칙을 "A 여러 개 금지" 로 잘못 넓히면 red.
//   FO2 RED(flip)  — 현행 `invariants.mjs:45` 가 `feed` + `added>0` 을 위반으로 본다(D6 은 겸용 허용).
//   FO3 pair       — 1파일 규칙이 사라져도 **진짜 위험(id 중복)** 은 계속 잡힌다(원장 ⑩ 의 보호 승계).
//   FO4 pin        — A+D 가드 생존(접두어 무관).
//   FO5 RED        — `feed:` 커밋의 A+D 가 **A+D 로 진단**돼야 한다(현행은 per-kind 문구로 샌다).
//   FO6 pin        — 과잉검출 가드(M · R100).
//   FO7 pin        — 이관 이전 커밋 면제 생존.
//   FO8 RED(flip)  — 현행 `invariants.mjs:262` 가 존재하지 않을 컨벤션(`uwiki`)을 안내한다.
//
// 자기참조 공허성(§2.3 규범 A): subject·경로·prefix 는 전부 리터럴이다. **입력에 `cwiki`/`uwiki` 문자열을
//   쓰지 않는다**(LG1 · P6 grep 스윕과 충돌 회피) — 비컨벤션 접두사는 `chore:` 등 임의값으로 쓴다.
//
// 기존 `invariants.test.mjs` 의 D26 3스펙(L249·L259·L267)은 **무수정 유지**한다(§10.1-3). 새 검사기가
//   그 3스펙을 여전히 통과해야 "게이트를 통째로 끄지 않았다" 가 증명된다.
import { describe, expect, it } from 'vitest'

import { cleanup, commit, initVault, writeDoc } from '../../__tests__/helpers/tmp-git-vault.mjs'
import { buildContent } from '../../validate.mjs'
import { checkCommitConventions } from '../invariants.mjs'

const WIKI_PREFIX = 'wiki/'

/** sha → `git show --name-status` stdout(그 외 조회는 ''). 기존 `invariants.test.mjs:244` 패턴 재사용. */
function stubGitStatuses(byHash) {
  return (args) => (args.includes('show') ? (byHash[args.at(-1)] ?? '') : '')
}

/** 위반 메시지를 문자열로 캔다 — throw 하지 않으면 null(그 자체가 진단이 된다). */
function violationMessage(commits, runGit) {
  try {
    checkCommitConventions(commits, runGit, WIKI_PREFIX)
    return null
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

describe('checkCommitConventions — 접두사는 더 이상 규칙이 아니다 (FO1·FO2)', () => {
  it('FO1: 접두사 없는 커밋이 문서 2개를 추가해도 throw 하지 않는다(pin · 과잉 확대 방지)', () => {
    // 1파일 규칙이 사라진다고 해서 "A 여러 개 금지" 로 넓히면 안 된다 — 사라지는 것은 규칙 자체다.
    const commits = [{ hash: 'c0ffee00fo01', subject: 'chore: 문서 두 개 생성' }]
    const runGit = stubGitStatuses({
      c0ffee00fo01: ['A\twiki/company/a.md', 'A\twiki/company/b.md'].join('\n'),
    })

    expect(() => checkCommitConventions(commits, runGit, WIKI_PREFIX)).not.toThrow()
  })

  it('FO2: `feed:` 커밋이 문서를 새로 만들면서 발행해도 throw 하지 않는다 (🔴RED(flip) · D6)', () => {
    // 저작/발행 겸용은 D6 이 명시적으로 허용한다. 현행은 `feed` + `added>0` 을 위반으로 본다.
    const commits = [{ hash: 'c0ffee00fo02', subject: 'feed: 문서 생성 겸 소식' }]
    const runGit = stubGitStatuses({ c0ffee00fo02: 'A\twiki/company/a.md' })

    expect(() => checkCommitConventions(commits, runGit, WIKI_PREFIX)).not.toThrow()
  })
})

describe('1파일 규칙이 사라져도 진짜 위험은 계속 잡힌다 (FO3 · pair · 원장 ⑩ 보호 승계)', () => {
  it('FO3: 한 커밋이 만든 두 문서가 **같은 id** 면 build 가 죽는다(빌드 전체 게이트)', () => {
    // ★ 이 짝이 없으면 §4-⑩(P1 무수정 pin 해제)이 **보호 순감소**가 된다. `cwiki` 1파일 규칙이
    //   막던 유일한 실질 위험은 "한 커밋 2문서" 그 자체가 아니라 **id 중복**이다 — 중복이면 참조가
    //   비는 게 아니라 **틀린 문서**를 가리킨다.
    // 실측: 이 vault 는 `derive` 의 중복-id 게이트가 먼저 끊는다(불변식 8 은 그 뒤의 최후 방어선).
    //   어느 게이트가 잡든 **빌드가 죽고 두 경로와 id 를 말한다** 는 것이 계약이다.
    const twinId = '0192a000-0000-7000-8000-0000000000aa'
    const vault = initVault()
    try {
      writeDoc(vault, 'company/a', { id: twinId, wikiRoot: 'wiki' })
      writeDoc(vault, 'company/b', { id: twinId, wikiRoot: 'wiki' })
      commit(vault, 'chore: 문서 두 개 생성')

      expect(() => buildContent({ env: 'dev', vault })).toThrow(new RegExp(twinId))
      expect(() => buildContent({ env: 'dev', vault })).toThrow(/company\/a[\s\S]*company\/b/)
    } finally {
      cleanup(vault)
    }
  })
})

describe('checkCommitConventions — A+D 가드는 접두사 무관 전 커밋에 산다 (FO4·FO5·FO8)', () => {
  it('FO4: 접두사 없는 커밋의 A+D 는 여전히 throw 한다(pin)', () => {
    const commits = [{ hash: 'c0ffee00fo04', subject: 'chore: 문서 대개편' }]
    const runGit = stubGitStatuses({
      c0ffee00fo04: ['A\twiki/tech/x.md', 'D\twiki/company/y.md'].join('\n'),
    })

    expect(() => checkCommitConventions(commits, runGit, WIKI_PREFIX)).toThrow(/컨벤션 위반/)
  })

  it('FO5: `feed:` 커밋의 A+D 도 **A+D 로** 진단된다(per-kind 문구로 새지 않는다) (🔴RED)', () => {
    const commits = [{ hash: 'c0ffee00fo05', subject: 'feed: 이동하며 재작성' }]
    const runGit = stubGitStatuses({
      c0ffee00fo05: ['A\twiki/tech/x.md', 'D\twiki/company/y.md'].join('\n'),
    })

    const message = violationMessage(commits, runGit)

    // 앵커: 메시지가 실재하고 두 경로를 담는다 — 부재 단언(아래)이 "throw 자체를 없앴다" 와 구분된다.
    expect(message).not.toBeNull()
    expect(message).toContain('wiki/tech/x.md')
    expect(message).toContain('wiki/company/y.md')
    // 사라지는 per-kind 규칙 문구 — D6 이후 이 문장은 존재해선 안 된다(있으면 죽은 규칙이 살아 있다).
    expect(message).not.toContain('신규 vault 문서를 추가할 수 없다')
    expect(message).toMatch(/같은 커밋/)
  })

  it('FO8: 위반 메시지가 존재하지 않는 컨벤션을 안내하지 않는다 (🔴RED(flip))', () => {
    // 현행 `invariants.mjs:262` 는 "이동만 담은 uwiki 커밋과 … 분리하라" 를 출력한다. P2 이후 그런
    //   컨벤션은 없다 — 없는 절차를 안내하는 진단은 사용자를 막다른 길로 보낸다.
    const commits = [{ hash: 'c0ffee00fo08', subject: 'feed: 이동하며 재작성' }]
    const runGit = stubGitStatuses({
      c0ffee00fo08: ['A\twiki/tech/x.md', 'D\twiki/company/y.md'].join('\n'),
    })

    const message = violationMessage(commits, runGit)

    // 앵커 먼저(규범 B): 메시지가 비어 있지 않고 분리 안내를 실제로 담는다.
    expect(message).not.toBeNull()
    expect(message).toMatch(/분리/)
    // 그 다음에 레거시 토큰 부재를 단언한다.
    expect(message).not.toMatch(/uwiki|cwiki/)
  })
})

describe('checkCommitConventions — 과잉검출·면제 가드 (FO6·FO7 · pin)', () => {
  it('FO6: 단순 수정(M)과 git 이 인식한 이동(R100)은 throw 하지 않는다', () => {
    const modify = [{ hash: 'c0ffee00fo6a', subject: 'chore: 오타 수정' }]
    const rename = [{ hash: 'c0ffee00fo6b', subject: 'chore: 폴더 재배치' }]

    expect(() =>
      checkCommitConventions(
        modify,
        stubGitStatuses({ c0ffee00fo6a: 'M\twiki/company/a.md' }),
        WIKI_PREFIX,
      ),
    ).not.toThrow()
    expect(() =>
      checkCommitConventions(
        rename,
        stubGitStatuses({ c0ffee00fo6b: 'R100\twiki/company/a.md\twiki/tech/a.md' }),
        WIKI_PREFIX,
      ),
    ).not.toThrow()
  })

  it('FO7: 이관 이전 커밋(현행 계약이 안 보이는 커밋)은 면제된다(면제 방향만 — 위반 방향이 여전히 잡히는지는 GF2 가 함께 증명한다)', () => {
    // statuses 가 비어 있다 = 그때 경로가 지금 계약 밖이다. 이것을 위반으로 읽으면 옛 커밋 7건이
    //   전부 빌드를 죽이고, 히스토리 재작성이 금지돼 **고칠 수도 없는** 위반이 된다.
    const commits = [{ hash: 'c0ffee00fo07', subject: 'chore: 옛 규칙 커밋' }]
    const runGit = stubGitStatuses({ c0ffee00fo07: '' })

    expect(() => checkCommitConventions(commits, runGit, WIKI_PREFIX)).not.toThrow()
  })
})
