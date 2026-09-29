// @vitest-environment node
//
// P1(통합) · R5 — 불변 게이트: id 줄의 마지막 변경 직전 id ≠ 현재 id 면 build fail — tdd §3 Task 3
//
// RED 사유(작성 당시): build 에 불변 게이트가 **없었고**, frontmatter id 를 무시하고 git-hash 를
//   주입했으므로 frontmatter id 를 사후 변조해도 build 가 조용히 성공했다. → id 줄을 마지막으로 바꾼
//   커밋의 바로 전 id 와 지금 id 를 대조해 다르면 실패시키는 게이트(ID_TAMPERED)가 green 조건이다.
//
// 경계(false-fail 금지 · anti-over-fire): 직전 값이 유효한 id 가 아닌 문서(처음 등록)는 반드시
//   **PASS** — 비교할 기준이 없다. 게이트가 처음 등록을 "차이"로 오판하면 id 를 처음 넣는 커밋이
//   전부 false-fail 한다.
import { describe, expect, it } from 'vitest'

import { buildContent } from '../validate.mjs'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { cleanup, commit, git, initVault, makeOut, writeDoc } from './helpers/tmp-git-vault.mjs'

const UUIDV7_A = '0192f0c0-8000-7000-8000-0123456789ab'
const UUIDV7_B = '0192f0c0-8000-7000-9abc-0123456789ab'

describe('R5 build 불변 게이트 — 사후 id 변조 차단', () => {
  it('id 를 바꾼 커밋이 있으면(바로 전 id ≠ 현재 id) build 가 실패한다', () => {
    const vault = initVault()
    const out = makeOut()
    try {
      writeDoc(vault, 'tech/HBM', { id: UUIDV7_A, title: 'HBM' }) // 생성: id=A
      commit(vault, 'chore: HBM 문서 생성')
      writeDoc(vault, 'tech/HBM', { id: UUIDV7_B, title: 'HBM' }) // 변조: id=B
      commit(vault, 'chore: HBM id 변조')

      // 현행: 게이트 부재 + git-hash 주입 → 변조가 통과 → build 성공(no-throw) → 이 단언이 RED.
      expect(() => buildContent({ out, vault })).toThrow(/ID_TAMPERED/u)
    } finally {
      cleanup(vault, out)
    }
  })
})

describe('R5 경계(green-stay) — 처음 등록하는 id 는 게이트를 통과한다', () => {
  it('커밋된 이력에 id 가 없던 문서에 처음 넣는 id 는 build 가 실패하지 않는다(false-fail 금지)', () => {
    const vault = initVault()
    const out = makeOut()
    try {
      // 실 마이그레이션 재현: 커밋된 이력에는 id 가 없고(직전 값 없음 → 처음 등록=PASS), 마이그레이션이
      // working tree 에 id 를 넣는다(미커밋 → 스키마 required(id) PASS). 이 조합에서 게이트가 처음 등록을
      // "차이"로 오판하지 않는지 검증한다.
      writeDoc(vault, 'tech/HBM', { title: 'HBM' }) // 생성 커밋: id 없음
      commit(vault, 'chore: HBM 문서 생성')
      writeDoc(vault, 'tech/HBM', { id: UUIDV7_A, title: 'HBM' }) // 마이그레이션: working tree id(미커밋)

      expect(() => buildContent({ out, vault })).not.toThrow()
    } finally {
      cleanup(vault, out)
    }
  })
})

