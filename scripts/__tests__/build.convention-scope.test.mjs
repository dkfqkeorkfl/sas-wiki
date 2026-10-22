// 파싱·생성·피드의 실제 기능 결과를 확인한다.
import { mkdirSync, writeFileSync } from 'node:fs'

import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { parsePayloads } from '../test-utils/vaultPayloads.mjs'

import { cleanup, feedCommit, git, initVault, writeDoc } from './helpers/tmp-git-vault.mjs'

const ID_A = '0192a000-0000-7000-8000-0000000000aa'

const ID_B = '0192b000-0000-7000-8000-0000000000bb'

const ID_C = '0192c000-0000-7000-8000-0000000000cc'

// FP4 전용 본문 — 서로 겹치는 줄이 없어야 `--find-renames` 가 A+D 를 rename 으로 합치지 않는다.
const BODY_B = [
  '## 정의',
  '',
  '고대역폭 메모리 적층 공정의 열 관리 지표를 다룬다.',
  '접합부 온도, 열저항, 냉각 유로 설계가 핵심 변수다.',
  '',
  '## 배경',
  '',
  '적층 단수가 늘수록 중간층 방열 경로가 길어진다.',
].join('\n')

const BODY_C = [
  '## 개요',
  '',
  '파운드리 선단 노드의 수율 곡선과 학습률을 정리한 문서.',
  '초기 램프업 구간에서 결함 밀도가 지수적으로 감소한다.',
  '',
  '## 지표',
  '',
  '웨이퍼당 다이 수, 결함 밀도, 파라메트릭 수율을 함께 본다.',
].join('\n')

/** author-date 를 명시 주입하는 일반 커밋. */
function commitAt(vault, message, date) {
  git(vault, ['add', '-A'])
  git(vault, ['commit', '--no-gpg-sign', '-m', message], {
    GIT_AUTHOR_DATE: date,
    GIT_COMMITTER_DATE: date,
  })
  return git(vault, ['rev-parse', 'HEAD'])
}

/** 위키 **밖** 파일 — frontmatter 가 없어 문서로 해석되지 않는다(README·docs/*). */
function writePlain(vault, relPath, text) {
  const full = path.join(vault, ...relPath.split('/'))
  mkdirSync(path.dirname(full), { recursive: true })
  writeFileSync(full, text, 'utf8')
}

describe('CN3 — 위키 밖에서 삭제된 .md 가 문서 후보 게이트를 통과할 때의 계상 (잔여 pin)', () => {
  it('CN3: unresolved(시끄러움)가 아니라 prune(조용함)으로 계상한다 — 결정된 동작을 못박는다', () => {
    // tdd §3.3 CN3 · plan F-5. 삭제 수집이 `.md` 전량으로 넓어지면 위키 **밖** 삭제 경로도
    // `everDeletedPaths` 에 들어가고, 문서 후보 게이트(`everWikiPaths ∪ everDeletedPaths`)를 통과한다.
    // 메인 세션 결정 = **(a) prune 으로 pin**(코드 변경 0). 근거: ① 실 리포에서 도달 불가능(기존 `feed:`
    // 커밋 6건은 전부 위키 경로만 건드린다) ② 어차피 `docs.length === 0` 이면 피드가 드랍되므로 관측
    // 차이는 통계 수치뿐 ③ 이 코드 경로 자체가 F-2(이중 빌더 통합)에서 소멸한다.
    // **미정으로 두지 않는다** — 미정이면 나중에 누가 바꿔도 아무도 모른다.
    const vault = initVault()
    try {
      writeDoc(vault, 'company/삼성', { id: ID_A, wikiRoot: 'wiki' })
      commitAt(vault, 'chore: 삼성 생성', '2026-01-01T00:00:00Z')
      writePlain(vault, 'docs/폐기.md', '# 폐기 예정 메모\n\n초안이다.\n')
      commitAt(vault, 'chore: 폐기 메모 초안', '2026-01-02T00:00:00Z')

      writeDoc(vault, 'company/삼성', {
        body: '## 정의\n\n정리 갱신.\n',
        id: ID_A,
        wikiRoot: 'wiki',
      })
      writePlain(vault, 'docs/폐기.md', '# 폐기 예정 메모\n\n초안을 갱신했다.\n')
      feedCommit(vault, { date: '2026-01-03T00:00:00Z', subject: '정리 소식' })

      git(vault, ['rm', '-q', 'docs/폐기.md'])
      commitAt(vault, 'chore: 폐기 메모 제거', '2026-01-04T00:00:00Z')

      const result = parsePayloads({ env: 'dev', vault })

      expect(result.feeds.items).toHaveLength(1)
      expect(result.feeds.items[0].docs.map((doc) => doc.id)).toEqual([ID_A])
      expect(result.stats.unresolvedPaths).toEqual([])
      expect(result.stats.prunedDocRefs).toBe(1) // ← pin: prune 쪽에 계상된다
      expect(result.stats.prunedFeeds).toBe(0) // 위키 문서 1건이 살아 있으므로 피드는 드랍되지 않는다
    } finally {
      cleanup(vault)
    }
  })
})
