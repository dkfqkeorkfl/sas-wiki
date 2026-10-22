import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'

import { cleanup, commit, git, initVault, writeDoc } from '../../test-utils/tmp-git-vault.mjs'
import { inspectVault } from '../document-integrity.mjs'

const id = '0192a000-0000-7000-8000-0000000000aa'
describe('문서 검사에 필요한 전체 Git 이력', () => {
  it('정상 전체 이력은 허용하고 shallow clone은 원인과 복구 안내로 실패한다', () => {
    const vault = initVault(),
      shallow = mkdtempSync(path.join(tmpdir(), 'wiki-shallow-'))
    try {
      writeDoc(vault, 'concept/문서', { id })
      commit(vault, 'chore: 문서 생성')
      writeDoc(vault, 'concept/문서', { id, body: '갱신된 문서입니다.\n' })
      commit(vault, 'chore: 문서 수정')
      expect(inspectVault({ vault, env: 'dev' }).summary.docs).toHaveLength(1)
      git(vault, ['clone', '-q', '--depth=1', pathToFileURL(vault).href, shallow])
      expect(() => inspectVault({ vault: shallow, env: 'dev' })).toThrow(
        /shallow[\s\S]*fetch --unshallow/,
      )
    } finally {
      cleanup(vault, shallow)
    }
  })

  it('partial clone은 필터와 복구 안내를 포함해 실패한다', () => {
    const vault = initVault()
    try {
      writeDoc(vault, 'concept/문서', { id })
      commit(vault, 'chore: 문서 생성')
      git(vault, ['config', 'remote.origin.partialclonefilter', 'blob:none'])
      expect(() => inspectVault({ vault, env: 'dev' })).toThrow(
        /partial clone[\s\S]*blob:none[\s\S]*필터 없이/,
      )
    } finally {
      cleanup(vault)
    }
  })

  it('Git 실행 실패를 빈 문서나 빈 피드로 바꾸지 않는다', () => {
    const vault = initVault()
    try {
      expect(() =>
        inspectVault({
          vault,
          env: 'dev',
          runGit() {
            throw new Error('fixture Git I/O failure')
          },
        }),
      ).toThrow(/Git|git|fixture/)
    } finally {
      cleanup(vault)
    }
  })
})
