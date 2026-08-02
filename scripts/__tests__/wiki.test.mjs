// @vitest-environment node
//
// P1 · Task 3 — endpoints.wiki **on-demand per-doc git read+render** 전환 (D5 재작업) — tdd §Task 3 (E-W)
//
// RED 사유(엔진 전환): 초판 `wiki(payload, ref)` 는 pre-parsed payload.bodies 에서 1건을 골랐다(git·렌더
//   미접근). 재작업 계약은 `wiki(vault, env, ref=path)` — 그 path 문서 **1건만** git 에서 읽어
//   renderMarkdownToHtml 렌더·투영한다. 아래는 1번째 인자에 **vault 경로 문자열**을 넘긴다 → 현행이
//   `vault.bodies.find` 를 호출해 **TypeError**(의도한 미구현)로 실패한다.
//
// 계약(GREEN 이 구현):
//   wiki(vault, env, ref) → 그 path 문서 1건 { html, headings, meta, sources, path, status, breadcrumb }.
//     없는 path → null(throw 아님) · disable → status='disable' 스텁 · 요청 path 만(이웃 본문 격리).
//     렌더는 renderMarkdownToHtml **재사용**(build 렌더 경로와 동일 · 회귀 0).
//   P5 · §4 원장 ㉖-c — `wiki()` 가 async 가 됐다. 단언 **내용**은 무변경 — `await` 만 붙는다.
import { describe, expect, it } from 'vitest'

import { prebuildArtifacts } from './helpers/prebuild-artifacts.mjs'
import { cleanup, commit, initVault, writeDoc } from './helpers/tmp-git-vault.mjs'

const { wiki } = await import(new URL('../wiki.mjs', import.meta.url).href)

const ID_A = '0192a000-0000-7000-8000-0000000000aa'
const ID_B = '0192b000-0000-7000-8000-0000000000bb'
const ID_D = '0192d000-0000-7000-8000-0000000000dd'

const PATH_A = 'company/삼성전자'
const PATH_B = 'tech/HBM'
const PATH_DISABLE = 'concept/온디바이스-AI'

/** active 2(A·B, 서로 다른 heading) + disable 1(D) 세계관 — 격리·disable 스텁을 드러낸다. */
function seedWorld(vault) {
  writeDoc(vault, PATH_A, { body: '## HBM 사업\n\n삼성 본문.\n', id: ID_A, title: '삼성전자', type: 'company' }) // prettier-ignore
  writeDoc(vault, PATH_B, { body: '## 공급망\n\n공급망 본문.\n', id: ID_B, title: 'HBM', type: 'concept' }) // prettier-ignore
  writeDoc(vault, PATH_DISABLE, { id: ID_D, status: 'disable', title: '온디바이스 AI', type: 'concept' }) // prettier-ignore
  commit(vault, 'chore: active 2 + disable 1 생성')
}

describe('endpoints.wiki — per-doc git read+render (E-W1 🔴RED 전환)', () => {
  it('E-W1: wiki(vault, env, path) → 그 문서 1건(본문 렌더) · 이웃 본문 미포함(격리)', async () => {
    const vault = initVault()
    try {
      seedWorld(vault)
      await prebuildArtifacts(vault, 'dev')

      const doc = await wiki(vault, 'dev', PATH_A)

      expect(doc).not.toBeNull()
      expect(doc.html).toContain('<h2')
      expect(doc.html).toContain('HBM 사업')
      expect(doc.headings.length).toBeGreaterThan(0)
      expect(doc).toHaveProperty('meta')
      expect(doc).toHaveProperty('sources')
      expect(doc.html).not.toContain('공급망') // 이웃 문서 B 본문이 새지 않는다
      expect((await wiki(vault, 'dev', PATH_B)).html).toContain('공급망') // B 는 정확히 B
    } finally {
      cleanup(vault)
    }
  })
})

describe('endpoints.wiki — 계약 pin (E-W2·E-W3 🟢GFS)', () => {
  it('E-W2: 없는 path → null(throw 아님)', async () => {
    const vault = initVault()
    try {
      seedWorld(vault)
      await prebuildArtifacts(vault, 'dev')

      expect(await wiki(vault, 'dev', '없는/경로')).toBeNull()
    } finally {
      cleanup(vault)
    }
  })

  it('E-W3: disable 문서 → status="disable" 스텁(throw 아님)', async () => {
    const vault = initVault()
    try {
      seedWorld(vault)
      await prebuildArtifacts(vault, 'dev')

      const doc = await wiki(vault, 'dev', PATH_DISABLE)

      expect(doc).not.toBeNull()
      expect(doc.status).toBe('disable')
    } finally {
      cleanup(vault)
    }
  })
})
