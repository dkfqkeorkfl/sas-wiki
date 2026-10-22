import { spawnSync } from 'node:child_process'
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
  it('pre-push는 일반 테스트 뒤 기존 validate를 실행한다', () => {
    const commands = commandsOf('pre-push')
    expect(commands[0]).toBe('pnpm run test || exit 1')
    expect(commands[1]).toBe('node scripts/validate.mjs --env dev || {')
    expect(commands.at(-2)).toBe('exit 1')
    expect(commands.join('\n')).toContain('git reset --soft "$(git merge-base HEAD @{upstream})"')
    expect(commands.join('\n')).toContain('git add')
  })
  it('uuid는 훅 전용 개발 의존성이다', () => {
    expect(pkg.devDependencies).toHaveProperty('uuid')
    expect(pkg.dependencies).not.toHaveProperty('uuid')
  })
})

describe('실제 pre-push의 순서와 실패 차단', () => {
  it.each([
    { testExit: 1, validateExit: 0, trace: ['pnpm:run test'], success: false },
    {
      testExit: 0,
      validateExit: 1,
      trace: ['pnpm:run test', 'node:scripts/validate.mjs --env dev'],
      success: false,
    },
    {
      testExit: 0,
      validateExit: 0,
      trace: ['pnpm:run test', 'node:scripts/validate.mjs --env dev'],
      success: true,
    },
  ])(
    'test 종료 $testExit / validate 종료 $validateExit',
    ({ testExit, validateExit, trace, success }) => {
      const dir = mkdtempSync(path.join(tmpdir(), 'wiki-hook-order-'))
      const traceFile = path.join(dir, 'trace')
      try {
        for (const [name, variable] of [
          ['pnpm', 'WIKI_TEST_EXIT'],
          ['node', 'WIKI_VALIDATE_EXIT'],
        ]) {
          const file = path.join(dir, name)
          writeFileSync(
            file,
            `#!/bin/sh\nprintf '%s:%s\\n' '${name}' "$*" >> "$WIKI_HOOK_TRACE"\nexit "$${variable}"\n`,
          )
          chmodSync(file, 0o755)
        }
        const result = spawnSync('sh', ['-e', path.join(repoRoot, '.husky/pre-push')], {
          cwd: dir,
          encoding: 'utf8',
          timeout: 10000,
          env: {
            ...process.env,
            PATH: `${dir}${path.delimiter}${process.env.PATH}`,
            WIKI_HOOK_TRACE: traceFile,
            WIKI_TEST_EXIT: String(testExit),
            WIKI_VALIDATE_EXIT: String(validateExit),
          },
        })
        expect(result.error).toBeUndefined()
        expect(result.status === 0, result.stderr).toBe(success)
        expect(readFileSync(traceFile, 'utf8').trim().split('\n')).toEqual(trace)
        if (testExit === 0 && validateExit !== 0)
          expect(result.stderr).toContain('validate 가 실패')
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    },
  )
})
