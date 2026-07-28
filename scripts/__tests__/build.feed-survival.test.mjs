// @vitest-environment node
//
// P2 · Task 3·6·7 — 검증 경로(`buildContent`)의 생존 판정 · off-convention 제거 · 발행 실패의 침묵 제거
//   tdd §3.3(BE1~BE3) · §3.6(PS1~PS5) · §3.7(IM4)
//
// **P3 Task 9 로 빌더가 하나가 됐다**(`buildFeedItems` 제거 · 검증 경로도 `collectFeedItems` 를 쓴다).
//   작성 당시엔 서빙(`walkFeeds`)·검증(`buildFeedItems`) 두 벌이라 BE2 가 그 격차를 물었고, 지금은
//   같은 코드를 **두 진입점**(`walkFeeds` / `buildContent`)에서 부르는 것이 같은 답을 내는지를 문다.
//   단언은 그대로 두는 것이 맞다 — 배선이 어긋나면(env·headState 주입 실수) 여전히 갈릴 수 있다.
//
// RED 사유(라벨별):
//   BE1·BE2  RED(flip) — 현행 `feed.mjs:140-141` 이 `docs 0` 이면 드랍 + `prunedFeeds++`.
//                        뒤집히는 기존 단언: tdd §4 원장 ②(`feed.test.mjs:326`)·⑬·⑭.
//   BE3      pair       — 생존 규칙이 사유를 `unresolved` 로 뭉개 통과하는 우회를 배제.
//   PS1      RED(flip)  — 현행은 `stats.offConventionCommits` 에 집계한다(원장 ⑦). D-D 는 **제거**다.
//   PS2·PS5  RED        — `stats.unpublishedFeedCommits` seam 부재(현행은 null 로 조용히 버린다).
//   PS3      pin+RED    — 발행 자체는 지금도 통과하는 **pin**(R2 `\s+` 유지). 다만 "0건 리포트" 절은
//                        새 seam 이라 지금 red 다. CX11 이 정규식을 좁히면 pin 절이 뒤집힌다.
//   PS4      RED        — 요약 줄 warnings 항의 관측 표면(§7.4 `stats` 합산 계약).
//   IM4      RED(flip)  — 현행은 fix·normal 둘 다 드랍한다.
//
// 자기참조 공허성(§2.3): 경로·subject·사유는 전부 리터럴이다. 부재 단언 앞에 **위험 실재 앵커**를 둔다.
// 비용(§7.3): CLI 를 spawn 하지 않는다 — `buildContent` 를 import 해 in-process 로 문다.
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { buildContent } from '../validate.mjs'
import { ID_A, T1, T2, seedSurvivalVault } from './helpers/survival-vault.mjs'
import { cleanup, commit, feedCommit, git, initVault, writeDoc } from './helpers/tmp-git-vault.mjs'

const ID_D = '0192d000-0000-7000-8000-0000000000dd' // fix 피드가 가리키는 문서(삭제됨)
const ID_E = '0192e000-0000-7000-8000-0000000000ee' // normal 피드가 가리키는 문서(삭제됨)

/**
 * U+00A0 non-breaking space — `\s` 는 이것도 먹는다(R2 가 유지하기로 한 계약).
 * 보이지 않는 바이트를 소스에 그대로 두지 않고 escape 로 못박는다 — 에디터·포매터가 일반 공백으로
 * 바꿔치면 PS3 이 조용히 공허해진다.
 */
const NBSP = '\u00A0'

const titlesOf = (items) => items.map((item) => item.title)
const docIdsOf = (items, title) =>
  items.find((item) => item.title === title)?.docs.map((doc) => doc.id)

/** 두 빌더 비교용 정규형 — `(feedId, title, docs[].id 정렬)` 튜플. 같은 vault 라 feedId 가 동일하다. */
const tuplesOf = (items) =>
  items
    .map((item) => [
      item.id,
      item.title,
      item.docs
        .map((doc) => doc.id)
        .toSorted()
        .join(','),
    ])
    .toSorted((a, b) => a[0].localeCompare(b[0]))

/**
 * `-m` 이 아니라 **`-F <파일>`** 로 커밋한다 — NBSP(0xC2 0xA0) 같은 바이트가 셸 인용을 거치며
 * 보존되는지에 의존하지 않기 위해서다(tdd §3.6 PS 픽스처 실측 규약).
 */
