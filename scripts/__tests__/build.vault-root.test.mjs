// @vitest-environment node
//
// P1 · RED — 문서 루트 이관 등가 · 삭제 이력 (tdd §3.1 MV1~MV5 · §3.4 DL1·DL2)
//
// 이 파일이 무는 것: `vault/wiki/` → `wiki/` 이관이 **과거 피드를 파괴하지 않는다**는 것.
//   PRD Success Metric("이관 전후 피드 생존 · docs 연결 동일")의 헤르메틱 표현이다.
//
// **두 진입점을 다 문다**(tdd §3.0): `git-walk.mjs walkFeeds`(서빙)와 `buildContent`(검증) 두 경로가
//   같은 이관 vault 에 같은 답을 내는지 본다. 작성 당시엔 두 경로가 **서로 다른 빌더**였고(P3 Task 9 가
//   `buildFeedItems` 를 제거해 `collectFeedItems` 하나로 통합), 지금은 같은 빌더를 다른 배선으로 부른다.
//   짝(MV1=walkFeeds · MV2=buildContent)을 유지하는 이유는 배선 자체가 어긋날 수 있기 때문이다.
//
// RED 사유 — 라벨별로 다르다(tdd §2.2):
//   · MV1·MV2·MV3·DL1 = **RED(root)**: `loadHeadDocs`·`parseVault` 가 `<vault>/vault/wiki` 를 스캔하므로
//     이관 후 **HEAD 문서 0건** → 피드가 전부 resolve 실패한다(walkFeeds 는 빈 배열, buildContent 는
//     `checkFeedResolution` 이 throw). 케이스 고유의 물림은 GREEN 이후 §5 CF1·CF5 가 증명한다.
//   · MV4 = **pair**: 순수 git 동작(`git mv` 가 R100 으로 기록되는가)이라 **현행에서도 통과**한다.
//     `git mv` 가 D+A 로 기록되면 `created`·`id` 가 리셋된다(PRD Technical Risk 1위) — 그 회귀 감지기다.
//   · MV5·DL2 = **pair**: GREEN 이후 항상 통과해야 하는 짝 가드. 다만 규범 B(카운트 하한)를 앞세워
//     **지금은 red** 다 — 하한이 없으면 "양쪽 다 0건이라 등가"라는 공허한 통과가 된다.
//
// 규범 A(자기참조 금지): 이 파일의 경로는 전부 리터럴(`'vault/wiki'` · `'wiki'`)이다. 헬퍼
//   `writeDoc` 의 기본값에도 기대지 않고 **매 호출 `wikiRoot` 를 명시**한다 — GREEN(Task 8)이 기본값을
//   뒤집어도 이 스펙들은 영향받지 않는다. 상수 드리프트 감지는 PR5 트립와이어가 담당한다.
import { describe, expect, it } from 'vitest'

import { walkFeeds } from '../lib/git-walk.mjs'
import { buildContent } from '../validate.mjs'
import { cleanup, feedCommit, git, initVault, writeDoc } from './helpers/tmp-git-vault.mjs'

// 유효 UUIDv7(스키마 pattern 준수) — 문서 정체성. 이관해도 바뀌지 않는다.
const ID_A = '0192a000-0000-7000-8000-0000000000aa'
const ID_B = '0192b000-0000-7000-8000-0000000000bb'

const titlesOf = (items) => items.map((item) => item.title)

/** feedId(=커밋 해시)를 **제외**한 비교 키 — 두 vault 는 해시가 반드시 다르다(tdd §6.4). */
const tuplesOf = (items) =>
  items.map((item) => ({
    docIds: item.docs.map((doc) => doc.id).toSorted(),
    title: item.title,
    ts: item.ts,
  }))

/** author-date 를 명시 주입하는 일반 커밋(헬퍼 `commit` 은 자동 tick 이라 날짜를 통제할 수 없다). */
function commitAt(vault, message, date) {
  git(vault, ['add', '-A'])
  git(vault, ['commit', '--no-gpg-sign', '-m', message], {
    GIT_AUTHOR_DATE: date,
    GIT_COMMITTER_DATE: date,
  })
  return git(vault, ['rev-parse', 'HEAD'])
}

/** 문서 2건 + `feed:` 3건(소식1=삼성 · 소식2=HBM · 소식3=둘 다). `wikiRoot` 는 호출부가 **명시**한다. */
function seedFeedHistory(vault, wikiRoot) {
  writeDoc(vault, 'company/삼성', { id: ID_A, wikiRoot })
  writeDoc(vault, 'tech/HBM', { id: ID_B, wikiRoot })
  commitAt(vault, 'chore: 초기 문서 2건', '2026-01-01T00:00:00Z')

  writeDoc(vault, 'company/삼성', { body: '## 정의\n\n소식1 갱신.\n', id: ID_A, wikiRoot })
  feedCommit(vault, { date: '2026-01-02T00:00:00Z', subject: '소식1' })

  writeDoc(vault, 'tech/HBM', { body: '## 정의\n\n소식2 갱신.\n', id: ID_B, wikiRoot })
  feedCommit(vault, { date: '2026-01-03T00:00:00Z', subject: '소식2' })

  writeDoc(vault, 'company/삼성', { body: '## 정의\n\n소식3 갱신.\n', id: ID_A, wikiRoot })
  writeDoc(vault, 'tech/HBM', { body: '## 정의\n\n소식3 갱신.\n', id: ID_B, wikiRoot })
  feedCommit(vault, { date: '2026-01-04T00:00:00Z', subject: '소식3' })
}

