// P3 — git spawn 계수 shim (tdd §7.5 · §8.2 측정용). **`expect` 를 두지 않는다**(규범 D).
//
// 용도 분리(섞지 않는다):
//   · **FR7**(스킵 경로가 `rev-parse HEAD` **1회**만 부르는가) → `runSummaryGenerator({ runGit })`
//     에 테스트 로컬 계수 fake 를 주입한다. 결정성이 높고 프로세스 경계를 넘지 않는다.
//   · **§8.2**(`feeds --env dev` 33 → 18 실측) → 이 shim. CLI 를 **자식 프로세스로** 띄워야 하므로
//     함수 주입이 불가능하다. PATH 앞에 `git` 래퍼를 놓고 argv 를 로그에 append 한다.
//
// 성립 근거(실측): `makeGitRunner`(`git.mjs:361` execFileSync)와 `catFileBatch`(`git.mjs:378`
//   spawnSync) 가 **둘 다 `'git'` 을 PATH 로 해석**한다(절대경로 하드코딩 없음). 실 git 의 절대경로는
//   래퍼 안에서 `command -v` 로 **1회** 해석해 재귀를 피한다.
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

/**
 * PATH 앞에 끼울 `git` 래퍼 디렉토리를 만든다.
 *
 * @returns {{ binDir: string, env: (base?: object) => object, logPath: string,
 *             read: () => string[][], root: string }}
 *   `env(base)` 는 `PATH` 가 앞에 붙은 자식 env 를 만든다. `read()` 는 기록된 argv 배열들을 돌려준다.
 */
export function makeGitCountShim() {
  const root = mkdtempSync(path.join(tmpdir(), 'wiki-gitshim-'))
  const binDir = path.join(root, 'bin')
  const logPath = path.join(root, 'git.log')
  mkdirSync(binDir, { recursive: true })
  writeFileSync(logPath, '')

  // 실 git 은 **shim 을 PATH 에서 제외한 상태**로 1회 해석한다(자기 자신을 다시 부르지 않도록).
  // argv 는 한 줄 = 한 호출로 기록한다(탭 구분 — 인자에 공백이 있어도 필드가 안 깨진다).
  const wrapper = [
    '#!/bin/sh',
    `LOG=${JSON.stringify(logPath)}`,
    `SHIM=${JSON.stringify(binDir)}`,
    'CLEAN_PATH=$(printf %s "$PATH" | tr ":" "\\n" | grep -v -x -F "$SHIM" | paste -sd: -)',
    'REAL=$(PATH="$CLEAN_PATH" command -v git)',
    'LINE=""',
    'for arg in "$@"; do',
    '  if [ -z "$LINE" ]; then LINE="$arg"; else LINE="$LINE\t$arg"; fi',
    'done',
    'printf "%s\\n" "$LINE" >> "$LOG"',
    'exec "$REAL" "$@"',
    '',
  ].join('\n')

  const gitPath = path.join(binDir, 'git')
  writeFileSync(gitPath, wrapper)
  chmodSync(gitPath, 0o755)

  return {
    binDir,
    env: (base = process.env) => ({ ...base, PATH: `${binDir}${path.delimiter}${base.PATH}` }),
    logPath,
    read: () =>
      readFileSync(logPath, 'utf8')
        .split('\n')
        .filter((line) => line !== '')
        .map((line) => line.split('\t')),
    root,
  }
}