function commitWithMessageFile(vault, message, date) {
  const messagePath = path.join(tmpdir(), `wiki-red-msg-${process.pid}-${Date.now()}.txt`)
  writeFileSync(messagePath, message, 'utf8')
  git(vault, ['add', '-A'])
  git(vault, ['commit', '--no-gpg-sign', '-F', messagePath], {
    GIT_AUTHOR_DATE: date,
    GIT_COMMITTER_DATE: date,
  })
  return git(vault, ['rev-parse', 'HEAD'])
}

describe('buildContent — 검증 경로의 사유별 생존 (BE1·BE2 🔴RED(flip) · 원장 ②⑬⑭)', () => {
  it('BE1: dev 3건 · 폐기 소식 docs [] · prunedDocRefs 1 · prunedFeeds **정확히 0**', () => {
    const vault = seedSurvivalVault()
    try {
      const { feeds, stats } = buildContent({ env: 'dev', vault })

      expect(feeds.items).toHaveLength(3) // 앵커: 개수가 먼저다
      expect(titlesOf(feeds.items)).toEqual(['폐기 소식', '실험 소식', '공개 소식'])
      expect(docIdsOf(feeds.items, '폐기 소식')).toEqual([])
      expect(stats.prunedDocRefs).toBe(1) // 참조는 걷힌다(요약 줄 의미 보존)
      // **정확 일치**(하한 아님) — "prune 으로 세면서 통과" 를 막는다(P1 CF5 가 실증한 조용한-skip 회귀형).
      expect(stats.prunedFeeds).toBe(0)
    } finally {
      cleanup(vault)
    }
  })

  it('BE2: prod 2건이고 **서빙 빌더(walkFeeds)와 튜플 동치**다 · prunedFeeds 1(실험 소식만)', async () => {
    const { walkFeeds } = await import(new URL('./helpers/walk-feeds.mjs', import.meta.url).href)
    const vault = seedSurvivalVault()
    try {
      const { feeds, stats } = buildContent({ env: 'prod', vault })

      expect(feeds.items).toHaveLength(2)
      expect(titlesOf(feeds.items)).toEqual(['폐기 소식', '공개 소식'])
      expect(titlesOf(feeds.items)).not.toContain('실험 소식')
      expect(stats.prunedFeeds).toBe(1) // draft 배제로 미노출된 1건만
      // ★ 두 빌더 동치 — 같은 vault 이므로 feedId 까지 같아야 한다(D-E 가 규칙을 한 곳에 뒀다는 증거).
      expect(tuplesOf(feeds.items)).toEqual(tuplesOf(walkFeeds(vault, { count: 50, env: 'prod' })))
    } finally {
      cleanup(vault)
    }
  })

  it('BE3: dev·prod 어느 쪽에서도 unresolvedPaths 가 []다(사유를 unresolved 로 뭉개는 우회 배제 · pair)', () => {
    // 사유를 `unresolved` 로 흘리면 `checkFeedResolution` 이 throw 해야 하고, throw 를 피하려고
    //   조용히 삼키면 여기서 잡힌다 — 생존 규칙의 도피로를 막는 짝이다.
    const vault = seedSurvivalVault()
    try {
      expect(buildContent({ env: 'dev', vault }).stats.unresolvedPaths).toEqual([])
      expect(buildContent({ env: 'prod', vault }).stats.unresolvedPaths).toEqual([])
    } finally {
      cleanup(vault)
    }
  })
})

describe('buildContent — off-convention 경고 제거 (PS1 🔴RED(flip) · 원장 ⑦ · D-D)', () => {
  it('PS1: 비-`feed:` 위키 커밋은 정상 저작이다 — offConventionCommits 키 자체가 없고 warning 도 없다', () => {
    const vault = initVault()
    try {
      writeDoc(vault, 'company/공개', { id: ID_A, wikiRoot: 'wiki' })
      commit(vault, 'chore: 문서 생성')
      writeDoc(vault, 'company/공개', { body: '## 정의\n\n발행 갱신.\n', id: ID_A, wikiRoot: 'wiki' }) // prettier-ignore
      feedCommit(vault, { date: T1, subject: '발행 소식' })
      // 저작/발행 분리 워크플로 — 위키를 건드리지만 발행하지 않는 **정상** 커밋이다.
      writeDoc(vault, 'company/공개', { body: '## 정의\n\n조용한 손질.\n', id: ID_A, wikiRoot: 'wiki' }) // prettier-ignore
      commit(vault, 'chore: 문서 손질')

      const { feeds, stats } = buildContent({ env: 'dev', vault })

      // ★ 위험 실재 앵커: 픽스처가 비어 있지 않다 — 같은 vault 의 `feed:` 커밋이 피드를 실제로 만들었다.
      expect(titlesOf(feeds.items)).toEqual(['발행 소식'])
      // 키 부재까지 본다 — 빈 배열로 남겨두면 D-D(제거)가 아니라 무력화다.
      expect(Object.hasOwn(stats, 'offConventionCommits')).toBe(false)
      expect(stats.warnings).toEqual([])
    } finally {
      cleanup(vault)
    }
  })
})

