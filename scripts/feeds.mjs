#!/usr/bin/env node
// feeds 엔드포인트 CLI — 얇은 진입점. 억제·정렬·커서·상한 로직은 lib/endpoints.feeds→walkFeeds 가 갖는다.
import { parseArgs } from 'node:util'
import { pathToFileURL } from 'node:url'

import { feeds } from './lib/endpoints.mjs'

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
  if (!values.vault) throw new Error('--vault is required')
  const result = feeds(values.vault, values.env, {
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
