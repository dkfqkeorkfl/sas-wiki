// @vitest-environment node
//
// prod 전용 draft↔public 문서 ID 충돌 검출 — `loadHeadDocState` (DC0~DC3)
//
// 배경(자기완결): `loadHeadDocState` 는 `env === 'dev'` 면 draft 를 포함한 전 문서를 문서 게이트에
//   넘기고, 그 외(prod)에서는 draft 를 **걸러낸 뒤** 넘긴다. 문서 게이트의 중복 id 판정은 id 로만
//   그룹핑하므로, prod 에서는 draft 가 아예 시야에 들어오지 않는다. 결과:
//     · dev  — 같은 id 를 쓰는 public + draft 를 `DUPLICATE_ID` 2건으로 잡는다(오늘도 잡는다).
//     · prod — **무언 통과**한다(본 세션 실측). 비공개 문서가 공개 문서의 정체성을 조용히 겹쳐 쓴다.
//
// 결과 계약(GREEN 이 만족해야 할 것):
//   ① prod 에서 draft 가 공개 문서의 id 를 재사용하면 두 경로가 `DUPLICATE_ID` 로 제외된다.
//   ② dev 동작은 **바이트 단위로 불변**이다.
//   ③ 새 사유 코드를 만들지 않는다 — 기존 `DUPLICATE_ID` 를 재사용한다.
//   ④ 충돌이 없는 vault 는 prod·dev 모두 종전대로 통과한다.
//
// RED 사유(케이스별 · 본 세션 실측):
//   DC0 — 🟢 seam 선단언. 모듈·export 부재가 collection error 로 접혀 "테스트 0건 = PASS" 로
//         오보고되는 것을 막는다.
//   DC1 — 🔴RED. 오늘 `loadHeadDocState(vault, 'prod').excluded` 는 **빈 배열**이고 충돌한 두 문서가
//         `headDocs` 에 나란히 남는다.
//   DC2 — 🟢pin. dev 는 오늘 두 경로를 `DUPLICATE_ID` 로 제외하고 `headDocs` 가 빈다. 그 판정을
//         **재작성당하지 않게** 못박는다 — prod 를 고치려다 dev 공통 경로를 건드리면 여기서 red 다.
//   DC3 — 🟢pin. 사유 코드 목록이 순서까지 그대로다. 새 사유를 신설하면 산출물 스키마 enum·문서
//         계약·순서 단언이 동시에 깨지므로, 그 유혹을 여기서 막는다.
//
// ★ **"보고" 와 "배제" 는 분리되지 않는다.** 제외 목록은 그대로 검증 CLI 의 제외 게이트로 흘러가고
//   그 허용치 기본값이 0 이라, 충돌 문서를 제외에 넣는 순간 **prod 빌드가 실패**한다. 이 fail-closed
//   동작은 의도된 것이다 — vault 에 실수로 id 를 복사하면 고치기 전에는 배포가 되지 않는다.
//
// ★ **draft ↔ draft 충돌은 여기서 규정하지 않는다.** 계약은 draft 와 non-draft **사이**의 충돌이다.
//   요구되지 않은 규칙을 테스트로 굳히지 않는다.
//
// 규범 A: id·경로·사유 코드는 전부 **리터럴**이다(프로덕션 상수에서 유도하지 않는다).
// 규범 N: 개수 단독 단언 금지 — 집합을 정렬 리터럴로 못박는다.
// 규범 B/U: prod 단언 앞에 「dev 에서는 오늘도 잡힌다」 앵커를 둔다 — 그것이 없으면 픽스처가 애초에
//   충돌을 안 만든 경우와 구분되지 않는다.
// 규범 D: 시딩 헬퍼에는 `expect` 를 두지 않는다.
import { afterAll, describe, expect, it } from 'vitest'

import { cleanup, commit, initVault, writeDoc } from '../../__tests__/helpers/tmp-git-vault.mjs'