describe('buildContent — 발행 실패의 침묵 제거 (PS2·PS3·PS4·PS5 · R2)', () => {
  it('PS2: `feed:` 인데 헤드라인이 없는 커밋은 조용히 사라지지 않고 정확히 1건 리포트된다 (🔴RED)', () => {
    const vault = initVault()
    try {
      writeDoc(vault, 'company/공개', { id: ID_A, wikiRoot: 'wiki' })
      commit(vault, 'chore: 문서 생성')
      writeDoc(vault, 'company/공개', { body: '## 정의\n\n헤드라인 없는 갱신.\n', id: ID_A, wikiRoot: 'wiki' }) // prettier-ignore
      const sha = commit(vault, 'feed:')

      // ★ 위험 실재 앵커: git 이 subject 를 **정확히 `feed:`** 로 보관했는지 먼저 본다. git 은 trailing
      //   space 를 strip 하므로 subject 형태를 추측하지 않는다(tdd §3.6 실측표).
      expect(git(vault, ['log', '-1', '--format=%s'])).toBe('feed:')

      const { feeds, stats } = buildContent({ env: 'dev', vault })

      expect(stats.unpublishedFeedCommits).toHaveLength(1)
      expect(stats.unpublishedFeedCommits[0]).toEqual({ sha, subject: 'feed:' })
      expect(feeds.items).toEqual([]) // 발행되지 않는다(리포트는 되지만 피드는 아니다)
    } finally {
      cleanup(vault)
    }
  })

  it('PS3: `feed:<NBSP>제목` 은 지금도 발행된다(R2 `\\s+` 유지 pin) · 미발행 리포트 0건', () => {
    // 정규식을 `/^feed: +(.+)$/` 로 좁히면 이 커밋이 **아무 진단 없이** 미발행이 된다 — 이 리포가 가장
    //   싫어하는 실패 모드. 첫 두 단언이 그 pin 이고(CX11 이 여기서 red 를 낸다), 마지막 단언은
    //   좁히기가 침묵이 아니라 **리포트**를 낳게 하는 새 seam 이라 지금은 red 다.
    const vault = initVault()
    try {
      writeDoc(vault, 'company/공개', { id: ID_A, wikiRoot: 'wiki' })
      commit(vault, 'chore: 문서 생성')
      writeDoc(vault, 'company/공개', { body: '## 정의\n\nNBSP 갱신.\n', id: ID_A, wikiRoot: 'wiki' }) // prettier-ignore
      commitWithMessageFile(vault, `feed:${NBSP}공백아닌구분자 소식\n`, '1700000060 +0000')

      // 앵커: NBSP 바이트가 커밋 subject 에 실제로 보존됐다(셸/인코딩이 삼키지 않았다).
      expect(git(vault, ['log', '-1', '--format=%s'])).toBe(`feed:${NBSP}공백아닌구분자 소식`)

      const { feeds, stats } = buildContent({ env: 'dev', vault })

      expect(titlesOf(feeds.items)).toEqual(['공백아닌구분자 소식'])
      expect(stats.unpublishedFeedCommits).toEqual([])
    } finally {
      cleanup(vault)
    }
  })

  it('PS4: 미발행 커밋은 요약 줄 warnings 항에 합산된다(§7.4 stats 합산 계약) (🔴RED)', () => {
    // `reportStats` 는 export 되지 않으므로(모듈 로컬) stdout 을 직접 잡을 수 없다 → 그 줄이 세는
    //   **합산 계약**을 stats 로 단언한다. off-convention 이 빠진 자리를 이 항이 잇는다(Task 6 GOTCHA).
    const vault = initVault()
    try {
      writeDoc(vault, 'company/공개', { id: ID_A, wikiRoot: 'wiki' })
      commit(vault, 'chore: 문서 생성')
      writeDoc(vault, 'company/공개', { body: '## 정의\n\n헤드라인 없는 갱신.\n', id: ID_A, wikiRoot: 'wiki' }) // prettier-ignore
      commit(vault, 'feed:')

      expect(git(vault, ['log', '-1', '--format=%s'])).toBe('feed:') // 앵커: 위험이 실재한다

      const { stats } = buildContent({ env: 'dev', vault })

      expect(stats.warnings.length + stats.unpublishedFeedCommits.length).toBeGreaterThanOrEqual(1)
    } finally {
      cleanup(vault)
    }
  })

  it('PS5: 구분자 없는 `feed:제목붙임` 도 같은 불변식으로 잡힌다(두 번째 케이스) (🔴RED)', () => {
    // PS2 하나면 `subject === 'feed:'` 하드코딩으로 통과한다. 이 행이 판정을 **불일치 불변식**
    //   (`startsWith('feed:')` 인데 FEED_SUBJECT_RE 실패)으로 강제한다.
    const vault = initVault()
    try {
      writeDoc(vault, 'company/공개', { id: ID_A, wikiRoot: 'wiki' })
      commit(vault, 'chore: 문서 생성')
      writeDoc(vault, 'company/공개', { body: '## 정의\n\n오타 갱신.\n', id: ID_A, wikiRoot: 'wiki' }) // prettier-ignore
      const sha = commit(vault, 'feed:제목붙임')

      expect(git(vault, ['log', '-1', '--format=%s'])).toBe('feed:제목붙임') // 앵커

      const { feeds, stats } = buildContent({ env: 'dev', vault })

      expect(stats.unpublishedFeedCommits).toHaveLength(1)
      expect(stats.unpublishedFeedCommits[0].sha).toBe(sha)
      expect(feeds.items).toEqual([])
    } finally {
      cleanup(vault)
    }
  })
})

