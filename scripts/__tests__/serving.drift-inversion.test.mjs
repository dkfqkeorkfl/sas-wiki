import { describe, expect, it } from 'vitest'
import { runSummaryGenerator } from '../lib/generator.mjs'
import { makeGitRunner } from '../lib/git.mjs'
import { cleanup } from './helpers/tmp-git-vault.mjs'
import { seedTamperedVault, seedIdReuseVault } from './helpers/drifted-vault.mjs'

describe('기능 처리에서 ID 감사를 분리한다', () => {
  it.each([
    ['ID 변경', seedTamperedVault],
    ['삭제 ID 재사용', seedIdReuseVault],
  ])('%s 입력을 전체 감사 호출 없이 처리한다', async (_label, seed) => {
    const { vault } = seed()
    const calls = []
    const real = makeGitRunner(vault)
    try {
      const { payload } = await runSummaryGenerator({
        vault,
        env: 'dev',
        runGit(args, options) {
          calls.push(args)
          return real(args, options)
        },
      })
      expect(payload.docs.length).toBeGreaterThan(0)
      expect(calls.some((args) => args.includes('--follow'))).toBe(true)
      expect(calls.filter((args) => args.includes('blame'))).toEqual([])
      expect(
        calls.filter((args) => args.includes('--diff-filter=D') && args.includes('--find-renames')),
      ).toEqual([])
    } finally {
      cleanup(vault)
    }
  })
})
