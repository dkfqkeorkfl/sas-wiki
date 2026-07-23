// @vitest-environment node
//
// P1 · Task 2C — endpoints.wiki 계약 pin (D5 · 3창구 정형화) — tdd §Task 2C
//
// RED 사유: `scripts/lib/endpoints.mjs` **부재** → 지연 import 가 "Cannot find module" 로 throw
//   → 전 케이스 수집 실패 RED. (정적 import 는 소비자 eslint import-x/no-unresolved 로 RED 커밋 차단 → 런타임 지연.)
//
// GFS/RED 정직 표기(behavior 기준): W1~W4 = 🟢GFS(buildBody per-doc 투영 + seam getWikiDoc 상속 회귀 가드 —
//   endpoints.mjs 트리비얼 wrap 후 즉시 green). wiki 는 미구현 hardening 지점이 아니다(계약 선택 pin).
//
// 계약(GREEN 이 구현):
//   wiki(payload, ref) → ref(=path, canonical) **1문서**.
//     active → { html, headings, meta, sources, …식별메타 }(본문 4키 + 식별). 없는 path → null(throw 아님).
//     disable → status='disable' 스텁(throw 아님). 요청 path 문서만 — 이웃 문서 본문이 새지 않는다(격리).
//   본문 소싱: payload.bodies(active 본문 레코드, breadcrumb 키잉) · disable 스텁: payload.docs.
import { describe, expect, it } from 'vitest'

import { aDisableStub } from './helpers/payload-builders.mjs'
import { aPayload, DOC_A, DOC_B, DOC_D } from './helpers/endpoint-builders.mjs'

const { wiki } = await import(new URL('../endpoints.mjs', import.meta.url).href)

/** active 본문 레코드(breadcrumb·status + 본문 4키) — buildBody 입력 형태(payloads.test.mjs 미러). */
function aBodyRecord(patch = {}) {
  return {
    breadcrumb: ['company', '삼성전자'],
    headings: [{ anchor: 'hbm-사업', level: 2, text: 'HBM 사업' }],
    html: '<h2 id="hbm-사업">HBM 사업</h2>',
    meta: { ticker: '005930' },
    sources: [],
    status: 'active',
    ...patch,
  }
}

const B_HTML = '<h2 id="공급망">공급망</h2>'

/** active 2(A·B) + disable 스텁 1(D) 세계관 — wiki 가 bodies·docs 양쪽을 소싱함을 드러낸다. */
function aWikiPayload() {
  return aPayload({
    bodies: [
      aBodyRecord(),
      aBodyRecord({
        breadcrumb: ['tech', 'HBM'],
        headings: [{ anchor: '공급망', level: 2, text: '공급망' }],
        html: B_HTML,
      }),
    ],
    docs: [aDisableStub().build()], // DOC_D disable 스텁(breadcrumb concept/온디바이스-AI)
  })
}

describe('endpoints.wiki — per-document (🟢GFS 회귀 가드)', () => {
  it('W1: ref=path → 그 문서 1건(본문 4키 존재)', () => {
    const doc = wiki(aWikiPayload(), DOC_A.path)

    expect(doc).not.toBeNull()
    expect(doc.html).toBe('<h2 id="hbm-사업">HBM 사업</h2>')
    expect(doc.headings).toEqual([{ anchor: 'hbm-사업', level: 2, text: 'HBM 사업' }])
    expect(doc).toHaveProperty('meta')
    expect(doc).toHaveProperty('sources')
  })

  it('W2: 없는 path → null(throw 아님)', () => {
    expect(wiki(aWikiPayload(), '없는/경로')).toBeNull()
  })

  it('W3: disable 문서 → status=disable 스텁(throw 아님)', () => {
    const doc = wiki(aWikiPayload(), DOC_D.path)

    expect(doc).not.toBeNull()
    expect(doc.status).toBe('disable')
  })

  it('W4: ref=path 는 다른 문서로 새지 않는다(요청 문서만 · 이웃 본문 미포함)', () => {
    const doc = wiki(aWikiPayload(), DOC_A.path)

    expect(doc.html).not.toContain('공급망') // 이웃 문서 B 의 본문이 섞이지 않는다
    expect(wiki(aWikiPayload(), DOC_B.path).html).toBe(B_HTML) // B 는 정확히 B
  })
})