describe('buildContent — importance: fix 의 D9 예외 (IM4 🔴RED(flip))', () => {
  it('IM4: 참조가 전멸한 fix 피드는 드랍되고, 같은 픽스처의 normal 피드는 생존한다', () => {
    // SV6·SV7 의 실 git 통합 대응. **짝 비교**라 "fix 는 항상 드랍"·"항상 생존" 둘 다 배제된다.
    const vault = initVault()
    try {
      writeDoc(vault, 'company/공개', { id: ID_A, wikiRoot: 'wiki' })
      writeDoc(vault, 'concept/정정대상', { id: ID_D, wikiRoot: 'wiki' })
      writeDoc(vault, 'concept/일반대상', { id: ID_E, wikiRoot: 'wiki' })
      commit(vault, 'chore: 초기 문서 3건')

      writeDoc(vault, 'concept/정정대상', { body: '## 정의\n\n정정 갱신.\n', id: ID_D, wikiRoot: 'wiki' }) // prettier-ignore
      feedCommit(vault, { date: T1, importance: 'fix', subject: '정정 알림' })
      writeDoc(vault, 'concept/일반대상', { body: '## 정의\n\n일반 갱신.\n', id: ID_E, wikiRoot: 'wiki' }) // prettier-ignore
      feedCommit(vault, { date: T2, importance: 'normal', subject: '일반 소식' })

      git(vault, ['rm', '-q', 'wiki/concept/정정대상.md', 'wiki/concept/일반대상.md'])
      commit(vault, 'chore: 대상 문서 2건 삭제')

      // ★ 위험 실재 앵커: 그 커밋이 정말 `Importance: fix` 트레일러를 달고 만들어졌다.
      expect(git(vault, ['log', '--format=%s%n%b'])).toContain('Importance: fix')

      const { feeds } = buildContent({ env: 'dev', vault })

      expect(titlesOf(feeds.items)).toContain('일반 소식') // normal + 0 docs → 생존(D9)
      expect(docIdsOf(feeds.items, '일반 소식')).toEqual([])
      expect(titlesOf(feeds.items)).not.toContain('정정 알림') // fix + 0 docs → 드랍(D9 예외)
    } finally {
      cleanup(vault)
    }
  })
})
