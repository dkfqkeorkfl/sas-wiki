#!/usr/bin/env node
// summary 엔드포인트 — 함수 export + CLI 가드 자기완결 파일. 서빙 로직 없음(순수 함수 + 얇은 CLI).
import path from 'node:path'
import { parseArgs } from 'node:util'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { buildWirePayload } from './lib/parse-vault.mjs'
import { buildSummary } from './lib/payloads.mjs'

// --vault 미지정 시 기본값 = 스크립트 자기 리포 루트(scripts/ 의 상위). cwd 무관(import.meta.url 파생).
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/**
 * summary 엔드포인트 — vault 를 on-demand 파싱해 화면 뼈대만 투영한다.
 *
 * @param {string} vault git vault repository root
 * @param {'dev'|'prod'} env
 */
export function summary(vault, env = 'prod') {
  const payload = buildWirePayload(vault, env)
  return buildSummary({
    docs: payload.docs,
    generatedAt: payload.generatedAt,
    sourceCommit: payload.sourceCommit,
    tags: payload.tags,
    tree: payload.tree,
  })
}

export async function main(argv = process.argv.slice(2)) {
  const { values } = parseArgs({
    allowPositionals: false,
    args: argv,
    options: { env: { default: 'prod', type: 'string' }, vault: { type: 'string' } },
  })
  const vault = values.vault ?? REPO_ROOT
  process.stdout.write(`${JSON.stringify(summary(vault, values.env))}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
