// @vitest-environment node
//
// P1 · Task 1 — ignore-feeds tombstone 스키마 계약 (파이프라인 무의존) — tdd §3 Task 1
//
// RED 사유: `scripts/schema/ignore-feeds.schema.json` 부재 → 이 파일 최상위의 readFileSync 가
//   ENOENT 로 throw → 모듈 수집 실패(전 케이스 RED). 스키마는 **코드가 아니라 데이터**이므로 정적
//   readFileSync 로 로드한다 — 존재하지 않는 *모듈* 이 아니라 존재하지 않는 *데이터 파일* 이라서
//   지연 import 규약(import-x/no-unresolved) 대상이 아니다. 파일 부재 자체가 RED 신호다.
//   (형식 계약 고립: schema.docid-format.test.mjs 미러 — 산출물 착지 불필요.)
//
// 계약(GREEN 이 만든다): top-level array. items = { id(^[0-9a-f]{12}$, required),
//   when(RFC3339, required), reason?(string), by?(string), additionalProperties:false }.
//   validateItem(entries, schema) 가 유효 tombstone 은 [](무오류), 위반은 length>0 을 낸다.
//   (id 폭 12hex = 피드 정체성 = 커밋해시 slice(0,12) · feed.mjs:123 정합.)
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { validateItem } from '../validate.mjs'

// 스키마 파일을 그대로 싣는다(형식 계약 고립). RED 시점엔 파일이 없어 여기서 ENOENT 로 죽는다.
const schema = JSON.parse(
  readFileSync(new URL('../../schema/ignore-feeds.schema.json', import.meta.url), 'utf8'),
)

const WHEN = '2026-07-23T00:00:00Z'
const ID_12HEX = 'abc123def456'

/** entries 배열을 스키마로 검증한 오류 목록(무오류 = 수락). */
function errorsFor(entries) {
  return validateItem(entries, schema)
}

describe('ignore-feeds 스키마 — 유효 tombstone 수락', () => {
  it('id·when·reason 를 갖춘 tombstone 은 무오류다', () => {
    expect(errorsFor([{ id: ID_12HEX, reason: '오보 — 잘못된 수치', when: WHEN }])).toEqual([])
  })

  it('reason·by 없이 id·when 만으로도 수락한다(선택 필드)', () => {
    expect(errorsFor([{ id: ID_12HEX, when: WHEN }])).toEqual([])
  })

  it('by 를 포함해도 수락한다(선택 필드)', () => {
    expect(errorsFor([{ by: 'ops@sas.wiki', id: ID_12HEX, when: WHEN }])).toEqual([])
  })

  it('빈 배열을 수락한다(초기 목록)', () => {
    expect(errorsFor([])).toEqual([])
  })
})

describe('ignore-feeds 스키마 — 필수 필드 누락 거부', () => {
  it('id 누락을 거부한다', () => {
    expect(errorsFor([{ when: WHEN }]).length).toBeGreaterThan(0)
  })

  it('when 누락을 거부한다', () => {
    expect(errorsFor([{ id: ID_12HEX }]).length).toBeGreaterThan(0)
  })
})

describe('ignore-feeds 스키마 — id 형식(12hex) 거부', () => {
  // 각 비-12hex 형태를 개별 케이스로(실패 원인 추적 가능). UUIDv7·40hex·대문자·길이·비hex 모두 거부.
  const badIds = {
    '13자(초과)': 'abc123def4567',
    '3자(미달)': 'abc',
    '40-hex full sha': '9e0a3a0c8072f436503c5065ca4b4b863cd434fb',
    'UUIDv7(하이픈·36자)': '0192f0c0-8000-7000-8000-0123456789ab',
    '대문자 hex': 'ABC123DEF456',
    '비-hex 문자(g-z)': 'abcxyz123456',
  }

  for (const [label, id] of Object.entries(badIds)) {
    it(`${label} id 를 거부한다`, () => {
      expect(errorsFor([{ id, when: WHEN }]).length).toBeGreaterThan(0)
    })
  }
})

describe('ignore-feeds 스키마 — when RFC3339 거부', () => {
  it('날짜만(시각 없음)인 when 을 거부한다', () => {
    expect(errorsFor([{ id: ID_12HEX, when: '2026-07-23' }]).length).toBeGreaterThan(0)
  })
})

describe('ignore-feeds 스키마 — additionalProperties:false', () => {
  it('정의되지 않은 필드를 거부한다', () => {
    expect(errorsFor([{ foo: 1, id: ID_12HEX, when: WHEN }]).length).toBeGreaterThan(0)
  })
})
