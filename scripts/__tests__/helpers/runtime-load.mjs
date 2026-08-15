// P5 — CLI **자식 프로세스 계측** 드라이버 (규범 G · D-J). **`expect` 금지**(규범 D).
//
// 왜 정적 그래프만으로는 부족한가(plan R4-6 · D-J): `runSummaryGenerator` 의 재생성 분기가
//   `await import()` 라서 **정적 도달성 게이트가 green 인 채로 렌더 툴체인이 실제로 로드되는 상태**가
//   성립한다. 이 리포에서 "새 가드 자체가 공허" 는 3회 연속 결함원이었다. 그래서 "열지 않았다" 를
//   정적 그래프가 아니라 **실행에서** 관측한다.
//
// 계측 수단(tdd §2.4 가 실측으로 확정 · Node v24.16.0):
//   · 주(主) `NODE_V8_COVERAGE=<케이스별 새 디렉토리>` → 산출 JSON 의 `result[].url` = **실행된** 스크립트
//     표준 Node 기능이라 훅 모듈이 필요 없고, "해석됐다" 보다 "실행됐다" 가 강한 주장이다.
//   · 보조 `module.register` resolve 훅(해석 지정자) — §8 측정 기록용이며 **게이트로 쓰지 않는다**.
//   · 기각 벽시계 임계값(규범 E — flaky · 9p·부하 의존) · `strace`/`lsof`(컨테이너 권한·이식성).
//
// ★ 부모가 `vitest --coverage`(v8 provider)로 `NODE_V8_COVERAGE` 를 이미 갖고 있을 수 있다 → 자식 env 에
//   **명시 override** 한다. ★ 케이스마다 **새 mkdtemp** 다 — 재사용하면 앞 케이스의 url 이 섞여 TR3 이
//   조용히 공허해진다.
//
// **판정하지 않는다 — 사실만 센다.** "없다/있다" 는 전부 `serving.cost-profile.test.mjs` 본문이 단언한다.
//   (vitest 기본 include 는 `*.test.mjs` 만 잡으므로 helpers/*.mjs 는 테스트로 수집되지 않는다 — 의도.)
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { makeGitCountShim } from './git-count-shim.mjs'

const SCRIPTS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

/**
 * sas-wiki CLI 를 자식으로 띄우면서 **git argv** 와 **실행된 모듈 url** 을 동시에 수집한다.
 *
 * @param {string} scriptName `scripts/` 아래 CLI 파일명(예: `'feeds.mjs'`)
 * @param {string[]} args CLI 인자(`--vault` 는 `vault` 옵션이 붙인다)
 * @param {{ cwd?: string, env?: object, timeoutMs?: number, vault?: string }} [options]
 * @returns {{ exitCode: number|null, gitCalls: string[][], loadedUrls: string[],
 *             stderr: string, stdout: string }}
 *   `gitCalls` = 자식이 낸 git 호출의 argv 배열들 · `loadedUrls` = 실행된 모듈 url(중복 제거·정렬)
 */
// 이 헬퍼가 항상 강제하는 환경변수 — 호출부가 `env` 옵션으로 덮어쓰면 계측(NODE_V8_COVERAGE)이나
// 9p safe.directory 방어가 조용히 무효화된다. 공유 헬퍼라 "조용한 무시"가 다음 호출부를 속인다 —
// 충돌은 무시하지 않고 즉시 던진다(스프레드 순서만으로는 "덮어썼는데 왜 안 먹히지" 를 남긴다).
const FORCED_ENV_KEYS = ['GIT_CONFIG_COUNT', 'GIT_CONFIG_KEY_0', 'GIT_CONFIG_VALUE_0', 'NODE_V8_COVERAGE'] // prettier-ignore

export function runCliWithLoadLog(scriptName, args = [], options = {}) {
  const { cwd, env: extraEnv = {}, timeoutMs = 120_000, vault } = options
  const collidingKeys = FORCED_ENV_KEYS.filter((key) => key in extraEnv)
  if (collidingKeys.length > 0) {
    throw new Error(
      `runCliWithLoadLog: extraEnv 가 강제 변수를 덮으려 한다(${collidingKeys.join(', ')}) — ` +
        '이 헬퍼는 계측·safe.directory 방어를 항상 강제한다. 호출부에서 이 키들을 넘기지 마라.',
    )
  }
  const shim = makeGitCountShim()
  const coverageDir = mkdtempSync(path.join(tmpdir(), 'wiki-v8cov-'))
  const scriptPath = path.join(SCRIPTS_DIR, scriptName)
  const argv = vault === undefined ? [...args] : ['--vault', vault, ...args]

  try {
    const child = spawnSync(process.execPath, [scriptPath, ...argv], {
      cwd: cwd ?? vault ?? SCRIPTS_DIR,
      encoding: 'utf8',
      env: {
        ...shim.env(process.env),
        // ★ 강제 변수는 항상 `extraEnv` **뒤**(=이긴다)에 둔다. 위 사전 검사가 이미 충돌을 막지만,
        //   스프레드 순서 자체도 방어선으로 유지한다(이중 방어 — 검사 로직만 믿지 않는다).
        ...extraEnv,
        // 9p 소유자 불일치 방어 — 실 리포를 spawn 하는 케이스의 관례(cli-contract.test.mjs:56-62).
        GIT_CONFIG_COUNT: '1',
        GIT_CONFIG_KEY_0: 'safe.directory',
        GIT_CONFIG_VALUE_0: '*',
        // ★ 부모 값을 그대로 물려받으면 앞 실행의 url 이 섞인다 — 반드시 덮어쓴다.
        NODE_V8_COVERAGE: coverageDir,
      },
      maxBuffer: 64 * 1024 * 1024,
      timeout: timeoutMs,
    })

    return {
      exitCode: child.status,
      gitCalls: shim.read(),
      loadedUrls: readCoverageUrls(coverageDir),
      stderr: child.stderr ?? '',
      stdout: child.stdout ?? '',
    }
  } finally {
    rmSync(coverageDir, { force: true, recursive: true })
    rmSync(shim.root, { force: true, recursive: true })
  }
}

/** V8 커버리지 산출물에서 **실행된** 스크립트 url 집합을 캔다. 읽기 실패는 빈 목록이다(사실 보고). */
function readCoverageUrls(coverageDir) {
  const urls = new Set()
  let entries
  try {
    entries = readdirSync(coverageDir)
  } catch {
    return []
  }
  for (const name of entries) {
    if (!name.endsWith('.json')) continue
    let parsed
    try {
      parsed = JSON.parse(readFileSync(path.join(coverageDir, name), 'utf8'))
    } catch {
      continue
    }
    for (const record of parsed.result ?? []) {
      if (typeof record.url === 'string') urls.add(record.url)
    }
  }
  return [...urls].sort()
}