/** MV-BASE — 옛 루트에 시딩한 뒤 **순수 `git mv` 단독 커밋**으로 이관한다(내용 0변경). */
function seedMigratedVault() {
  const vault = initVault()
  seedFeedHistory(vault, 'vault/wiki')
  git(vault, ['mv', 'vault/wiki', 'wiki'])
  const mvSha = commitAt(vault, 'chore: 문서 루트 이관', '2026-06-01T00:00:00Z')
  return { mvSha, vault }
}

/** MV5 대조군 — 같은 내용을 **처음부터 새 루트에** 시딩한다(이관 커밋 없음). */
function seedNativeVault() {
  const vault = initVault()
  seedFeedHistory(vault, 'wiki')
  return vault
}

/** DL-BASE — 문서 2건 · feed 2건 · 문서 1건 삭제 · 그 뒤 루트 이관. */
function seedDeletionVault() {
  const vault = initVault()
  writeDoc(vault, 'company/생존', { id: ID_A, wikiRoot: 'vault/wiki' })
  writeDoc(vault, 'concept/폐기예정', { id: ID_B, wikiRoot: 'vault/wiki' })
  commitAt(vault, 'chore: 초기 문서 2건', '2026-01-01T00:00:00Z')

  writeDoc(vault, 'company/생존', { body: '## 정의\n\n생존 갱신.\n', id: ID_A, wikiRoot: 'vault/wiki' }) // prettier-ignore
  feedCommit(vault, { date: '2026-01-02T00:00:00Z', subject: '생존 소식' })

  writeDoc(vault, 'concept/폐기예정', { body: '## 정의\n\n폐기 갱신.\n', id: ID_B, wikiRoot: 'vault/wiki' }) // prettier-ignore
  feedCommit(vault, { date: '2026-01-03T00:00:00Z', subject: '폐기 소식' })

  git(vault, ['rm', '-q', 'vault/wiki/concept/폐기예정.md'])
  commitAt(vault, 'uwiki: 폐기 메모 삭제', '2026-01-04T00:00:00Z')

  git(vault, ['mv', 'vault/wiki', 'wiki'])
  commitAt(vault, 'chore: 문서 루트 이관', '2026-06-01T00:00:00Z')
  return vault
}

describe('이관 등가 — 서빙 경로 walkFeeds (MV1)', () => {
  it('MV1: 이관 이전 `feed:` 커밋 3건이 살아 있고 문서 연결이 그대로다', () => {
    const { vault } = seedMigratedVault()
    try {
      const items = walkFeeds(vault, { count: 50, env: 'dev' })

      // 규범 B: 카운트 하한이 **먼저** — 픽스처가 비면 아래 단언들이 공허해진다.
      expect(items).toHaveLength(3)
      expect(titlesOf(items)).toEqual(['소식3', '소식2', '소식1'])
      // 제목만 살고 연결이 죽은 "반쪽 성공"을 통과시키지 않는다.
      expect(items.map((item) => item.docs.map((doc) => doc.id).toSorted())).toEqual([
        [ID_A, ID_B],
        [ID_B],
        [ID_A],
      ])
    } finally {
      cleanup(vault)
    }
  })
})

describe('이관 등가 — 검증 경로 buildContent (MV2·MV3)', () => {
  it('MV2: 같은 vault 를 검증 경로로 빌드해도 동일한 피드가 나온다(이중 빌더 격차 가드)', () => {
    const { vault } = seedMigratedVault()
    try {
      const result = buildContent({ env: 'dev', vault })

      expect(result.feeds.items).toHaveLength(3)
      expect(titlesOf(result.feeds.items)).toEqual(['소식3', '소식2', '소식1'])
      expect(result.feeds.items.map((item) => item.docs.map((doc) => doc.id).toSorted())).toEqual([
        [ID_A, ID_B],
        [ID_B],
        [ID_A],
      ])
      // 조용히 prune 으로 삼키거나 unresolved 로 흘리는 통과를 배제한다.
      expect(result.stats.unresolvedPaths).toEqual([])
      expect(result.stats.prunedDocRefs).toBe(0)
    } finally {
      cleanup(vault)
    }
  })

  it('MV3: 이관해도 created·id·breadcrumb 는 불변이고 **updated 만 이관일로 바뀐다**', () => {
    // `updated` 변경은 **정상 동작**이다(HEAD 커밋 이력을 보고 있다는 증거). 명시적 기대값으로
    // 못박아 두지 않으면 나중에 이 정상 동작이 회귀로 오인된다(plan Task 9 의 명시 사항).
    const { vault } = seedMigratedVault()
    try {
      const result = buildContent({ env: 'dev', vault })
      const doc = result.summary.docs.find((entry) => entry.id === ID_A)

      expect(result.summary.docs).toHaveLength(2)
      expect(doc).toBeDefined()
      expect(doc.created).toBe('2026-01-01T00:00:00Z')
      expect(doc.breadcrumb).toEqual(['company', '삼성'])
      expect(doc.updated).toBe('2026-06-01T00:00:00Z')
    } finally {
      cleanup(vault)
    }
  })
})

