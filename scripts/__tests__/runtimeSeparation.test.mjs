import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { runSummaryGenerator } from '../lib/generator.mjs'
import { makeGitRunner } from '../lib/git.mjs'
import { makeGitCountShim } from './helpers/git-count-shim.mjs'
import { cleanup, commit, feedCommit, initVault, writeDoc } from './helpers/tmp-git-vault.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const originalId = '0192a000-0000-7000-8000-0000000000aa'
const currentId = '0192b000-0000-7000-8000-0000000000bb'
const auditCalls = (calls) =>
  calls.filter(
    (args) =>
      args.includes('blame') ||
      (args.includes('--diff-filter=D') && args.includes('--find-renames')),
  )

function seedVault({ tampered = false } = {}) {
  const vault = initVault()
  writeDoc(vault, 'concept/문서', { id: originalId })
  commit(vault, 'chore: 문서 생성')
  writeDoc(vault, 'concept/문서', {
    id: tampered ? currentId : originalId,
    body: '갱신된 본문입니다.\n',
  })
  feedCommit(vault, { subject: '문서 갱신' })
  return vault
}

describe('기능 처리와 문서 감사의 경계', () => {
  it.each(['dev', 'prod'])(
    '%s summary는 실제 이력을 사용하되 ID를 감사하지 않는다',
    async (env) => {
      const vault = seedVault()
      const calls = []
      const real = makeGitRunner(vault, { timeoutMs: 30000 })
      try {
        const result = await runSummaryGenerator({
          vault,
          env,
          runGit(args, options) {
            calls.push(args)
            return real(args, options)
          },
        })
        expect(result.payload.docs.map((doc) => doc.id)).toEqual([originalId])
        expect(result.payload.docs[0].updated).toBeTruthy()
        expect(calls.some((args) => args.includes('--follow'))).toBe(true)
        expect(auditCalls(calls)).toEqual([])
      } finally {
        cleanup(vault)
      }
    },
  )

  it('summary는 ID 변경을 찾아 문서를 제외하는 정책을 실행하지 않는다', async () => {
    const vault = seedVault({ tampered: true })
    try {
      const { payload } = await runSummaryGenerator({ vault, env: 'dev' })
      expect(payload.docs.map((doc) => doc.id)).toEqual([currentId])
    } finally {
      cleanup(vault)
    }
  })

  it('라이브 feeds는 실제 피드를 해석하되 전체 ID 감사를 실행하지 않는다', () => {
    const vault = seedVault()
    const shim = makeGitCountShim()
    try {
      const result = spawnSync(
        process.execPath,
        [path.join(root, 'scripts/feeds.mjs'), '--vault', vault, '--env', 'dev', '--count', '5'],
        {
          encoding: 'utf8',
          env: shim.env(),
          timeout: 120000,
          killSignal: 'SIGKILL',
        },
      )
      expect(result.error).toBeUndefined()
      expect(result.status, result.stderr).toBe(0)
      expect(JSON.parse(result.stdout).items[0].docs).toEqual([{ id: originalId }])
      const calls = shim.read()
      expect(calls.some((args) => args.includes('rev-list'))).toBe(true)
      expect(auditCalls(calls)).toEqual([])
    } finally {
      cleanup(vault, shim.root)
    }
  })

  it('summary의 감사 전용 옵션은 호출 오류로 드러난다', () => {
    const vault = seedVault()
    try {
      const result = spawnSync(
        process.execPath,
        [
          path.join(root, 'scripts/summary.mjs'),
          '--vault',
          vault,
          '--env',
          'dev',
          '--max-excluded=0',
        ],
        {
          encoding: 'utf8',
          timeout: 120000,
          killSignal: 'SIGKILL',
        },
      )
      expect(result.error).toBeUndefined()
      expect(result.status, result.stderr).toBe(2)
      expect(result.stderr).toContain('--max-excluded')
    } finally {
      cleanup(vault)
    }
  })
})
