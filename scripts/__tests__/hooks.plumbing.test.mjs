// @vitest-environment node
//
// git 훅 배선 — 클론 후 `pnpm install` 만으로 커밋·push 직전 검사가 걸리게 되는 연결부.
//
//   · `prepare` 가 husky 를 실행한다 — husky 9 는 `core.hooksPath` 를 `.husky/_` 로 두고 거기서
//     `.husky/<훅 이름>` 을 `sh -e` 로 실행한다(github.com/typicode/husky `husky` 스크립트).
//   · `.husky/pre-commit` 은 문서 id 를 판단한다(미등록이면 채우고 훼손·변경이면 막는다).
//   · `.husky/pre-push` 는 CI 와 같은 문서 검증(validate)을 돌린다 — 중복 id 는 여기서 처음 걸린다.
//   · 새 문서 id 발급(uuid)은 커밋 훅만 쓴다. feeds 서빙 경로는 npm 패키지를 로드하지 않아야 하므로
//     (`serving.cost-profile.test.mjs`) 발급을 `new-doc-id.mjs` 로 분리했고, uuid 는 husky 와 함께
//     개발 도구(devDependency)다.
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { cleanup, commit, git, initVault, writeDoc } from './helpers/tmp-git-vault.mjs'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const pkg = JSON.parse(readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'))

/** 훅 파일에서 주석·빈 줄을 뺀 실행 줄. */
const commandsOf = (hook) =>
  readFileSync(path.join(REPO_ROOT, '.husky', hook), 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'))

describe('git 훅 배선', () => {
  it('prepare 가 husky 를 설치한다', () => {
    expect(pkg.scripts.prepare).toBe('husky')
    expect(pkg.devDependencies).toHaveProperty('husky')
  })

  it('.husky/pre-commit 은 check-doc-ids 만 실행한다', () => {
    expect(commandsOf('pre-commit')).toEqual(['node scripts/check-doc-ids.mjs'])
  })

  it('.husky/pre-push 는 validate 를 돌리고, 실패하면 고치는 방법을 알리고 멈춘다', () => {
    const commands = commandsOf('pre-push')

    expect(commands[0]).toBe('node scripts/validate.mjs --env dev || {')
    expect(commands.at(-2)).toBe('exit 1')
    expect(commands.join('\n')).toContain('git reset --soft')
  })

  it('uuid 는 훅 전용 개발 도구다(devDependency)', () => {
    expect(pkg.devDependencies).toHaveProperty('uuid')
    expect(pkg.dependencies).not.toHaveProperty('uuid')
  })
})

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
