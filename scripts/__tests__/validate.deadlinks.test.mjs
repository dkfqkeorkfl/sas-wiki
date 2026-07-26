// @vitest-environment node
//
// P2 · Task 8 — 데드링크 심각도 옵션화 + **동명충돌 분리** (`validate.mjs`) — tdd §3.8 (DK1~DK8)
//
// 무엇이 바뀌는가(R3): `--allow-deadlinks`(불리언) → `--deadlinks <ignore|warn|error>`, 기본 **warn**.
//   기본 완화의 출처는 리서치가 아니라 **PRD D11**(확정 제품 결정: 빌드실패 → 런타임 UX)이다.
//   그리고 **동명 문서 충돌(ambiguous)은 이 옵션에서 떼어내 계속 `error`** 다 — 앞의 둘(대상 문서 없음·
//   대상 앵커 없음)은 사용자에게 "존재하지 않는 문서" 로 보이지만, 동명 충돌은 링크가 **존재하는 엉뚱한
//   문서**로 해석돼 아무 오류 없이 **틀린 문서가 정상처럼 열린다.** 완화 대상이 아니다.
//
// 관측 표면 seam(§7.4): `reportStats` 는 모듈 로컬이라 stdout 을 단위 테스트가 잡을 수 없다 →
//   `buildContent` 가 **`stats.deadlinks`**(각 항목이 `reason` 을 갖는 배열)를 반환하도록 확장한다.
//   `warn` 으로 내리는 순간 그 배열이 **유일한 관측 경로**다 — 반환하지 않으면 "경고가 나왔는지" 자체를
//   검증할 수 없고, 관측 불가능한 완화는 조용한 유실이다.
//
// RED 사유(라벨별):
//   DK1 RED(flip) — 현행 기본값이 실패(`allowDeadlinks: false`)이고 `stats.deadlinks` 가 없다.
//   DK2 RED       — 옵션 자체가 없다(메시지에 탈출구 옵션명도 없다 · R3 전이 패턴).
//   DK3 RED       — `ignore` 와 `warn` 의 차이가 아예 없다(3값 enum 이 사실상 2값이 되는 것을 막는다).
//   DK4 RED       — **분리의 실증**: 같은 `ignore` 에서 평범한 데드링크는 살고 동명충돌은 죽는다.
//   DK5 RED       — enum 위반이 `--env` 와 같은 fail-loud 여야 한다(오타의 조용한 warn 폴백 금지).
//   DK6 RED(flip) — 호환 별칭 부재 pin(원장 ⑨ · Task 8 GOTCHA: 실호출자 0이므로 별칭을 남기지 않는다).
//   DK7 RED       — 기본값 `warn`(출처 = PRD D11).
//   DK8 pin       — 게이트 **순서** 보존(conventions → schema → deadlinks → feedResolution → strayDocs).
//
// 비용(§7.3): CLI 를 spawn 하지 않는다 — `parseArgs`·`buildContent` 를 import 해 in-process 로 문다.
import { describe, expect, it } from 'vitest'

import { buildContent, parseArgs } from '../validate.mjs'
import { cleanup, commit, git, initVault, writeDoc } from './helpers/tmp-git-vault.mjs'

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

