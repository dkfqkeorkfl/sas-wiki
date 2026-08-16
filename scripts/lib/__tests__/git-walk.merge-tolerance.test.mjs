// @vitest-environment node
//
// P1 · RED — 병합 내성 (tdd §3.2 MG1·MG3 — MG2 는 아래 사유로 제거됐다)
//
// 이 파일이 무는 것: 병합 커밋이 있는 히스토리에서 `walkFeeds` 가 문서 연결(docs[])을 통째로
//   잃는 결함(MG1). 현행 코드로 **직접 관측**됐다(재현: `docs.length === 0` 이면 항목 통째 드랍).
//   추측이 아니다.
//
// RED 사유(MG1):
//   · 라벨 **RED(root)**: 픽스처가 마지막에 `git mv vault/wiki wiki` 를 하므로, GREEN 이전에는
//     `loadHeadDocs` 가 `<vault>/vault/wiki` 를 스캔해 **HEAD 문서 0건** → 전 피드 resolve 실패로
//     빈 배열이 된다(모듈 레벨 사유).
//   · 케이스 고유의 물림(병합 문서 연결)은 GREEN 이후 §5 반사실 **CF2** 가 증명한다.
//     CF2 = `{ diffMerges: 'first-parent' }` 만 제거 → MG1 만 red.
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

describe('walkFeeds — 병합 커밋 내성 (MG1)', () => {
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

  // MG2 제거됨 — 원래 "`count: 1` 커서 페이징이 전량을 돌려준다"를 `walkFeeds`(위 import, 수집 전용
  //   참조 구현)로 검증했으나, 그 `walkFeeds`가 자체 합성하는 페이지(`from`/`to`/`count`/`after`/
  //   `nextCursor`)는 **어떤 프로덕션 파일도 import 하지 않는다**(`__tests__/helpers/walk-feeds.mjs`
  //   자신의 파일 머리말이 그렇게 선언한다 — 프로덕션 조회는 `lib/feed-cursor.mjs` 의
  //   `walkCursorPage`로 완전히 대체됐다). 실측 확인(2건, 원복 완료):
  //     ① `walkCursorPage` 를 통째로 무력화해도 이 파일 3케이스는 전부 green 을 유지했다
  //        (같은 대상을 물지 않는다는 뜻).
  //     ② MG2 원본은 "50회 가드 소진 전까지 `nextCursor` 가 null 이 됐는가"를 단언하지 않았다 —
  //        `nextCursor` 가 영영 null 이 안 되도록 변이해도(=페이지네이션이 끝을 못 찾는 결함이
  //        있어도) 개수·중복·순서 단언은 그대로 green 이었다(가드 소진을 "정상 종료"와 구분하지
  //        못한다).
  //   대체안(진짜 프로덕션 경로 — `scripts/feeds.mjs` 의 `feeds()` → `walkCursorPage`)으로 이
  //   시나리오(병합 커밋 + `count`가 작은 반복 페이징)를 직접 실행해 본 결과, 페이지네이션이
  //   실제로 **10건 중 7건에서 `nextCursor: null`(히스토리 끝)을 조기 신고**하고 나머지 3건(병합
  //   이전 main 브랜치 feed)을 소실했다(재현: count=1·2·3·5 전부 동일하게 7에서 멈춤, 반면
  //   `feeds(vault,'dev',{count:99})` 단발 호출은 10건 전부를 정확히 낸다 — 문제는 배치 간 커서
  //   연속 특유의 것이다). 이것은 `lib/feed-cursor.mjs`(`walkCursorPage`/`revListBatch`)의 실제
  //   결함으로 보이지만, 그 파일은 이 배치의 편집 대상이 아니다 — 여기서 조용히 우회하거나 단언을
  //   약화해 덮지 않고, 이 파일에서는 **해당 항목을 삭제**하고 발견 사실만 기록해 별도 처리로
  //   넘긴다.
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
