#!/usr/bin/env node
// feeds 엔드포인트 — **커서 기반 라이브 워크**(v3 P2 · D6~D17·D20·D22·D23·D45·D48).
//
// ★ "모드" 개념이 없다(설계 §3-3). 캐시 빌드(`--out`)든 라이브 조회(stdout)든 하는 일은 하나 —
//   git 로그를 커서 위치에서 읽어 feed JSON 을 **계산**한다. 용도는 호출자가 인자로 구분한다:
//     캐시 빌드: `feeds.mjs --env prod --count 200 --ignore ignore-feeds.json --out cache/feeds.prod.json`
//     라이브   : `feeds.mjs --env prod --after <12hex> --count 40 --ignore <경로>`
//   그래서 stdout 응답과 `--out` 파일이 **같은 형태**(6키)다.
//
// ★ v3 P2 이전에는 조회가 아티팩트를 **읽었다**. 그 경로는 남기지 않았다 — 호환 분기를 두면 옛
//   `{feedId,ts}` 커서와 새 12-hex 커서가 공존해 "어느 쪽이 계약인가" 가 사라진다(D8).
//
// ★ 억제는 **명시 인자로만** 걸린다(D20). 예전에는 이 파일이 vault 기준으로 `ignore-feeds.json` 을
//   암묵 로드했는데, 그러면 배선이 두 곳(빌드 체인과 이 파일)이 되어 한쪽만 고쳐도 조용히 어긋난다.
//   필터의 단일 구현은 여전히 `lib/ignore.mjs` 이고, 이 파일은 **호출부**일 뿐이다.
//
// ★ 파싱·렌더·파생 툴체인을 정적으로도 런타임으로도 물지 않는다(FC1·PU2) — 커서 워크는
//   `parseVault` 를 경유하지 않는다. `--out` 만 생성기를 **동적으로** 연다.
import path from 'node:path'
import { parseArgs } from 'node:util'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { envEnumError } from './lib/cli-env.mjs'
import { LIVE_WALK_TIMEOUT_MS, isCursorFormat, walkCursorPage } from './lib/feed-cursor.mjs'
import { checkGitAvailable, makeGitRunner } from './lib/git.mjs'
import { makeFeedItemResolver } from './lib/git-walk.mjs'
import { loadIgnoreFeedsAt } from './lib/ignore.mjs'
import { buildFeeds } from './lib/payloads.mjs'

// --vault 미지정 시 기본값 = 스크립트 자기 리포 루트(scripts/ 의 상위). cwd 무관(import.meta.url 파생).
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** 0건 페이지의 `generatedAt` 기준선 — 벽시계를 읽지 않는다(결정적 재빌드). */
const EPOCH = '1970-01-01T00:00:00.000Z'

/**
 * feeds 엔드포인트 — 커서 위치에서 한 페이지를 **git 워크로 계산**한다.
 *
 * @param {string} vault git vault repository root
 * @param {'dev'|'prod'} env
 * @param {{ after?: string, count?: number, ignore?: string }} [window]
 *   `after` 는 12-hex 커서(미지정 = HEAD 부터) · `count` 는 페이지 크기(**미지정 = 상한 없음**;
 *   CLI 층은 D15 로 필수다) · `ignore` 는 억제 목록 파일 경로(미지정 = 억제 없음 · D20).
 */
export async function feeds(vault, env = 'prod', window = {}) {
  const vaultDir = path.resolve(vault)
  // 러너가 둘인 것이 계약이다(`lib/feed-cursor.mjs` 의 `LIVE_WALK_TIMEOUT_MS` 「적용 범위」 참조):
  //   · `walkGit`    — 워크 자신의 호출(가용성 확인·커서 검증·배치 워크). D23 spawn 타임아웃이 붙는다.
  //   · `resolveGit` — 문서 해석 계층. 비용 분포가 자릿수로 달라 개별 호출 상한을 걸지 않는다.
  const walkGit = makeGitRunner(vaultDir, { timeoutMs: LIVE_WALK_TIMEOUT_MS })
  const resolveGit = makeGitRunner(vaultDir)
  // git 자체의 가용성은 워크보다 **먼저** 가른다 — 여기서 끊지 않으면 러너 실패가 커서 해석 실패
  //   (= 빈 페이지)로 접혀 「피드 끝」으로 오독된다. spawn 타임아웃(D23)도 이 지점에서 드러난다.
  checkGitAvailable(walkGit)

  const { items, nextCursor } = walkCursorPage(vaultDir, {
    after: window.after,
    count: window.count,
    ignoreEntries: loadIgnoreEntries(vaultDir, window.ignore),
    resolveItems: makeFeedItemResolver(vaultDir, { env, runGit: resolveGit }),
    runGit: walkGit,
  })

  return {
    ...buildFeeds({
      env,
      // 서빙 시점 집계 — **억제 후**(= 응답에 실리는) item ts 의 max 다. 억제된 항목의 ts 는 응답
      //   어디에도 남지 않는다(CWE-204 클로즈 · FC7).
      generatedAt: latestItemTimestamp(items),
      items,
      sourceCommit: walkGit(['rev-parse', 'HEAD']).trim(),
    }),
    nextCursor,
  }
}

