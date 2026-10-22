// 문서 검사 정책의 정상·위반 회귀. 실제 wiki 대신 격리 fixture를 사용한다.
import { describe, expect, it } from 'vitest'

import { inspectVault } from '../document-integrity.mjs'

import { cleanup, commit, git, initVault, writeDoc } from '../../test-utils/tmp-git-vault.mjs'

const ID_A = '0192a000-0000-7000-8000-0000000000aa'

const ID_B = '0192b000-0000-7000-8000-0000000000bb'

const ID_C = '0192c000-0000-7000-8000-0000000000cc'

const reasonsOf = (stats) => stats.deadlinks.map((entry) => entry.reason)

/** DEAD-BASE — 대상 문서가 **없는** 위키링크 1건(가장 흔한 저작 중 상태). */
function seedDeadlinkVault() {
  const vault = initVault()
  writeDoc(vault, 'company/삼성', {
    body: '## 정의\n\n[[없는문서]] 를 참조한다.\n',
    id: ID_A,
    wikiRoot: 'wiki',
  })
  commit(vault, 'chore: 문서 생성')
  return vault
}

/** AMBIG-BASE — 같은 basename 문서 2건 + 그것을 가리키는 `[[중복]]`(동명 충돌). */
function seedAmbiguousVault() {
  const vault = initVault()
  writeDoc(vault, 'company/중복', { id: ID_B, wikiRoot: 'wiki' })
  writeDoc(vault, 'tech/중복', { id: ID_C, wikiRoot: 'wiki' })
  writeDoc(vault, 'company/삼성', {
    body: '## 정의\n\n[[중복]] 을 참조한다.\n',
    id: ID_A,
    wikiRoot: 'wiki',
  })
  commit(vault, 'chore: 초기 문서 3건')
  return vault
}

describe('데드링크는 빌드를 죽이지 않는다', () => {
  it('DK1: 옵션 미지정이면 throw 하지 않고 데드링크 1건이 관측 가능하다 )', () => {
    const vault = seedDeadlinkVault()
    try {
      // ★ 위험 실재 앵커(규범 B): 이 픽스처가 **정말** 데드링크를 만든다 — `error` 로 세우면 건수와
      //   함께 죽는다. 이 앵커가 없으면 링크가 아예 없는 픽스처로 "안 죽는다" 를 공허 통과시킨다.
      expect(() => inspectVault({ deadlinks: 'error', env: 'dev', vault })).toThrow(/데드링크/)

      const { stats } = inspectVault({ env: 'dev', vault })

      expect(reasonsOf(stats)).toEqual(['대상 문서 없음'])
    } finally {
      cleanup(vault)
    }
  })

  it('DK2: `--deadlinks error` 로 되돌리면 건수와 **탈출구 옵션명**을 함께 말하며 죽는다', () => {
    // R3 전이 패턴: 실패 메시지에 탈출구 설정 이름을 함께 출력한다. "옵션을 받지만 무시" 하는 구현을
    //   red 로 만든다 — 옵션명이 없으면 사용자는 무엇을 눌러야 넘어가는지 모른다.
    const vault = seedDeadlinkVault()
    try {
      expect(() => inspectVault({ deadlinks: 'error', env: 'dev', vault })).toThrow(/데드링크 1건/)
      expect(() => inspectVault({ deadlinks: 'error', env: 'dev', vault })).toThrow(/warn.*ignore/)
    } finally {
      cleanup(vault)
    }
  })

  it('DK3: `ignore` 는 `warn` 과 다르다 — throw 도 없고 리포트도 없다', () => {
    const vault = seedDeadlinkVault()
    try {
      // 앵커: 같은 vault 가 `error` 에서는 죽는다(픽스처가 비어 있지 않다).
      expect(() => inspectVault({ deadlinks: 'error', env: 'dev', vault })).toThrow(/데드링크/)

      const { stats } = inspectVault({ deadlinks: 'ignore', env: 'dev', vault })

      expect(stats.deadlinks).toEqual([]) // 세지도 않는다 — 3값 enum 이 사실상 2값이 되면 red
    } finally {
      cleanup(vault)
    }
  })
})

describe('동명 문서 충돌은 심각도 옵션에서 분리된다', () => {
  it('DK4: 같은 `ignore` 에서 평범한 데드링크는 살고 **동명 충돌은 죽는다**', () => {
    const deadVault = seedDeadlinkVault()
    const ambiguousVault = seedAmbiguousVault()
    try {
      // ★ 앵커: 옵션이 실제로 게이트를 끈다 — 이게 없으면 "ignore 에서도 throw" 가 그저 옵션 미구현
      //   때문인지(현행) 분리 결정 때문인지(P2) 구분되지 않는다.
      expect(() => inspectVault({ deadlinks: 'ignore', env: 'dev', vault: deadVault })).not.toThrow() // prettier-ignore

      expect(() => inspectVault({ env: 'dev', vault: ambiguousVault })).toThrow(/동명 문서 충돌/)
      expect(() =>
        inspectVault({ deadlinks: 'ignore', env: 'dev', vault: ambiguousVault }),
      ).toThrow(/동명 문서 충돌/)
    } finally {
      cleanup(deadVault, ambiguousVault)
    }
  })
})

describe('게이트 순서는 보존된다', () => {
  it('DK8: 컨벤션 위반과 데드링크가 동시에 있으면 **컨벤션 위반**으로 진단된다', () => {
    // 순서(conventions → schema → deadlinks → feedResolution → strayDocs)를 흔들면 여기서만 red 다.
    // 다른 DK 케이스는 전부 green 이라 격리가 좋다.
    const vault = initVault()
    try {
      writeDoc(vault, 'company/삼성', {
        body: '## 정의\n\n[[없는문서]] 를 참조한다.\n',
        id: ID_A,
        wikiRoot: 'wiki',
      })
      writeDoc(vault, 'company/옛문서', { id: ID_B, wikiRoot: 'wiki' })
      commit(vault, 'chore: 초기 문서 2건')
      // A+D 를 한 커밋에 — git 이 rename 으로 못 붙게 본문을 완전히 벌린다(유사도 밖).
      git(vault, ['rm', '-q', 'wiki/company/옛문서.md'])
      writeDoc(vault, 'tech/신문서', {
        body: '## 정의\n\n앞 문서와 한 문장도 겹치지 않는 완전히 다른 장문이다. 엣지 추론, 전력 효율, NPU 세대, 모바일 배포, 온디바이스 학습 전략을 새로 정리한다.\n',
        id: ID_C,
        wikiRoot: 'wiki',
      })
      commit(vault, 'chore: 문서 대개편')

      // 앵커: 이 vault 의 링크가 정말 죽어 있다(`error` 로 세우면 데드링크로 죽을 재료가 있다).
      //   그럼에도 **먼저 나가는 진단은 컨벤션 위반**이어야 한다.
      expect(() => inspectVault({ deadlinks: 'error', env: 'dev', vault })).toThrow(/컨벤션 위반/)
      expect(() => inspectVault({ env: 'dev', vault })).toThrow(/컨벤션 위반/)
      expect(() => inspectVault({ env: 'dev', vault })).not.toThrow(/데드링크/)
    } finally {
      cleanup(vault)
    }
  })
})
