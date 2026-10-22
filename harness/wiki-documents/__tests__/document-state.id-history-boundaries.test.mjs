// 문서 검사 정책의 정상·위반 회귀. 실제 wiki 대신 격리 fixture를 사용한다.
import { describe, expect, it } from 'vitest'

import { inspectVault } from '../document-integrity.mjs'

import { cleanup, commit, initVault, makeOut, writeDoc } from '../../test-utils/tmp-git-vault.mjs'

const UUIDV7_B = '0192f0c0-8000-7000-9abc-0123456789ab'

const UUIDV7_C = '0192f0c1-0000-7000-b000-000000000003'

describe('V1 불변 게이트 경계 재단언(hidden verify)', () => {
  it('정상: id 를 한 번도 바꾸지 않았으면 build PASS', () => {
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

      expect(() => inspectVault({ out, vault })).not.toThrow()
    } finally {
      cleanup(vault, out)
    }
  })

  it('변조: id 를 바꾼 커밋이 있으면 build FAIL', () => {
    const vault = initVault()
    const out = makeOut()
    try {
      writeDoc(vault, 'concept/온디바이스-AI', { id: UUIDV7_B, title: '온디바이스 AI' }) // 생성: B
      commit(vault, 'chore: 온디바이스 AI 문서 생성')
      writeDoc(vault, 'concept/온디바이스-AI', { id: UUIDV7_C, title: '온디바이스 AI' }) // 변조: C
      commit(vault, 'chore: 온디바이스 AI id 변조')

      // bare toThrow() 는 **아무 이유로나** 실패해도 통과한다 — 게이트가 진짜 변조 사유
      // (doc-gate.mjs 의 ID_TAMPERED)로 막았는지, 아니면 무관한 예외(예: 스키마 오류)로 우연히
      // 막혔는지 구별하지 못한다. 정체를 물어 진짜 게이트가 발화했음을 증명한다.
      expect(() => inspectVault({ out, vault })).toThrow(/ID_TAMPERED/)
    } finally {
      cleanup(vault, out)
    }
  })

  it('등록 전: 커밋된 이력에 id 가 없으면 build PASS(false-fail 금지)', () => {
    const vault = initVault()
    const out = makeOut()
    try {
      // 실 마이그레이션 재현: 커밋된 이력에는 id 부재(직전 값 없음 → 처음 등록=PASS), working tree 에는
      // 마이그레이션이 넣은 id(미커밋 → 스키마 required PASS). 게이트가 처음 등록을 오판하지 않음을 검증한다.
      writeDoc(vault, 'concept/온디바이스-AI', { title: '온디바이스 AI' }) // 생성 커밋: id 없음
      commit(vault, 'chore: 온디바이스 AI 문서 생성')
      writeDoc(vault, 'concept/온디바이스-AI', { id: UUIDV7_B, title: '온디바이스 AI' }) // 마이그레이션: working tree id(미커밋)

      expect(() => inspectVault({ out, vault })).not.toThrow()
    } finally {
      cleanup(vault, out)
    }
  })
})