/**
 * `--ignore <경로>` → 억제 엔트리. 미지정이면 **빈 배열**(억제 없음 · D20 — 암묵 로드 금지).
 *
 * 상대 경로는 `--vault` 기준으로 해석하고 **그 경로를 그대로** 로더에 넘긴다 — basename 을 버리고
 * 디렉토리만 넘기면 `--ignore <dir>/my-ignore.json` 이 조용히 `<dir>/ignore-feeds.json` 을 읽는
 * **관측되지 않는 오동작**이 된다(사용자가 지정한 파일이 아닌 것을 읽고도 exit 0).
 * 읽기·스키마 검증·문구는 `lib/ignore.mjs` 한 곳이 소유한다(FC10 이 fail-loud 를 문다).
 */
function loadIgnoreEntries(vaultDir, ignoreArg) {
  if (ignoreArg === undefined) return []
  return loadIgnoreFeedsAt(resolveFromVault(vaultDir, ignoreArg))
}

/** 응답 item ts 의 max. 항목이 없으면 epoch — 벽시계를 읽지 않는다. */
function latestItemTimestamp(items) {
  const timestamps = [EPOCH]
  for (const item of items) {
    if (item.ts && !Number.isNaN(Date.parse(item.ts))) {
      timestamps.push(new Date(item.ts).toISOString())
    }
  }
  timestamps.sort()
  return timestamps.at(-1)
}

export async function main(argv = process.argv.slice(2)) {
  const { values } = parseArgs({
    allowPositionals: false,
    args: argv,
    options: {
      after: { type: 'string' },
      count: { type: 'string' },
      env: { default: 'prod', type: 'string' },
      ignore: { type: 'string' },
      out: { type: 'string' },
      vault: { type: 'string' },
    },
  })
  // ★ 인자 검증 순서는 계약이되 **exit code 로 가르지 않는다**(셋 다 2 · 규범 P). 사유는 stderr
  //   어휘가 가른다 — `--env` 는 `dev|prod`, `--count` 는 `count`, `--after` 는 `--after`/커서.
  //   문구 소유자만 다르다: env 는 `lib/cli-env.mjs`, 나머지는 여기다. **종료는 전부 여기서** 한다
  //   (아래 `.catch` 는 exit 1 이라 던져서는 안 된다).
  const envError = envEnumError(values.env)
  if (envError !== null) return fail(envError)

  const countError = countValueError(values.count)
  if (countError !== null) return fail(countError)

  // D10 ① — 형식 검사는 **git 을 부르기 전에** 한다. `--after=--all`·`--after=--output=<path>` 가
  //   하위 프로세스의 옵션으로 재해석되는 것을 막는 주력 층이다(②③ 은 워크가 진다 · D11).
  if (values.after !== undefined && !isCursorFormat(values.after)) {
    return fail(
      `--after 커서 형식이 아닙니다: ${JSON.stringify(values.after)} — 12자리 소문자 16진수(예: 65fc53636938)여야 합니다.`,
    )
  }

  const vault = values.vault ?? REPO_ROOT
  const count = Number.parseInt(values.count, 10)
  if (values.out) {
    const artifactPath = resolveFromVault(vault, values.out)
    const { runFeedsGenerator } = await import('./lib/generator.mjs')
    await runFeedsGenerator({
      artifactPath,
      count,
      env: values.env,
      ignore: values.ignore,
      vault,
    })
    console.error(`[wiki] feeds generated artifact=${artifactPath}`)
    return
  }
  const result = await feeds(vault, values.env, {
    after: values.after,
    count,
    ignore: values.ignore,
  })
  process.stdout.write(`${JSON.stringify(result)}\n`)
}

/** 인자 계약 위반 = **exit 2** · stdout 침묵. 열거 오타·count·커서가 같은 코드를 공유한다(규범 P). */
function fail(message) {
  console.error(message)
  process.exitCode = 2
}

/**
 * D15·D16 — `--count` 는 **필수**이고 값은 **1 이상 정수**다. 위반이면 사유 문구, 정상이면 `null`.
 *
 * ★ `Number.isFinite(n) && n > 0` 만으로는 부족하다(실측): `parseInt('1.9')=1` · `parseInt('5e2')=5`
 *   (500 이 아니다) · `parseInt(' 7')=7` · `parseInt('0x10')=0`. 앞의 셋은 **조용히 다른 수**가 되어
 *   통과한다 — 오배선이 관측되지 않는 것이 정확히 D16 이 없애려는 상태다. 그래서 파싱 결과를 다시
 *   문자열로 만들어 **원문과 대조**한다(`plugin.ts` 의 `parseCountParam` 이 이미 그 형태다).
 */
function countValueError(raw) {
  if (raw === undefined) {
    return '--count 는 필수 인자입니다 — 페이지 크기를 명시하세요(예: --count 40).'
  }
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isInteger(parsed) || parsed < 1 || String(parsed) !== raw) {
    return `--count 값이 1 이상의 정수가 아닙니다: ${JSON.stringify(raw)}`
  }
  return null
}

function resolveFromVault(vault, value) {
  return path.isAbsolute(value) ? value : path.join(path.resolve(vault), value)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
