// @vitest-environment node
//
// P1(통합) · R3 — validateParsedDocs 의 git-hash 주입 제거 (침묵 no-op 차단) — tdd §3 Task 2
//
// RED 사유: 현행 build.validateParsedDocs(build.mjs:297-301)는
//   `candidate = { ...parsed.frontmatter, id: dates.hash ? dates.hash.slice(0,12) : undefined }`
//   로 **git-hash 를 id 로 주입**한다. 그래서 (a) frontmatter 에 id 가 없어도 git-hash 가 구제해
//   통과하고, (b) frontmatter 에 UUIDv7 id 가 있어도 git-hash 로 덮여 산출물에 흐르지 못한다.
//   → id 주입을 제거해(candidate = parsed.frontmatter) frontmatter id 만 검증·전파해야 green.
//
// validateParsedDocs 는 build.mjs 의 private 함수라 buildContent 통합으로 관측한다(실 tmp git).
//   두 지점 반전(derive + build) 중 build 쪽 한 곳만 놓치면 이 스펙이 잡는다(침묵 no-op).
import { describe, expect, it } from 'vitest'

import { buildContent } from '../validate.mjs'
import { cleanup, commit, initVault, makeOut, writeDoc } from './helpers/tmp-git-vault.mjs'

const UUIDV7_A = '0192f0c0-8000-7000-8000-0123456789ab'

describe('R3 build — frontmatter id 없으면 실패한다(git-hash 구제 제거)', () => {
  it('frontmatter id 가 없는 문서는 build 가 스키마 위반(required id)으로 실패한다', () => {
    const vault = initVault()
    const out = makeOut()
    try {
      writeDoc(vault, 'tech/HBM', { title: 'HBM' }) // frontmatter 에 id 없음
      commit(vault, 'chore: HBM 문서 생성')

      // 현행: git-hash(12-hex) 가 id 로 주입돼 통과 → build 성공(no-throw) → 이 단언이 RED.
      expect(() => buildContent({ out, vault })).toThrow(
        /문서 제외[\s\S]*SCHEMA_VIOLATION[\s\S]*필수 필드 누락 "id"/iu,
      )
    } finally {
      cleanup(vault, out)
    }
  })
})

describe('R3 build — frontmatter UUIDv7 id 가 산출물로 흐른다(git-hash 로 안 덮인다)', () => {
  it('summary 문서 id 가 frontmatter UUIDv7 이다', () => {
    const vault = initVault()
    const out = makeOut()
    try {
      writeDoc(vault, 'tech/HBM', { id: UUIDV7_A, title: 'HBM' })
      commit(vault, 'chore: HBM 문서 생성')

      // 현행: candidate.id 가 git-hash 로 덮여 summary id = git-hash(12-hex) → UUIDV7_A 와 불일치 → RED.
      const { summary } = buildContent({ out, vault })

      expect(summary.docs[0].id).toBe(UUIDV7_A)
    } finally {
      cleanup(vault, out)
    }
  })
})
