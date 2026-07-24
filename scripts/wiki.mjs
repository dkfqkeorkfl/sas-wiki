#!/usr/bin/env node
// wiki 엔드포인트 CLI — 얇은 진입점. per-doc git read+render 로직은 lib/endpoints.wiki 가 갖는다.
import { parseArgs } from 'node:util'
import { pathToFileURL } from 'node:url'

import { wiki } from './lib/endpoints.mjs'

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
  if (!values.vault) throw new Error('--vault is required')
  process.stdout.write(`${JSON.stringify(wiki(values.vault, values.env, values.path ?? ''))}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