const headStateModule = await import(new URL('../head-state.mjs', import.meta.url).href).catch(
  (error) => ({ __loadError: error instanceof Error ? error.message : String(error) }),
)
const docGateModule = await import(new URL('../doc-gate.mjs', import.meta.url).href).catch(
  (error) => ({ __loadError: error instanceof Error ? error.message : String(error) }),
)

/** 로드 실패·export 부재를 **명시적 [RED]** 로 바꾼다 — undefined 호출의 TypeError 로 위장되지 않게. */
function loadHeadDocState(...args) {
  if (headStateModule.__loadError !== undefined) {
    throw new Error(`[RED] scripts/lib/head-state.mjs 로드 실패: ${headStateModule.__loadError}`)
  }
  if (typeof headStateModule.loadHeadDocState !== 'function') {
    throw new Error('[RED] scripts/lib/head-state.mjs 에 loadHeadDocState export 가 없다')
  }
  return headStateModule.loadHeadDocState(...args)
}

/** 규범 C10 — 각 케이스가 seam 존재를 먼저 단언한다. */
function expectSeamPresent() {
  expect(headStateModule.__loadError, 'scripts/lib/head-state.mjs 로드').toBeUndefined()
  expect(docGateModule.__loadError, 'scripts/lib/doc-gate.mjs 로드').toBeUndefined()
  expect(typeof headStateModule.loadHeadDocState, 'loadHeadDocState export').toBe('function')
  expect(Array.isArray(docGateModule.REASON_CODES), 'REASON_CODES export 가 배열').toBe(true)
}

const ID_SHARED = '0192a000-0000-7000-8000-0000000000aa'
const ID_OTHER = '0192b000-0000-7000-8000-0000000000bb'
const REL_PUBLIC = 'company/공개'
/** `wiki/dev/` 폴더 안의 문서는 그 위치만으로 draft 다(frontmatter 플래그와 동치인 두 신호 중 하나). */
const REL_DRAFT = 'dev/초안'
const PUBLIC_PATH = 'wiki/company/공개.md'
const DRAFT_PATH = 'wiki/dev/초안.md'
/** 제외 목록의 경로 좌표계. 정렬 리터럴로 못박는다(규범 N). */
const COLLIDING_PATHS = [PUBLIC_PATH, DRAFT_PATH].toSorted()
const DUPLICATE_MESSAGE = `중복 id 발견: ${ID_SHARED}`

const tmps = []
afterAll(() => cleanup(...tmps))

/** public 1건 + draft 1건이 **같은 id** 를 쓰는 vault. */
function seedCollisionVault() {
  const vault = initVault()
  tmps.push(vault)
  writeDoc(vault, REL_PUBLIC, { id: ID_SHARED })
  writeDoc(vault, REL_DRAFT, { id: ID_SHARED })
  commit(vault, 'chore: 공개 문서 + 같은 id draft')
  return vault
}

/** 형태는 같고 **id 만 다른** 대조군 vault. */
function seedDistinctVault() {
  const vault = initVault()
  tmps.push(vault)
  writeDoc(vault, REL_PUBLIC, { id: ID_SHARED })
  writeDoc(vault, REL_DRAFT, { id: ID_OTHER })
  commit(vault, 'chore: 공개 문서 + 다른 id draft')
  return vault
}

const pathsOf = (excluded) => excluded.map((entry) => entry.path).toSorted()

describe('seam 선단언 (DC0 · 🟢)', () => {
  it('DC0: `head-state.mjs`·`doc-gate.mjs` 가 로드되고 관측 대상 export 가 있다 (🟢)', () => {
    // 이 못이 없으면 모듈·export 부재가 collection error 로 접혀 **테스트 0건이 PASS 로 오보고**된다.
    expectSeamPresent()
  })
})

