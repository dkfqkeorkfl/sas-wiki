#!/usr/bin/env node
// summary 엔드포인트 CLI — 얇은 진입점. 로직은 lib/endpoints.summary 가 전부 갖는다(중복 0).
import { parseArgs } from 'node:util'
import { pathToFileURL } from 'node:url'

import { summary } from './lib/endpoints.mjs'

export async function main(argv = process.argv.slice(2)) {
  const { values } = parseArgs({
    allowPositionals: false,
    args: argv,
    options: { env: { default: 'prod', type: 'string' }, vault: { type: 'string' } },
  })
  if (!values.vault) throw new Error('--vault is required')
  process.stdout.write(`${JSON.stringify(summary(values.vault, values.env))}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
