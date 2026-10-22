// @vitest-environment node
// 실제 validate가 중복 ID 문서의 push를 차단하는 기능 검사다.
// 훅 설정·명령 순서 계약은 harness/validation-regression에서 수동 검증한다.
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { cleanup, commit, git, initVault, writeDoc } from './helpers/tmp-git-vault.mjs'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

describe('push 직전 validate — 실제 git push', () => {
  /** validate 를 부르는 pre-push 훅 디렉터리(`core.hooksPath` 로 지정한다). */
  function hooksDir() {
    const dir = mkdtempSync(path.join(tmpdir(), 'pre-push-hooks-'))
    const hook = path.join(dir, 'pre-push')
    const validate = path.join(REPO_ROOT, 'scripts', 'validate.mjs')
    writeFileSync(hook, `#!/bin/sh\nexec "${process.execPath}" "${validate}" --env dev --vault .\n`)
    chmodSync(hook, 0o755)
    return dir
  }

  function pushWithHook(vault, hooks, remote) {
    return spawnSync('git', ['-c', `core.hooksPath=${hooks}`, 'push', '-q', remote, 'HEAD:main'], {
      cwd: vault,
      encoding: 'utf8',
    })
  }

  it('복사해서 id 가 겹친 문서가 있으면 push 가 멈추고 원격은 그대로다 → 복사본 id 를 고치면 통과한다', () => {
    const vault = initVault()
    const remote = mkdtempSync(path.join(tmpdir(), 'pre-push-remote-'))
    const hooks = hooksDir()
    try {
      git(remote, ['init', '-q', '--bare'])
      const ID = '0192f0c0-8000-7000-8000-00000000000a'
      writeDoc(vault, 'tech/HBM', { id: ID, title: 'HBM' })
      commit(vault, 'chore: HBM 생성')
      const pushed = pushWithHook(vault, hooks, remote)
      expect(pushed.status, pushed.stderr).toBe(0)

      writeDoc(vault, 'tech/HBM-복사', { id: ID, title: 'HBM 복사' }) // 복사로 따라온 id
      commit(vault, 'chore: 복사한 문서')

      const blocked = pushWithHook(vault, hooks, remote)

      expect(blocked.status).not.toBe(0)
      expect(blocked.stderr).toMatch(/DUPLICATE_ID/u)
      expect(git(remote, ['rev-parse', 'main'])).toBe(git(vault, ['rev-parse', 'HEAD~1']))

      // 아직 push 하지 않은 커밋이라 되돌려 고친다(커밋 훅이 하는 일을 여기선 직접 한다).
      git(vault, ['reset', '-q', '--soft', 'HEAD~1'])
      writeDoc(vault, 'tech/HBM-복사', { id: '0192f0c0-8000-7000-8000-00000000000b', title: 'HBM 복사' }) // prettier-ignore
      commit(vault, 'chore: 복사한 문서')

      expect(pushWithHook(vault, hooks, remote).status).toBe(0)
    } finally {
      cleanup(vault, remote, hooks)
    }
  })
})
