// @vitest-environment node
//
// P1 · RED — 병합 내성 (tdd §3.2 MG1~MG3)
//
// 이 파일이 무는 것: 병합 커밋이 있는 히스토리에서 `walkFeeds` 가 **항목을 통째로 잃거나**
//   **커서 페이징이 절반만 돌려주는** 결함. 둘 다 tdd §2.4 에서 현행 코드로 **직접 관측**됐다
//   (10건 중 9건 · 페이징 누적 5건). 추측이 아니다.
//
// RED 사유 — 두 겹이다(tdd §2.2 라벨 규약):
//   · 라벨 **RED(root)**: 픽스처가 마지막에 `git mv vault/wiki wiki` 를 하므로, GREEN 이전에는
//     `loadHeadDocs` 가 `<vault>/vault/wiki` 를 스캔해 **HEAD 문서 0건** → 전 피드 resolve 실패로
//     빈 배열이 된다(모듈 레벨 사유).
//   · 케이스 고유의 물림(병합 문서 연결 · 페이징 전량)은 GREEN 이후 §5 반사실 **CF2·CF3** 가 증명한다.
//     CF2 = `{ diffMerges: 'first-parent' }` 만 제거 → MG1 만 red. CF3 = 청크 루프 복원 → MG2 만 red.
//
// 픽스처 규약(tdd §6.3):
//   · 브랜치명을 **명시**한다 — vitest env 가 `GIT_CONFIG_GLOBAL=/dev/null` 이라 `init.defaultBranch`
//     가 없어 기본 브랜치명이 환경에 따라 다르다(실측: `master`). `rev-parse --abbrev-ref` 로 받아 쓴다.
//   · 병합 커밋의 author-date 도 **명시 주입**한다. 안 하면 `--author-date-order` 가 환경 시계에 좌우된다.
//   · 양쪽 브랜치가 **서로 다른 문서**를 건드려 병합이 어느 부모에도 TREESAME 이 아니게 만든다.
//     한쪽만 건드리면 history simplification 이 병합을 지워 픽스처가 의도한 상황을 재현하지 못한다.
//   · `execFileSync('git', …)` 를 직접 부르지 않는다 — 헬퍼 `git()` 이 identity 를 주입한다.
//
// 규범 A: 경로는 전부 리터럴이다(`'vault/wiki'` · `'wiki'`). 구현 상수에서 만들지 않는다.
import { describe, expect, it } from 'vitest'

import {
  cleanup,
  feedCommit,
  git,
  initVault,
  writeDoc,
} from '../../__tests__/helpers/tmp-git-vault.mjs'
import { walkFeeds } from '../../__tests__/helpers/walk-feeds.mjs'

// 유효 UUIDv7(스키마 pattern 준수) — 문서 정체성.
const ID_A = '0192a000-0000-7000-8000-0000000000aa'
const ID_B = '0192b000-0000-7000-8000-0000000000bb'
const ID_C = '0192c000-0000-7000-8000-0000000000cc'

const titlesOf = (items) => items.map((item) => item.title)

/** 이관 **전** 루트에 문서를 쓴다 — 리터럴 `'vault/wiki'`(규범 A · 헬퍼 기본값에 기대지 않는다). */
function writeOldDoc(vault, rel, options) {
  return writeDoc(vault, rel, { ...options, wikiRoot: 'vault/wiki' })
}

/** author-date 를 명시 주입하는 일반 커밋(헬퍼 `commit` 은 자동 tick 이라 순서를 통제할 수 없다). */
function commitAt(vault, message, date) {
  git(vault, ['add', '-A'])
  git(vault, ['commit', '--no-gpg-sign', '-m', message], {
    GIT_AUTHOR_DATE: date,
    GIT_COMMITTER_DATE: date,
  })
  return git(vault, ['rev-parse', 'HEAD'])
}

/** 문서를 건드리는 `feed:` 커밋(본문에 subject 를 심어 빈 커밋을 피한다). */
function feedOn(vault, rel, id, subject, date) {
  writeOldDoc(vault, rel, { body: `## 정의\n\n${subject} 갱신.\n`, id })
  return feedCommit(vault, { date, subject })
}

/**
 * MG-BASE — 문서 3건 · main 에 feed 3건(a) · topic 에 feed 4건(b·c) · 병합 1건 · 병합 위 feed 2건(a)
 * → `git mv vault/wiki wiki`. 병합 제목만 바꿔 MG1·MG2(피드 병합)와 MG3(비-feed 병합)를 가른다.
 */
