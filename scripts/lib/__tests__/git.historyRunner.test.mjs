import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'

import { memoizeGitRunner } from '../git.mjs'

describe('한 실행의 Git 조회 공유', () => {
  it('같은 질의는 성공 결과를 공유하고 인자를 그대로 전달한다', () => {
    const real = vi.fn(() => 'result')
    const run = memoizeGitRunner(real)
    const args = ['show', 'HEAD:wiki/문서.md']
    const options = { input: '문서 원문', encoding: 'utf8' }
    expect(run(args, options)).toBe('result')
    expect(run([...args], { ...options })).toBe('result')
    expect(real).toHaveBeenCalledExactlyOnceWith(args, options)
  })

  it('stdin·encoding·명령이 다르면 별도로 조회한다', () => {
    const real = vi.fn((_args, options) => `${options.input}:${options.encoding}`)
    const run = memoizeGitRunner(real)
    expect(run(['blame'], { input: '첫 원문', encoding: 'utf8' })).toBe('첫 원문:utf8')
    expect(run(['blame'], { input: '다른 원문', encoding: 'utf8' })).toBe('다른 원문:utf8')
    expect(run(['blame'], { input: '첫 원문', encoding: 'buffer' })).toBe('첫 원문:buffer')
    run(['show'], { input: '첫 원문', encoding: 'utf8' })
    expect(real).toHaveBeenCalledTimes(4)
  })

  it('실패는 캐시하지 않고 다음 시도에서 성공할 수 있다', () => {
    const failure = new Error('fixture Git I/O')
    const real = vi
      .fn()
      .mockImplementationOnce(() => {
        throw failure
      })
      .mockReturnValue('recovered')
    const run = memoizeGitRunner(real)
    expect(() => run(['show'])).toThrow(failure)
    expect(run(['show'])).toBe('recovered')
    expect(run(['show'])).toBe('recovered')
    expect(real).toHaveBeenCalledTimes(2)
  })

  it('서로 다른 실행 사이에는 결과를 공유하지 않는다', () => {
    const real = vi.fn().mockReturnValueOnce('old').mockReturnValueOnce('new')
    expect(memoizeGitRunner(real)(['rev-parse', 'HEAD'])).toBe('old')
    expect(memoizeGitRunner(real)(['rev-parse', 'HEAD'])).toBe('new')
  })
})

describe('Git 자식의 유한 종료', () => {
  it('SIGTERM을 무시하는 Git도 지정한 종료 신호로 중단하고 원인을 반환한다', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'wiki-git-timeout-'))
    const pidFile = path.join(dir, 'pid')
    let result
    try {
      const shim = path.join(dir, 'git')
      writeFileSync(
        shim,
        `#!${process.execPath}\nimport { writeFileSync } from 'node:fs'\nwriteFileSync(${JSON.stringify(pidFile)}, String(process.pid))\nprocess.on('SIGTERM', () => {})\nsetInterval(() => {}, 1000)\n`,
      )
      chmodSync(shim, 0o755)
      const source = `import { makeGitRunner } from ${JSON.stringify(new URL('../git.mjs', import.meta.url).href)}
        try { makeGitRunner(${JSON.stringify(dir)}, { timeoutMs: 250, killSignal: 'SIGKILL' })(['status']) }
        catch (error) { console.log(JSON.stringify({ code: error.code, signal: error.signal, status: error.status })) }`
      // 바깥 제한은 회귀가 다시 무한 대기를 만들었을 때 테스트 러너까지 정지하지 않게 한다.
      result = spawnSync(process.execPath, ['--input-type=module', '-e', source], {
        encoding: 'utf8',
        env: { ...process.env, PATH: `${dir}${path.delimiter}${process.env.PATH}` },
        timeout: 5000,
        killSignal: 'SIGKILL',
      })
      expect(result.error).toBeUndefined()
      expect(result.status, result.stderr).toBe(0)
      expect(JSON.parse(result.stdout)).toEqual({
        code: 'ETIMEDOUT',
        signal: 'SIGKILL',
        status: null,
      })
    } finally {
      if (result?.error?.code === 'ETIMEDOUT' && existsSync(pidFile)) {
        try {
          process.kill(Number(readFileSync(pidFile, 'utf8')), 'SIGKILL')
        } catch (error) {
          if (error.code !== 'ESRCH') throw error
        }
      }
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
