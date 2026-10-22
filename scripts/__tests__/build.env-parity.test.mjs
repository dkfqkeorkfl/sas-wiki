// 파싱·생성·피드의 실제 기능 결과를 확인한다.
import { describe, expect, it } from 'vitest'

import { parsePayloads } from '../test-utils/vaultPayloads.mjs'

import { cleanup, feedCommit, git, initVault, writeDoc } from './helpers/tmp-git-vault.mjs'

const ID_A = '0192a000-0000-7000-8000-0000000000aa'
// 공개 문서
const ID_B = '0192b000-0000-7000-8000-0000000000bb'
// draft 문서(`dev/` 폴더 백스톱)

const titlesOf = (items) => items.map((item) => item.title)

function commitAt(vault, message, date) {
  git(vault, ['add', '-A'])
  git(vault, ['commit', '--no-gpg-sign', '-m', message], {
    GIT_AUTHOR_DATE: date,
    GIT_COMMITTER_DATE: date,
  })
  return git(vault, ['rev-parse', 'HEAD'])
}

/** EP-BASE — 공개 문서 1 · draft 문서 1 · 각각을 가리키는 `feed:` 1건씩. */
function seedEnvVault(wikiRoot) {
  const vault = initVault()
  writeDoc(vault, 'company/삼성', { id: ID_A, wikiRoot })
  commitAt(vault, 'chore: 삼성 생성', '2026-01-01T00:00:00Z')
  writeDoc(vault, 'dev/실험', { id: ID_B, wikiRoot })
  commitAt(vault, 'chore: 실험 생성', '2026-01-02T00:00:00Z')

  writeDoc(vault, 'company/삼성', { body: '## 정의\n\n공개 갱신.\n', id: ID_A, wikiRoot })
  feedCommit(vault, { date: '2026-01-03T00:00:00Z', subject: '공개 소식' })

  writeDoc(vault, 'dev/실험', { body: '## 정의\n\ndraft 갱신.\n', id: ID_B, wikiRoot })
  feedCommit(vault, { date: '2026-01-04T00:00:00Z', subject: 'draft 소식' })
  return vault
}

describe('env parity — dev·prod 가 실제로 갈린다 (EP1·EP2)', () => {
  it('EP1: dev 는 draft 를 포함해 피드 2건 · prune 0 · warning 0', () => {
    // EP2 의 **대조군** — 두 수치가 env 에 따라 실제로 갈리는지를 보여 "항상 0" 또는 "항상 prune"
    // 구현을 배제한다.
    const vault = seedEnvVault('wiki')
    try {
      const result = parsePayloads({ env: 'dev', vault })

      expect(result.summary.docs).toHaveLength(2)
      expect(result.feeds.items).toHaveLength(2)
      expect(titlesOf(result.feeds.items)).toEqual(['draft 소식', '공개 소식'])
      expect(result.stats.prunedDocRefs).toBe(0)
      expect(result.stats.prunedFeeds).toBe(0)
      expect(result.stats.warnings).toEqual([])
    } finally {
      cleanup(vault)
    }
  })

  it('EP2: prod 는 draft 피드를 **설명된 prune** 으로 떨군다(warning 이 아니다)', () => {
    // `everWikiPaths` 구성의 핵심 가드. `pathIndex.keys()` 만으로 만들면 draft 경로가 문서 후보에서
    // 빠져 그 피드가 "문서 0개" warning 으로 떨어진다 — `warnings` `[]` 가 그것을 잡는다.
    const vault = seedEnvVault('wiki')
    try {
      const result = parsePayloads({ env: 'prod', vault })

      expect(result.summary.docs).toHaveLength(1)
      expect(result.feeds.items).toHaveLength(1)
      expect(titlesOf(result.feeds.items)).toEqual(['공개 소식'])
      expect(result.stats.prunedDocRefs).toBe(1)
      expect(result.stats.prunedFeeds).toBe(1)
      expect(result.stats.warnings).toEqual([])
    } finally {
      cleanup(vault)
    }
  })
})

describe('env parity × 루트 이관의 교차 (EP3)', () => {
  it('EP3: 이관한 vault 의 prod 수치가 미이관 vault(EP2)와 동일하다', () => {
    // draft 문서의 좌표가 rename 계보(`buildPathIndex(headDocs)`)를 포함하지 않으면 **여기서만** red 다:
    // 이관 전 경로로 기록된 draft 피드가 "설명되지 않은 참조"가 되어 빌드를 죽인다.
    const vault = seedEnvVault('vault/wiki')
    try {
      git(vault, ['mv', 'vault/wiki', 'wiki'])
      commitAt(vault, 'chore: 문서 루트 이관', '2026-06-01T00:00:00Z')

      const result = parsePayloads({ env: 'prod', vault })

      expect(result.summary.docs).toHaveLength(1)
      expect(result.feeds.items).toHaveLength(1)
      expect(titlesOf(result.feeds.items)).toEqual(['공개 소식'])
      expect(result.stats.prunedDocRefs).toBe(1)
      expect(result.stats.prunedFeeds).toBe(1)
      expect(result.stats.warnings).toEqual([])
    } finally {
      cleanup(vault)
    }
  })
})