function seedMergeVault(mergeSubject) {
  const vault = initVault()
  writeOldDoc(vault, 'company/a', { id: ID_A })
  writeOldDoc(vault, 'company/b', { id: ID_B })
  writeOldDoc(vault, 'company/c', { id: ID_C })
  const seed = commitAt(vault, 'chore: 초기 문서 3건', '2026-01-01T00:00:00Z')
  const mainBranch = git(vault, ['rev-parse', '--abbrev-ref', 'HEAD'])

  feedOn(vault, 'company/a', ID_A, '본선 소식 1', '2026-01-02T00:00:00Z')
  feedOn(vault, 'company/a', ID_A, '본선 소식 2', '2026-01-03T00:00:00Z')
  feedOn(vault, 'company/a', ID_A, '본선 소식 3', '2026-01-04T00:00:00Z')

  git(vault, ['checkout', '-q', '-b', 'topic', seed])
  feedOn(vault, 'company/b', ID_B, '지선 소식 1', '2026-01-05T00:00:00Z')
  feedOn(vault, 'company/b', ID_B, '지선 소식 2', '2026-01-06T00:00:00Z')
  feedOn(vault, 'company/c', ID_C, '지선 소식 3', '2026-01-07T00:00:00Z')
  feedOn(vault, 'company/c', ID_C, '지선 소식 4', '2026-01-08T00:00:00Z')

  git(vault, ['checkout', '-q', mainBranch])
  git(vault, ['merge', '--no-ff', 'topic', '-m', mergeSubject], {
    GIT_AUTHOR_DATE: '2026-01-09T00:00:00Z',
    GIT_COMMITTER_DATE: '2026-01-09T00:00:00Z',
  })

  feedOn(vault, 'company/a', ID_A, '후속 소식 1', '2026-01-10T00:00:00Z')
  feedOn(vault, 'company/a', ID_A, '후속 소식 2', '2026-01-11T00:00:00Z')

  git(vault, ['mv', 'vault/wiki', 'wiki'])
  commitAt(vault, 'chore: 문서 루트 이관', '2026-06-01T00:00:00Z')
  return vault
}

describe('walkFeeds — 병합 커밋 내성 (MG1·MG2)', () => {
  it('MG1: `feed:` 제목 병합 커밋이 항목으로 살아남고 **문서 연결까지** 보존된다', () => {
    // 실측 결함(tdd §2.4): 현행은 `git show --name-status` 의 기본값(dense-combined)이 평범한 병합에서
    // **0줄**이라 병합 항목의 docs 가 비고, `docs.length === 0` 이면 항목이 통째로 드랍된다(10→9건).
    const vault = seedMergeVault('feed: 병합 소식')
    try {
      const items = walkFeeds(vault, { count: 99, env: 'dev' })
      const merged = items.find((item) => item.title === '병합 소식')

      // 규범 B: 카운트 하한을 **먼저** 통과시킨다(픽스처가 비면 아래 부재/존재 단언이 공허해진다).
      expect(items).toHaveLength(10)
      expect(merged).toBeDefined()
      // "항목은 살았는데 연결은 빈" 반쪽 구현을 통과시키지 않는다.
      expect(merged.docs.map((doc) => doc.id).toSorted()).toEqual([ID_B, ID_C])
    } finally {
      cleanup(vault)
    }
  })

  it('MG2: `count: 1` 커서 페이징이 전량을 돌려준다(중복 0 · 전량 호출과 순서 동일)', () => {
    // 실측 결함(tdd §2.4): 청크 루프의 `tip = at(-1).hash + '^'` 가 first-parent 만 따라가 topic 쪽
    // 4건이 통째로 소실된다(누적 10→5건).
    const vault = seedMergeVault('feed: 병합 소식')
    try {
      const collected = []
      let cursor = null
      let guard = 0
      do {
        const page = walkFeeds(vault, { after: cursor, count: 1, env: 'dev' })
        collected.push(...page)
        cursor = page.nextCursor
        guard += 1
      } while (cursor !== null && guard < 50)

      expect(collected).toHaveLength(10)
      // "중복으로 개수만 채우는" 구현을 배제한다.
      expect(new Set(collected.map((item) => item.id)).size).toBe(10)
      expect(titlesOf(collected)).toEqual(titlesOf(walkFeeds(vault, { count: 99, env: 'dev' })))
    } finally {
      cleanup(vault)
    }
  })
})

describe('walkFeeds — 비-feed 병합은 피드가 아니다 (MG3 짝 가드)', () => {
  it('MG3: `Merge branch topic` 병합은 항목을 만들지 않고, 나머지 건수는 유지된다', () => {
    // `diffMerges` 를 켜면서 **subject 필터까지 느슨해지는** 과잉 구현을 red 로 만든다.
    // 총 건수 유지 단언이 짝이라 "전부 버려서 0건"으로는 통과할 수 없다.
    const vault = seedMergeVault('Merge branch topic')
    try {
      const items = walkFeeds(vault, { count: 99, env: 'dev' })

      expect(items).toHaveLength(9)
      expect(titlesOf(items).filter((title) => title.includes('Merge'))).toEqual([])
    } finally {
      cleanup(vault)
    }
  })
})