describe('데드링크는 빌드를 죽이지 않는다 (DK1·DK2·DK3 · PRD D11)', () => {
  it('DK1: 옵션 미지정이면 throw 하지 않고 데드링크 1건이 관측 가능하다 (🔴RED(flip))', () => {
    const vault = seedDeadlinkVault()
    try {
      // ★ 위험 실재 앵커(규범 B): 이 픽스처가 **정말** 데드링크를 만든다 — `error` 로 세우면 건수와
      //   함께 죽는다. 이 앵커가 없으면 링크가 아예 없는 픽스처로 "안 죽는다" 를 공허 통과시킨다.
      expect(() => buildContent({ deadlinks: 'error', env: 'dev', vault })).toThrow(/데드링크/)

      const { stats } = buildContent({ env: 'dev', vault })

      expect(reasonsOf(stats)).toEqual(['대상 문서 없음'])
    } finally {
      cleanup(vault)
    }
  })

  it('DK2: `--deadlinks error` 로 되돌리면 건수와 **탈출구 옵션명**을 함께 말하며 죽는다 (🔴RED)', () => {
    // R3 전이 패턴: 실패 메시지에 탈출구 설정 이름을 함께 출력한다. "옵션을 받지만 무시" 하는 구현을
    //   red 로 만든다 — 옵션명이 없으면 사용자는 무엇을 눌러야 넘어가는지 모른다.
    const vault = seedDeadlinkVault()
    try {
      expect(() => buildContent({ deadlinks: 'error', env: 'dev', vault })).toThrow(/데드링크 1건/)
      expect(() => buildContent({ deadlinks: 'error', env: 'dev', vault })).toThrow(/--deadlinks/)
    } finally {
      cleanup(vault)
    }
  })

  it('DK3: `ignore` 는 `warn` 과 다르다 — throw 도 없고 리포트도 없다 (🔴RED)', () => {
    const vault = seedDeadlinkVault()
    try {
      // 앵커: 같은 vault 가 `error` 에서는 죽는다(픽스처가 비어 있지 않다).
      expect(() => buildContent({ deadlinks: 'error', env: 'dev', vault })).toThrow(/데드링크/)

      const { stats } = buildContent({ deadlinks: 'ignore', env: 'dev', vault })

      expect(stats.deadlinks).toEqual([]) // 세지도 않는다 — 3값 enum 이 사실상 2값이 되면 red
    } finally {
      cleanup(vault)
    }
  })
})

describe('동명 문서 충돌은 심각도 옵션에서 분리된다 (DK4 🔴RED · R3 신규 결정)', () => {
  it('DK4: 같은 `ignore` 에서 평범한 데드링크는 살고 **동명 충돌은 죽는다**', () => {
    const deadVault = seedDeadlinkVault()
    const ambiguousVault = seedAmbiguousVault()
    try {
      // ★ 앵커: 옵션이 실제로 게이트를 끈다 — 이게 없으면 "ignore 에서도 throw" 가 그저 옵션 미구현
      //   때문인지(현행) 분리 결정 때문인지(P2) 구분되지 않는다.
      expect(() => buildContent({ deadlinks: 'ignore', env: 'dev', vault: deadVault })).not.toThrow() // prettier-ignore

      expect(() => buildContent({ env: 'dev', vault: ambiguousVault })).toThrow(/동명 문서 충돌/)
      expect(() =>
        buildContent({ deadlinks: 'ignore', env: 'dev', vault: ambiguousVault }),
      ).toThrow(/동명 문서 충돌/)
    } finally {
      cleanup(deadVault, ambiguousVault)
    }
  })
})

describe('parseArgs — 새 옵션 계약 (DK5·DK6·DK7 🔴RED · 원장 ⑨)', () => {
  it('DK5: `--deadlinks loud` 는 허용값을 말하며 죽는다(`--env` 와 같은 fail-loud)', () => {
    // 오타가 **조용히 warn 으로 폴백**하면 저자는 강화해 둔 줄 알고 넘어간다.
    expect(() => parseArgs(['--deadlinks', 'loud'])).toThrow(/ignore|warn|error/)
  })

  it('DK6: `--allow-deadlinks` 는 호환 별칭으로 남지 않는다(실호출자 0 · Task 8 GOTCHA)', () => {
    expect(() => parseArgs(['--allow-deadlinks'])).toThrow(/알 수 없는 인자/)
  })

  it('DK7: 기본값은 `warn` 이다(출처 = PRD D11 제품 결정 · 리서치 아님)', () => {
    expect(parseArgs([]).deadlinks).toBe('warn')
    expect(parseArgs(['--deadlinks', 'error']).deadlinks).toBe('error') // 두 번째 케이스
  })
})

describe('게이트 순서는 보존된다 (DK8 · pin · Task 8 GOTCHA)', () => {
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
      expect(() => buildContent({ deadlinks: 'error', env: 'dev', vault })).toThrow(/컨벤션 위반/)
      expect(() => buildContent({ env: 'dev', vault })).toThrow(/컨벤션 위반/)
      expect(() => buildContent({ env: 'dev', vault })).not.toThrow(/데드링크/)
    } finally {
      cleanup(vault)
    }
  })
})
