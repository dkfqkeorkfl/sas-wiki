#!/usr/bin/env node
// feeds 엔드포인트 — **아티팩트 소비자**(D-E·D-G). 파싱·렌더·파생 툴체인을 **정적으로 물지 않는다**
//   (FC1) — 신선도는 `lib/generator.mjs` 재사용으로 확보하고(재생성 분기는 그 파일 안의 동적 import
//   로만 열린다), 사유 판정은 전혀 하지 않는다(D-A: 판정 권위는 생성기 하나).
//   하는 일은 아티팩트를 읽고, 억제 필터를 걸고, 페이지를 내는 것뿐이다 — 정렬·슬라이스·억제는
//   `pageFeeds` 에 **위임**한다(재구현 금지 · FC5 · `ignore.mjs` 헤더의 "두 번째 필터 경로" 금지).
import path from 'node:path'
import { parseArgs } from 'node:util'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { feedsArtifactPath, readArtifact } from './lib/artifact.mjs'
import { envEnumError } from './lib/cli-env.mjs'
import { runSummaryGenerator } from './lib/generator.mjs'
import { pageFeeds } from './lib/git-walk.mjs'
import { loadIgnoreFeeds } from './lib/ignore.mjs'
import { FEEDS_ARTIFACT_PRODUCER, SCHEMA_VERSION, buildFeeds } from './lib/payloads.mjs'

// --vault 미지정 시 기본값 = 스크립트 자기 리포 루트(scripts/ 의 상위). cwd 무관(import.meta.url 파생).
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/**
 * feeds 엔드포인트 — 아티팩트를 읽어 **억제 필터 + 페이지**만 얹는다.
 *
 * @param {string} vault git vault repository root
 * @param {'dev'|'prod'} env
 * @param {{ after?: object|string, count?: number, from?: string, to?: string }} [window]
 */
export async function feeds(vault, env = 'prod', window = {}) {
  const vaultDir = path.resolve(vault)
  // 신선도 확보 — D1 lazy 재생성 그 자체다. 히트 경로는 `rev-parse HEAD` 1회만 낸다(D-F 비용 계약).
  const status = await runSummaryGenerator({ env, vault: vaultDir })
  const artifact = readArtifact({
    expect: {
      env,
      inputsFingerprint: status.inputsFingerprint,
      producer: FEEDS_ARTIFACT_PRODUCER,
      schemaVersion: SCHEMA_VERSION,
    },
    path: feedsArtifactPath(vaultDir, env),
  })
  // 재생성 직후에도 feeds 아티팩트를 신뢰할 수 없다면(쓰기 실패·경쟁) 옛 세대를 200 으로 흘리지
  //   않는다 — throw 하면 CLI/미들웨어가 그대로 5xx 로 전파한다(FC9).
  if (!artifact.fresh) {
    throw new Error(
      `feeds 아티팩트를 신뢰할 수 없다(${artifact.reason}): ${feedsArtifactPath(vaultDir, env)}`,
    )
  }
  const payload = artifact.payload
  // 억제 목록은 여기서 **직접** 부른다(Task 8 이후에도 유지되는 계약 — OQ-P5-6). 스키마 위반은
  //   fail-loud 로 던진다(FC10).
  const ignore = loadIgnoreFeeds(vaultDir)
  const { items, nextCursor } = pageFeeds(payload.items, ignore, {
    after: window.after,
    from: window.from,
    limit: window.count,
    to: window.to,
  })
  return {
    ...buildFeeds({
      // 서빙 시점 재집계(D-B 두 번째 층) — 아티팩트 값(억제 무관)과 **억제 후** 응답 item ts 의
      //   max. 억제된 항목의 ts 는 응답 어디에도 남지 않는다(CWE-204 클로즈 · FC7).
      generatedAt: recomputeGeneratedAt(payload.generatedAt, items),
      inputsFingerprint: payload.inputsFingerprint,
      items,
      sourceCommit: payload.sourceCommit,
    }),
    nextCursor,
  }
}

/** 억제 후(=응답에 실리는) item ts 와 아티팩트 `generatedAt` 의 max. 벽시계를 읽지 않는다. */
function recomputeGeneratedAt(base, items) {
  const timestamps = [base]
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
      from: { type: 'string' },
      to: { type: 'string' },
      vault: { type: 'string' },
    },
  })
  // `--env` 열거 검증 — `util.parseArgs` 는 choices 를 지원하지 않아 파싱 뒤에 직접 본다.
  //   조용한 prod 폴백은 fail-closed 가 아니라 **silent misconfiguration** 이다: `--env Dev` 오타 하나로
  //   dev 예제를 본다고 믿는 사람이 상용 산출물을 받는다(반대 방향이면 미공개 데이터 누출이다).
  //   미지정은 여전히 prod 다 — 여기서 막는 것은 **오타뿐**이다.
  //   문구는 `lib/cli-env.mjs` 가 소유하고, **종료는 여기서** 한다 — 아래 `.catch` 는 exit 1 이라
  //   던져서는 안 된다(EV1·EV7 이 exit 2 를 문다).
  const envError = envEnumError(values.env)
  if (envError !== null) {
    console.error(envError)
    process.exitCode = 2
    return
  }
  const vault = values.vault ?? REPO_ROOT
  const result = await feeds(vault, values.env, {
    after: values.after ? JSON.parse(values.after) : undefined,
    count: values.count === undefined ? undefined : Number.parseInt(values.count, 10),
    from: values.from,
    to: values.to,
  })
  process.stdout.write(`${JSON.stringify(result)}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
