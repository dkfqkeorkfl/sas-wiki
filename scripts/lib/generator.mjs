// summary **생성기** — 요청받으면 계산한다. 신선도 판정은 v3 P1 에서 제거됐다.
//
// ★ OQ-P5-1 = A: `runSummaryGenerator` 는 예전에 CLI 파일 `scripts/summary.mjs` 에 있었다. `feeds.mjs`·
//   `wiki.mjs` 가 그것을 import 하면 엔드포인트 CLI 가 다른 CLI 를 무는 꼴이 된다(`main`·`parseCliArgs`·
//   argv 가드까지 정적 폐쇄에 딸려 온다) — P4 가 `summary()` 를 `lib/summary-endpoint.mjs` 로 옮겨 정리한
//   형태와 어긋난다. 그래서 이 함수를 CLI 밖으로 옮긴다. **재export 는 두지 않는다** — 재export 는
//   정적 import 와 같은 비용이라 분리가 무효가 된다.
//
// ★ 이 파일의 **정적** import 그래프에 파싱·렌더 툴체인이 들어오면 안 된다(규범 G). 판정에 실제로
//   필요한 일은 git HEAD 조회와 파일 쓰기뿐인데, 마크다운 렌더러를 정적으로 물면 호출할 때마다
//   그 로드 비용(수 초)을 전부 낸다. 그래서 파싱은 실행 본문에서 동적으로 연다.
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { writeFileAtomic } from './atomic.mjs'
import { CURSOR_LENGTH, walkCursorPage } from './feed-cursor.mjs'
import { makeGitRunner } from './git.mjs'
import { loadIgnoreFeedsAt } from './ignore.mjs'
import { buildFeeds, buildSummary } from './payloads.mjs'

/** 생산 JSON Schema 디렉토리 — 이 모듈은 scripts/lib/ 이므로 상위 scripts/schema. */
const SCHEMA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'schema')

/**
 * summary 산출물을 계산하고, `artifactPath` 가 있을 때만 발행한다.
 *
 * 신선도 판정은 지운 값을 다른 값으로 대체하지 않는다. 약화된 판정을 남기면 어떤 산출물도 항상
 * fresh 처럼 보이므로 PRD D34 가 금지한 "발동 불가능한 방어층"이 된다. 쓰기 순서는
 * feeds 아티팩트는 `runFeedsGenerator` / `feeds.mjs --out` 이 소유하고, 리포트는 `validate.mjs` 가
 * 게이트 전에 쓴다. 이 파일은 더 이상 형제 경로를 파생하지 않는다.
 *
 * 예전 스킵 판정의 교훈 중 살아남는 것은 "모르면 다시 만든다"가 아니라 "모르면 서빙하지 않는다"다.
 * 조회 스크립트는 이제 직접 만들지 않고, 부재·손상 캐시는 fail-loud 로 드러낸다.
 *
 * `--max-excluded` 는 **여기 없다**. 그것은 산출 방식이 아니라 **종료 코드 정책**이라 CLI 층
 * (`summary.mjs`)이 `result.excludedCount` 로 판정한다 — 이 함수는 제외를 세기만 하고 그것으로
 * 무엇을 할지는 정하지 않는다. 예전에는 구조분해에 남아 있었으나 본문에서 쓰이지 않아, 이 함수가
 * 임계를 강제한다는 **거짓 인상**만 줬다(리뷰 지적).
 *
 * @param {{ artifactPath?: string, env?: 'dev'|'prod', runGit?: Function, vault: string }} input
 */
export async function runSummaryGenerator({
  // `--out` 로 들어오는 경로 **덮어쓰기**다. 미지정이면 파일을 쓰지 않는다.
  artifactPath: artifactPathOverride,
  env = 'prod',
  runGit,
  vault,
}) {
  const vaultDir = path.resolve(vault)
  const git = runGit ?? makeGitRunner(vaultDir)
  const sourceCommit = git(['rev-parse', 'HEAD']).trim()

  // ★ 여기서 비로소 파싱·렌더 툴체인을 연다(위 헤더 주석 참조). 이 함수 안에는 조기 반환 분기가
  //   없다 — 일단 호출되면 예외 없이 이 지점까지 진행한다. 비용을 피하는 유일한 경로는 이 함수
  //   자체를 호출하지 않는 것이다(정적 import 였다면 호출 여부와 무관하게 로드 시점에 항상 비용을
  //   냈을 것이다).
  const { parseVault } = await import('./parse-vault.mjs')
  // P5 Task 9(D-I) — parseVault 는 이제 항상 깊은 티어다(얕은 티어 선택 스위치를 제거했다).
  const parsed = parseVault(vaultDir, env, SCHEMA_DIR, { runGit: git })
  const payload = buildSummary({
    docs: parsed.wire.docs,
    env,
    generatedAt: parsed.wire.generatedAt,
    sourceCommit: parsed.wire.sourceCommit,
    tags: parsed.wire.tags,
    tree: parsed.wire.tree,
  })
  const excluded = parsed.stats.excluded ?? []
  const result = {
    artifactPath: artifactPathOverride ?? null,
    excluded,
    excludedCount: excluded.length,
    payload,
    sourceCommit,
    status: excluded.length > 0 ? 'partial' : 'clean',
  }

  if (artifactPathOverride) {
    writeFileAtomic(artifactPathOverride, `${JSON.stringify(payload)}\n`)
  }
  return result
}

