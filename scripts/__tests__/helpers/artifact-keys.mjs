// v3 P1 · Task 7·10 — 산출물 키 추출 + `package.json` 스크립트 실행 드라이버. **`expect` 금지**(규범 D).
//
// DAMP 경계: 이 파일은 **사실만** 돌려준다 — 키 집합이 옳은지, exit code 가 옳은지는 판정하지 않는다.
//   "7키여야 한다"·"체인이 exit≠0 이어야 한다" 는 전부 스펙 본문(`dead-values.guard.test.mjs` KY ·
//   `build.v3p1-plumbing.test.mjs` BD)이 리터럴로 단언한다.
//   (vitest 기본 include 는 `*.test.mjs` 만 잡으므로 helpers/*.mjs 는 테스트로 수집되지 않는다 — 의도.)
//
// ★ `runPackageScript` 는 **체인을 재구현하지 않는다.** `package.json` 의 스크립트 문자열을 읽어
//   그대로 셸에 넘기고, vault 만 tmp 로 재조준한다 — 재구현하면 "우리가 만든 체인으로는 되더라" 가
//   되어 BD2(순서·`&&`)·BD3(실패 전파)이 증명하는 것이 사라진다(tdd §3.11 GOTCHA).
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPTS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const REPO_ROOT = path.resolve(SCRIPTS_DIR, '..')

/**
 * 산출물 파일의 top-level 키를 **정렬해** 돌려준다.
 *
 * 파싱 실패·부재·비객체 JSON 은 전부 `null` 이다 — **throw 하지 않는다.** 스펙이 "키 집합이 7키다"
 * 를 물 때 부재/절단이 예외로 터지면 실패 메시지가 "무엇이 없는가" 가 아니라 스택 트레이스가 된다.
 *
 * @param {string} filePath 절대 경로
 * @returns {string[] | null} 정렬된 키 배열. 읽기·파싱 실패 또는 비객체면 `null`
 */
export function readArtifactKeys(filePath) {
  let parsed
  try {
    parsed = JSON.parse(readFileSync(filePath, 'utf8'))
  } catch {
    return null
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  return Object.keys(parsed).toSorted()
}

/**
 * `package.json` 의 `scripts[name]` **문자열을 읽어** vault 만 tmp 로 재조준해 실행한다.
 *
 * 재조준 규칙(문서화된 유일한 변형): `&&` 로 나눈 각 스텝 중 **`scripts/*.mjs` 를 부르는 것**에만
 * `--vault <tmp>` 를 덧붙인다. 그 외 스텝(예: 인라인 `node -e`)은 **문자열 그대로** 넘어간다 —
 * 즉 체인의 순서·연결자·게이트는 전혀 손대지 않는다.
 *   ☞ GREEN 계약: 체인의 모든 스텝은 `--vault` 를 받아들여야 한다. 받지 못하는 스텝이 있으면 그
 *     스텝은 실 리포를 보게 되고, 그 사실 자체가 BD3 의 tmp 격리(규범 F)를 깬다.
 *
 * 판정하지 않는다 — exit code 를 해석하지 않고 그대로 돌려준다.
 *
 * @param {string} name `package.json` scripts 의 키(`'build'` · `'build-dev'`)
 * @param {{ cwd?: string, env?: object, timeoutMs?: number, vault: string }} options
 * @returns {{ command: string, exitCode: number|null, stderr: string, stdout: string }}
 * @throws `scripts[name]` 이 없으면 던진다 — 빈 결과로 접으면 "0건 실행 → 성공" 이 된다(H7 형태).
 */
export function runPackageScript(name, { cwd, env = {}, timeoutMs = 600_000, vault }) {
  const scripts = JSON.parse(readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')).scripts
  const raw = scripts?.[name]
  if (typeof raw !== 'string') {
    throw new Error(`[RED] package.json 의 scripts.${name} 이 아직 없다 (v3 P1 Task 7 미구현)`)
  }

  const command = retargetVault(raw, vault)
  const child = spawnSync(command, {
    cwd: cwd ?? REPO_ROOT,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'safe.directory',
      GIT_CONFIG_VALUE_0: '*',
      ...env,
    },
    maxBuffer: 64 * 1024 * 1024,
    shell: true,
    timeout: timeoutMs,
  })
  return {
    command,
    exitCode: child.status,
    stderr: child.stderr ?? '',
    stdout: child.stdout ?? '',
  }
}

/**
 * `&&` 로 분할하되 `'`·`"` **안의 `&&` 는 자르지 않는다**(원문 보존 계약 — 따옴표 표현식이 스텝
 * 경계로 잘못 잘리면 그 표현식이 깨진다).
 *
 * 인용 규칙은 POSIX 셸을 따른다(이 명령들은 `shell: true` 로 실행되므로 셸이 실제로 그렇게 읽는다):
 * 홑따옴표 안에서는 **역슬래시도 그냥 글자**라 `'…'` 는 다음 홑따옴표에서 반드시 끝나고, 겹따옴표
 * 밖·안에서는 `\` 가 다음 한 글자를 이스케이프한다. 세 규칙이 다 필요하다 — 같은 파일의 `quote()`
 * 는 경로 안의 홑따옴표를 `'\''`(닫고 · **따옴표 밖에서** 이스케이프된 따옴표 · 다시 열기)로 내보내는데,
 * 밖의 이스케이프를 빼먹으면 그 자리에서 따옴표 상태가 반대로 뒤집혀 뒤따르는 `&&` 를 자르지 못한다.
 */
function splitStepsOutsideQuotes(command) {
  const steps = []
  let current = ''
  let quote = null
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index]
    if (quote) {
      current += char
      if (char === '\\' && quote === '"') {
        current += command[index + 1] ?? ''
        index += 1
        continue
      }
      if (char === quote) quote = null
      continue
    }
    if (char === '\\') {
      current += char + (command[index + 1] ?? '')
      index += 1
      continue
    }
    if (char === "'" || char === '"') {
      quote = char
      current += char
      continue
    }
    if (char === '&' && command[index + 1] === '&') {
      steps.push(current)
      current = ''
      index += 1
      continue
    }
    current += char
  }
  steps.push(current)
  return steps
}

/** `&&` 스텝 중 `scripts/*.mjs` 를 부르는 것에만 `--vault <tmp>` 를 덧붙인다(그 외는 원문 그대로). */
function retargetVault(rawCommand, vault) {
  return splitStepsOutsideQuotes(rawCommand)
    .map((step) =>
      /scripts\/[\w.-]+\.mjs/u.test(step) ? `${step.trim()} --vault ${quote(vault)}` : step.trim(),
    ) // prettier-ignore
    .join(' && ')
}

/** POSIX 셸 단일 인용 — tmp 경로에 공백이 섞여도 스텝 경계가 깨지지 않게 한다. */
function quote(value) {
  return `'${String(value).replaceAll("'", `'\\''`)}'`
}

/** `package.json` 의 scripts 객체를 그대로 돌려준다(판정하지 않는다). */
export function readPackageScripts() {
  return JSON.parse(readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')).scripts ?? {}
}
