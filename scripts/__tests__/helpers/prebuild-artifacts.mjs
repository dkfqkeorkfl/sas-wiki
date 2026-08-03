import path from 'node:path'
import { existsSync } from 'node:fs'

import { feedsArtifactPath } from '../../lib/artifact.mjs'
import { runFeedsGenerator, runSummaryGenerator } from '../../lib/generator.mjs'

export function summaryArtifactPath(vault, env = 'dev') {
  return path.join(vault, 'cache', `summary.${env}.json`)
}

/**
 * **tmp vault 전용이다.** 실 repo 를 `vault` 로 주면 죽는다 — 이 함수는 러너 프로세스 안에서 git 을
 * 부르는데, `vitest.config.js` 가 `GIT_CONFIG_GLOBAL=/dev/null` 로 git 설정을 격리하므로(의도된 격리)
 * 소유자가 러너와 다른 실 repo 에서는 `safe.directory` 예외를 못 봐 dubious ownership 으로 거부된다.
 * 실 repo 산출물이 필요하면 `safe.directory=*` 를 자식 env 로 주입하는 **CLI spawn** 을 써라
 * (`cli-contract.test.mjs` 의 `runCli` 기반 프리빌드가 그 형태다). tmp vault 사용처는 무해하다.
 */
export async function prebuildArtifacts(vault, env = 'dev', options = {}) {
  const artifactPath = options.artifactPath ?? summaryArtifactPath(vault, env)
  const summary = await runSummaryGenerator({ ...options, artifactPath, env, vault })
  const feedsPath = options.feedsArtifactPath ?? feedsArtifactPath(vault, env)
  const feeds = await runFeedsGenerator({ ...options, artifactPath: feedsPath, env, vault })
  if (!existsSync(artifactPath)) {
    throw new Error(`summary 아티팩트 생성 실패: ${artifactPath}`)
  }
  if (!existsSync(feedsPath)) {
    throw new Error(`feeds 아티팩트 생성 실패: ${feedsPath}`)
  }
  return { ...summary, feedsArtifactPath: feedsPath, feedsPayload: feeds.payload }
}
