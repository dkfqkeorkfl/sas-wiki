// @vitest-environment node
//
// P2 RED-9 · scripts/wiki/schema/{summary,feeds,body}.schema.json (strict 계약) — tdd §6.9
// RED 사유: 스키마 3종 미작성 → loadSchema 의 readFileSync 실패(파일 전체 RED).
//
// **이 스키마의 존재 이유는 "제거된 필드가 산출물에 있으면 fail" 이다.**
//   전부 `additionalProperties: false` (Task 1 이 그 지원을 넣는다).
//   `body.docs` 는 `Record<path, WikiDocBody>` → `additionalProperties: <스키마>` 로 표현한다.
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { loadSchema, validateItem } from '../validate.mjs'
import {
  aBody,
  aBodyDoc,
  aDisableStub,
  aDoc,
  aFeedItem,
  aFeeds,
  aSummary,
  aWorld,
  DOC_A,
} from './helpers/payload-builders.mjs'

const SCHEMA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'schema')

const summarySchema = loadSchema(path.join(SCHEMA_DIR, 'summary.schema.json'))
const feedsSchema = loadSchema(path.join(SCHEMA_DIR, 'feeds.schema.json'))
const bodySchema = loadSchema(path.join(SCHEMA_DIR, 'body.schema.json'))

/** doc 한 건만 담은 summary(위반 주입용). */
function summaryWithDoc(doc) {
  return aSummary().withDoc(doc).build()
}

describe('스키마 3종 — 정상 페이로드', () => {
  it('정상 3 페이로드는 각 스키마를 통과한다', () => {
    const { body, feeds, summary } = aWorld()

    expect(validateItem(summary, summarySchema)).toEqual([])
    expect(validateItem(feeds, feedsSchema)).toEqual([])
    expect(validateItem(body, bodySchema)).toEqual([])
  })
})

describe('summary.schema — 제거된 필드가 있으면 fail', () => {
  it.each(['md', 'path', 'html', 'backlinks', 'links', 'footnotes', 'headings', 'meta', 'sources'])(
    'active doc 에 `%s` 가 있으면 위반이다',
    (field) => {
      const errors = validateItem(summaryWithDoc(aDoc().with({ [field]: 'x' }).build()), summarySchema) // prettier-ignore

      expect(errors.length).toBeGreaterThan(0)
      expect(errors.join(' ')).toContain(field)
    },
  )

  it.each(['excerpt', 'type', 'tags', 'created'])(
    'disable 스텁에 `%s` 가 있으면 위반이다(4키 초과)',
    (field) => {
      const errors = validateItem(
        summaryWithDoc(aDisableStub().with({ [field]: 'x' }).build()), // prettier-ignore
        summarySchema,
      )

      expect(errors.length).toBeGreaterThan(0)
      expect(errors.join(' ')).toContain(field)
    },
  )

  it('schemaVersion 이 문자열이면 fail 한다(type: integer)', () => {
    const summary = aSummary().withDoc(aDoc()).with({ schemaVersion: '1' }).build()

    expect(validateItem(summary, summarySchema).length).toBeGreaterThan(0)
  })
})

describe('feeds.schema — 제거된 필드가 있으면 fail', () => {
  it.each(['sentiment', 'link', 'source', 'bodyHtml', 'tags', 'refs', 'path', 'breadcrumb'])(
    'FeedItem 에 `%s` 가 있으면 위반이다',
    (field) => {
      const feeds = aFeeds()
        .withItem(aFeedItem().with({ [field]: 'x' }))
        .build()
      const errors = validateItem(feeds, feedsSchema)

      expect(errors.length).toBeGreaterThan(0)
      expect(errors.join(' ')).toContain(field)
    },
  )

  it('docs[].anchor·anchorText 는 string | null 을 허용한다', () => {
    const feeds = aFeeds()
      .withItem(aFeedItem().refs([{ anchor: null, anchorText: null, id: DOC_A.id }]))
      .build()

    expect(validateItem(feeds, feedsSchema)).toEqual([])
  })

  it('docs[].anchor 가 숫자면 fail 한다(nullable 계약 고정)', () => {
    // 2번째 케이스: `anchor: {}` 같은 무제한 타입이면 이 위반이 통과해버린다.
    const feeds = aFeeds()
      .withItem(aFeedItem().refs([{ anchor: 3, anchorText: null, id: DOC_A.id }]))
      .build()

    expect(validateItem(feeds, feedsSchema).length).toBeGreaterThan(0)
  })

  it('docs[].anchorText 가 숫자면 fail 한다(표시용 라벨은 문자열이다)', () => {
    const feeds = aFeeds()
      .withItem(aFeedItem().refs([{ anchor: 'hbm-사업', anchorText: 3, id: DOC_A.id }]))
      .build()

    expect(validateItem(feeds, feedsSchema).length).toBeGreaterThan(0)
  })

  it('docs[].anchorText 가 없으면 fail 한다(계약 필수 — 카드가 라벨을 못 그린다)', () => {
    // additionalProperties:false 와 짝을 이루는 required — 필드가 **빠지는** 회귀를 잡는다.
    const feeds = aFeeds()
      .withItem(aFeedItem().refs([{ anchor: 'hbm-사업', id: DOC_A.id }]))
      .build()
    const errors = validateItem(feeds, feedsSchema)

    expect(errors.length).toBeGreaterThan(0)
    expect(errors.join(' ')).toContain('anchorText')
  })
})

describe('body.schema — Record<path, WikiDocBody>', () => {
  it.each(['md', 'links', 'footnotes', 'excerpt', 'id', 'title'])(
    'body doc 에 `%s` 가 있으면 위반이다',
    (field) => {
      const body = aBody()
        .withDoc(DOC_A.path, aBodyDoc().with({ [field]: 'x' }))
        .build()
      const errors = validateItem(body, bodySchema)

      expect(errors.length).toBeGreaterThan(0)
      expect(errors.join(' ')).toContain(field)
    },
  )

  it('Record 값의 타입을 검증한다(html 이 숫자면 fail)', () => {
    const body = aBody()
      .withDoc(DOC_A.path, aBodyDoc().with({ html: 1 }))
      .build()

    expect(validateItem(body, bodySchema).length).toBeGreaterThan(0)
  })

  it('body 봉투에 generatedAt 이 있으면 fail 한다(§5.3 — 봉투 3키)', () => {
    const body = aBody()
      .withDoc(DOC_A.path, aBodyDoc())
      .with({ generatedAt: '2026-01-01T00:00:00.000Z' })
      .build()

    expect(validateItem(body, bodySchema).length).toBeGreaterThan(0)
  })
})
