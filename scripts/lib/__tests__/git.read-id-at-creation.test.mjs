// @vitest-environment node
//
// P1 · R4 — readIdAtCreation(runGit, relPath) 신규 헬퍼 (불변 게이트 원자재) — tdd §3 Task 3
//
// RED 사유: `git.mjs` 에 `readIdAtCreation` export 가 **아직 없다** → 아래 named import 가 링크
//   단계에서 "does not provide an export named 'readIdAtCreation'" 로 파일 전체를 실패시킨다(유효 RED).
//
// 계약(GREEN 이 세울 seam): 문서의 **생성 커밋 blob** frontmatter 에서 id 를 읽는다.
//   · 생성 blob 에 id 있음 → 그 id 반환
//   · 생성 blob 에 id 없음(pre-id era) → null 반환 (불변 게이트가 pre-id 를 "차이"로 오판하지 않게 함)
//   · HEAD 가 아니라 **생성 시점** blob 을 본다(사후 삽입/변조 무시) · 한글 경로도 quotepath 로 조회
import { describe, expect, it } from 'vitest'

import { makeGitRunner, readIdAtCreation } from '../git.mjs'
import { cleanup, commit, initVault, writeDoc } from '../../__tests__/helpers/tmp-git-vault.mjs'

const UUIDV7_A = '0192f0c0-8000-7000-8000-0123456789ab'
const UUIDV7_B = '0192f0c0-8000-7000-9abc-0123456789ab'

describe('R4 readIdAtCreation — 생성 blob frontmatter id', () => {
  it('생성 blob 에 id 가 있으면 그 id 를 반환한다', () => {
    const vault = initVault()
    try {
      writeDoc(vault, 'tech/HBM', { id: UUIDV7_A, title: 'HBM' })
      commit(vault, 'cwiki: HBM 문서 생성')

      expect(readIdAtCreation(makeGitRunner(vault), 'wiki/tech/HBM.md')).toBe(UUIDV7_A)
    } finally {
      cleanup(vault)
    }
  })

  it('생성 blob 에 id 가 없으면(pre-id era) null 을 반환한다', () => {
    const vault = initVault()
    try {
      writeDoc(vault, 'tech/HBM', { title: 'HBM' }) // id 없이 생성
      commit(vault, 'cwiki: HBM 문서 생성')

      expect(readIdAtCreation(makeGitRunner(vault), 'wiki/tech/HBM.md')).toBeNull()
    } finally {
      cleanup(vault)
    }
  })

  it('한글 경로 문서의 생성 blob id 도 읽는다(core.quotepath=false)', () => {
    const vault = initVault()
    try {
      writeDoc(vault, 'concept/온디바이스-AI', { id: UUIDV7_B, title: '온디바이스 AI' })
      commit(vault, 'cwiki: 온디바이스 AI 문서 생성')

      expect(readIdAtCreation(makeGitRunner(vault), 'wiki/concept/온디바이스-AI.md')).toBe(UUIDV7_B)
    } finally {
      cleanup(vault)
    }
  })

  it('id 를 생성 이후에 추가해도 생성 blob 기준이라 null 이다(사후 삽입 무시)', () => {
    // 경계: readIdAtCreation 은 HEAD 가 아니라 **생성 시점** blob 을 본다.
    const vault = initVault()
    try {
      writeDoc(vault, 'tech/HBM', { title: 'HBM' }) // 생성: id 없음
      commit(vault, 'cwiki: HBM 문서 생성')
      writeDoc(vault, 'tech/HBM', { id: UUIDV7_A, title: 'HBM' }) // 이후: id 추가
      commit(vault, 'uwiki: HBM id 추가')

      expect(readIdAtCreation(makeGitRunner(vault), 'wiki/tech/HBM.md')).toBeNull()
    } finally {
      cleanup(vault)
    }
  })
})
