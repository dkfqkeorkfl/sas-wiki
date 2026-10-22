import { describe, expect, it } from 'vitest'
import { makeGitRunner } from '../lib/git.mjs'
import { parseVault } from '../lib/parse-vault.mjs'
import { cleanup } from './helpers/tmp-git-vault.mjs'
import { ID_A, seedCleanVault } from './helpers/polluted-vault.mjs'

describe('파싱의 Git 책임', () => {
  it('실제 문서·날짜·피드는 도출하고 ID 감사는 수행하지 않는다', () => {
    const { vault } = seedCleanVault()
    const calls = [],
      real = makeGitRunner(vault)
    try {
      const { wire } = parseVault(vault, 'dev', {
        runGit(args, options) {
          calls.push(args)
          return real(args, options)
        },
      })
      expect(wire.docs.map((doc) => doc.id)).toContain(ID_A)
      expect(wire.items.length).toBeGreaterThan(0)
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
