// @vitest-environment node
//
// P1 · R1 — doc-id 형식 게이트 (스키마 pattern 직접 · 파이프라인 무의존) — tdd §3 Task 1
//
// RED 사유: 4개 doc-id pattern 이 현행 `^[0-9a-f]{12}$` 다(wiki-doc.id · summary.activeDoc.id ·
//   summary.disableStub.id · feeds.docRef.id). 이 게이트가 UUIDv7 을 **거부**하고 12-hex 를 **수락**하는
//   한, frontmatter UUIDv7 doc id 는 산출물로 흐를 수 없다. → 스키마 파일의 pattern 을 §0 UUIDv7
//   정규식으로 바꿔야 green.
//
// 왜 파이프라인 무의존인가(tdd §0-2): 현행 파이프라인은 12-hex 를 주입해 통과하므로 UUIDv7 산출물이
//   존재하지 않는다. 손으로 쓴 UUIDv7/12-hex 리터럴을 스키마 pattern 에 **직접** 먹여 형식 계약만
//   고립 검증한다(산출물 착지 불필요).
//
// 폭 3종 동시 단언(오전환 방지): doc-id(→UUIDv7) · feed-id(12-hex KEEP) · sourceCommit(40-hex 불가침).
//   feed-id·sourceCommit 케이스는 **green-stay** 다 — 지금도 통과하고 GREEN 후에도 통과해야 한다.
//   그것이 "doc-id 만 전환하고 feed-id/sourceCommit 은 건드리지 않았다"를 못박는다.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { validateItem } from '../schema-validator.mjs'

const UUIDV7_A = '0192f0c0-8000-7000-8000-0123456789ab'
const DOC_12HEX = '062530b95593'
const FEED_12HEX = 'f1f1f1f1f1f1'
const SOURCE_40HEX = '9e0a3a0c8072f436503c5065ca4b4b863cd434fb'
// UUIDv4 형(8-4-4-4-12 하이픈 · 버전 니블 `4`) — UUID **모양**이지만 v7 은 아니다. `DOC_12HEX`(하이픈
//   없는 12자)는 하이픈 유무만으로도 걸러지므로, "버전 니블까지 실제로 본다"는 별도로 확인해야 한다.
const REGULAR_UUID_V4 = 'f47ac10b-58cc-4372-a567-0e02b2c3d479'

const wikiDocSchema = load('wiki-doc.schema.json')
const summarySchema = load('summary.schema.json')
const feedsSchema = load('feeds.schema.json')
const bodySchema = load('body.schema.json')

function load(name) {
  return JSON.parse(readFileSync(new URL(`../../schema/${name}`, import.meta.url), 'utf8'))
}

/** 스키마 파일의 pattern 을 그대로 실어 문자열 하나만 검증한다(형식 계약 고립). */
function patternOf(owner) {
  return { pattern: owner.pattern, type: 'string' }
}

function accepts(owner, value) {
  return validateItem(value, patternOf(owner)).length === 0
}

describe('R1 doc-id 형식 — UUIDv7 수락 / 12-hex 거부 (4 pattern)', () => {
  const docIdOwners = {
    'feeds.docRef.id': feedsSchema.definitions.docRef.properties.id,
    'summary.activeDoc.id': summarySchema.definitions.activeDoc.properties.id,
    'summary.disableStub.id': summarySchema.definitions.disableStub.properties.id,
    'wiki-doc.id': wikiDocSchema.properties.id,
  }

  for (const [label, owner] of Object.entries(docIdOwners)) {
    it(`${label} 이 UUIDv7 을 수락한다`, () => {
      expect(accepts(owner, UUIDV7_A)).toBe(true)
    })

    it(`${label} 이 12-hex(비-UUIDv7)를 거부한다`, () => {
      expect(accepts(owner, DOC_12HEX)).toBe(false)
    })

    it(`${label} 이 일반 UUID(v4 · 비-UUIDv7)를 거부한다`, () => {
      expect(accepts(owner, REGULAR_UUID_V4)).toBe(false)
    })
  }

  it('wiki-doc 전체 문서 형태로도 UUIDv7 id 는 무오류, 12-hex id 는 오류다', () => {
    // tdd §3 Task 1 의 예시 — required + pattern 이 문서 레벨에서 함께 작동한다(type=concept 는 meta 무요구).
    const base = { status: 'active', title: '삼성전자', type: 'concept' }

    expect(validateItem({ ...base, id: UUIDV7_A }, wikiDocSchema, 'doc')).toEqual([])
    expect(validateItem({ ...base, id: DOC_12HEX }, wikiDocSchema, 'doc').length).toBeGreaterThan(0)
  })
})

describe('R1 음성 대조(green-stay) — feed-id 12-hex KEEP (D6)', () => {
  const feedIdOwner = feedsSchema.definitions.feedItem.properties.id

  it('feeds.feedItem.id 는 12-hex 를 수락한다(피드 정체성=커밋해시)', () => {
    expect(accepts(feedIdOwner, FEED_12HEX)).toBe(true)
  })

  it('feeds.feedItem.id 는 UUIDv7 을 거부한다(doc-id 폭으로 오전환 금지)', () => {
    expect(accepts(feedIdOwner, UUIDV7_A)).toBe(false)
  })
})

describe('R1 음성 대조(green-stay) — sourceCommit 40-hex 불가침', () => {
  const owners = {
    'body.sourceCommit': bodySchema.properties.sourceCommit,
    'feeds.sourceCommit': feedsSchema.properties.sourceCommit,
    'summary.sourceCommit': summarySchema.properties.sourceCommit,
  }

  for (const [label, owner] of Object.entries(owners)) {
    it(`${label} 은 40-hex full sha 를 수락한다`, () => {
      expect(accepts(owner, SOURCE_40HEX)).toBe(true)
    })

    it(`${label} 은 12-hex 를 거부한다(doc-id 폭으로 오전환 금지)`, () => {
      expect(accepts(owner, DOC_12HEX)).toBe(false)
    })
  }
})
