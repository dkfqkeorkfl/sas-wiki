import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { cleanup, commit, git, initVault } from '../../test-utils/tmp-git-vault.mjs'
import { createExampleVault } from '../../test-utils/seed-example-vault.mjs'
import { inspectVault } from '../document-integrity.mjs'

const EPOCH = '1700000000'
const roots = []

beforeEach(() => vi.stubEnv('SOURCE_DATE_EPOCH', EPOCH))
afterEach(() => {
  try {
    cleanup(...roots.splice(0))
  } finally {
    vi.unstubAllEnvs()
  }
})

function appendDoc(root, rel, paragraph) {
  const full = path.join(root, 'wiki', `${rel}.md`)
  writeFileSync(full, `${readFileSync(full, 'utf8')}\n${paragraph}\n`)
}

// 각 문서와 삭제 후 재생성한 문서는 서로 다른 UUIDv7을 사용한다.
let idSeq = 0

function nextDocId() {
  return `0192f0d0-0000-7000-8000-${(idSeq += 1).toString(16).padStart(12, '0')}`
}

function writeDoc(root, rel, title) {
  const full = path.join(root, 'wiki', `${rel}.md`)
  mkdirSync(path.dirname(full), { recursive: true })
  const id = nextDocId()
  writeFileSync(
    full,
    [
      '---',
      `id: "${id}"`,
      `title: ${title}`,
      'type: concept',
      'status: active',
      'tags: ["반도체"]',
      '---',
      '',
      '## 정의',
      '',
      `${title} 문서의 정의 문단이다.`,
      '',
      '## 로드맵',
      '',
      '세대 전환을 준비한다.',
      '',
    ].join('\n'),
  )
}

function createHistoryVault() {
  const vault = initVault()
  roots.push(vault)

  // 1 · 문서 생성(chore — id = frontmatter 저작 UUIDv7)
  writeDoc(vault, 'concept/foo', '삼성전자')
  commit(vault, 'chore: 삼성전자 문서 생성')

  // 2 · 삭제 후 재생성될 문서 — **옛 id**(부활하면 안 된다)
  writeDoc(vault, 'concept/reborn', '부활문서')
  commit(vault, 'chore: 부활문서 문서 생성')

  // 3 · 삭제될 문서
  writeDoc(vault, 'misc/del-me', '폐기문서')
  commit(vault, 'chore: 폐기문서 문서 생성')

  // 4 · feed — 살아남는 피드(anchor = 바뀐 섹션)
  appendDoc(vault, 'concept/foo', 'HBM4 양산 로드맵을 공개했다.')
  commit(vault, 'feed: 삼성전자 HBM4 로드맵 공개\n\n본문.\n\nKeywords: HBM\nImportance: breaking')

  // 5 · feed — 대상 문서가 곧 삭제되어 **prune 될** 피드
  appendDoc(vault, 'misc/del-me', '정리 대상으로 분류됐다.')
  commit(vault, 'feed: 폐기문서 관련 소식\n\n본문.\n\nKeywords: 정리\nImportance: normal')

  // 6 · chore — 피드 미발행 수정(재생성 준비: 삭제)
  git(vault, ['rm', '-q', 'wiki/concept/reborn.md'])
  commit(vault, 'chore: 부활문서 삭제')

  // 7 · chore — 삭제(→ 5번 피드가 prune 된다)
  git(vault, ['rm', '-q', 'wiki/misc/del-me.md'])
  commit(vault, 'chore: 폐기문서 삭제')

  // 8 · chore — **같은 경로에 재생성 → 새 문서(새 id)**  (README · 문서 id)
  writeDoc(vault, 'concept/reborn', '부활문서')
  commit(vault, 'chore: 부활문서 재생성')

  // 9~13 · **경로 재사용 함정** — 살아 있는 문서의 과거 피드가 사라지면 안 된다.
  //   문서 A 를 x 에 만들고 → A 를 가리키는 feed → A 를 y 로 이동 → **다른 문서 B 가 빈 x 를 재사용**
  //   → B 삭제. 이때 x 는 "삭제된 경로" 지만, 그 feed 의 diff 가 가리키는 x 는 **그 시점의 A** 이고
  //   A 는 y 로 멀쩡히 살아 있다. 경로만 보고 prune 하면 A 의 뉴스가 통째로 증발한다.
  writeDoc(vault, 'company/reuse-x', '이사간문서')
  commit(vault, 'chore: 이사간문서 문서 생성')

  appendDoc(vault, 'company/reuse-x', '신제품 라인업을 공개했다.')
  commit(vault, 'feed: 이사간문서 신제품 공개\n\n본문.\n\nKeywords: 신제품\nImportance: normal')

  git(vault, ['mv', 'wiki/company/reuse-x.md', 'wiki/company/reuse-y.md'])
  commit(vault, 'chore: 이사간문서를 reuse-y 로 이동')

  writeDoc(vault, 'company/reuse-x', '경로재사용문서')
  commit(vault, 'chore: 경로재사용문서 생성')

  git(vault, ['rm', '-q', 'wiki/company/reuse-x.md'])
  commit(vault, 'chore: 경로재사용문서 삭제')

  return vault
}

describe('정상 문서 이력의 전체 집행', () => {
  it.each([
    { name: '문서 이동·삭제·경로 재사용 이력', createVault: createHistoryVault },
    {
      name: '예제 문서·피드 이력',
      createVault() {
        const vault = createExampleVault()
        roots.push(vault)
        return vault
      },
    },
  ])('$name를 허용한다', ({ createVault }) => {
    // inspectVault가 스키마와 불변식을 집행한다. 반환한 결과에 같은 검사를 반복하지 않는다.
    const result = inspectVault({ vault: createVault() })
    expect(result.report.error).toBeNull()
  })
})
