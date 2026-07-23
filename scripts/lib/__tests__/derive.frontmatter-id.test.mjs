// @vitest-environment node
//
// P1 · R2 — id 유도 반전 (git-hash → frontmatter) — tdd §3 Task 2
//
// RED 사유: 현행 derive(derive.mjs:34-41)는 `id: dates.hash.slice(0, 12)` 로 **git 생성 해시**를
//   id 로 쓴다. 문서 frontmatter 에 UUIDv7 id 가 있어도 무시된다. → id 출처를 `parsed.frontmatter.id`
//   로 반전해야 green.
//
// green-stay(id/이력 출처 분리): created·updated 는 **여전히 fakeGit dates** 에서 온다(frontmatter
//   아님). 이 단언이 "id 만 frontmatter 로 이관, 이력 메타는 파생 유지"를 못박아 과잉 반전(이력까지
//   frontmatter 로 끌어옴)을 막는다.
import { describe, expect, it } from 'vitest'

import { derive } from '../derive.mjs'

const UUIDV7_A = '0192f0c0-8000-7000-8000-0123456789ab'
// git 생성 해시 — UUIDv7 도 아니고 slice(0,12) 도 UUIDv7 A 와 다르다(현행 id 출처).
const GIT_HASH = '1111111111112222222222223333333333334444'
const CREATED = '2026-01-01T00:00:00Z'
const UPDATED = '2026-01-09T00:00:00Z'

/** `git log --follow --name-status --format=%H%x09%aI` 실제 출력(최신순: M 그리고 A). */
function aLog(sha, file) {
  return [`${sha}\t${UPDATED}`, '', `M\t${file}`, `${sha}\t${CREATED}`, '', `A\t${file}`].join('\n')
}

function makeRunner(logByRelPath) {
  return (args) => {
    const file = String(args.at(-1))
    for (const [rel, log] of Object.entries(logByRelPath)) {
      if (file.includes(`${rel}.md`)) return log
    }
    return ''
  }
}

/** frontmatter 에 UUIDv7 id 가 저작된 합성 파싱 문서. */
function aParsedDoc(relPath, frontmatterPatch = {}) {
  return {
    body: '## 정의\n\n본문 문단.\n',
    bodyLineOffset: 6,
    breadcrumb: relPath.split('/'),
    filePath: `/tmp/vault/wiki/${relPath}.md`,
    frontmatter: {
      status: 'active',
      tags: [],
      title: relPath.split('/').at(-1),
      type: 'concept',
      ...frontmatterPatch,
    },
    relPath,
  }
}

describe('R2 derive — id 는 frontmatter UUIDv7, created/updated 는 git 파생', () => {
  it('docs[0].id 가 frontmatter UUIDv7 이다(git 해시 slice 아님)', () => {
    const runner = makeRunner({ 'tech/HBM': aLog(GIT_HASH, 'vault/wiki/tech/HBM.md') })

    const { docs } = derive([aParsedDoc('tech/HBM', { id: UUIDV7_A })], runner)

    expect(docs[0].id).toBe(UUIDV7_A)
  })

  it('created·updated 는 여전히 fakeGit dates 에서 온다(이력 메타는 파생 유지)', () => {
    const runner = makeRunner({ 'tech/HBM': aLog(GIT_HASH, 'vault/wiki/tech/HBM.md') })

    const { docs } = derive([aParsedDoc('tech/HBM', { id: UUIDV7_A })], runner)

    expect(docs[0].created).toBe(CREATED)
    expect(docs[0].updated).toBe(UPDATED)
  })

  it('disable 스텁도 frontmatter UUIDv7 id 를 그대로 싣는다', () => {
    const runner = makeRunner({ 'legacy/폐문서': aLog(GIT_HASH, 'vault/wiki/legacy/폐문서.md') })

    const { docs } = derive(
      [aParsedDoc('legacy/폐문서', { id: UUIDV7_A, status: 'disable', title: '폐문서' })],
      runner,
    )

    expect(docs[0].id).toBe(UUIDV7_A)
  })
})
