// @vitest-environment node
//
// P1 · V1 (hidden — GREEN 후 재실행 의도) — 불변 게이트 경계 독립 재단언 — tdd §2 hidden / §3 Task 3
//
// 목적(spec-gaming 방지): visible R4/R5 에 오버피팅해도 V1 이 진짜 불변식을 재검한다. 그래서 R5 와
//   **다른 리터럴·경로**(UUIDv7 B/C · 다른 문서)로 세 케이스를 독립 단언한다. GREEN 완료 후 메인이
//   재실행해 게이트가 R5 시나리오에만 맞춘 하드코딩이 아님을 확인한다(현재는 게이트 부재라 tamper 가 RED).
//
//   · 정상   : 생성 blob id == HEAD id            → build PASS
//   · 변조   : 생성 blob id ≠ HEAD id             → build FAIL (← 현행 게이트 부재라 이 케이스가 RED)
//   · pre-id : 생성 blob 에 id 부재(마이그레이션 전) → build PASS (false-fail 금지)
import { describe, expect, it } from 'vitest'

import { buildContent } from '../validate.mjs'
import { cleanup, commit, initVault, makeOut, writeDoc } from './helpers/tmp-git-vault.mjs'

const UUIDV7_B = '0192f0c0-8000-7000-9abc-0123456789ab'
const UUIDV7_C = '0192f0c1-0000-7000-b000-000000000003'

describe('V1 불변 게이트 경계 재단언(hidden verify)', () => {
  it('정상: 생성 id 가 HEAD 까지 불변이면 build PASS', () => {
    const vault = initVault()
    const out = makeOut()
    try {
      writeDoc(vault, 'concept/온디바이스-AI', { id: UUIDV7_B, title: '온디바이스 AI' })
      commit(vault, 'chore: 온디바이스 AI 문서 생성')
      writeDoc(vault, 'concept/온디바이스-AI', {
        body: '## 정의\n\n갱신된 본문.\n',
        id: UUIDV7_B, // id 는 그대로, 본문만 수정
        title: '온디바이스 AI',
      })
      commit(vault, 'chore: 온디바이스 AI 본문 갱신')

      expect(() => buildContent({ out, vault })).not.toThrow()
    } finally {
      cleanup(vault, out)
    }
  })

  it('변조: 생성 id ≠ HEAD id 면 build FAIL', () => {
    const vault = initVault()
    const out = makeOut()
    try {
      writeDoc(vault, 'concept/온디바이스-AI', { id: UUIDV7_B, title: '온디바이스 AI' }) // 생성: B
      commit(vault, 'chore: 온디바이스 AI 문서 생성')
      writeDoc(vault, 'concept/온디바이스-AI', { id: UUIDV7_C, title: '온디바이스 AI' }) // 변조: C
      commit(vault, 'chore: 온디바이스 AI id 변조')

      expect(() => buildContent({ out, vault })).toThrow()
    } finally {
      cleanup(vault, out)
    }
  })

  it('pre-id: 생성 blob 에 id 가 없으면 build PASS(false-fail 금지)', () => {
    const vault = initVault()
    const out = makeOut()
    try {
      // 실 마이그레이션 재현: 생성 커밋 blob 에는 id 부재(불변 게이트 null=PASS), working tree 에는
      // 마이그레이션이 넣은 id(미커밋 → 스키마 required PASS). 게이트가 pre-id 를 오판하지 않음을 검증한다.
      writeDoc(vault, 'concept/온디바이스-AI', { title: '온디바이스 AI' }) // 생성 커밋: id 없음
      commit(vault, 'chore: 온디바이스 AI 문서 생성')
      writeDoc(vault, 'concept/온디바이스-AI', { id: UUIDV7_B, title: '온디바이스 AI' }) // 마이그레이션: working tree id(미커밋)

      expect(() => buildContent({ out, vault })).not.toThrow()
    } finally {
      cleanup(vault, out)
    }
  })
})
