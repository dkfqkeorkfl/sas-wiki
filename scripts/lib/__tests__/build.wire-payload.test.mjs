// @vitest-environment node
//
// P1 · Task 1 — build.mjs `buildWirePayload(vault, env)` 순수 export 추출 (생산측 seam) — tdd §Task 1
//
// RED 사유: `build.mjs` 에 `buildWirePayload` export 가 **아직 없다** → 지연 import 후 destructure 가
//   `undefined` → WP1 은 typeof 불일치, WP2/WP4 는 `undefined()` **TypeError**(의도한 미구현). build.mjs 는
//   존재하나 pre-wire 파싱 조립을 순수 export 로 아직 뽑지 않았다(추출 미구현).
//
// 계약(GREEN 이 구현): buildContent 내부 pre-wire 파싱 조립(git→pre-wire)을 `buildWirePayload(vault, env)`
//   **순수 export** 로 추출(재사용, 재작성 아님). validator 파이프라인(checkInvariants·validatePayloads·write)은
//   그 위에 검증을 얹는다 → build.mjs 검증 동작·CLI·출력 **무변경**(추출=리팩터).
//   반환 shape ⊇ { bodies, docs, generatedAt, ignore, items, sourceCommit, tags, tree }.
//   env='prod' → draft 문서 제외(visibleDocs 상속) · env='dev' → 전량.
import { describe, expect, it } from 'vitest'

import { cleanup, commit, feedCommit, initVault, makeOut, writeDoc } from '../../__tests__/helpers/tmp-git-vault.mjs' // prettier-ignore

const { buildWirePayload } = await import(new URL('../parse-vault.mjs', import.meta.url).href)
const build = await import(new URL('../../validate.mjs', import.meta.url).href)

const ID_A = '0192a000-0000-7000-8000-0000000000aa'
const ID_DRAFT = '0192b000-0000-7000-8000-0000000000bb'

const SHAPE_KEYS = ['bodies', 'docs', 'generatedAt', 'ignore', 'items', 'sourceCommit', 'tags', 'tree'] // prettier-ignore

/** active 1(prod 가시) + draft 1(dev/ 폴더) + feed 1(active 문서 대상). */
function seedVault(vault) {
  // cwiki 는 신규 vault 문서 1개만 추가해야 한다(컨벤션) → 두 문서를 **각각** cwiki 커밋으로 시드한다.
  // WP3 은 buildContent(전량 검증)를 직접 호출해 buildWirePayload 와 대조하므로, 시드가 컨벤션을
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

describe('buildWirePayload — 추출·shape (WP1·WP2 🔴RED)', () => {
  it('WP1: buildWirePayload export 가 존재한다', () => {
    expect(typeof buildWirePayload).toBe('function')
  })

  it('WP2: 반환 shape 이 pre-wire 데이터셋(8키)을 포함한다', () => {
    const vault = initVault()
    try {
      seedVault(vault)

      const keys = Object.keys(buildWirePayload(vault, 'dev')).toSorted()

      expect(keys).toEqual(expect.arrayContaining(SHAPE_KEYS))
    } finally {
      cleanup(vault)
    }
  })
})

describe('buildWirePayload — draft 필터 상속 (WP4 🔴RED)', () => {
  it('WP4: env="prod" 는 draft 문서를 제외하고 env="dev" 는 포함한다', () => {
    const vault = initVault()
    try {
      seedVault(vault)

      const prodIds = buildWirePayload(vault, 'prod').docs.map((doc) => doc.id)
      const devIds = buildWirePayload(vault, 'dev').docs.map((doc) => doc.id)

      expect(prodIds).toContain(ID_A)
      expect(prodIds).not.toContain(ID_DRAFT) // draft 제외
      expect(devIds).toContain(ID_DRAFT) // dev 는 전량
    } finally {
      cleanup(vault)
    }
  })
})

describe('buildWirePayload — build.mjs 산출 회귀 0 (WP3 🟡CARRIED)', () => {
  it('WP3: buildWirePayload.docs id 집합이 buildContent summary 와 동일하다(추출=동작 불변)', () => {
    const vault = initVault()
    const out = makeOut()
    try {
      seedVault(vault)

      const wireIds = buildWirePayload(vault, 'dev')
        .docs.map((doc) => doc.id)
        .toSorted()
      const built = build.buildContent({ env: 'dev', out, vault })
      const summaryIds = built.summary.docs.map((doc) => doc.id).toSorted()

      expect(wireIds).toEqual(summaryIds) // 추출된 파싱이 buildContent 와 갈리지 않는다
    } finally {
      cleanup(vault, out)
    }
  })
})
