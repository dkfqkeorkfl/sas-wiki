#!/usr/bin/env node
// wiki 엔드포인트 — 함수 export + CLI 가드 자기완결 파일. ref(=path, canonical) 문서 1건.
import path from 'node:path'
import { parseArgs } from 'node:util'
import { fileURLToPath, pathToFileURL } from 'node:url'

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
  const vault = values.vault ?? REPO_ROOT
  process.stdout.write(`${JSON.stringify(wiki(vault, values.env, values.path ?? ''))}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
