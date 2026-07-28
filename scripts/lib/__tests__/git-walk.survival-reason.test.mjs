// @vitest-environment node
//
// P2 · Task 2 — 서빙 경로가 참조 소실 **사유**를 안다 (`git-walk.mjs:walkFeeds`) — tdd §3.2 (RR1~RR6)
//
// 무엇이 바뀌는가: 지금 `resolveDocId` 는 "못 찾음" 하나로 끝난다 → **삭제된 문서**를 가리킨 참조와
//   **prod 에서 draft 배제된** 문서를 가리킨 참조가 구분되지 않는다. D-A 는 앞을 살리고(D9) 뒤를
//   막는다(D2 fail-closed). 사유를 값으로 만들지 않으면 두 요구가 동시에 성립할 수 없다.
//
// RED 사유(라벨별):
//   RR1·RR2  RED(flip) — 현행 `git-walk.mjs:169` 가 `docs.length === 0 → continue` 로 드랍하고,
//                        prod 는 draft 를 pathIndex/headIds 에서 빼 두 사유를 뭉갠다.
//                        뒤집히는 기존 단언: tdd §4 원장 ①(`git-walk.test.mjs:166` GW6).
//   RR3      pair       — GREEN 이후 항상 통과해야 하는 짝(같은 "빈 docs" 라도 하나는 살고 하나는 죽는다).
//   RR4      pin(실측)  — 현행도 통과한다(부분 resolve). 사유 도입이 과잉 차단으로 번지면 red.
//   RR5      pin        — `env !== 'dev'` fail-closed 극성. **비교 형태**로 걸어 GREEN 전후 모두 통과한다.
//   RR6      pair       — `isDraft` SSOT 재사용(폴더 신호 ≡ frontmatter 플래그). 역시 비교 형태.
//
// 자기참조 공허성(tdd §2.3): 경로·prefix·사유는 전부 **리터럴**이다(`WIKI_PREFIX` import 금지).
//   `writeDoc(..., { wikiRoot: 'wiki' })` 를 항상 명시한다(P1 §3.8(E) 규약 계승).
// 위험 실재 앵커(규범 B): "prod 에 없다" 단언 앞에 **dev 에는 있다**가 먼저 온다 — 픽스처가 그 피드를
//   만들긴 했는지를 증명하지 않으면 부재 단언은 공허하다(P1 FP4 전례).
import { describe, expect, it } from 'vitest'

import { ID_A, ID_B, T2, seedSurvivalVault } from '../../__tests__/helpers/survival-vault.mjs'
import { cleanup, commit, feedCommit, initVault, writeDoc } from '../../__tests__/helpers/tmp-git-vault.mjs' // prettier-ignore

const { walkFeeds } = await import(
  new URL('../../__tests__/helpers/walk-feeds.mjs', import.meta.url).href
)

const titlesOf = (items) => items.map((item) => item.title)
const docIdsOf = (items, title) =>
  items.find((item) => item.title === title)?.docs.map((doc) => doc.id)

describe('walkFeeds — 삭제 사유는 연결만 끊고 피드는 남긴다 (RR1 🔴RED(flip) · 원장 ①)', () => {
  it('RR1: dev 는 3건이고 폐기 소식의 docs 가 []다(제목만 살고 연결이 전멸하는 것도 아니다)', () => {
    const vault = seedSurvivalVault()
    try {
      const items = walkFeeds(vault, { count: 50, env: 'dev' })

      // 앵커: 개수가 먼저다. 3건이 아니면 아래 항목별 단언이 무엇을 보고 있는지 알 수 없다.
      expect(items).toHaveLength(3)
      expect(titlesOf(items)).toEqual(['폐기 소식', '실험 소식', '공개 소식'])
      expect(docIdsOf(items, '폐기 소식')).toEqual([]) // D9 — 삭제는 연결만 끊는다
      expect(docIdsOf(items, '실험 소식')).toEqual([ID_B])
      expect(docIdsOf(items, '공개 소식')).toEqual([ID_A])
    } finally {
      cleanup(vault)
    }
  })
})

describe('walkFeeds — prod 는 삭제(생존)와 draft 배제(미노출)를 가른다 (RR2·RR3)', () => {
  it('RR2: prod 는 2건 — 폐기 소식은 살고 실험 소식은 부재다 (🔴RED(flip))', () => {
    const vault = seedSurvivalVault()
    try {
      // ★ 위험 실재 앵커(규범 B): 부재 단언 전에 **dev 에서는 그 피드가 나온다**를 먼저 증명한다.
      //   이게 없으면 "픽스처가 애초에 실험 소식을 안 만들었다" 와 구분되지 않는다(P1 FP4 형).
      expect(titlesOf(walkFeeds(vault, { count: 50, env: 'dev' }))).toContain('실험 소식')

      const items = walkFeeds(vault, { count: 50, env: 'prod' })

      expect(items).toHaveLength(2)
      expect(titlesOf(items)).toEqual(['폐기 소식', '공개 소식'])
      expect(titlesOf(items)).not.toContain('실험 소식') // D2 fail-closed — 예제 누출 차단
    } finally {
      cleanup(vault)
    }
  })

  it('RR3: 같은 "빈 docs" 라도 하나는 살고 하나는 죽는다(사유 구분의 최종 관측점 · pair)', () => {
    // 오분류하면 둘 다 살거나(누출) 둘 다 죽는다(D9 소멸) — 이 짝이 그 두 실패를 동시에 배제한다.
    const vault = seedSurvivalVault()
    try {
      const items = walkFeeds(vault, { count: 50, env: 'prod' })

      expect(docIdsOf(items, '폐기 소식')).toEqual([]) // 삭제 → 생존하되 연결 0
      expect(docIdsOf(items, '공개 소식')).toEqual([ID_A]) // 정상 → 연결 유지
      expect(docIdsOf(items, '실험 소식')).toBeUndefined() // draft 배제 → 피드 자체가 없다
    } finally {
      cleanup(vault)
    }
  })
})

