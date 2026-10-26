// @vitest-environment node
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { getFileHistory, makeGitRunner } from '../git.mjs'
import { cleanup, commit, git, initVault } from '../../__tests__/helpers/tmp-git-vault.mjs'

describe.each([
  ['package[.]json', 'package.json'],
  ['note*.md', 'note-other.md'],
])('getFileHistory — literal 경로 %s', (literal, other) => {
  it('이름이 패턴에 맞는 다른 파일의 이력을 가져오지 않는다', () => {
    const vault = initVault()
    try {
      writeFileSync(path.join(vault, other), '다른 파일의 내용')
      commit(vault, 'chore: 다른 파일 생성')
      expect(getFileHistory(makeGitRunner(vault), literal)).toEqual([])
    } finally {
      cleanup(vault)
    }
  })

  it('--follow 가 literal 파일의 이동 전 이력만 추적한다', () => {
    const vault = initVault()
    try {
      writeFileSync(path.join(vault, other), '완전히 별개인 파일')
      commit(vault, 'chore: 다른 파일 생성')
      writeFileSync(path.join(vault, 'before.txt'), '이동할 문서의 고유 본문')
      const added = commit(vault, 'chore: 이동 전 파일 생성')
      git(vault, ['mv', '--', 'before.txt', literal])
      const renamed = commit(vault, 'chore: 특수 이름으로 이동')

      expect(
        getFileHistory(makeGitRunner(vault), literal).map(({ ts: _ts, ...entry }) => entry),
      ).toEqual([
        { oldPath: 'before.txt', pathAtCommit: literal, sha: renamed, status: 'R' },
        { pathAtCommit: 'before.txt', sha: added, status: 'A' },
      ])
    } finally {
      cleanup(vault)
    }
  })
})
