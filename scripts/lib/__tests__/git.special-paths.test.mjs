// @vitest-environment node
import { describe, expect, it } from 'vitest'

import {
  anyMarkdown,
  collectDeletedDocEvents,
  collectEverDeletedDocPaths,
  getCommitDocStatuses,
  getFileHistory,
  makeGitRunner,
} from '../git.mjs'
import {
  cleanup,
  commit,
  git,
  initVault,
  writeDoc,
} from '../../__tests__/helpers/tmp-git-vault.mjs'

const NAMES = ['따옴표"', '역슬래시\\', '탭\t', '개행\n', '캐리지\r', '제어\x01\x07\b\f\v']

/** 추가·이동·삭제를 모두 남긴다. 본문은 같아야 git 이 이동으로 판정한다. */
function withHistory(name, check) {
  const vault = initVault()
  try {
    const oldPath = `wiki/old-${name}.md`
    const newPath = `wiki/new-${name}.md`
    writeDoc(vault, `old-${name}`, { title: '특수 경로' })
    const added = commit(vault, 'chore: 추가')
    git(vault, ['mv', '--', oldPath, newPath])
    const renamed = commit(vault, 'chore: 이동')
    git(vault, ['rm', '--', newPath])
    const deleted = commit(vault, 'chore: 삭제')
    check({ added, deleted, newPath, oldPath, renamed, runGit: makeGitRunner(vault) })
  } finally {
    cleanup(vault)
  }
}

describe.each(NAMES)('git — 특수 경로 %j 원문 보존', (name) => {
  it('커밋의 추가·이동·삭제 경로를 원형 그대로 판정한다', () => {
    withHistory(name, ({ added, deleted, newPath, oldPath, renamed, runGit }) => {
      expect(getCommitDocStatuses(runGit, added, anyMarkdown)).toEqual([
        { path: oldPath, status: 'A' },
      ])
      expect(getCommitDocStatuses(runGit, renamed, anyMarkdown)).toEqual([
        { oldPath, path: newPath, status: 'R' },
      ])
      expect(getCommitDocStatuses(runGit, deleted, anyMarkdown)).toEqual([
        { path: newPath, status: 'D' },
      ])
    })
  })

  it('과거 삭제 경로 집합에 원 경로를 남긴다', () => {
    withHistory(name, ({ newPath, runGit }) => {
      expect(collectEverDeletedDocPaths(runGit, { isDocPath: anyMarkdown })).toEqual(
        new Set([newPath]),
      )
    })
  })

  it('삭제 이벤트에 원 경로와 삭제 커밋을 남긴다', () => {
    withHistory(name, ({ deleted, newPath, runGit }) => {
      expect(collectDeletedDocEvents(runGit, { isDocPath: anyMarkdown })).toEqual([
        { path: newPath, sha: deleted },
      ])
    })
  })

  it('파일 이력의 당시 경로와 이동 전 경로를 복원한다', () => {
    withHistory(name, ({ added, deleted, newPath, oldPath, renamed, runGit }) => {
      const history = getFileHistory(runGit, newPath)
      expect(history.map(({ ts: _ts, ...entry }) => entry)).toEqual([
        { pathAtCommit: newPath, sha: deleted, status: 'D' },
        { oldPath, pathAtCommit: newPath, sha: renamed, status: 'R' },
        { pathAtCommit: oldPath, sha: added, status: 'A' },
      ])
    })
  })
})

it('8진 바이트로 인용된 UTF-8 경로도 복원한다', () => {
  const quoted = '"wiki/\\355\\225\\234\\352\\270\\200.md"'
  expect(getCommitDocStatuses(() => `A\t${quoted}\n`, 'sha', anyMarkdown)).toEqual([
    { path: 'wiki/한글.md', status: 'A' },
  ])
})
