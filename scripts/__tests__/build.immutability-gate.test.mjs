// @vitest-environment node
//
// P1(통합) · R5 — 불변 게이트: 생성 blob id ≠ HEAD id 면 build fail — tdd §3 Task 3
//
// RED 사유: 현행 build 에는 불변 게이트가 **없다**. 게다가 현행은 frontmatter id 를 무시하고 git-hash
//   를 주입하므로, frontmatter id 를 사후 변조해도 build 가 조용히 성공한다. → 생성 커밋 blob 의 id 와
//   HEAD frontmatter id 를 대조해 다르면 실패시키는 게이트를 build 에 추가해야 green.
//
// 경계(false-fail 금지 · anti-over-fire): pre-id 문서(생성 blob 에 id 부재)는 반드시 **PASS**. 게이트가
//   pre-id 를 "차이"로 오판하면 마이그레이션 전 전 문서가 false-fail 한다. 이 케이스는 게이트 부재인
//   현행에서도 자명히 PASS 이므로 green-stay 이고, GREEN 후 게이트가 pre-id 를 안 건드리는지를 지킨다.
import { describe, expect, it } from 'vitest'

import { buildContent } from '../validate.mjs'
import { cleanup, commit, initVault, makeOut, writeDoc } from './helpers/tmp-git-vault.mjs'

const UUIDV7_A = '0192f0c0-8000-7000-8000-0123456789ab'
const UUIDV7_B = '0192f0c0-8000-7000-9abc-0123456789ab'

describe('R5 build 불변 게이트 — 사후 id 변조 차단', () => {
  it('생성 blob id 와 HEAD frontmatter id 가 다르면 build 가 실패한다', () => {
    const vault = initVault()
    const out = makeOut()
    try {
      writeDoc(vault, 'tech/HBM', { id: UUIDV7_A, title: 'HBM' }) // 생성: id=A
      commit(vault, 'cwiki: HBM 문서 생성')
      writeDoc(vault, 'tech/HBM', { id: UUIDV7_B, title: 'HBM' }) // 변조: id=B
      commit(vault, 'uwiki: HBM id 변조')

      // 현행: 게이트 부재 + git-hash 주입 → 변조가 통과 → build 성공(no-throw) → 이 단언이 RED.
      expect(() => buildContent({ out, vault })).toThrow()
    } finally {
      cleanup(vault, out)
    }
  })
})

describe('R5 경계(green-stay) — pre-id 문서는 게이트를 통과한다', () => {
  it('생성 blob 에 id 가 없는 문서는 build 가 실패하지 않는다(false-fail 금지)', () => {
    const vault = initVault()
    const out = makeOut()
    try {
      // 실 마이그레이션 재현: 생성 커밋 blob 에는 id 가 없고(pre-id era → 불변 게이트는 null=PASS),
      // 마이그레이션이 working tree 에 id 를 넣는다(미커밋 → 스키마 required(id) PASS). 이 조합이 게이트가
      // pre-id 를 "차이"로 오판하지 않는지를 실제로 검증한다(원래 셋업은 스키마 required 에서 먼저 죽어
      // 게이트에 닿지도 못했다). 단언은 그대로 not.toThrow — 약화가 아니라 시나리오 정정이다.
      writeDoc(vault, 'tech/HBM', { title: 'HBM' }) // 생성 커밋: id 없음(pre-id era)
      commit(vault, 'cwiki: HBM 문서 생성')
      writeDoc(vault, 'tech/HBM', { id: UUIDV7_A, title: 'HBM' }) // 마이그레이션: working tree id(미커밋)

      expect(() => buildContent({ out, vault })).not.toThrow()
    } finally {
      cleanup(vault, out)
    }
  })
})
