import { describe, expect, it } from 'vitest'
import { feeds } from '../feeds.mjs'
import { summary } from '../lib/summary-endpoint.mjs'
import { cleanup } from './helpers/tmp-git-vault.mjs'
import { CONTROL_FEED_TITLE, CONTROL_REL, ID_A, seedCleanVault } from './helpers/polluted-vault.mjs'

describe('검증된 정상 입력의 조회', () => {
  it.each(['dev', 'prod'])('%s의 문서 경로와 실제 피드 참조를 유지한다', async (env) => {
    const { vault } = seedCleanVault()
    try {
      const payload = summary(vault, env)
      expect(payload.docs.map((doc) => doc.id)).toContain(ID_A)
      expect(payload.docs.map((doc) => doc.breadcrumb.join('/'))).toContain(CONTROL_REL)
      expect(payload.docs).toHaveLength(3)
      const page = await feeds(vault, env, { count: 10 })
      expect(page.items.map((item) => item.title)).toEqual([CONTROL_FEED_TITLE])
      expect(page.items[0].docs).toEqual([{ id: ID_A }])
    } finally {
      cleanup(vault)
    }
  })
})
