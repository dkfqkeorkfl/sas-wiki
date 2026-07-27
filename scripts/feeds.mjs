#!/usr/bin/env node
// feeds 엔드포인트 — 함수 export + CLI 가드 자기완결 파일. pageFeeds 가 억제·정렬·커서·상한을
//   결정하고 여기서는 봉투만 씌운다(로직은 lib/git-walk·parse-vault·payloads 공유부품).
import path from 'node:path'
import { parseArgs } from 'node:util'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { pageFeeds } from './lib/git-walk.mjs'
import { buildWirePayload } from './lib/parse-vault.mjs'
import { buildFeeds } from './lib/payloads.mjs'

// --vault 미지정 시 기본값 = 스크립트 자기 리포 루트(scripts/ 의 상위). cwd 무관(import.meta.url 파생).
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** feeds 기본 상한 — 소비자 DEFAULT_FEED_LIMIT 과 parity(미지정·0 이면 이 값으로 슬라이스). */
const DEFAULT_FEED_LIMIT = 50

/**
 * feeds 엔드포인트 — `env` 를 buildWirePayload 로 배선한다(summary/wiki 와 시그니처 일관) — **prod 는 draft
 * 문서 참조 피드를 제외**한다.
 *
 * @param {string} vault git vault repository root
 * @param {'dev'|'prod'} env
 * @param {{ after?: object|string, count?: number, from?: string, to?: string }} [window]
 */
export function feeds(vault, env = 'prod', window = {}) {
  const parsed = buildWirePayload(vault, env)
  const limit = window.count ?? DEFAULT_FEED_LIMIT
  const { items, nextCursor } = pageFeeds(parsed.items, parsed.ignore, {
    after: window.after,
    limit,
    from: window.from,
    to: window.to,
  })
  return {
    ...buildFeeds({
      generatedAt: parsed.generatedAt,
      items,
      sourceCommit: parsed.sourceCommit,
    }),
    nextCursor,
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
  // `--env` 열거 검증 — `util.parseArgs` 는 choices 를 지원하지 않아 파싱 뒤에 직접 본다.
  //   조용한 prod 폴백은 fail-closed 가 아니라 **silent misconfiguration** 이다: `--env Dev` 오타 하나로
  //   dev 예제를 본다고 믿는 사람이 상용 산출물을 받는다(반대 방향이면 미공개 데이터 누출이다).
  //   미지정은 여전히 prod 다 — 여기서 막는 것은 **오타뿐**이다.
  if (values.env !== 'dev' && values.env !== 'prod') {
    console.error(`알 수 없는 --env 값: "${values.env}" — dev|prod 만 허용합니다`)
    process.exitCode = 2
    return
  }
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
