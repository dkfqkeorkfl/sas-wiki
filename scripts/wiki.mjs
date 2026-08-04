#!/usr/bin/env node
// wiki 엔드포인트 — **단일 문서 렌더**(D-F). summary 아티팩트를 읽어 `docs[].breadcrumb` 로 경로
//   집합 + basename 인덱스를 만들고(`lib/single-doc.mjs`), 요청 문서 **1건만** 파싱·렌더한다.
//   `derive()`·`collectFeedItems()`·`getFileCommitDates()` 를 타지 않고, 생성기도 부르지 않는다.
//   히트 경로의 비용 계약은 "아티팩트 읽기 + 단일 문서 렌더" 이며 git 호출은 없다.
import path from 'node:path'
import { parseArgs } from 'node:util'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { SCHEMA_VERSION, readArtifact } from './lib/artifact.mjs'
import { envEnumError } from './lib/cli-env.mjs'
import { WIKI_PREFIX } from './lib/head-state.mjs'
import { parseMarkdownFile } from './lib/parse.mjs'
import { makeDocIndex, projectSingleDoc } from './lib/single-doc.mjs'

// --vault 미지정 시 기본값 = 스크립트 자기 리포 루트(scripts/ 의 상위). cwd 무관(import.meta.url 파생).
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/**
 * wiki 엔드포인트 — ref(=path, canonical) 문서 1건.
 *
 * active 문서는 본문 7키(breadcrumb·headings·html·meta·path·sources·status)를, disable 문서는
 * 아티팩트 스텁(4키)을 그대로 반환한다. 없는 path 는 null 이다.
 *
 * ★ D27 — summary 아티팩트 경로는 **호출자가 소유한다**. 이 함수는 경로를 파생하지 않고 받은 것을
 * 그대로 `readArtifact` 에 넘긴다(`feeds.mjs:136` 이 `--out` 을 다루는 형태와 같다). 파생이 남으면
 * 미래 소비자(Rust 서버)가 같은 파생을 복제해야 하고, 두 벌이 갈리는 순간 조용히 어긋난다.
 * ★ **해석(상대 경로 → `--vault` 기준)과 미지정 판정은 `main()` 이 소유한다.** 여기에 미지정 검사를
 * 넣지 않는다 — 그것은 인자 계약(exit 2)이고, 이 함수는 인자를 파싱하지 않는다(규범 O).
 *
 * @param {string} vault git vault repository root
 * @param {'dev'|'prod'} env
 * @param {string} ref path(canonical)
 * @param {string} summaryPath summary 아티팩트 경로 — `main()` 이 해석해 넘긴다(기본값 없음)
 * @returns {Promise<object|null>}
 */
export async function wiki(vault, env = 'prod', ref = '', summaryPath) {
  const vaultDir = path.resolve(vault)
  // 읽기 실패 처리일 뿐 신선도 판정이 아니다. path 가 summary 아티팩트를 가리키고, 남은 expect 는
  // `{env, schemaVersion}` 로 feeds 독자와 같다.
  const artifact = readArtifact({
    expect: {
      env,
      schemaVersion: SCHEMA_VERSION,
    },
    path: summaryPath,
  })
  // 빌드 후에도 아티팩트를 신뢰할 수 없다면 옛 세대를 200 으로 흘리지 않는다(WK9).
  if (!artifact.fresh) {
    throw new Error(
      `summary 아티팩트를 읽을 수 없다(${artifact.reason}): ${summaryPath} — 빌드를 먼저 실행하세요.`,
    )
  }
  const index = makeDocIndex(artifact.payload.docs)
  return projectSingleDoc({
    index,
    readFile: (docRef) => parseMarkdownFile(path.join(vaultDir, WIKI_PREFIX, `${docRef}.md`)),
    ref,
  })
}

export async function main(argv = process.argv.slice(2)) {
  const { values } = parseArgs({
    allowPositionals: false,
    args: argv,
    options: {
      env: { default: 'prod', type: 'string' },
      path: { type: 'string' },
      // D27 — **기본값을 두지 않는다**(`summary --out`·`feeds --out`·`validate --report` 와 같은
      //   "명시 출력/입력만 쓴다" 계약). 기본값을 주면 파생이 되살아나 D27 이 무의미해진다.
      summary: { type: 'string' },
      vault: { type: 'string' },
    },
  })
  // `--env` 열거 검증 — `util.parseArgs` 는 choices 를 지원하지 않아 파싱 뒤에 직접 본다.
  //   조용한 prod 폴백은 fail-closed 가 아니라 **silent misconfiguration** 이다: `--env Dev` 오타 하나로
  //   dev 예제를 본다고 믿는 사람이 상용 산출물을 받는다(반대 방향이면 미공개 데이터 누출이다).
  //   미지정은 여전히 prod 다 — 여기서 막는 것은 **오타뿐**이다.
  //   문구는 `lib/cli-env.mjs` 가 소유하고, **종료는 여기서** 한다 — 아래 `.catch` 는 exit 1 이라
  //   던져서는 안 된다(EV2 가 exit 2 를 문다).
  const envError = envEnumError(values.env)
  if (envError !== null) {
    console.error(envError)
    process.exitCode = 2
    return
  }
  const vault = values.vault ?? REPO_ROOT
  // ★ 순서가 계약이다 — **`--env` 열거가 먼저, `--summary` 미지정이 나중**이다. 뒤집으면
  //   `wiki.mjs --env Dev`(summary 없음)가 summary 사유로 죽어 EV2·EV5·SUM-4 가 동시에 red 가 된다.
  //   두 위반은 같은 exit 2 를 공유하고 **사유는 stderr 어휘가 가른다**(규범 P · `feeds.mjs:115-118`).
  // ★ 던지지 않는다 — 아래 `.catch` 는 exit 1(런타임 실패)이라 인자 계약 위반이 그리로 새면 안 된다.
  if (values.summary === undefined) {
    console.error(
      '--summary 는 필수 인자입니다 — summary 아티팩트 경로를 명시하세요(예: --summary cache/summary.prod.json).',
    )
    process.exitCode = 2
    return
  }
  const result = await wiki(
    vault,
    values.env,
    values.path ?? '',
    resolveFromVault(vault, values.summary),
  )
  process.stdout.write(`${JSON.stringify(result)}\n`)
}

/**
 * 상대 경로는 **`--vault` 기준**이다(cwd 기준이 아니다) — 호출자가 어디서 부르든 답이 같아야 한다.
 *
 * `summary.mjs:94-96`·`validate.mjs:220-222`·`feeds.mjs:181-183` 과 **같은 형태**의 4번째 복제다.
 * 공용 `lib/` 로 추출하면 P4 가 원래 안 건드릴 3파일을 동시 수정하게 되므로 plan 이 **후속 제안**으로
 * 분리했다 — 이 커밋에서 하지 않는다(tdd §9.3-2).
 */
function resolveFromVault(vault, value) {
  return path.isAbsolute(value) ? value : path.join(vault, value)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
