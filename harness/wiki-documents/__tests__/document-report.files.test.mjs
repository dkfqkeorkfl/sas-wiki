import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'

import { tmpdir } from 'node:os'

import path from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { inspectVault } from '../document-integrity.mjs'

import { createExampleVault } from '../../test-utils/seed-example-vault.mjs'

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

describe('실 vault ⑧ --out 리포트 파일 쓰기(in-memory 만 검증하면 쓰기 회귀가 안 보인다)', () => {
  // 이 파일의 다른 모든 단언은 `ctx.result`(reportDir 없이 조립한 in-memory payload)만 본다 —
  //   그래서 `--out` 이 실제로 디스크에 파일을 남기는지는 이 파일 어디에서도 확인되지 않았다
  //   (416줄에 `existsSync` 가 0건이었다). 파일쓰기 경로가 통째로 회귀해도(예: 쓰기 호출이
  //   조용히 no-op 이 되어도) exit/반환값만으로는 잡히지 않는다 — 실재를 직접 본다.
  let outDir
  let write

  beforeAll(() => {
    outDir = mkdtempSync(path.join(tmpdir(), 'wiki-vault-out-'))
    ;({ report: write } = inspectVault({ reportDir: outDir, vault: ctx.vault }))
  })

  afterAll(() => {
    rmSync(outDir, { force: true, recursive: true })
  })

  it('report.jsonPath · report.txtPath 가 실제로 디스크에 쓰인다', () => {
    expect(write.error).toBeNull()
    expect(existsSync(write.jsonPath), write.jsonPath).toBe(true)
    expect(existsSync(write.txtPath), write.txtPath).toBe(true)
  })

  it('쓰인 json 리포트는 이번 실행의 sourceCommit 을 담는다(빈 파일이 통과하는 것을 막는다)', () => {
    const written = JSON.parse(readFileSync(write.jsonPath, 'utf8'))

    expect(written.sourceCommit).toBe(ctx.result.summary.sourceCommit)
  })
})
