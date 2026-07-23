// @vitest-environment node
//
// P1 · Task 2A — endpoints.summary 계약 pin (D5 · 3창구 정형화) — tdd §Task 2A
//
// RED 사유: `scripts/lib/endpoints.mjs` **부재** → 아래 지연 import 가 "Cannot find module" 로 throw →
//   이 파일의 전 케이스가 수집 실패로 RED 다. 정적 import 로 적으면 소비자 eslint import-x/no-unresolved 가
//   RED 커밋을 막으므로 해석을 런타임으로 미룬다(전례: ignore.test.mjs:17 · payloads.test.mjs:34 —
//   in-process 라 coverage 계측 유지).
//
// GFS/RED 정직 표기(behavior 기준 — 모듈 부재의 균일 RED 와 별개):
//   S1~S4 = 🟢GFS(payloads.buildSummary 투영 + build.mjs visibleDocs draft 필터 **상속** 회귀 가드 —
//           endpoints.mjs 트리비얼 wrap 후 즉시 green).
//   S5    = 🔴RED(빈 입력 경계 — 순진 구현이 throw/undocs 가능).
//
// 계약(GREEN 이 구현):
//   summary(payload, env) → { docs, generatedAt, schemaVersion, sourceCommit, tags, tree } 봉투.
//     docs 는 active=10키 / disable=4키 로 **투영**(잉여 키 차단 — payloads.mjs 와 동일 계약).
//     env='prod' → payload.docs 중 draft 마커(`draft:true`) 문서 **제외**(build.mjs:76 visibleDocs 상속).
//     env='dev'  → 전량 포함. generatedAt/sourceCommit 는 payload 주입값을 그대로 싣는다(시계 미독).
import { describe, expect, it } from 'vitest'

import { aDisableStub, aDoc } from './helpers/payload-builders.mjs'
import { aPayload, DOC_B, GENERATED_AT, SOURCE_COMMIT } from './helpers/endpoint-builders.mjs'

const { summary } = await import(new URL('../endpoints.mjs', import.meta.url).href)

const TREE = [{ children: [], docs: [aDoc().build().id], path: 'company' }]
const TAGS = { 반도체: [aDoc().build().id] }

/** active 문서 하나를 draft 로 표식 — env='prod' 에서 사라져야 한다(build.mjs isDraft 상속). */
function aDraftDoc() {
  return aDoc().with({
    breadcrumb: ['dev', '실험문서'],
    draft: true,
    id: DOC_B.id,
    title: '실험 문서',
  })
}

function summaryWith(docs, env) {
  return summary(aPayload({ docs, generatedAt: GENERATED_AT, sourceCommit: SOURCE_COMMIT, tags: TAGS, tree: TREE }), env) // prettier-ignore
}

describe('endpoints.summary — 봉투·투영 (🟢GFS 회귀 가드)', () => {
  it('S1: 봉투 키 집합이 정확하다', () => {
    const out = summaryWith([aDoc().build()], 'prod')

    expect(Object.keys(out).toSorted()).toEqual([
      'docs',
      'generatedAt',
      'schemaVersion',
      'sourceCommit',
      'tags',
      'tree',
    ])
    expect(out.schemaVersion).toBe(1)
  })

  it('S2a: active doc 은 정확히 10키다(body 필드가 부팅 페이로드로 새지 않는다)', () => {
    // 오염된 입력 — 투영이 없으면 html·md 가 summary 로 샌다(= 이 계약의 목적 붕괴).
    const contaminated = aDoc().with({
      html: '<p>본문</p>',
      md: '# 본문',
      path: 'company/삼성전자',
    })
    const out = summaryWith([contaminated.build()], 'prod')

    expect(Object.keys(out.docs[0]).toSorted()).toEqual([
      'aliases',
      'breadcrumb',
      'created',
      'excerpt',
      'id',
      'status',
      'tags',
      'title',
      'type',
      'updated',
    ])
  })

  it('S2b: disable doc 은 정확히 4키 스텁이다', () => {
    const out = summaryWith([aDisableStub().with({ excerpt: '새면 안 된다' }).build()], 'prod')

    expect(Object.keys(out.docs[0]).toSorted()).toEqual(['breadcrumb', 'id', 'status', 'title'])
  })

  it("S3: env='prod' → draft 문서가 출력 docs 에 없다(visibleDocs 상속)", () => {
    const out = summaryWith([aDoc().build(), aDraftDoc().build()], 'prod')

    expect(out.docs.map((doc) => doc.id)).not.toContain(DOC_B.id)
  })

  it("S4: env='dev' → **같은 입력** 이 draft 문서를 포함한다", () => {
    const out = summaryWith([aDoc().build(), aDraftDoc().build()], 'dev')

    expect(out.docs.map((doc) => doc.id)).toContain(DOC_B.id)
  })

  it('S4-대조: 같은 입력에서 prod⊂dev — draft 제외가 실제로 작동한다(no-op 하드코딩 방지)', () => {
    const input = [aDoc().build(), aDraftDoc().build()]

    expect(summaryWith(input, 'prod').docs.length).toBeLessThan(
      summaryWith(input, 'dev').docs.length,
    )
  })

  it('generatedAt/sourceCommit 은 payload 주입값을 그대로 싣는다', () => {
    const out = summaryWith([aDoc().build()], 'prod')

    expect(out.generatedAt).toBe(GENERATED_AT)
    expect(out.sourceCommit).toBe(SOURCE_COMMIT)
  })
})

describe('endpoints.summary — 경계 (🔴RED)', () => {
  it('S5: 빈 summary(prod 0문서)를 throw 없이 우아하게 처리한다', () => {
    const out = summaryWith([], 'prod')

    expect(out.docs).toEqual([])
    expect(Object.keys(out).toSorted()).toEqual([
      'docs',
      'generatedAt',
      'schemaVersion',
      'sourceCommit',
      'tags',
      'tree',
    ])
  })
})
