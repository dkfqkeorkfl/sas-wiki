import { rmSync } from 'node:fs'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { inspectVault } from '../document-integrity.mjs'

import { createExampleVault } from '../../test-utils/seed-example-vault.mjs'

import { checkInvariants } from '../document-invariants.mjs'

// 결정성: SOURCE_DATE_EPOCH 를 고정해 generatedAt 을 못 박는다(재빌드 byte-identical 의 전제).
const EPOCH = '1700000000'

const ctx = { first: null, result: null, vault: '' }

beforeAll(() => {
  ctx.vault = createExampleVault()

  ctx.first = process.env.SOURCE_DATE_EPOCH
  process.env.SOURCE_DATE_EPOCH = EPOCH

  // in-process 호출 — 신규 lib(payloads·invariants)이 v8 커버리지에 잡히게 한다(tdd §11).
  // 검사기는 reportDir를 지정하지 않으면 파일을 쓰지 않으므로 결정성은 in-memory payload 2회 조립으로 대조한다(구: out1·out2).
  ctx.result = inspectVault({ vault: ctx.vault })
})

afterAll(() => {
  if (ctx.first === undefined) delete process.env.SOURCE_DATE_EPOCH
  else process.env.SOURCE_DATE_EPOCH = ctx.first
  for (const dir of [ctx.vault]) if (dir) rmSync(dir, { force: true, recursive: true })
})
describe('생성 상태의 문서 검사', () => {
  it('불변식 7종을 지킨다', () => {
    const { body, feeds, summary } = ctx.result

    expect(() => checkInvariants(summary, feeds, body)).not.toThrow()
  })
})
