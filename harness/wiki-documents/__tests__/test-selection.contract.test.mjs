import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { commandArgs, repoRoot, runVitest, withProbe } from '../../test-utils/vitest-probe.mjs'

function testFiles(dir) {
  return readdirSync(path.join(repoRoot, dir), { withFileTypes: true }).flatMap((entry) => {
    const file = `${dir}/${entry.name}`
    return entry.isDirectory() ? testFiles(file) : file.endsWith('.test.mjs') ? [file] : []
  })
}

function collected(name) {
  const result = runVitest(['list', ...commandArgs(name), '--filesOnly', '--json'])
  expect(result.status, result.output).toBe(0)
  return JSON.parse(result.stdout)
    .map(({ file }) => path.relative(repoRoot, file).split(path.sep).join('/'))
    .sort()
}

describe('자동 집행과 수동 회귀의 수집 계약', () => {
  it('훅·CI·자동 명령의 간접 실행에도 수동 회귀를 연결하지 않는다', () => {
    const { scripts } = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'))
    const automaticSources = [
      '.husky/pre-push',
      '.husky/pre-commit',
      '.github/workflows/ci.yml',
    ].map((file) =>
      readFileSync(path.join(repoRoot, file), 'utf8')
        .split('\n')
        .filter((line) => !line.trimStart().startsWith('#'))
        .join('\n'),
    )
    const pending = ['test', 'test:coverage', 'build', 'build-dev', 'prepare']
    const visited = new Set()
    const references = (source) =>
      [...source.matchAll(/\b(?:pnpm(?:\s+run)?|npm\s+run|yarn(?:\s+run)?)\s+([\w:-]+)/gu)].map(
        (match) => match[1],
      )
    for (const source of automaticSources) {
      expect(source).not.toMatch(/\btest:harness\b/u)
      pending.push(...references(source))
    }
    while (pending.length) {
      const name = pending.pop()
      if (visited.has(name)) continue
      visited.add(name)
      for (const key of [name, `pre${name}`, `post${name}`]) {
        const command = scripts[key] ?? ''
        expect(command, `${key}가 수동 회귀를 자동 호출합니다.`).not.toMatch(/\btest:harness\b/u)
        pending.push(...references(command))
      }
    }
  })

  it('실제 명령은 역할별 전체 테스트를 수집하고 서로 겹치지 않는다', () => {
    const automatic = collected('test')
    const coverage = collected('test:coverage')
    const manual = collected('test:harness')
    const documentTests = testFiles('harness/wiki-documents')
    const isGuard = (file) => /\.guard(?:\.|$)/u.test(path.basename(file))
    const expectedAutomatic = [...testFiles('scripts'), ...documentTests.filter(isGuard)].sort()
    const expectedManual = documentTests.filter((file) => !isGuard(file)).sort()

    expect(expectedAutomatic.length).toBeGreaterThan(0)
    expect(expectedManual.length).toBeGreaterThan(0)
    expect(automatic).toEqual(expectedAutomatic)
    expect(coverage).toEqual(automatic)
    expect(manual).toEqual(expectedManual)
    expect(manual.filter((file) => automatic.includes(file))).toEqual([])
  }, 60000)

  it('같은 분야에서 가드 종류만 자동 수집하고 스크립트 계약도 자동에 유지한다', () => {
    withProbe(({ root, write }) => {
      const automatic = [
        'scripts/__tests__/feature.contract.test.mjs',
        'harness/wiki-documents/__tests__/example.guard.test.mjs',
        'harness/wiki-documents/__tests__/example.guard.source-scan.test.mjs',
      ].sort()
      const manual = [
        'harness/wiki-documents/__tests__/example.test.mjs',
        'harness/wiki-documents/__tests__/example.contract.test.mjs',
      ].sort()
      for (const file of [...automatic, ...manual]) {
        write(file, "import { it } from 'vitest'; it('fixture', () => {})\n")
      }
      const collect = (name) => {
        const args = commandArgs(name)
        if (!args.includes('--config'))
          args.push('--config', path.join(repoRoot, 'vitest.config.js'))
        const result = runVitest(['list', ...args, '--root', root, '--filesOnly', '--json'], root)
        expect(result.status, result.output).toBe(0)
        return JSON.parse(result.stdout)
          .map(({ file }) => path.relative(root, file).split(path.sep).join('/'))
          .sort()
      }
      expect(collect('test')).toEqual(automatic)
      expect(collect('test:coverage')).toEqual(automatic)
      expect(collect('test:harness')).toEqual(manual)
    })
  }, 60000)

  it.each(['test', 'test:coverage', 'test:harness'])('%s는 빈 수집을 실패로 전달한다', (name) => {
    withProbe(({ root }) => {
      const args = commandArgs(name)
      if (!args.includes('--config')) args.push('--config', path.join(repoRoot, 'vitest.config.js'))
      const result = runVitest(['run', ...args, '--root', root], root)
      expect(result.status, result.output).not.toBe(0)
      expect(result.output).toContain('No test files found')
    })
  })

  it('검사기를 무력화하면 기존 위반 회귀가 실패한다', () => {
    withProbe(({ copy, write, run }) => {
      copy('harness/wiki-documents/__tests__/document-rules.test.mjs')
      write(
        'harness/wiki-documents/document-rules.mjs',
        'export function inspectDocument() { return [] }\n',
      )
      const result = run()
      expect(result.status, result.output).not.toBe(0)
      expect(result.output).toContain('AssertionError')
      expect(result.output).not.toContain('Cannot find')
    })
  })
})
