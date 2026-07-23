// @vitest-environment node
//
// P2 dev/prod 분리 · Task 1 — wiki-doc 스키마 `draft` 필드 계약 RED (tdd §3 Task 1 · plan §Task 1)
//
// RED 사유(유효 RED): 현행 wiki-doc.schema.json 은 `additionalProperties: true`(실측 :63)라
//   `draft` 가 properties 에 없어 **어떤 타입이든 통과**한다 → `draft: "yes"`(비-boolean)가 위반 0건이다.
//   GREEN(Task 1)이 properties 에 `draft: {type:"boolean", default:false}` 를 추가하면 `draft:"yes"` 는
//   타입 불일치로 걸리고(RED→green), boolean/미지정은 계속 통과한다.
//
// 결과 계약: boolean 수락 · 비-boolean 거부 · optional(required 아님 → Layer A fail-open: 미지정=유효=공개).
// spec-gaming 가드: 스키마를 `additionalProperties:false` 로 뒤집어 통과시키지 말 것(무관 필드 대량 회귀).
//   draft 만 boolean 으로 핀한다 — 아래 4케이스가 그 경계를 고정한다.
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { loadSchema, validateItem } from '../validate.mjs'

const SCHEMA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'schema')
const wikiDocSchema = loadSchema(path.join(SCHEMA_DIR, 'wiki-doc.schema.json'))

/** 최소 유효 frontmatter — id(UUIDv7 pattern)·title·type·status(모두 required)만 채운다. */
function validFrontmatter(overrides = {}) {
  return {
    id: '0192f0d0-0000-7000-8000-000000000001',
    status: 'active',
    title: '삼성전자',
    type: 'concept',
    ...overrides,
  }
}

describe('wiki-doc.schema — draft 필드 계약(boolean 핀)', () => {
  it('draft: "yes"(비-boolean)는 위반이다 (RED — 현행 additionalProperties:true 라 통과)', () => {
    const errors = validateItem(validFrontmatter({ draft: 'yes' }), wikiDocSchema)

    expect(errors.length).toBeGreaterThan(0)
    expect(errors.join(' ')).toContain('draft')
  })

  it('draft: true 는 통과한다', () => {
    expect(validateItem(validFrontmatter({ draft: true }), wikiDocSchema)).toEqual([])
  })

  it('draft: false 는 통과한다 (2번째 케이스 — boolean 을 하드코딩 거부하지 않음을 드러낸다)', () => {
    expect(validateItem(validFrontmatter({ draft: false }), wikiDocSchema)).toEqual([])
  })

  it('draft 미지정은 통과한다 (optional — Layer A fail-open, required 아님)', () => {
    expect(validateItem(validFrontmatter(), wikiDocSchema)).toEqual([])
  })
})
