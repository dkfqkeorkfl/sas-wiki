import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
const REASON_CODES_LITERAL = [
  'NO_FRONTMATTER',
  'MISSING_TYPE',
  'SCHEMA_VIOLATION',
  'DUPLICATE_PATH',
  'DUPLICATE_ID',
  'ID_TAMPERED',
  'DELETED_ID_REUSE',
]

describe('문서 검사 계약 회귀', () => {
  it('PL3: `REASON_CODES`(코드) · report.schema.json enum · 리터럴 7값이 일치한다', () => {
    // ★ 규범 A 의 대가를 갚는 두 자리 중 하나(다른 하나는 PG9). 한쪽만 넓히면 리포트가 조용히 자기
    //   스키마를 어기고, 그 리포트를 읽는 사람은 사유가 왜 비었는지 영원히 모른다.
    const reportSchemaPath = new URL('../../../scripts/schema/report.schema.json', import.meta.url)
    expect(existsSync(reportSchemaPath), 'scripts/schema/report.schema.json').toBe(true)

    const reportSchema = JSON.parse(readFileSync(reportSchemaPath, 'utf8'))
    const schemaEnum = reportSchema.properties?.excluded?.items?.properties?.reasonCode?.enum
    expect(Array.isArray(schemaEnum), 'report.schema.json 에 reasonCode enum 이 없다').toBe(true)
    expect([...schemaEnum].toSorted()).toEqual([...REASON_CODES_LITERAL].toSorted())
  })
  it('PL3: 코드 상수 `REASON_CODES` 가 리터럴 7값과 **순서까지** 일치한다 (우선순위)', async () => {
    // 순서가 곧 우선순위다(OQ-P3-3) — 배열을 재정렬하면 같은 vault 가 실행마다 다른 사유를 낸다.
    // 존재 확인을 **먼저** 해 미구현 시점의 실패가 "모듈이 없다" 로 깨끗하게 드러나게 한다.
    const docGatePath = new URL('../document-state.mjs', import.meta.url)
    expect(existsSync(docGatePath), 'document-state.mjs').toBe(true)

    const { REASON_CODES } = await import(docGatePath.href)
    expect([...REASON_CODES]).toEqual(REASON_CODES_LITERAL)
  })
})
