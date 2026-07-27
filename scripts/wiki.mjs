#!/usr/bin/env node
// wiki 엔드포인트 — 함수 export + CLI 가드 자기완결 파일. ref(=path, canonical) 문서 1건.
import path from 'node:path'
import { parseArgs } from 'node:util'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { envEnumError } from './lib/cli-env.mjs'
import { buildWirePayload } from './lib/parse-vault.mjs'

// --vault 미지정 시 기본값 = 스크립트 자기 리포 루트(scripts/ 의 상위). cwd 무관(import.meta.url 파생).
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/**
 * wiki 엔드포인트 — ref(=path, canonical) 문서 1건.
 *
 * active 문서는 본문 4키 + path/status/breadcrumb 를, disable 문서는 summary stub 를 반환한다.
 * 없는 path 는 null 이다.
 *
 * @param {string} vault git vault repository root
 * @param {'dev'|'prod'} env
 * @param {string} ref path(canonical)
 * @returns {object|null}
 */
export function wiki(vault, env = 'prod', ref = '') {
  const payload = buildWirePayload(vault, env)
  const body = payload.bodies.find((record) => record.breadcrumb.join('/') === ref)
  if (body) return projectBody(body, ref)

  const stub = payload.docs.find((doc) => doc.breadcrumb.join('/') === ref)
  return stub ?? null
}

/** active 본문 레코드 → 본문 4키 + 식별메타(path·status·breadcrumb). body 내부(md 등) 누출 차단. */
function projectBody(record, ref) {
  return {
    breadcrumb: record.breadcrumb,
    headings: record.headings,
    html: record.html,
    meta: record.meta,
    path: ref,
    sources: record.sources,
    status: record.status,
  }
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
  process.stdout.write(`${JSON.stringify(wiki(vault, values.env, values.path ?? ''))}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
