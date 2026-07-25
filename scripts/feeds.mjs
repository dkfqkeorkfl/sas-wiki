#!/usr/bin/env node
// feeds 엔드포인트 — 함수 export + CLI 가드 자기완결 파일. walkFeeds 가 억제·정렬·커서·상한을
//   결정하고 여기서는 봉투만 씌운다(로직은 lib/git-walk·parse-vault·payloads 공유부품).
import path from 'node:path'
import { parseArgs } from 'node:util'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { walkFeeds } from './lib/git-walk.mjs'
import { buildWirePayload } from './lib/parse-vault.mjs'
import { buildFeeds } from './lib/payloads.mjs'

// --vault 미지정 시 기본값 = 스크립트 자기 리포 루트(scripts/ 의 상위). cwd 무관(import.meta.url 파생).
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** feeds 기본 상한 — 소비자 DEFAULT_FEED_LIMIT 과 parity(미지정·0 이면 이 값으로 슬라이스). */
const DEFAULT_FEED_LIMIT = 50

/**
 * feeds 엔드포인트 — `env` 를 walkFeeds 로 배선한다(summary/wiki 와 시그니처 일관) — **prod 는 draft
 * 문서 참조 피드를 제외**한다(env 미전달이면 walkFeeds 가 전체 HEAD 로 resolve 해 prod 에서 draft 피드 노출).
 *
 * @param {string} vault git vault repository root
 * @param {'dev'|'prod'} env
 * @param {{ after?: object|string, count?: number, from?: string, to?: string }} [window]
 */
export function feeds(vault, env = 'prod', window = {}) {
  const payload = buildWirePayload(vault, env)
  const items = walkFeeds(vault, {
    after: window.after,
    count: window.count ?? DEFAULT_FEED_LIMIT,
    env,
    from: window.from,
    to: window.to,
  })
  return {
    ...buildFeeds({
      generatedAt: payload.generatedAt,
      items,
      sourceCommit: payload.sourceCommit,
    }),
    nextCursor: items.nextCursor ?? null,
  }
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
  const vault = values.vault ?? REPO_ROOT
  const result = feeds(vault, values.env, {
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
