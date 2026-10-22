import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'

import { cleanup } from '../../test-utils/tmp-git-vault.mjs'
import { seedCleanVault } from '../../test-utils/polluted-vault.mjs'
import { inspectVault } from '../document-integrity.mjs'

const schemaDir = fileURLToPath(new URL('../../../scripts/schema/', import.meta.url))
const tmps = []
afterAll(() => cleanup(...tmps))

function schemaCopy(name, keys) {
  const dir = mkdtempSync(path.join(tmpdir(), 'wiki-inspector-schema-'))
  tmps.push(dir)
  cpSync(schemaDir, dir, { recursive: true })
  const file = path.join(dir, name)
  const schema = JSON.parse(readFileSync(file, 'utf8'))
  for (const key of keys) {
    schema.properties[key] ??= {}
    if (!schema.required.includes(key)) schema.required.push(key)
  }
  writeFileSync(file, JSON.stringify(schema))
  return dir
}

describe('검사기가 실제 조립한 payload와 주입한 스키마의 계약', () => {
  it('제거된 필드를 각각 요구하면 누락을 거부한다', () => {
    const { vault } = seedCleanVault()
    tmps.push(vault)
    const control = inspectVault({
      vault,
      env: 'dev',
      schema: schemaCopy('summary.schema.json', []),
    })
    expect(control.summary.docs.length).toBeGreaterThan(0)
    // 두 필드를 함께 요구하면 하나의 부활을 다른 필드의 누락이 가릴 수 있다.
    for (const key of ['producer', ['inputs', 'Fingerprint'].join('')]) {
      const schema = schemaCopy('summary.schema.json', [key])
      expect(() => inspectVault({ vault, env: 'dev', schema })).toThrow(new RegExp(key))
    }
  })

  it('feeds 봉투의 환경과 커서를 필수로 검사한다', () => {
    const { vault } = seedCleanVault()
    tmps.push(vault)
    const schema = schemaCopy('feeds.schema.json', ['env', 'nextCursor'])
    const result = inspectVault({ vault, env: 'dev', schema })
    expect(result.feeds).toHaveProperty('env', 'dev')
    expect(result.feeds).toHaveProperty('nextCursor', null)
  })
})
