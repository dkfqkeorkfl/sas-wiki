import { describe, expect, it } from 'vitest'
import { makeGitRunner, memoizeGitRunner } from '../../../scripts/lib/git.mjs'
import { collectHeadDocuments } from '../../../scripts/lib/head-state.mjs'
import { cleanup, commit, initVault, writeDoc } from '../../test-utils/tmp-git-vault.mjs'
import { inspectVault } from '../document-integrity.mjs'

describe('환경별 문서 검사에서 같은 입력의 공유', () => {
  it('snapshot과 성공 Git 조회를 공유해도 두 환경의 가시성을 각각 계산한다', () => {
    const vault = initVault()
    try {
      writeDoc(vault, 'company/공개', { id: '0192e000-0000-7000-8000-0000000000e1' })
      writeDoc(vault, 'dev/초안', { id: '0192e000-0000-7000-8000-0000000000e2' })
      commit(vault, 'chore: 문서 생성')
      const snapshot = collectHeadDocuments(vault)
      const calls = []
      const real = makeGitRunner(vault)
      const runGit = memoizeGitRunner((args, options) => {
        const value = real(args, options)
        calls.push(JSON.stringify([args, options.input ?? null, options.encoding ?? null]))
        return value
      })
      const dev = inspectVault({ vault, env: 'dev', snapshot, runGit })
      const afterDev = calls.length
      const prod = inspectVault({ vault, env: 'prod', snapshot, runGit })
      expect(snapshot.files).toHaveLength(2)
      expect(dev.summary.docs).toHaveLength(2)
      expect(prod.summary.docs).toHaveLength(1)
      expect(prod.summary.docs[0].title).toBe('공개')
      expect(calls.some((call) => call.includes('blame'))).toBe(true)
      expect(afterDev).toBeGreaterThan(0)
      expect(calls).toHaveLength(afterDev)
      expect(new Set(calls).size).toBe(calls.length)
    } finally {
      cleanup(vault)
    }
  })
})
