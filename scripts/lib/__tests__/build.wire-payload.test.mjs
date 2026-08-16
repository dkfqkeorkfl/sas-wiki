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

import { cleanup, commit, feedCommit, initVault, writeDoc } from '../../__tests__/helpers/tmp-git-vault.mjs' // prettier-ignore

const { parseVault } = await import(new URL('../parse-vault.mjs', import.meta.url).href)
const build = await import(new URL('../../validate.mjs', import.meta.url).href)

const SCHEMA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'schema')
const wireOf = (vault, env) => parseVault(vault, env, SCHEMA_DIR).wire

const ID_A = '0192a000-0000-7000-8000-0000000000aa'
const ID_DRAFT = '0192b000-0000-7000-8000-0000000000bb'

const SHAPE_KEYS = ['bodies', 'docs', 'generatedAt', 'ignore', 'items', 'sourceCommit', 'tags', 'tree'] // prettier-ignore

/** active 1(prod 가시) + draft 1(dev/ 폴더) + feed 1(active 문서 대상). */
function seedVault(vault) {
  // 두 문서를 **각각** chore 커밋으로 시드한다.
  // WP3 은 buildContent(전량 검증)를 직접 호출해 parseVault(...).wire 와 대조하므로, 시드가 컨벤션을
  // 지켜야 한다(그러지 않으면 buildContent 의 게이트가 던진다) — WP1·WP2·WP4 는 parseVault(...).wire
  // 만 호출해 게이트를 타지 않으므로 이 요구가 없다. 문서 집합·draft 구성은 불변이다.
  // type 은 concept 로 둔다 — company 는 스키마상 meta(ticker·sector·exchange)를 요구하는데 시딩
  // 헬퍼가 meta 를 내지 못해 buildContent 검증이 막힌다(WP 는 type·meta 를 단언하지 않는다).
  writeDoc(vault, 'company/삼성전자', { id: ID_A, title: '삼성전자', type: 'concept' })
  commit(vault, 'chore: 삼성전자 생성')
  writeDoc(vault, 'dev/실험문서', { id: ID_DRAFT, title: '실험 문서', type: 'concept' })
  commit(vault, 'chore: dev 실험문서 생성')
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

      // ★ `arrayContaining` 은 부분집합 검사라 계약에 없는 **여분 키**가 섞여도 통과한다(SILENT_PASS —
      //   예: 실수로 내부 필드를 wire 에 흘려도 잡지 못한다). SHAPE_KEYS 는 이미 정렬된 8키 전체이므로
      //   `toSorted()` 결과와 **정확히** 같아야 한다 — 부족도 초과도 여기서 잡는다.
      expect(keys).toEqual(SHAPE_KEYS)
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
  it('WP3: parseVault(...).wire.docs 가 buildContent summary.docs 와 필드까지 동일하다(파싱 엔진 공유)', () => {
    const vault = initVault()
    try {
      seedVault(vault)

      // ★ id 집합만 비교하면 본문 파생물(excerpt)·tags 등이 두 경로 사이에서 갈려도(예: 한쪽만
      //   조용히 truncate·drop) 잡히지 않는다(SILENT_PASS) — id 로 정렬한 **전체 문서 객체**를
      //   비교한다. `wire.docs` 는 derive.mjs 가 이미 summary 계약 키(ACTIVE_DOC_KEYS)와 동일한
      //   10키로 낸다(disable 스텁은 4키로 동일) — 두 경로가 같은 파싱 엔진을 공유하면 완전히
      //   같아야 한다.
      const byId = (a, b) => a.id.localeCompare(b.id)
      const wireDocs = wireOf(vault, 'dev').docs.toSorted(byId)
      // `out` 은 buildContent() 가 받지 않는 옵션이다(죽은 픽스처였다 — makeOut() 을 걷어냈다).
      const built = build.buildContent({ env: 'dev', vault })
      const summaryDocs = built.summary.docs.toSorted(byId)

      expect(summaryDocs).toEqual(wireDocs) // 같은 파싱 엔진이므로 buildContent 와 갈리지 않는다
    } finally {
      cleanup(vault)
    }
  })
})
