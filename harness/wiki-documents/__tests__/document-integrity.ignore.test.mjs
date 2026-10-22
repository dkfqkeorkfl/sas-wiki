import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { cleanup } from '../../test-utils/tmp-git-vault.mjs'
import { seedCleanVault } from '../../test-utils/polluted-vault.mjs'
import { inspectVault } from '../document-integrity.mjs'

const tmps = []
afterAll(() => cleanup(...tmps))

describe('억제 목록의 문서 검사 정책', () => {
  it('존재하지 않는 피드의 억제는 성공을 유지하며 stale 경고를 남긴다', () => {
    const { vault } = seedCleanVault()
    tmps.push(vault)
    const before = inspectVault({ vault, env: 'dev' })
    writeFileSync(
      path.join(vault, 'ignore-feeds.json'),
      JSON.stringify([{ id: '000000000000', when: '2026-07-23T00:00:00Z' }]),
    )
    const after = inspectVault({ vault, env: 'dev' })
    expect(after.feeds.items).toEqual(before.feeds.items)
    expect(after.stats.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ reason: expect.stringMatching(/stale/), sha: '000000000000' }),
      ]),
    )
  })

  it.each(['{', '[{"id":"ABC"}]'])('신뢰할 수 없는 억제 파일 %s는 실패한다', (text) => {
    const { vault } = seedCleanVault()
    tmps.push(vault)
    expect(inspectVault({ vault, env: 'dev' }).summary.docs.length).toBeGreaterThan(0)
    writeFileSync(path.join(vault, 'ignore-feeds.json'), text)
    expect(() => inspectVault({ vault, env: 'dev' })).toThrow(/ignore-feeds/)
  })
})
