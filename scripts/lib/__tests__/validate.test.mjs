// @vitest-environment node
//
// P2 RED-1 · scripts/wiki/lib/validate.mjs — `additionalProperties` 지원 (plan Task 1 / tdd §6.1)
//
// RED 사유: 현행 검증기는 JSON Schema **서브셋**이고 `additionalProperties` 를 **무시한다**
//   (`validate.mjs:44-95`). 그래서 산출물의 strict 검증(= 제거된 필드가 정말 없는가)이 불가능하다.
//   → `additionalProperties: false`(잉여 키 거부)와 `additionalProperties: <스키마>`(Record<K,V>)를
//     지원해야 스키마 3종(summary·feeds·body)이 계약을 강제할 수 있다.
//
// 삭제(기능 소멸): `feed-item 스키마` 케이스 — `feed-item.schema.json` 은 `feeds.schema.json` 이
//   대체한다(피드 7필드). 죽은 계약을 두 벌 유지하지 않는다. "안 통과해서" 지우는 것이 아니다.
//
// 회귀 위험: `wiki-doc.schema.json` 은 `additionalProperties: true` 이고 `meta` 하위 자유 키를
//   허용한다. Task 1 이 이걸 깨면 **입력 검증이 전부 죽는다** → 마지막 케이스가 그 가드다.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { validateItem } from '../validate.mjs'

const wikiDocSchema = JSON.parse(
  readFileSync(new URL('../../schema/wiki-doc.schema.json', import.meta.url), 'utf8'),
)

const STRICT = {
  additionalProperties: false,
  properties: { a: { type: 'number' } },
  type: 'object',
}

describe('validateItem — 신형 wiki-doc 스키마', () => {
  it('신형(id UUIDv7 · status active) 문서는 위반이 없다', () => {
    const errors = validateItem(
      {
        id: '0192a000-0000-7000-8000-0000000000aa',
        status: 'active',
        title: '삼성전자',
        type: 'concept',
      },
      wikiDocSchema,
      'doc',
    )

    expect(errors).toEqual([])
  })

  it('구형(UUID id · status seed) 문서는 id pattern·status enum 위반이다', () => {
    // 2번째 케이스 의도: 스키마가 실제 신형인지 노출 — 구형 스키마면 이 문서가 통과해버린다.
    const errors = validateItem(
      {
        id: '123e4567-e89b-42d3-a456-426614174000',
        status: 'seed',
        title: 'X',
        type: 'concept',
      },
      wikiDocSchema,
      'doc',
    )

    expect(errors.length).toBeGreaterThan(0)
    expect(errors.join(' ')).toMatch(/id|pattern/i)
    expect(errors.join(' ')).toMatch(/status|enum/i)
  })
})

describe('validateItem — additionalProperties: false (strict 쓰기)', () => {
  it('잉여 키를 에러로 보고한다(키 이름과 경로를 메시지에 담는다)', () => {
    const errors = validateItem({ a: 1, zzz: 2 }, STRICT)

    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('zzz')
    expect(errors[0]).toContain('$.zzz')
  })

  it('잉여 키가 없으면 통과한다', () => {
    // 2번째 케이스: "항상 에러" 하드코딩 방지.
    expect(validateItem({ a: 1 }, STRICT)).toEqual([])
  })

  it('중첩 객체의 잉여 키도 잡는다', () => {
    const schema = {
      properties: {
        doc: {
          additionalProperties: false,
          properties: { html: { type: 'string' } },
          type: 'object',
        },
      },
      type: 'object',
    }

    const errors = validateItem({ doc: { html: 'x', md: '# 제거된 필드' } }, schema)

    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('$.doc.md')
  })

  it('배열 items 안 객체의 잉여 키도 잡는다', () => {
    const schema = {
      items: {
        additionalProperties: false,
        properties: { id: { type: 'string' } },
        type: 'object',
      },
      type: 'array',
    }

    const errors = validateItem([{ id: 'a' }, { id: 'b', sentiment: null }], schema)

    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('sentiment')
  })
})

describe('validateItem — additionalProperties: <스키마> (Record<K, V>)', () => {
  // wiki_body.json 의 `docs` 는 `Record<path, WikiDocBody>` 다 — 키가 문서 경로라 열거할 수 없다.
  const recordSchema = {
    additionalProperties: {
      properties: { html: { type: 'string' } },
      required: ['html'],
      type: 'object',
    },
    type: 'object',
  }

  it('값 스키마를 만족하는 Record 는 통과한다', () => {
    expect(validateItem({ 'company/삼성전자': { html: '<p>x</p>' } }, recordSchema)).toEqual([])
  })

  it('값이 타입을 어기면 위반으로 잡는다', () => {
    // 2번째 케이스: additionalProperties 를 boolean 으로만 처리하면 이 경로가 통째로 무검증이 된다.
    const errors = validateItem({ 'company/삼성전자': { html: 1 } }, recordSchema)

    expect(errors.length).toBeGreaterThan(0)
    expect(errors.join(' ')).toContain('company/삼성전자')
  })
})

describe('validateItem — additionalProperties 회귀 가드', () => {
  it('additionalProperties: true 인 wiki-doc 은 자유 키(meta 하위)를 계속 허용한다', () => {
    // Task 1 이 이걸 깨면 **입력 frontmatter 검증이 전부 죽는다**.
    const errors = validateItem(
      {
        id: '0192a000-0000-7000-8000-0000000000aa',
        meta: { exchange: 'KRX', sector: '반도체', ticker: '005930' },
        status: 'active',
        title: '삼성전자',
        type: 'company',
      },
      wikiDocSchema,
      'doc',
    )

    expect(errors).toEqual([])
  })
})

describe('validateItem — 판별 유니온의 포괄 실패(discriminator)', () => {
  // 회귀: if/then 만 있고 else 가 없으면, 어느 조건에도 안 걸리는 값은 strict 하위 스키마(10키/4키)가
  // **하나도 적용되지 않아** 임의의 잉여 필드까지 조용히 통과했다 — "제거된 필드가 있으면 fail 한다"는
  // 이 검증기의 존재 이유가 바로 그 경우에만 무력화된다.
  const summarySchema = JSON.parse(
    readFileSync(new URL('../../schema/summary.schema.json', import.meta.url), 'utf8'),
  )
  // $ref 해석의 root 가 필요하므로 definitions 를 동봉해 넘긴다(validateItem 은 schema 를 root 로 쓴다).
  const withRoot = (data) =>
    validateItem(
      data,
      { ...summarySchema.definitions.summaryDoc, definitions: summarySchema.definitions },
      'doc',
    )

  it('알 수 없는 status 는 통과하지 않는다', () => {
    const errors = withRoot({
      breadcrumb: ['company', '삼성전자'],
      id: '0192d000-0000-7000-8000-0000000000dd',
      status: 'weird-value',
      title: '삼성전자',
      totallyUnexpectedField: { leaked: true },
    })

    expect(errors.length).toBeGreaterThan(0)
    expect(errors.join('\n')).toMatch(/판별자/u)
  })

  it('정상 분기(disable 스텁)는 그대로 통과한다', () => {
    const errors = withRoot({
      breadcrumb: ['concept', '온디바이스-AI'],
      id: '0192d000-0000-7000-8000-0000000000dd',
      status: 'disable',
      title: '온디바이스 AI',
    })

    expect(errors).toEqual([])
  })
})