/**
 * feeds 아티팩트 생성기 — `feeds.mjs --out` 의 동적 import 대상이다.
 *
 * ★ v3 P2(D48·D39·D20) — **페이지 계산을 조회 경로와 같은 코드로 한다.** 예전에는 이 함수가
 * `parseVault` 가 전량 수집한 items 를 `byRecencyThenId` 로 다시 정렬한 뒤 잘랐고, 그 근거는
 * "조회 경로(`pageFeeds`)도 같은 정렬 권위를 쓴다" 였다. **P2 에서 그 전제가 거짓이 된다** —
 * 조회는 커서 기반 git 워크가 되고 정렬 권위가 워크 순서로 이전된다(D39). 두 경로가 다른 순서를
 * 쓰면 D48 등가 불변식("캐시 슬라이스와 라이브 워크가 같은 페이지를 낸다")이 **구조적으로** 깨지므로,
 * 여기서도 `walkCursorPage` 를 부른다. 그 결과 캐시 파일과 라이브 응답이 형태뿐 아니라 **계산까지**
 * 같아진다(설계 §3-3 "모드 개념이 없다" 의 귀결).
 *
 * ★ `generatedAt` 만 `parseVault` 에서 온다 — 아티팩트의 그 값은 **`max(doc.updated)`**(D-B)이고
 * summary 아티팩트와 같아야 한다(FA12: 두 산출물은 같은 커밋·같은 세대에서 나온다). 응답 층의
 * `generatedAt`(억제 후 item ts 의 max)과는 층이 다르다.
 *
 * @param {{ artifactPath: string, count?: number, env?: 'dev'|'prod', ignore?: string,
 *           runGit?: Function, vault: string }} input
 */
export async function runFeedsGenerator({
  artifactPath,
  count,
  env = 'prod',
  ignore,
  runGit,
  vault,
}) {
  const vaultDir = path.resolve(vault)
  const git = runGit ?? makeGitRunner(vaultDir)
  const sourceCommit = git(['rev-parse', 'HEAD']).trim()
  const { parseVault } = await import('./parse-vault.mjs')
  const parsed = parseVault(vaultDir, env, SCHEMA_DIR, { runGit: git })
  // ★ 해석기를 **다시 돌리지 않는다.** `parseVault` 가 이미 `collectFeedItems`(전량 워크)로 모든
  //   `feed:` 커밋을 해석해 뒀고(`wire.items`), 그것이 `resolveItems` 가 낼 값 **그 자체**다 —
  //   같은 HEAD·같은 생존 판정이므로 다시 부르면 HEAD 문서 상태와 경로 역인덱스를 통째로 재구성하는
  //   비용만 낸다. 커서 워크에는 **순서·경계·`nextCursor`** 만 맡긴다(그것이 이 함수가 워크를 부르는
  //   유일한 이유다 — D48 등가 불변식이 두 경로의 페이지 계산을 같게 요구한다).
  // ★ `parsed.gate.runGit` 은 메모이즈된 러너다. 같은 리포는 한 파싱 안에서 변하지 않으므로 배치
  //   워크가 내는 질의도 그 캐시를 그대로 탄다.
  const walkGit = parsed.gate.runGit ?? git
  const byFeedId = new Map(parsed.wire.items.map((item) => [item.id, item]))
  const { items, nextCursor } = walkCursorPage(vaultDir, {
    count,
    ignoreEntries:
      ignore === undefined ? [] : loadIgnoreFeedsAt(resolveIgnorePath(vaultDir, ignore)),
    resolveItems: (shas) =>
      shas.map((sha) => byFeedId.get(sha.slice(0, CURSOR_LENGTH))).filter((item) => item !== undefined), // prettier-ignore
    runGit: walkGit,
  })
  const payload = {
    ...buildFeeds({
      env,
      generatedAt: parsed.wire.generatedAt,
      items,
      sourceCommit: parsed.wire.sourceCommit,
    }),
    nextCursor,
  }

  writeFileAtomic(artifactPath, `${JSON.stringify(payload)}\n`)
  return { artifactPath, payload, sourceCommit }
}

/**
 * `--ignore <경로>` → 억제 목록 **파일 경로**. 상대 경로는 vault 기준이다(D20).
 * basename 을 버리면 사용자가 지정하지 않은 파일을 조용히 읽게 된다 — 경로를 그대로 보존한다.
 */
function resolveIgnorePath(vaultDir, ignoreArg) {
  return path.isAbsolute(ignoreArg) ? ignoreArg : path.join(vaultDir, ignoreArg)
}
