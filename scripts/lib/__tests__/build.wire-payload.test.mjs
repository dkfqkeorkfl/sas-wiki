// @vitest-environment node
//
// P1 · Task 1 — build.mjs pre-wire 파싱 순수 export 추출 (생산측 seam) — tdd §Task 1
//
// P5 Task 9(D-I) 재작성 사유: 이 파일은 원래 `buildWirePayload(vault, env)`(얕은 티어 wrapper)를
//   추출·검증했다. `deepDocGate` 스위치가 사라지며 그 wrapper 는 `parseVault(vault, env, schemaDir).wire`
//   와 완전히 같은 값을 내는 1줄짜리 함수가 됐고(D-I), 심볼 자체가 삭제됐다(§4.5 ㉔ = 삭제). 아래는
//   같은 계약(shape·draft 필터·build.mjs 산출 회귀 0)을 `parseVault(...).wire` 좌표로 옮긴 것이다 —
//   단언 **내용은 무변경**이다.
import { describe, expect, it } from 'vitest'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { cleanup, commit, feedCommit, initVault, makeOut, writeDoc } from '../../__tests__/helpers/tmp-git-vault.mjs' // prettier-ignore

const { parseVault } = await import(new URL('../parse-vault.mjs', import.meta.url).href)
const build = await import(new URL('../../validate.mjs', import.meta.url).href)

const SCHEMA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'schema')
const wireOf = (vault, env) => parseVault(vault, env, SCHEMA_DIR).wire

const ID_A = '0192a000-0000-7000-8000-0000000000aa'
const ID_DRAFT = '0192b000-0000-7000-8000-0000000000bb'

const SHAPE_KEYS = ['bodies', 'docs', 'generatedAt', 'ignore', 'items', 'sourceCommit', 'tags', 'tree'] // prettier-ignore

/** active 1(prod 가시) + draft 1(dev/ 폴더) + feed 1(active 문서 대상). */
function seedVault(vault) {
  // cwiki 는 신규 vault 문서 1개만 추가해야 한다(컨벤션) → 두 문서를 **각각** cwiki 커밋으로 시드한다.
  // WP3 은 buildContent(전량 검증)를 직접 호출해 parseVault(...).wire 와 대조하므로, 시드가 컨벤션을
  // 지켜야 검증을 통과한다. 문서 집합·draft 구성은 불변(단일 cwiki 2-add 는 그 자체가 위반이었다).
  // type 은 concept 로 둔다 — company 는 스키마상 meta(ticker·sector·exchange)를 요구하는데 시딩
  // 헬퍼가 meta 를 내지 못해 buildContent 검증이 막힌다(WP 는 type·meta 를 단언하지 않는다).
  writeDoc(vault, 'company/삼성전자', { id: ID_A, title: '삼성전자', type: 'concept' })
  commit(vault, 'cwiki: 삼성전자 생성')
  writeDoc(vault, 'dev/실험문서', { id: ID_DRAFT, title: '실험 문서', type: 'concept' })
  commit(vault, 'cwiki: dev 실험문서 생성')
  writeDoc(vault, 'company/삼성전자', { body: '## 정의\n\n갱신.\n', id: ID_A, title: '삼성전자', type: 'concept' }) // prettier-ignore
  feedCommit(vault, { date: '2026-01-05T00:00:00Z', subject: '삼성 HBM 소식' })
}

describe('parseVault(...).wire — shape (WP1·WP2 🟢회귀 · 좌표 이동)', () => {
  it('WP1: parseVault export 가 존재한다', () => {
    expect(typeof parseVault).toBe('function')
  })

  it('WP2: 반환 shape 이 pre-wire 데이터셋(8키)을 포함한다', () => {
    const vault = initVault()
    try {
      seedVault(vault)

      const keys = Object.keys(wireOf(vault, 'dev')).toSorted()

      expect(keys).toEqual(expect.arrayContaining(SHAPE_KEYS))
    } finally {
      cleanup(vault)
    }
  })
})

describe('parseVault(...).wire — draft 필터 상속 (WP4 🟢회귀 · 좌표 이동)', () => {
  it('WP4: env="prod" 는 draft 문서를 제외하고 env="dev" 는 포함한다', () => {
    const vault = initVault()
    try {
      seedVault(vault)

      const prodIds = wireOf(vault, 'prod').docs.map((doc) => doc.id)
      const devIds = wireOf(vault, 'dev').docs.map((doc) => doc.id)

      expect(prodIds).toContain(ID_A)
      expect(prodIds).not.toContain(ID_DRAFT) // draft 제외
      expect(devIds).toContain(ID_DRAFT) // dev 는 전량
    } finally {
      cleanup(vault)
    }
  })
})

describe('parseVault(...).wire — build.mjs 산출 회귀 0 (WP3 🟡CARRIED · 좌표 이동)', () => {
  it('WP3: parseVault(...).wire.docs id 집합이 buildContent summary 와 동일하다(파싱 엔진 공유)', () => {
    const vault = initVault()
    const out = makeOut()
    try {
      seedVault(vault)

      const wireIds = wireOf(vault, 'dev')
        .docs.map((doc) => doc.id)
        .toSorted()
      const built = build.buildContent({ env: 'dev', out, vault })
      const summaryIds = built.summary.docs.map((doc) => doc.id).toSorted()

      expect(wireIds).toEqual(summaryIds) // 같은 파싱 엔진이므로 buildContent 와 갈리지 않는다
    } finally {
      cleanup(vault, out)
    }
  })
})
