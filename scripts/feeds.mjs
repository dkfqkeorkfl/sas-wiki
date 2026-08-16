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
 * 문서 해석 계층(`resolveGit`)의 **백스톱** spawn 타임아웃(ms) — 완전 hang 만 잡는다.
 *
 * `walkGit` 의 `LIVE_WALK_TIMEOUT_MS`(5000ms)를 그대로 물리지 않는 이유는 두 계층의 비용 분포가
 * 자릿수로 다르기 때문이다: `resolveGit` 은 HEAD 문서 상태·삭제 이력·경로 역인덱스를 훑어 부하
 * 상태에서 초 단위(같은 일을 하는 CLI 가 이 리포에서 실측 25~31초)가 정상이다. 5000ms 를 그대로
 * 쓰면 정상 부하가 타임아웃으로 오탐된다.
 *
 * 그렇다고 상한을 아예 없애면 완전 hang(자격증명 프롬프트 대기 · 막힌 네트워크 fetch 등 비용
 * 분포와 무관한 별개 실패)을 영영 못 끝낸다. 그래서 정상 실측 상한(31초)의 **약 20배** —
 * `walkGit` 값과 뚜렷이 다른 자릿수이면서 어떤 정상 가변비용도 침범하지 않는 값을 고른다.
 * 완전 hang 을 이 값으로 실측(인위적으로 git 을 멈춰) 관측하지는 않는다 — 그러려면 테스트 전용
 * hang 주입 지점을 코드에 새로 심어야 하는데, 그 자체가 실사용 동기 없는 새 표면이다. 이 값은
 * "정상 케이스를 절대 건드리지 않는다"는 코드 대조로만 판정한다.
 */
const RESOLVE_BACKSTOP_TIMEOUT_MS = 600_000

/**
 * feeds 엔드포인트 — 커서 위치에서 한 페이지를 **git 워크로 계산**한다.
 *
 * ★ CLI(`main`)를 거치지 않는 **모듈 직접 호출자**도 있다(테스트·서빙 코드가 이 함수를 바로 부른다).
 * `main` 의 인자 검증(`envEnumError`·`countValueError`)은 CLI 층에서만 돌기 때문에, 이 함수 자신도
 * `env`·`window.count` 를 검증한다 — 그러지 않으면 `count: 0` 이 vault 상태에 따라 갈리는 방식으로
 * 새 나간다: 커밋이 있는 vault 는 `walkCursorPage`(`lib/feed-cursor.mjs`)가 빈 `items` 위에서 마지막
 * 항목에 접근해 TypeError 로 죽고, 0-커밋 vault 는 아무 사유도 없이 빈 페이지를 조용히 낸다 — 어느
 * 쪽도 "count 인자가 잘못됐다"는 사유를 호출자에게 말하지 않는다.
 *
 * @param {string} vault git vault repository root
 * @param {'dev'|'prod'} env
 * @param {{ after?: string, count?: number, ignore?: string }} [window]
 *   `after` 는 12-hex 커서(미지정 = HEAD 부터) · `count` 는 페이지 크기(**미지정 = 상한 없음**;
 *   지정 시 1 이상의 안전정수여야 한다 · CLI 층은 D15 로 필수다) · `ignore` 는 억제 목록 파일 경로
 *   (미지정 = 억제 없음 · D20).
 */
export async function feeds(vault, env = 'prod', window = {}) {
  const envError = envEnumError(env)
  if (envError !== null) throw new Error(envError)
  if (window.count !== undefined && !(Number.isSafeInteger(window.count) && window.count >= 1)) {
    throw new Error(
      `feeds() 의 count 는 1 이상의 안전정수여야 합니다: ${JSON.stringify(window.count)}`,
    )
  }
  const vaultDir = path.resolve(vault)
  // 러너가 둘인 것이 계약이다(`lib/feed-cursor.mjs` 의 `LIVE_WALK_TIMEOUT_MS` 「적용 범위」 참조):
  //   · `walkGit`    — 워크 자신의 호출(가용성 확인·커서 검증·배치 워크). D23 spawn 타임아웃이 붙는다.
  //   · `resolveGit` — 문서 해석 계층. 비용 분포가 자릿수로 달라 `walkGit` 과 **같은 값의** 촘촘한
  //     상한은 걸지 않는다 — 그 계층은 HEAD 문서 상태·삭제 이력·경로 역인덱스를 훑어 정상 범위에서도
  //     초 단위로 걸리고(부하 상태의 실측이 초 단위대 — 아래 주석), `walkGit` 값을 그대로 물리면 정상
  //     가변비용이 타임아웃으로 오탐된다. 그러나 "촘촘한 상한을 안 건다"가 "상한이 없어도 된다"는
  //     아니다 — git 프로세스가 완전히 멈추는 것(예: 자격증명 프롬프트 대기·막힌 네트워크 fetch)은
  //     비용 분포와 무관한 별개 위험이다. 그래서 **백스톱**만 건다: 정상 가변비용에는 절대 걸리지
  //     않을 만큼 넉넉하되(아래), 완전 hang 은 결국 끝낸다.
  const walkGit = makeGitRunner(vaultDir, { timeoutMs: LIVE_WALK_TIMEOUT_MS })
  const resolveGit = makeGitRunner(vaultDir, { timeoutMs: RESOLVE_BACKSTOP_TIMEOUT_MS })
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
 * `--count` 상한 — 이 값을 넘기면 거절한다(DoS 방지: 임의로 큰 값이 그대로 git 워크의 배치 상한
 * 으로 전달되는 것을 막는다). `package.json` 의 `build`·`build-dev` 가 이미 `--count 200` 을 쓰므로
 * **200 미만으로 내리면 그 두 빌드가 즉시 깨진다** — 실사용치보다 뚜렷이 큰 값을 고르되 임의의 큰
 * 정수(예: 10^9)와는 확실히 구분되는 자릿수로 둔다.
 */
const MAX_COUNT = 10_000

/**
 * D15·D16 — `--count` 는 **필수**이고 값은 **1 이상 `MAX_COUNT` 이하의 정수**다. 위반이면 사유 문구,
 * 정상이면 `null`.
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
  if (parsed > MAX_COUNT) {
    return `--count 값이 상한(${MAX_COUNT})을 초과했습니다: ${JSON.stringify(raw)}`
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
