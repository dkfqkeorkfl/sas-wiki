#!/usr/bin/env node
import { parseArgs } from 'node:util'
import { pathToFileURL } from 'node:url'

import { feeds, summary, wiki } from './lib/endpoints.mjs'

export async function main(argv = process.argv.slice(2)) {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    args: argv,
    options: {
      after: { type: 'string' },
      count: { type: 'string' },
      env: { default: 'prod', type: 'string' },
      from: { type: 'string' },
      path: { type: 'string' },
      to: { type: 'string' },
      vault: { type: 'string' },
    },
  })
  const command = positionals[0]
  if (!values.vault) throw new Error('--vault is required')

  let result
  if (command === 'summary') {
    result = summary(values.vault, values.env)
  } else if (command === 'feeds') {
    result = feeds(values.vault, values.env, {
      after: values.after ? JSON.parse(values.after) : undefined,
      count: values.count === undefined ? undefined : Number.parseInt(values.count, 10),
      from: values.from,
      to: values.to,
    })
  } else if (command === 'wiki') {
    result = wiki(values.vault, values.env, values.path ?? '')
  } else {
    throw new Error('Usage: node scripts/wiki-serve.mjs summary|feeds|wiki --vault <repo> [--env dev|prod] [--from <iso>] [--to <iso>] [--count <n>] [--after <json>] [--path <path>]')
  }

  process.stdout.write(`${JSON.stringify(result)}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
