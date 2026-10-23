import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { repoRoot } from '../../test-utils/vitest-probe.mjs'

const pkg = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'))
const commandsOf = (hook) =>
  readFileSync(path.join(repoRoot, '.husky', hook), 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))

describe('git 훅 연결', () => {
  it('prepare가 husky를 설치한다', () => {
    expect(pkg.scripts.prepare).toBe('husky')
    expect(pkg.devDependencies).toHaveProperty('husky')
  })
  it('pre-commit은 기존 ID 검사를 실행한다', () => {
    expect(commandsOf('pre-commit')).toEqual(['node scripts/check-doc-ids.mjs'])
  })
  it('pre-push는 문서 가드가 포함된 test를 실행한다', () => {
    const commands = commandsOf('pre-push')
    expect(commands).toContain('pnpm run test || {')
    expect(commands.join('\n')).toContain('exit 1')
    expect(commands.filter((line) => /^(pnpm|node) /.test(line))).toEqual(['pnpm run test || {'])
  })
  it('uuid는 훅 전용 개발 의존성이다', () => {
    expect(pkg.devDependencies).toHaveProperty('uuid')
    expect(pkg.dependencies).not.toHaveProperty('uuid')
  })
})

describe('실제 pre-push의 순서와 실패 차단', () => {
  it.each([0, 1])('Git 저장소 환경을 격리하고 test 종료 %s를 push에 전달한다', (testExit) => {
    const dir = mkdtempSync(path.join(tmpdir(), 'wiki-hook-order-'))
    const traceFile = path.join(dir, 'trace')
    try {
      const source = path.join(dir, 'source')
      const foreign = path.join(dir, 'foreign.git')
      execFileSync('git', ['init', '--quiet', source])
      const gitDir = path.join(source, '.git')
      const originalConfig = readFileSync(path.join(gitDir, 'config'), 'utf8')
      const file = path.join(dir, 'pnpm')
      writeFileSync(
        file,
        '#!/bin/sh\nset -eu\nprintf "%s\\n" "$*" >> "$WIKI_HOOK_TRACE"\ngit init --bare --quiet "$WIKI_HOOK_FOREIGN"\ngit -C "$WIKI_HOOK_FOREIGN" rev-parse --absolute-git-dir >> "$WIKI_HOOK_TRACE"\nexit "$WIKI_TEST_EXIT"\n',
      )
      chmodSync(file, 0o755)
      const result = spawnSync('sh', ['-e', path.join(repoRoot, '.husky/pre-push')], {
        cwd: dir,
        encoding: 'utf8',
        timeout: 10000,
        env: {
          ...process.env,
          PATH: dir + path.delimiter + process.env.PATH,
          GIT_COMMON_DIR: gitDir,
          GIT_DIR: gitDir,
          GIT_INDEX_FILE: path.join(gitDir, 'index'),
          GIT_WORK_TREE: source,
          WIKI_HOOK_FOREIGN: foreign,
          WIKI_HOOK_TRACE: traceFile,
          WIKI_TEST_EXIT: String(testExit),
        },
      })
      expect(result.error).toBeUndefined()
      expect(result.status === 0, result.stderr).toBe(testExit === 0)
      expect(readFileSync(traceFile, 'utf8').trim().split('\n')).toEqual(['run test', foreign])
      expect(readFileSync(path.join(gitDir, 'config'), 'utf8')).toBe(originalConfig)
      if (testExit !== 0) expect(result.stderr).toContain('test가 실패')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
