import { parseVault } from '../lib/parse-vault.mjs'
import { buildBody, buildFeeds, buildSummary } from '../lib/payloads.mjs'

/** 공통 파싱의 결과를 공개 wire 빌더로 투영한다. 감사나 파일 쓰기는 하지 않는다. */
export function parsePayloads({ vault, env = 'prod' }) {
  const { stats, wire } = parseVault(vault, env)
  return {
    body: buildBody({ docs: wire.bodies, sourceCommit: wire.sourceCommit }),
    feeds: {
      ...buildFeeds({
        env,
        generatedAt: wire.generatedAt,
        items: wire.items,
        sourceCommit: wire.sourceCommit,
      }),
      nextCursor: null,
    },
    stats,
    summary: buildSummary({ ...wire, env }),
  }
}