describe('불변 게이트 기준 = id 줄을 마지막으로 바꾼 커밋의 바로 전 값(blame)', () => {
  it('생성 때 없던 id 를 나중에 넣고 다시 바꾸면 build 가 실패한다', () => {
    const vault = initVault()
    const out = makeOut()
    try {
      writeDoc(vault, 'tech/HBM', { title: 'HBM' }) // 생성: id 없음
      commit(vault, 'chore: HBM 문서 생성')
      writeDoc(vault, 'tech/HBM', { id: UUIDV7_A, title: 'HBM' }) // 처음 등록: A
      commit(vault, 'chore: HBM id 등록')
      writeDoc(vault, 'tech/HBM', { id: UUIDV7_B, title: 'HBM' }) // 변경: B
      commit(vault, 'chore: HBM id 변경')

      expect(() => buildContent({ out, vault })).toThrow(/ID_TAMPERED/u)
    } finally {
      cleanup(vault, out)
    }
  })

  it('바꿨다 되돌린 id 도 변경이다 — 되돌린 커밋의 바로 전 값과 다르다', () => {
    // 합의한 규칙: 되돌리기도 "유효한 id 가 다른 유효한 id 로 바뀐" 변경이다. 이런 문서는 지우고
    //   새 문서로 다시 만든다(README · 문서 id 정정).
    const vault = initVault()
    const out = makeOut()
    try {
      writeDoc(vault, 'tech/HBM', { id: UUIDV7_A, title: 'HBM' })
      commit(vault, 'chore: HBM 문서 생성')
      writeDoc(vault, 'tech/HBM', { id: UUIDV7_B, title: 'HBM' })
      commit(vault, 'chore: HBM id 실수로 변경')
      writeDoc(vault, 'tech/HBM', { id: UUIDV7_A, title: 'HBM' })
      commit(vault, 'chore: HBM id 되돌림')

      expect(() => buildContent({ out, vault })).toThrow(/ID_TAMPERED/u)
    } finally {
      cleanup(vault, out)
    }
  })

  it('id 줄을 지운 커밋 뒤에 새 id 를 넣으면 build 가 통과한다(열어 둔 정정 경로)', () => {
    // 합의한 규칙: 직전 값이 비어 있으면 처음 등록이다. id 규칙이 바뀔 때 이 두 커밋으로 id 를
    //   정정할 수 있게 열어 둔다 — 첫 커밋(id 삭제)은 커밋 훅이 막으므로 사람이 훅을 건너뛰어 만든다.
    const vault = initVault()
    const out = makeOut()
    try {
      writeDoc(vault, 'tech/HBM', { id: UUIDV7_A, title: 'HBM' })
      commit(vault, 'chore: HBM 문서 생성')
      writeDoc(vault, 'tech/HBM', { title: 'HBM' })
      commit(vault, 'chore: HBM id 줄 삭제')
      writeDoc(vault, 'tech/HBM', { id: UUIDV7_B, title: 'HBM' })
      commit(vault, 'chore: HBM 새 id 삽입')

      expect(() => buildContent({ out, vault })).not.toThrow()
    } finally {
      cleanup(vault, out)
    }
  })

  it('생성 때 빈 id 자리(id: "")를 두고 나중에 채우면 build 가 통과한다(빈 값은 등록이 아니다)', () => {
    const vault = initVault()
    const out = makeOut()
    try {
      writeDoc(vault, 'tech/HBM', { id: '', title: 'HBM' })
      commit(vault, 'chore: HBM 문서 생성')
      writeDoc(vault, 'tech/HBM', { id: UUIDV7_A, title: 'HBM' })
      commit(vault, 'chore: HBM id 채움')

      expect(() => buildContent({ out, vault })).not.toThrow()
    } finally {
      cleanup(vault, out)
    }
  })

  it('따옴표만 바꾼 커밋은 변경이 아니다(데이터로 비교한다)', () => {
    const vault = initVault()
    const out = makeOut()
    try {
      const file = writeDoc(vault, 'tech/HBM', { id: UUIDV7_A, title: 'HBM' })
      commit(vault, 'chore: HBM 문서 생성')
      writeFileSync(
        file,
        readFileSync(file, 'utf8').replace(`id: "${UUIDV7_A}"`, `id: '${UUIDV7_A}'`),
      )
      commit(vault, 'chore: 따옴표만 변경')

      expect(() => buildContent({ out, vault })).not.toThrow()
    } finally {
      cleanup(vault, out)
    }
  })

  it('예전 문서가 떠난 경로에 커밋 전 새 문서를 만들어도 변경으로 보지 않는다', () => {
    // 옛 이력(떠난 문서의 id)을 새 문서의 기준으로 삼으면 커밋 전부터 오탐한다.
    const vault = initVault()
    const out = makeOut()
    try {
      writeDoc(vault, 'tech/HBM', { id: UUIDV7_A, title: 'HBM' })
      commit(vault, 'chore: HBM 문서 생성')
      git(vault, ['rm', '-q', path.join('wiki', 'tech', 'HBM.md')])
      commit(vault, 'chore: HBM 삭제')
      writeDoc(vault, 'tech/HBM', { id: UUIDV7_B, title: 'HBM' }) // 커밋 전 새 문서

      expect(() => buildContent({ out, vault })).not.toThrow()
    } finally {
      cleanup(vault, out)
    }
  })

  it('실패 사유에 원래 id 가 실린다(어느 값으로 되돌릴지 알 수 있다)', () => {
    const vault = initVault()
    const out = makeOut()
    try {
      writeDoc(vault, 'tech/HBM', { id: UUIDV7_A, title: 'HBM' })
      commit(vault, 'chore: HBM 문서 생성')
      writeDoc(vault, 'tech/HBM', { id: UUIDV7_B, title: 'HBM' })
      commit(vault, 'chore: HBM id 변경')

      expect(() => buildContent({ out, vault })).toThrow(
        new RegExp(`원래 id\\(${UUIDV7_A}\\)`, 'u'),
      )
    } finally {
      cleanup(vault, out)
    }
  })
})
