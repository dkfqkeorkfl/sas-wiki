import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  copyFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { cleanup, commit, git, initVault, writeDoc } from './helpers/tmp-git-vault.mjs'

const repo = fileURLToPath(new URL('../../', import.meta.url))
const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`

function installFixtureHook(vault, bin) {
  for (const dir of ['scripts/lib', 'scripts/schema']) {
    cpSync(path.join(repo, dir), path.join(vault, dir), {
      recursive: true,
      filter: (source) => !source.includes('__tests__'),
    })
  }
  const domain = 'harness/wiki-documents'
  mkdirSync(path.join(vault, domain, '__tests__'), { recursive: true })
  for (const name of [
    'document-rules.mjs',
    'document-state.mjs',
    'document-invariants.mjs',
    'document-integrity.mjs',
    'document-report.mjs',
    '__tests__/document-rules.guard.test.mjs',
  ]) {
    copyFileSync(path.join(repo, domain, name), path.join(vault, domain, name))
  }
  symlinkSync(path.join(repo, 'node_modules'), path.join(vault, 'node_modules'), 'dir')
  writeFileSync(path.join(vault, '.gitignore'), 'node_modules\nlogs\n')
  const config = path.join(vault, 'fixture.config.mjs')
  writeFileSync(
    config,
    `export default { test: { include: ['harness/wiki-documents/__tests__/*.guard.test.mjs'], env: { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' }, testTimeout: 60000 } }`,
  )
  // 실제 훅의 pnpm run test를 fixture의 실제 가드로 한정해 전체 suite 재귀를 막는다.
  const pnpm = path.join(bin, 'pnpm')
  writeFileSync(
    pnpm,
    `#!/bin/sh\n[ "$#" = 2 ] && [ "$1" = run ] && [ "$2" = test ] || exit 2\nexec ${quote(process.execPath)} ${quote(path.join(repo, 'node_modules/vitest/vitest.mjs'))} run --root ${quote(vault)} --config ${quote(config)} --maxWorkers=1\n`,
  )
  chmodSync(pnpm, 0o755)
  const hooks = path.join(vault, 'fixture-hooks')
  mkdirSync(hooks)
  copyFileSync(path.join(repo, '.husky/pre-push'), path.join(hooks, 'pre-push'))
  chmodSync(path.join(hooks, 'pre-push'), 0o755)
  return hooks
}

function writeFixtureDoc(vault, name, id) {
  const file = writeDoc(vault, name, { id })
  // 이 fixture는 파일명 제목을 사용하는 실제 작성 규칙도 지킨다.
  writeFileSync(file, readFileSync(file, 'utf8').replace(/^title:.*\n/m, ''))
}

describe('실제 pre-push의 문서 집행', () => {
  it('중복 ID는 원격 변경을 막고 정상 문서는 push할 수 있다', () => {
    const vault = initVault()
    const remote = mkdtempSync(path.join(tmpdir(), 'wiki-push-remote-'))
    const bin = mkdtempSync(path.join(tmpdir(), 'wiki-push-bin-'))
    try {
      git(remote, ['init', '-q', '--bare'])
      const hooks = installFixtureHook(vault, bin)
      const push = () =>
        spawnSync('git', ['-c', `core.hooksPath=${hooks}`, 'push', '-q', remote, 'HEAD:main'], {
          cwd: vault,
          encoding: 'utf8',
          timeout: 180000,
          killSignal: 'SIGKILL',
          env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}` },
        })
      const firstId = '0192a000-0000-7000-8000-0000000000aa'
      writeFixtureDoc(vault, 'concept/문서', firstId)
      const firstHead = commit(vault, 'chore: 문서 생성')
      const first = push()
      expect(first.error).toBeUndefined()
      expect(first.status, first.stderr).toBe(0)
      expect(git(remote, ['rev-parse', 'main'])).toBe(firstHead)

      writeFixtureDoc(vault, 'concept/복사', firstId)
      commit(vault, 'chore: 문서 복사')
      const blocked = push()
      expect(blocked.error).toBeUndefined()
      expect(blocked.status).not.toBe(0)
      expect(`${blocked.stdout}${blocked.stderr}`).toContain('DUPLICATE_ID')
      expect(git(remote, ['rev-parse', 'main'])).toBe(firstHead)

      git(vault, ['reset', '-q', '--soft', 'HEAD~1'])
      writeFixtureDoc(vault, 'concept/복사', '0192b000-0000-7000-8000-0000000000bb')
      const repairedHead = commit(vault, 'chore: 새 ID의 복사 문서')
      const repaired = push()
      expect(repaired.error).toBeUndefined()
      expect(repaired.status, repaired.stderr).toBe(0)
      expect(git(remote, ['rev-parse', 'main'])).toBe(repairedHead)
    } finally {
      cleanup(vault, remote, bin)
    }
  }, 180000)
})