describe('prod 는 draft 의 공개 id 재사용을 잡는다 (DC1 · 🔴RED)', () => {
  it('DC1: prod 에서 두 경로가 `DUPLICATE_ID` 로 제외된다 (🔴RED)', () => {
    expectSeamPresent()
    const vault = seedCollisionVault()

    // 앵커 ①(규범 B): **같은 vault** 를 dev 로 보면 오늘도 두 경로가 제외된다 — 픽스처가 충돌을
    //   실제로 만들었음을 먼저 증명한다. 이게 없으면 prod 단언은 "충돌이 애초에 없었다" 와 같다.
    expect(pathsOf(loadHeadDocState(vault, 'dev').excluded), 'dev 제외 경로 앵커').toEqual(
      COLLIDING_PATHS,
    )

    // 앵커 ②(오탐 배제): 형태가 같고 id 만 다른 vault 는 prod 에서 제외가 0건이다 — 「전부 제외」로
    //   통과하는 하드코딩 구현을 배제한다.
    expect(
      loadHeadDocState(seedDistinctVault(), 'prod').excluded,
      '다른 id vault 의 prod 제외',
    ).toEqual([])

    const excluded = loadHeadDocState(vault, 'prod').excluded

    expect(pathsOf(excluded), 'prod 제외 경로 집합').toEqual(COLLIDING_PATHS)
    expect(
      excluded.map((entry) => entry.reasonCode),
      'prod 제외 사유 코드',
    ).toEqual(['DUPLICATE_ID', 'DUPLICATE_ID'])
    expect(
      excluded.map((entry) => entry.message.includes(ID_SHARED)),
      'prod 제외 메시지에 충돌 id 포함',
    ).toEqual([true, true])
  })
})

describe('dev 판정은 불변이다 (DC2 · 🟢pin)', () => {
  it('DC2: dev 는 두 경로를 `DUPLICATE_ID` 로 제외하고 `headDocs` 가 빈다 (🟢pin)', () => {
    expectSeamPresent()

    // 양성 대조를 케이스 안에 둔다(규범 B/U): 형태가 같고 id 만 다른 vault 는 dev 에서 제외 0건이고
    //   두 문서가 그대로 남는다. 이게 없으면 「dev 는 늘 전부 제외한다」는 구현도 아래를 통과한다.
    const clean = loadHeadDocState(seedDistinctVault(), 'dev')
    expect(clean.excluded, '다른 id vault 의 dev 제외').toEqual([])
    expect(
      clean.headDocs.map((doc) => doc.filePath).toSorted(),
      '다른 id vault 의 dev HEAD 문서',
    ).toEqual([PUBLIC_PATH, DRAFT_PATH].toSorted())

    const state = loadHeadDocState(seedCollisionVault(), 'dev')

    expect(pathsOf(state.excluded), 'dev 제외 경로 집합').toEqual(COLLIDING_PATHS)
    expect(
      state.excluded.map((entry) => entry.reasonCode),
      'dev 제외 사유 코드',
    ).toEqual(['DUPLICATE_ID', 'DUPLICATE_ID'])
    expect(
      state.excluded.map((entry) => entry.message),
      'dev 제외 메시지',
    ).toEqual([DUPLICATE_MESSAGE, DUPLICATE_MESSAGE])
    // 제외된 문서는 HEAD 문서 집합에서도 빠진다 — prod 를 고치려고 공통 경로를 건드리면 여기가 red 다.
    expect(
      state.headDocs.map((doc) => doc.filePath),
      'dev HEAD 문서',
    ).toEqual([])
  })
})

describe('사유 코드는 늘지 않는다 (DC3 · 🟢pin)', () => {
  it('DC3: `REASON_CODES` 가 7값이고 **순서까지** 그대로다 (🟢pin)', () => {
    // 이 배열의 순서는 우선순위이자 산출물 스키마 enum·문서 서술과 결속된 좌표다. 새 사유를 신설하면
    //   그 넷을 동시에 갱신해야 한다 — 이 못이 「조용히 하나 더 넣기」를 막는다.
    expectSeamPresent()

    expect(docGateModule.REASON_CODES, '문서 제외 사유 코드 목록').toEqual([
      'NO_FRONTMATTER',
      'MISSING_TYPE',
      'SCHEMA_VIOLATION',
      'DUPLICATE_PATH',
      'DUPLICATE_ID',
      'ID_TAMPERED',
      'DELETED_ID_REUSE',
    ])
  })
})
