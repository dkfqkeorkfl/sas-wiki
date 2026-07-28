#!/usr/bin/env node
// wiki 엔드포인트 — **단일 문서 렌더**(D-F). summary 아티팩트를 읽어 `docs[].breadcrumb` 로 경로
//   집합 + basename 인덱스를 만들고(`lib/single-doc.mjs`), 요청 문서 **1건만** 파싱·렌더한다.
//   `derive()`·`collectFeedItems()`·`getFileCommitDates()` 를 타지 않으므로 문서별 git 호출이 0 이다 —
//   히트 경로의 git 호출 multiset 은 `runSummaryGenerator` 의 신선도 판정이 내는 `[['rev-parse','HEAD']]`
//   뿐이다(TR2 의 비용 계약).
import path from 'node:path'
import { parseArgs } from 'node:util'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { ARTIFACT_PRODUCER, SCHEMA_VERSION, artifactPath, readArtifact } from './lib/artifact.mjs'
import { envEnumError } from './lib/cli-env.mjs'
import { runSummaryGenerator } from './lib/generator.mjs'
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
 * @param {string} vault git vault repository root
 * @param {'dev'|'prod'} env
 * @param {string} ref path(canonical)
 * @returns {Promise<object|null>}
 */
export async function wiki(vault, env = 'prod', ref = '') {
  const vaultDir = path.resolve(vault)
  // 신선도 확보 — D1 lazy 재생성 그 자체다(재생성 분기는 lib/generator.mjs 안의 동적 import 로만 열린다).
  const status = await runSummaryGenerator({ env, vault: vaultDir })
  const artifact = readArtifact({
    expect: {
      env,
      inputsFingerprint: status.inputsFingerprint,
      producer: ARTIFACT_PRODUCER,
      schemaVersion: SCHEMA_VERSION,
    },
    path: artifactPath(vaultDir, env),
  })
  // 재생성 직후에도 아티팩트를 신뢰할 수 없다면 옛 세대를 200 으로 흘리지 않는다(WK9).
  if (!artifact.fresh) {
    throw new Error(
      `summary 아티팩트를 신뢰할 수 없다(${artifact.reason}): ${artifactPath(vaultDir, env)}`,
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
  const result = await wiki(vault, values.env, values.path ?? '')
  process.stdout.write(`${JSON.stringify(result)}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
