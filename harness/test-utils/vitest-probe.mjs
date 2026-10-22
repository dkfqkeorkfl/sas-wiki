import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const repoRoot = fileURLToPath(new URL('../../', import.meta.url))
const require = createRequire(import.meta.url)
const vitest = path.join(path.dirname(require.resolve('vitest/package.json')), 'vitest.mjs')

/** 테스트 위반과 실행 오류·시간 초과를 구분한다. 모든 자식 실행은 유한하다. */
export function runVitest(args, cwd = repoRoot) {
  const result = spawnSync(process.execPath, [vitest, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
    maxBuffer: 4 * 1024 * 1024,
    timeout: 30_000,
  })
  if (result.error || result.signal || result.status === null) {
    throw new Error(`Vitest 실행 실패: ${result.error?.message ?? result.signal}\n${result.stderr}`)
  }
  return { ...result, output: `${result.stdout}\n${result.stderr}` }
}

/** package에 실제 연결한 Vitest 명령을 shell 없이 재현한다. */
export function commandArgs(name) {
  const pkg = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'))
  const [binary, action, ...args] = pkg.scripts[name].split(/\s+/u)
  if (binary !== 'vitest' || action !== 'run' || args.some((arg) => /[;&|$`]/u.test(arg))) {
    throw new Error(`${name}: 직접 Vitest run 명령이어야 합니다.`)
  }
  const config = args.indexOf('--config')
  if (config !== -1) args[config + 1] = path.resolve(repoRoot, args[config + 1])
  return args
}

/** 두 회귀 모듈이 공유하는 임시 프로젝트 수명·설치된 러너 연결. */
export function withProbe(callback) {
  const root = mkdtempSync(path.join(tmpdir(), 'wiki-harness-'))
  const write = (file, source) => {
    const target = path.join(root, file)
    mkdirSync(path.dirname(target), { recursive: true })
    writeFileSync(target, source)
  }
  try {
    symlinkSync(path.join(repoRoot, 'node_modules'), path.join(root, 'node_modules'), 'dir')
    write('package.json', '{"type":"module"}\n')
    write(
      'vitest.config.mjs',
      `export default { test: {
        include: ['harness/**/*.test.mjs'], passWithNoTests: false,
        env: { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' }
      } }\n`,
    )
    return callback({
      root,
      write,
      copy(file, target = file) {
        write(target, readFileSync(path.join(repoRoot, file), 'utf8'))
      },
      run(args = ['run']) {
        return runVitest([...args, '--maxWorkers=1', '--reporter=verbose', '--silent=false'], root)
      },
    })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}
