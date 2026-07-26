import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { commit, feedCommit, git, initVault, writeDoc } from './tmp-git-vault.mjs'

export const ID_A = '0192a000-0000-7000-8000-0000000000aa' // 공개
export const ID_B = '0192b000-0000-7000-8000-0000000000bb' // 실험 draft
export const ID_C = '0192c000-0000-7000-8000-0000000000cc' // 폐기

export const T1 = '2026-01-01T00:00:00Z'
export const T2 = '2026-01-02T00:00:00Z'
export const T3 = '2026-01-03T00:00:00Z'

/**
 * RR-BASE — 공개(active), 실험(draft), 폐기(deleted)를 각각 1건씩 가리키는 feed 3건.
 *
 * `draftBy: 'folder'` 는 `wiki/dev/실험.md`, `'frontmatter'` 는 `wiki/lab/실험.md` + `draft: true`.
 * 호출부는 이 원자로 관측하려는 동작을 직접 단언한다. 이 헬퍼에는 expect 를 두지 않는다.
 */
export function seedSurvivalVault({ draftBy = 'folder' } = {}) {
  const vault = initVault()
  writeDoc(vault, 'company/공개', { id: ID_A, wikiRoot: 'wiki' })
  const draftRel = draftBy === 'folder' ? 'dev/실험' : 'lab/실험'
  if (draftBy === 'folder') writeDoc(vault, draftRel, { id: ID_B, wikiRoot: 'wiki' })
  else writeDraftDoc(vault, draftRel, ID_B)
  writeDoc(vault, 'concept/폐기', { id: ID_C, wikiRoot: 'wiki' })
  commit(vault, 'chore: 초기 문서 3건')

  writeDoc(vault, 'company/공개', { body: '## 정의\n\n공개 갱신.\n', id: ID_A, wikiRoot: 'wiki' })
  feedCommit(vault, { date: T1, subject: '공개 소식' })

  if (draftBy === 'folder') {
    writeDoc(vault, draftRel, { body: '## 정의\n\n실험 갱신.\n', id: ID_B, wikiRoot: 'wiki' })
  } else {
    writeDraftDoc(vault, draftRel, ID_B, '## 정의\n\n실험 갱신.\n')
  }
  feedCommit(vault, { date: T2, subject: '실험 소식' })

  writeDoc(vault, 'concept/폐기', { body: '## 정의\n\n폐기 갱신.\n', id: ID_C, wikiRoot: 'wiki' })
  feedCommit(vault, { date: T3, subject: '폐기 소식' })

  git(vault, ['rm', '-q', 'wiki/concept/폐기.md'])
  commit(vault, 'chore: 폐기 문서 삭제')
  return vault
}

function writeDraftDoc(root, rel, id, body = '## 정의\n\n본문 문단이다.\n') {
  const full = path.join(root, 'wiki', `${rel}.md`)
  mkdirSync(path.dirname(full), { recursive: true })
  const front = [
    '---',
    `title: ${rel.split('/').at(-1)}`,
    'type: concept',
    'status: active',
    'draft: true',
    `id: "${id}"`,
    '---',
    '',
    body,
  ]
  writeFileSync(full, front.join('\n'))
}