describe('이관 등가 — rename 재탐지 · 미이관 대조군 (MV4·MV5)', () => {
  it('MV4: 이관 커밋이 전량 `R100` 으로 기록된다(D+A 면 문서 id 가 리셋된다)', () => {
    const { mvSha, vault } = seedMigratedVault()
    try {
      const lines = git(vault, ['show', '--find-renames', '--name-status', '--format=', mvSha])
        .split('\n')
        .filter(Boolean)

      // 규범 B: 줄 수 하한이 먼저 — 0줄이면 "전량 R100"이 공허하게 참이 된다.
      expect(lines).toHaveLength(2)
      expect(lines.filter((line) => line.startsWith('R100\t'))).toHaveLength(2)
      expect(lines.map((line) => line.split('\t')[1]).toSorted()).toEqual(
        ['vault/wiki/company/삼성.md', 'vault/wiki/tech/HBM.md'].toSorted(),
      )
      expect(lines.map((line) => line.split('\t')[2]).toSorted()).toEqual(
        ['wiki/company/삼성.md', 'wiki/tech/HBM.md'].toSorted(),
      )
    } finally {
      cleanup(vault)
    }
  })

  it('MV5: 이관한 vault 와 처음부터 새 루트인 vault 의 피드가 완전히 같다', () => {
    // "이관 전후 동일"의 헤르메틱 표현 — MV1 이 이관 경로에서만 우연히 맞는 것을 배제한다.
    // feedId 는 커밋 해시라 두 vault 가 반드시 다르므로 비교 키에서 제외한다(tdd §6.4).
    const { vault: migrated } = seedMigratedVault()
    const native = seedNativeVault()
    try {
      const migratedTuples = tuplesOf(walkFeeds(migrated, { count: 50, env: 'dev' }))
      const nativeTuples = tuplesOf(walkFeeds(native, { count: 50, env: 'dev' }))

      // 규범 B: 양쪽 모두 카운트 하한을 먼저 통과해야 한다 — 없으면 `[] === []` 로 공허하게 통과한다.
      expect(migratedTuples).toHaveLength(3)
      expect(nativeTuples).toHaveLength(3)
      expect(migratedTuples).toEqual(nativeTuples)
    } finally {
      cleanup(migrated, native)
    }
  })
})

describe('삭제 이력 — 이관 전 경로의 삭제를 설명한다 (DL1·DL2)', () => {
  it('DL1: 이관 전에 삭제된 문서의 피드는 unresolved 가 아니라 prune 이다', () => {
    // 삭제 수집이 현재 prefix 로 좁혀지면 이관 전 삭제 경로(`vault/wiki/concept/폐기예정.md`)를
    // 찾지 못해 그 피드가 unresolved 가 되고 **빌드가 죽는다**(fail-loud 게이트).
    const vault = seedDeletionVault()
    try {
      const result = buildContent({ env: 'dev', vault })

      expect(result.feeds.items).toHaveLength(2)
      expect(titlesOf(result.feeds.items)).toEqual(['폐기 소식', '생존 소식'])
      expect(result.feeds.items.find((item) => item.title === '폐기 소식').docs).toEqual([])
      expect(result.stats.unresolvedPaths).toEqual([])
      // 정확 일치(하한 아님) — "전부 prune 해서 통과"를 막는다.
      expect(result.stats.prunedDocRefs).toBe(1)
      expect(result.stats.prunedFeeds).toBe(0)
    } finally {
      cleanup(vault)
    }
  })

  it('DL2: 살아 있는 문서의 피드는 prune 되지 않는다(경로 단위 시간-무관 집합의 고전적 오류)', () => {
    // "삭제 이력이 있으면 무조건 prune" 하는 과잉 구현을 red 로 만든다(feed.mjs:87-99 주석 참조).
    const vault = seedDeletionVault()
    try {
      const result = buildContent({ env: 'dev', vault })
      const survived = result.feeds.items.find((item) => item.title === '생존 소식')

      expect(survived).toBeDefined()
      expect(survived.docs.map((doc) => doc.id)).toEqual([ID_A])
    } finally {
      cleanup(vault)
    }
  })
})