describe('walkFeeds — 남은 문서가 있으면 prod 에서도 산다 (RR4 · 과잉 차단 가드)', () => {
  it('RR4: 한 feed 커밋이 공개+실험을 함께 고치면 prod 에서 생존하고 docs 는 공개 1건이다', () => {
    // SV5 의 실 git 대응. D-A 표를 "draft 가 섞이면 통째로 숨김" 으로 읽으면 여기서 red 다.
    const vault = initVault()
    try {
      writeDoc(vault, 'company/공개', { id: ID_A, wikiRoot: 'wiki' })
      writeDoc(vault, 'dev/실험', { id: ID_B, wikiRoot: 'wiki' })
      commit(vault, 'chore: 초기 문서 2건')
      writeDoc(vault, 'company/공개', { body: '## 정의\n\n동시 갱신.\n', id: ID_A, wikiRoot: 'wiki' }) // prettier-ignore
      writeDoc(vault, 'dev/실험', { body: '## 정의\n\n동시 갱신.\n', id: ID_B, wikiRoot: 'wiki' })
      feedCommit(vault, { date: T2, subject: '동시 소식' })

      // 앵커: dev 에서는 두 문서가 다 붙는다 → 픽스처가 정말 "둘 다 건드린" 커밋을 만들었다.
      expect(
        docIdsOf(walkFeeds(vault, { count: 50, env: 'dev' }), '동시 소식')?.toSorted(),
      ).toEqual([ID_A, ID_B].toSorted())

      const items = walkFeeds(vault, { count: 50, env: 'prod' })

      expect(titlesOf(items)).toContain('동시 소식')
      expect(docIdsOf(items, '동시 소식')).toEqual([ID_A])
    } finally {
      cleanup(vault)
    }
  })
})

describe('walkFeeds — fail-closed 극성 pin (RR5 · Task 2 GOTCHA)', () => {
  it("RR5: env 가 ''·'staging' 이어도 prod 와 **동일 결과**다(`env !== 'dev'` 유지)", () => {
    // `env === 'prod'` 로 뒤집으면 오타·빈 문자열이 노출로 샌다. 절대값이 아니라 **prod 와의 동치**로
    //   거는 이유: 이 못은 GREEN 전후 모두 성립해야 하는 극성 가드다(값은 RR2 가 문다).
    const vault = seedSurvivalVault()
    try {
      const prod = titlesOf(walkFeeds(vault, { count: 50, env: 'prod' }))
      const dev = titlesOf(walkFeeds(vault, { count: 50, env: 'dev' }))

      // 앵커: dev 와 prod 가 실제로 다르다 — 같으면 아래 동치 단언이 아무것도 구분하지 못한다.
      expect(dev).not.toEqual(prod)
      expect(titlesOf(walkFeeds(vault, { count: 50, env: '' }))).toEqual(prod)
      expect(titlesOf(walkFeeds(vault, { count: 50, env: 'staging' }))).toEqual(prod)
      expect(titlesOf(walkFeeds(vault, { count: 50 }))).toEqual(prod) // 미지정도 숨김
    } finally {
      cleanup(vault)
    }
  })
})

describe('walkFeeds — isDraft SSOT 재사용 (RR6 · pair)', () => {
  it('RR6: frontmatter `draft: true` 문서는 `dev/` 폴더 문서와 동일하게 취급된다(재구현 금지)', () => {
    // 폴더 신호만 보는 구현이면 여기서 red 다 — `draft.mjs` 를 그대로 쓰는지 묻는 못.
    const folderVault = seedSurvivalVault({ draftBy: 'folder' })
    const flagVault = seedSurvivalVault({ draftBy: 'frontmatter' })
    try {
      // 앵커: 플래그 vault 의 dev 결과에 실험 소식이 실제로 있다(픽스처가 그 피드를 만들었다).
      expect(titlesOf(walkFeeds(flagVault, { count: 50, env: 'dev' }))).toContain('실험 소식')

      const flagProd = titlesOf(walkFeeds(flagVault, { count: 50, env: 'prod' }))

      expect(flagProd).not.toContain('실험 소식')
      expect(flagProd).toEqual(titlesOf(walkFeeds(folderVault, { count: 50, env: 'prod' })))
    } finally {
      cleanup(folderVault, flagVault)
    }
  })
})
