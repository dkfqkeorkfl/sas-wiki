// @vitest-environment node
//
// P4 · Task 3 — 배관(발행 아티팩트 스키마) — tdd §3.11 (PL8)
//
// RED 사유:
//   PL8 — `summary.schema.json` 은 지금 strict + required **7키**이고 `producer`·`env` 가 없다.
//
// 왜 스키마를 따로 무는가: 이 스키마는 `additionalProperties: false` 다. 즉 생성기가 페이로드에
//   `producer`·`env` 를 실으면서 스키마를 안 넓히면 **산출물이 자기 검증에 걸려 죽는다**(넓히면서
//   required 를 빠뜨리면 반대로 헤더 없는 파일이 통과한다). 두 방향 모두 `.mjs` 라 타입 체커가
//   못 잡고 런타임까지 드러나지 않는다. AR4(발행 파일 9키)·AR8 과 3자로 맞댄다.
//
// 규범 A: 기대값은 **리터럴**이다 — `payloads.mjs` 의 상수를 import 하면 스키마와 코드가 함께
//   틀려도 통과하는 자기참조가 된다.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SCHEMA_DIR = path.resolve(HERE, '..', 'schema')

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'))

describe('P4 배관 — 발행 아티팩트 스키마', () => {
  it('PL8: `producer`·`env` 가 required 이고 값 domain 이 선언돼 있다', () => {
    const schema = readJson(path.join(SCHEMA_DIR, 'summary.schema.json'))

    // 앵커 ①: 이 스키마는 strict 다. 그래서 키 추가가 **스키마 갱신을 강제**한다.
    //   이 단언이 깨지면 아래 required 단언들의 의미가 약해진다(미선언 키가 그냥 통과하므로).
    expect(schema.additionalProperties).toBe(false)

    expect(schema.required).toContain('producer')
    expect(schema.required).toContain('env')

    // **존재만으로는 부족하다** — `properties` 에 domain 이 없으면 `producer: ''` 도 통과하고,
    //   그러면 소비자의 producer 층(RD3·RD4)이 무엇을 대조할지 계약이 없다.
    expect(schema.properties.producer).toEqual({ const: 'sas-wiki/summary', type: 'string' })
    expect(schema.properties.env).toEqual({ enum: ['dev', 'prod'], type: 'string' })

    // 앵커 ②: 기존 7키를 밀어내지 않았다(strict 스키마라 누락은 산출물 전체를 죽인다).
    for (const key of [
      'schemaVersion',
      'generatedAt',
      'inputsFingerprint',
      'sourceCommit',
      'docs',
      'tree',
      'tags',
    ]) {
      expect(schema.required).toContain(key)
    }
  })
})
