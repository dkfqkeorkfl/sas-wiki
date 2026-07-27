// @vitest-environment node
//
// P2 RED-5 · scripts/wiki/lib/payloads.mjs (3 페이로드 조립) — README · 반환 데이터형 / tdd §6.5
// RED 사유: `lib/payloads.mjs` 미구현(모듈 부재) → import 실패.
//
// 계약(GREEN 이 구현할 seam):
//   buildSummary({ docs, tree, tags, sourceCommit, generatedAt }) → §5.1 봉투
//     docs: derive 의 summary 레코드. **잉여 키가 섞여 들어와도 봉투에는 계약 키만 싣는다**
//           (active 10키 / disable 4키) — payloads 가 wire 경계이므로 투영은 여기서 강제한다.
//   buildFeeds({ items, sourceCommit, generatedAt })  → §5.2 봉투 (정렬은 feed.mjs 소관)
//   buildBody({ docs, sourceCommit })                 → §5.3 봉투. **generatedAt 없음**
//     docs: 본문 레코드 배열 `{ breadcrumb, status, html, headings, meta, sources }`.
//           active 만, `breadcrumb.join('/')` 키로, 값은 4키(html·headings·meta·sources).
//
// 결정성 seam: `generatedAt` 은 **주입**받는다 — payloads 는 시계를 직접 읽지 않는다
//   (SOURCE_DATE_EPOCH 계산은 build.mjs 의 몫). 여기서 Date.now() 를 부르면 재빌드가 흔들린다.
import { describe, expect, it } from 'vitest'

import {
  aDisableStub,
  aDoc,
  aFeedItem,
  DOC_A,
  DOC_B,
  DOC_D,
  GENERATED_AT,
  SOURCE_COMMIT,
} from './helpers/payload-builders.mjs'

// RED 시점에 이 모듈은 존재하지 않는다. 정적 import 로 적으면 eslint 의 import-x/no-unresolved 가
// 에러를 내고, pre-commit(lint-staged)이 **RED 커밋 자체를 막는다** — 규칙을 억제하는 대신 해석을
// 런타임으로 미룬다. 실패는 "Cannot find module …" 로 명확히 드러나고, in-process 호출이므로
// coverage 계측(vitest.config.ts:20)은 그대로 유지된다.
const { buildBody, buildFeeds, buildSummary } = await import(
  new URL('../payloads.mjs', import.meta.url).href
)

const TREE = [{ children: [], docs: [DOC_A.id], path: 'company' }]
const TAGS = { 반도체: [DOC_A.id] }

/** buildBody 가 받는 본문 레코드(breadcrumb·status 를 들고 있다). */
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

function summaryOf(docs) {
  return buildSummary({
    docs,
    generatedAt: GENERATED_AT,
    inputsFingerprint: '0123456789abcdef',
    sourceCommit: SOURCE_COMMIT,
    tags: TAGS,
    tree: TREE,
  })
}

describe('buildSummary', () => {
  it('봉투 키 집합이 정확하다', () => {
    const summary = summaryOf([aDoc().build()])

    expect(Object.keys(summary).toSorted()).toEqual([
      'docs',
      'generatedAt',
      'inputsFingerprint',
      'schemaVersion',
      'sourceCommit',
      'tags',
      'tree',
    ])
  })

  it('schemaVersion 은 정수 1이다(문자열 "1" 금지)', () => {
    const summary = summaryOf([aDoc().build()])

    expect(summary.schemaVersion).toBe(1)
    expect(Number.isInteger(summary.schemaVersion)).toBe(true)
  })

  it('active doc 은 정확히 10키다(body 필드가 새지 않는다)', () => {
    // 오염된 입력을 준다 — 투영이 없으면 html·md 가 부팅 페이로드로 새어나간다(= 이 phase 의 목적 붕괴).
    const contaminated = aDoc().with({
      html: '<p>본문</p>',
      md: '# 본문',
      path: 'company/삼성전자',
    })
    const summary = summaryOf([contaminated.build()])

    expect(Object.keys(summary.docs[0]).toSorted()).toEqual([
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

  it('disable 은 4키 스텁이다(path 문자열 필드 없음)', () => {
    const summary = summaryOf([aDisableStub().with({ excerpt: '새면 안 된다' }).build()])

    expect(Object.keys(summary.docs[0]).toSorted()).toEqual(['breadcrumb', 'id', 'status', 'title'])
  })

  it('generatedAt 은 주입값을 그대로 싣는다(시계를 직접 읽지 않는다)', () => {
    const summary = summaryOf([aDoc().build()])

    expect(summary.generatedAt).toBe(GENERATED_AT)
  })
})

describe('buildFeeds', () => {
  it('봉투 키 집합이 정확하고 items 를 그대로 싣는다', () => {
    const item = aFeedItem().build()
    const feeds = buildFeeds({
      generatedAt: GENERATED_AT,
      items: [item],
      sourceCommit: SOURCE_COMMIT,
    })

    expect(Object.keys(feeds).toSorted()).toEqual([
      'generatedAt',
      'items',
      'schemaVersion',
      'sourceCommit',
    ])
    expect(feeds.items).toEqual([item])
    expect(feeds.schemaVersion).toBe(1)
  })
})

describe('buildBody', () => {
  it('봉투 키 집합에 generatedAt 이 없다(§5.3)', () => {
    const body = buildBody({ docs: [aBodyRecord()], sourceCommit: SOURCE_COMMIT })

    expect(Object.keys(body).toSorted()).toEqual(['docs', 'schemaVersion', 'sourceCommit'])
    expect('generatedAt' in body).toBe(false)
  })

  it('키는 active 문서의 breadcrumb.join("/") 이고 disable 은 실리지 않는다', () => {
    const body = buildBody({
      docs: [
        aBodyRecord(),
        aBodyRecord({ breadcrumb: ['tech', 'HBM'] }),
        aBodyRecord({ breadcrumb: ['concept', '온디바이스-AI'], status: 'disable' }),
      ],
      sourceCommit: SOURCE_COMMIT,
    })

    expect(Object.keys(body.docs).toSorted()).toEqual([DOC_A.path, DOC_B.path].toSorted())
    expect(DOC_D.path in body.docs).toBe(false)
  })

  it('값은 정확히 4키다(md·excerpt·links·footnotes 부재)', () => {
    const body = buildBody({
      docs: [aBodyRecord({ excerpt: '새면 안 된다', md: '# 본문' })],
      sourceCommit: SOURCE_COMMIT,
    })

    expect(Object.keys(body.docs[DOC_A.path]).toSorted()).toEqual([
      'headings',
      'html',
      'meta',
      'sources',
    ])
  })
})

describe('payloads — sourceCommit 은 3 페이로드 공통(불변식 7 의 생산 측)', () => {
  it('같은 인자를 받으면 3 봉투의 sourceCommit 이 같다', () => {
    const summary = summaryOf([aDoc().build()])
    const feeds = buildFeeds({
      generatedAt: GENERATED_AT,
      items: [],
      sourceCommit: SOURCE_COMMIT,
    })
    const body = buildBody({ docs: [aBodyRecord()], sourceCommit: SOURCE_COMMIT })

    expect(new Set([body.sourceCommit, feeds.sourceCommit, summary.sourceCommit])).toEqual(
      new Set([SOURCE_COMMIT]),
    )
  })
})
