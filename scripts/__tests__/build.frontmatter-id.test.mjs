// 파싱·생성·피드의 실제 기능 결과를 확인한다.
import { describe, expect, it } from 'vitest'

import { parsePayloads } from '../test-utils/vaultPayloads.mjs'

import { cleanup, commit, initVault, makeOut, writeDoc } from './helpers/tmp-git-vault.mjs'

const UUIDV7_A = '0192f0c0-8000-7000-8000-0123456789ab'

describe('R3 build — frontmatter UUIDv7 id 가 산출물로 흐른다(git-hash 로 안 덮인다)', () => {
  it('summary 문서 id 가 frontmatter UUIDv7 이다', () => {
    const vault = initVault()
    const out = makeOut()
    try {
      writeDoc(vault, 'tech/HBM', { id: UUIDV7_A, title: 'HBM' })
      commit(vault, 'chore: HBM 문서 생성')

      // 현행: candidate.id 가 git-hash 로 덮여 summary id = git-hash(12-hex) → UUIDV7_A 와 불일치 → RED.
      const { summary } = parsePayloads({ out, vault })

      expect(summary.docs[0].id).toBe(UUIDV7_A)
    } finally {
      cleanup(vault, out)
    }
  })
})
