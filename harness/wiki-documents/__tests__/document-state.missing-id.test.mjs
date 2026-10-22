// 문서 검사 정책의 정상·위반 회귀. 실제 wiki 대신 격리 fixture를 사용한다.
import { describe, expect, it } from 'vitest'

import { inspectVault } from '../document-integrity.mjs'

import { cleanup, commit, initVault, makeOut, writeDoc } from '../../test-utils/tmp-git-vault.mjs'

describe('R3 build — frontmatter id 없으면 실패한다(git-hash 구제 제거)', () => {
  it('frontmatter id 가 없는 문서는 build 가 스키마 위반으로 실패한다', () => {
    const vault = initVault()
    const out = makeOut()
    try {
      writeDoc(vault, 'tech/HBM', { title: 'HBM' }) // frontmatter 에 id 없음
      commit(vault, 'chore: HBM 문서 생성')

      // 현행: git-hash(12-hex) 가 id 로 주입돼 통과 → build 성공(no-throw) → 이 단언이 RED.
      expect(() => inspectVault({ out, vault })).toThrow(
        /문서 제외[\s\S]*SCHEMA_VIOLATION[\s\S]*필수 필드 누락 "id"/iu,
      )
    } finally {
      cleanup(vault, out)
    }
  })
})
