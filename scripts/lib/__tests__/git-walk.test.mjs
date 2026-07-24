// @vitest-environment node
//
// P1 · Task 2 — feeds 바운디드 keyset git-walk (`git-walk.mjs`) — tdd §Task 2 (주력 RED)
//
// RED 사유: `scripts/lib/git-walk.mjs` **부재** → 아래 지연 import 가 "Cannot find module" 로 throw →
//   이 파일 전체가 로드 실패로 RED 다(유효 RED · 의도한 미구현). 정적 import 로 적으면 ESM 링크가
//   커밋 단계에서 파일을 죽이므로 해석을 런타임으로 미룬다(전례: git.read-id-at-creation.test.mjs).
//
// 계약(GREEN 이 구현 — **순서가 계약**): walkFeeds(vault, { from, to, count, after }) 파이프라인
//   ① git rev-list --author-date-order <tip> -- vault/wiki --max-count=count*K 청크
//   ② parseCommitForFeed 필터(`feed:` 만) → ③ `<sha>:<당시경로>` blob frontmatter UUIDv7 id resolve
//   (현재 summary id 대조·미스 prune) → ④ applyIgnoreFeeds 억제(P4 SSOT **재사용**) → ⑤ docs[] id dedupe
//   → ⑥ JS byRecencyThenId 재정렬(**권위** — git 워크순서 ≠ author-date) → ⑦ from/to = author-date 값
//   경계(inclusive) → ⑧ after=(ts, feedId) strict `<` 연속 → ⑨ count 상한. 미달=continuation.
//
// 정직 범례: GW3(재정렬)·GW4(tie-break)·GW11(after)·GW12(continuation) 는 트리비얼 wrap(상위 N 슬라이스)
//   후에도 실패해야 진짜(🔴RED). GW9/GW10 은 🟡CARRIED(초판 payload-슬라이서 의미 이식). GW13 은 🟢GFS.
//
// 실 git 시딩(tmp-git-vault + feedCommit) — 순수 함수라 mock 대신 결정적 실 실행(순수함수 over-mock 금지).
import { writeFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  cleanup,
  commit,
  feedCommit,
  git,
  initVault,
  writeDoc,
} from '../../__tests__/helpers/tmp-git-vault.mjs'

const { walkFeeds } = await import(new URL('../git-walk.mjs', import.meta.url).href)

// 유효 UUIDv7(스키마 pattern 준수) — 문서 정체성.
const ID_A = '0192a000-0000-7000-8000-0000000000aa'
const ID_B = '0192b000-0000-7000-8000-0000000000bb'
const ID_C = '0192c000-0000-7000-8000-0000000000cc'

// 서로 다른 author-date(ISO UTC → %aI 는 UTC 를 `Z` 로 렌더 = 이 상수와 동일 문자열). T1 최과거 … T6 최신.
const T1 = '2026-01-01T00:00:00Z'
const T2 = '2026-01-02T00:00:00Z'
const T3 = '2026-01-03T00:00:00Z'
const T4 = '2026-01-04T00:00:00Z'
const T5 = '2026-01-05T00:00:00Z'
const T6 = '2026-01-06T00:00:00Z'

const titlesOf = (items) => items.map((item) => item.title)
const tsOf = (items) => items.map((item) => item.ts)
const idsOf = (items) => items.map((item) => item.id)

/** cwiki 생성 커밋 — 문서 하나를 frontmatter id 와 함께 만든다. */
function seedDoc(vault, rel, id) {
  writeDoc(vault, rel, { id })
  commit(vault, `cwiki: ${rel} 생성`)
}

/**
 * `feed:` 커밋 — 문서를 (내용 변경으로) 건드려 그 문서를 가리키는 피드를 만든다.
 * 매 호출 본문에 subject 를 심어 diff 를 보장한다(같은 내용이면 빈 커밋이라 git 이 거부).
 * feedId(hash.slice(0,12)) 를 돌려준다.
 */
function seedFeed(vault, rel, id, { date, importance, keywords, subject }) {
  writeDoc(vault, rel, { body: `## 정의\n\n${subject} 갱신.\n`, id })
  const hash = feedCommit(vault, { date, importance, keywords, subject })
  return hash.slice(0, 12)
}

/** vault 루트 ignore-feeds.json 억제 목록(작업트리 — loadIgnoreFeeds 는 fs 를 읽는다). */
function writeIgnore(vault, feedIds) {
  const entries = feedIds.map((id) => ({ id, when: '2026-07-23T00:00:00Z' }))
  writeFileSync(path.join(vault, 'ignore-feeds.json'), JSON.stringify(entries), 'utf8')
}

describe('walkFeeds — 모듈·subject 필터 (GW1·GW2 🔴RED)', () => {
  it('GW1: walkFeeds export 가 존재한다', () => {
    expect(typeof walkFeeds).toBe('function')
  })

  it('GW2: `feed:` 커밋만 피드가 된다 (cwiki·uwiki·chore 는 제외)', () => {
    const vault = initVault()
    try {
      seedDoc(vault, 'company/삼성', ID_A)
      // 비-feed 커밋들 — vault 를 건드려도 피드가 아니다.
      writeDoc(vault, 'company/삼성', { body: '## 정의\n\n일반 갱신.\n', id: ID_A })
      commit(vault, 'uwiki: 삼성 본문 보강')
      // vault/wiki 밖 파일만 바꾸는 관리용 커밋 — 실제 변경이 있어야 git 이 커밋을 만든다(빈 커밋 거부
      // 회피). vault/wiki 는 그대로라 "feed: 만 피드가 된다" 단언 의미는 불변이다.
      writeFileSync(path.join(vault, 'notes.txt'), '잡무 메모\n', 'utf8')
      commit(vault, 'chore: 잡무') // vault/wiki 무변경 커밋
      seedFeed(vault, 'company/삼성', ID_A, { date: T3, subject: '진짜 소식' })

      const items = walkFeeds(vault, { count: 10 })

      expect(titlesOf(items)).toEqual(['진짜 소식'])
    } finally {
      cleanup(vault)
    }
  })
})

describe('walkFeeds — JS 재정렬 권위 · tie-break (GW3·GW4 🔴RED)', () => {
  it('GW3: git 워크순서 ≠ author-date → 결과는 author-date 내림차순(재정렬 권위)', () => {
    // author-date 를 **커밋순서와 역행**시켜 시딩한다. 선형 히스토리에서 git rev-list --author-date-order
    // 의 원시 워크순서는 역-커밋순서(= 여기선 중간·최신·최고참)라 내림차순이 **아니다** → JS 재정렬이
    // 없으면 결과가 내림차순이 아니게 되어 실패한다(over-walk 후 재정렬 누락의 핵심 함정).
    const vault = initVault()
    try {
      seedDoc(vault, 'company/삼성', ID_A)
      seedFeed(vault, 'company/삼성', ID_A, { date: T2, subject: '최고참 소식' }) // 커밋2 · ts 최과거
      seedFeed(vault, 'company/삼성', ID_A, { date: T6, subject: '최신 소식' }) //   커밋3 · ts 최신
      seedFeed(vault, 'company/삼성', ID_A, { date: T4, subject: '중간 소식' }) //   커밋4 · ts 중간

      const items = walkFeeds(vault, { count: 10 })

      // author-date 내림차순 — 원시 워크순서(['중간','최신','최고참'])가 아니다.
      expect(titlesOf(items)).toEqual(['최신 소식', '중간 소식', '최고참 소식'])
      expect(tsOf(items)).toEqual([T6, T4, T2])
    } finally {
      cleanup(vault)
    }
  })

  it('GW4: 동일 author-date 는 feedId 오름차순으로 tie-break(입력 순서 무의존·결정적)', () => {
    const vault = initVault()
    try {
      seedDoc(vault, 'company/삼성', ID_A)
      // 같은 author-date T3 3건 — tie-break 없으면 워크순서(역-커밋순서)가 새어 비결정적이다.
      seedFeed(vault, 'company/삼성', ID_A, { date: T3, subject: '동시 A' })
      seedFeed(vault, 'company/삼성', ID_A, { date: T3, subject: '동시 B' })
      seedFeed(vault, 'company/삼성', ID_A, { date: T3, subject: '동시 C' })

      const items = walkFeeds(vault, { count: 10 })
      const ids = idsOf(items)

      expect(items).toHaveLength(3)
      expect(tsOf(items)).toEqual([T3, T3, T3]) // 전부 동일 ts
      expect(ids).toEqual([...ids].toSorted()) // feedId 오름차순 결정적
    } finally {
      cleanup(vault)
    }
  })
})

describe('walkFeeds — blob-id resolve · prune · dedupe (GW5·GW6·GW8 🔴RED)', () => {
  it('GW5: 이동한 문서의 과거 피드가 현재 id 로 resolve 된다(rename 내성 · 소실 0)', () => {
    const vault = initVault()
    try {
      seedDoc(vault, 'company/옛경로', ID_A)
      seedFeed(vault, 'company/옛경로', ID_A, { date: T2, subject: '과거 소식' }) // 당시경로 company/옛경로
      // 문서를 새 경로로 이동(rename) — HEAD 는 company/새경로.
      git(vault, ['mv', 'vault/wiki/company/옛경로.md', 'vault/wiki/company/새경로.md'])
      commit(vault, 'uwiki: 문서 이동 옛경로→새경로')

      const items = walkFeeds(vault, { count: 10 })
      const past = items.find((item) => item.title === '과거 소식')

      expect(past).toBeDefined()
      expect(past.docs.map((doc) => doc.id)).toContain(ID_A) // 당시경로가 현재 id 로 해석됨
    } finally {
      cleanup(vault)
    }
  })

  it('GW6: 참조 문서가 HEAD 에서 삭제되면 그 피드는 prune(부재)·에러 없음', () => {
    const vault = initVault()
    try {
      seedDoc(vault, 'company/생존', ID_A)
      seedFeed(vault, 'company/생존', ID_A, { date: T3, subject: '생존 소식' })
      seedDoc(vault, 'company/삭제될', ID_B)
      seedFeed(vault, 'company/삭제될', ID_B, { date: T2, subject: '삭제될 소식' })
      git(vault, ['rm', 'vault/wiki/company/삭제될.md'])
      commit(vault, 'cwiki: 삭제될 문서 제거')

      const items = walkFeeds(vault, { count: 10 })

      expect(titlesOf(items)).toContain('생존 소식')
      expect(titlesOf(items)).not.toContain('삭제될 소식') // 참조 전멸 → prune
    } finally {
      cleanup(vault)
    }
  })

  it('GW8: 동일 커밋에서 rename 된 문서는 docs[] 에 그 id 1건(중복 0)', () => {
    const vault = initVault()
    try {
      seedDoc(vault, 'company/before', ID_C)
      // 한 feed: 커밋이 문서를 개명(old→new)하며 내용도 바꾼다 — old·new 경로가 같은 id 로 해석돼도 1건.
      git(vault, ['mv', 'vault/wiki/company/before.md', 'vault/wiki/company/after.md'])
      writeDoc(vault, 'company/after', { body: '## 정의\n\n개명하며 갱신.\n', id: ID_C })
      feedCommit(vault, { date: T2, subject: '개명+소식' })

      const items = walkFeeds(vault, { count: 10 })
      const feed = items.find((item) => item.title === '개명+소식')

      expect(feed).toBeDefined()
      expect(feed.docs.filter((doc) => doc.id === ID_C)).toHaveLength(1) // dedupe
    } finally {
      cleanup(vault)
    }
  })
})

describe('walkFeeds — 억제 직교(P4 SSOT 재사용) (GW7 🔴RED)', () => {
  it('GW7: 억제 tombstone 을 가진 feedId 는 결과 부재(applyIgnoreFeeds 경유 · 재구현 금지)', () => {
    const vault = initVault()
    try {
      seedDoc(vault, 'company/삼성', ID_A)
      seedFeed(vault, 'company/삼성', ID_A, { date: T3, subject: '남을 소식' })
      const suppressed = seedFeed(vault, 'company/삼성', ID_A, { date: T2, subject: '억제될 소식' })
      writeIgnore(vault, [suppressed])

      const items = walkFeeds(vault, { count: 10 })

      expect(titlesOf(items)).toContain('남을 소식')
      expect(titlesOf(items)).not.toContain('억제될 소식') // 억제(Complete Mediation)
    } finally {
      cleanup(vault)
    }
  })
})

describe('walkFeeds — 값 경계·상한 (GW9·GW10 🟡CARRIED)', () => {
  /** 5 feed(ts T1..T5, 제목 n1..n5) 세계관. */
  function seedFive(vault) {
    seedDoc(vault, 'company/삼성', ID_A)
    seedFeed(vault, 'company/삼성', ID_A, { date: T1, subject: 'n1' })
    seedFeed(vault, 'company/삼성', ID_A, { date: T2, subject: 'n2' })
    seedFeed(vault, 'company/삼성', ID_A, { date: T3, subject: 'n3' })
    seedFeed(vault, 'company/삼성', ID_A, { date: T4, subject: 'n4' })
    seedFeed(vault, 'company/삼성', ID_A, { date: T5, subject: 'n5' })
  }

  it('GW9: from=T3 → ts>=T3 경계 포함 · to=T3 → ts<=T3 경계 포함', () => {
    const vault = initVault()
    try {
      seedFive(vault)

      expect(tsOf(walkFeeds(vault, { count: 10, from: T3 }))).toEqual([T5, T4, T3])
      expect(tsOf(walkFeeds(vault, { count: 10, to: T3 }))).toEqual([T3, T2, T1])
      expect(tsOf(walkFeeds(vault, { count: 10, from: T2, to: T4 }))).toEqual([T4, T3, T2]) // 닫힌구간
    } finally {
      cleanup(vault)
    }
  })

  it('GW10: count<가용 → 정확 count(최신 상위) · count>가용 → 전량', () => {
    const vault = initVault()
    try {
      seedFive(vault)

      expect(titlesOf(walkFeeds(vault, { count: 3 }))).toEqual(['n5', 'n4', 'n3'])
      expect(walkFeeds(vault, { count: 99 })).toHaveLength(5)
    } finally {
      cleanup(vault)
    }
  })
})

describe('walkFeeds — after 커서 연속 (GW11 🔴RED)', () => {
  it('GW11: 1페이지 커서로 2페이지 요청 → 경계 재포함 0·중복 0·누락 0(strict `<`)', () => {
    const vault = initVault()
    try {
      seedDoc(vault, 'company/삼성', ID_A)
      seedFeed(vault, 'company/삼성', ID_A, { date: T1, subject: 'n1' })
      seedFeed(vault, 'company/삼성', ID_A, { date: T2, subject: 'n2' })
      seedFeed(vault, 'company/삼성', ID_A, { date: T3, subject: 'n3' })
      seedFeed(vault, 'company/삼성', ID_A, { date: T4, subject: 'n4' })

      const page1 = walkFeeds(vault, { count: 2 }) // [n4, n3]
      const cursor = { feedId: page1.at(-1).id, ts: page1.at(-1).ts } // (T3, id(n3))
      const page2 = walkFeeds(vault, { after: cursor, count: 2 }) // strict < cursor → [n2, n1]

      expect(titlesOf(page1)).toEqual(['n4', 'n3'])
      expect(titlesOf(page2)).toEqual(['n2', 'n1']) // 경계(n3) 재포함 없음
      const overlap = idsOf(page2).filter((id) => idsOf(page1).includes(id))
      expect(overlap).toEqual([]) // 중복 0
    } finally {
      cleanup(vault)
    }
  })
})

describe('walkFeeds — over-walk continuation (GW12 🔴RED)', () => {
  it('GW12: 상한 창 안 항목이 억제로 대량 드롭돼도 continuation 으로 count 를 채운다(언더필 0)', () => {
    // 상위 8건을 억제한다 → 작은 K 의 단일 창(max-count=count*K)은 전부 억제라 언더필한다.
    // continuation 이 다음 tip 으로 이어 걸어야 최과거 2건(n1·n2)이 채워진다(누락·중복 0).
    const vault = initVault()
    try {
      seedDoc(vault, 'company/삼성', ID_A)
      const suppress = []
      const dates = [T1, T2, T3, T4, T5, T6, '2026-01-07T00:00:00Z', '2026-01-08T00:00:00Z', '2026-01-09T00:00:00Z', '2026-01-10T00:00:00Z'] // prettier-ignore
      dates.forEach((date, i) => {
        const feedId = seedFeed(vault, 'company/삼성', ID_A, { date, subject: `n${i + 1}` })
        if (i >= 2) suppress.push(feedId) // n3..n10 억제 → 생존 n1·n2
      })
      writeIgnore(vault, suppress)

      const items = walkFeeds(vault, { count: 2 })

      expect(titlesOf(items)).toEqual(['n2', 'n1']) // 최과거 2건 · 언더필 없음
    } finally {
      cleanup(vault)
    }
  })
})

describe('walkFeeds — 경계·스케일 (GW13·GW14)', () => {
  it('GW13: `feed:` 0 → [] · throw 없음 (🟢GFS)', () => {
    const vault = initVault()
    try {
      seedDoc(vault, 'company/삼성', ID_A) // cwiki 만
      expect(walkFeeds(vault, { count: 10 })).toEqual([])
    } finally {
      cleanup(vault)
    }
  })

  it('GW14: 다수 피드 커밋을 결정적으로 전부 resolve 한다(blob batch 정확성 경계 · 🔴RED)', () => {
    // cat-file batch(N+1 회피)의 **정확성 경계**를 대량 시딩으로 관측한다(스파이 아님) — 배치가
    // 누락·중복을 내면 length·정렬에서 드러난다.
    const vault = initVault()
    try {
      seedDoc(vault, 'company/삼성', ID_A)
      const dates = Array.from(
        { length: 12 },
        (_, i) => `2026-02-${String(i + 1).padStart(2, '0')}T00:00:00Z`,
      )
      dates.forEach((date, i) => seedFeed(vault, 'company/삼성', ID_A, { date, subject: `b${i}` }))

      const items = walkFeeds(vault, { count: 50 })
      const ts = tsOf(items)

      expect(items).toHaveLength(12) // 누락·중복 0
      expect(ts).toEqual([...ts].toSorted().reverse()) // ts 내림차순
    } finally {
      cleanup(vault)
    }
  })
})

describe('walkFeeds — pre-D1 blob(id 부재) 폴백 resolve (GW15 🔴RED)', () => {
  it('GW15: id 부여 이전에 만들어진 피드도 buildPathIndex 폴백으로 현재 id 로 resolve 된다(소실 0)', () => {
    // 실 vault 회귀 재현: feed 커밋들이 **문서 id 부여(P1 마이그레이션)보다 먼저** 만들어져 그 시점
    //   blob frontmatter 에 id 가 없다(pre-D1). readBlobId(고속경로)는 그 blob 에서 null →
    //   buildPathIndex(경로→현재 id · rename 추적) 폴백이 없으면 이 피드가 통째로 prune 돼 실 vault 에서
    //   feeds 가 빈다(build.mjs 는 buildPathIndex 로 resolve 해 5건이 나오는데 walkFeeds 만 0건이던 결함).
    //   폴백이 build.mjs 와 동치로 살려야 한다.
    const vault = initVault()
    try {
      // id 없이 생성(pre-id 생성 blob) — tmp-git-vault writeDoc 은 id 생략 시 pre-id 문서를 만든다.
      writeDoc(vault, 'company/삼성', {})
      commit(vault, 'cwiki: 삼성 생성 (D1 이전)')
      // 여전히 id 없는 채로 피드 — 그 시점 blob frontmatter 에 id 부재.
      writeDoc(vault, 'company/삼성', { body: '## 정의\n\npre-D1 소식 본문.\n' })
      const feedHash = feedCommit(vault, { date: T3, subject: 'pre-D1 소식' })
      // 나중에 id 부여(D1 마이그레이션) — HEAD 에만 id 가 생긴다.
      writeDoc(vault, 'company/삼성', { body: '## 정의\n\npre-D1 소식 본문.\n', id: ID_A })
      commit(vault, 'uwiki: 삼성 id 부여 (D1 마이그레이션)')

      const items = walkFeeds(vault, { count: 10 })
      const feed = items.find((item) => item.title === 'pre-D1 소식')

      expect(feed).toBeDefined() // 폴백으로 살아남는다(prune 되지 않는다)
      expect(feed.id).toBe(feedHash.slice(0, 12))
      expect(feed.docs.map((doc) => doc.id)).toEqual([ID_A]) // 당시 blob 엔 id 없었지만 현재 id 로 resolve
    } finally {
      cleanup(vault)
    }
  })
})

describe('walkFeeds — 뒤섞인 author-date 조기종료 방지 (GW16 🔴RED · F1)', () => {
  it('GW16: 뒤 청크의 더 최신 author-date 피드를 count 작아도 놓치지 않는다(walk순서 ≠ author-date)', () => {
    const vault = initVault()
    try {
      seedDoc(vault, 'company/삼성', ID_A)
      // A: author-date 최신(T6)이지만 **가장 먼저 커밋** → 역-커밋 워크순서에서 맨 뒤 청크로 밀린다.
      seedFeed(vault, 'company/삼성', ID_A, { date: T6, subject: '뒤늦게 걸리는 최신' })
      // b1..b5: 더 과거 author-date 를 나중에 커밋 → over-walk(count*3) 첫 청크를 채운다.
      seedFeed(vault, 'company/삼성', ID_A, { date: T1, subject: 'b1' })
      seedFeed(vault, 'company/삼성', ID_A, { date: T2, subject: 'b2' })
      seedFeed(vault, 'company/삼성', ID_A, { date: T3, subject: 'b3' })
      seedFeed(vault, 'company/삼성', ID_A, { date: T4, subject: 'b4' })
      seedFeed(vault, 'company/삼성', ID_A, { date: T5, subject: 'b5' })

      // count=1 → 첫 청크는 최신-커밋 3건(b5·b4·b3)뿐 → 조기 종료하면 T6(맨 뒤 청크)을 놓쳐 b5 를 낸다.
      //   전량 워크 + JS 재정렬이면 T6 이 1위다(조기종료의 정렬-비안전성이 여기서 드러난다).
      expect(titlesOf(walkFeeds(vault, { count: 1 }))).toEqual(['뒤늦게 걸리는 최신'])
      expect(titlesOf(walkFeeds(vault, { count: 2 }))).toEqual(['뒤늦게 걸리는 최신', 'b5'])
    } finally {
      cleanup(vault)
    }
  })
})

describe('walkFeeds — prod draft 참조 피드 제외 (GW17 🔴RED · F4)', () => {
  it('GW17: draft(dev/) 문서만 가리키는 피드는 dev 만 포함하고 prod·미지정은 제외한다', () => {
    const vault = initVault()
    try {
      seedDoc(vault, 'company/삼성', ID_A) // 공개 문서
      seedFeed(vault, 'company/삼성', ID_A, { date: T2, subject: '공개 소식' })
      seedDoc(vault, 'dev/실험문서', ID_B) // draft — dev/ 폴더(isDraft)
      seedFeed(vault, 'dev/실험문서', ID_B, { date: T3, subject: 'draft 소식' })

      // dev: 전량(draft 포함)
      expect(titlesOf(walkFeeds(vault, { count: 10, env: 'dev' }))).toEqual(['draft 소식', '공개 소식']) // prettier-ignore
      // prod: draft 문서만 가리키는 피드 제외 → 공개 소식만(summary/wiki 와 같은 은닉 방향)
      expect(titlesOf(walkFeeds(vault, { count: 10, env: 'prod' }))).toEqual(['공개 소식'])
      // env 미지정: **숨김**(fail-closed). 과거엔 "전량 — 기존 호출 계약 보존"으로 단언했으나 그것은
      //   PRD D2("미지정·오류 = prod = dev 숨김")와 정면으로 어긋났고, summary/wiki(parse-vault 는
      //   `env === 'dev'` 기준)와 극성이 반대여서 feeds 만 draft 를 노출했다. 판정을 PRD 로 되돌린다.
      //   비-dev 값 전반의 회귀 가드는 lib/__tests__/fail-closed.verify.test.mjs(H3) 가 담당한다.
      expect(titlesOf(walkFeeds(vault, { count: 10 }))).toEqual(['공개 소식'])
    } finally {
      cleanup(vault)
    }
  })
})

describe('walkFeeds — 비-UTC offset 시간 비교 (GW18 🔴RED · F2·F3)', () => {
  it('GW18: author-date offset(+09:00)이 섞여도 epoch 기준 정렬·from 경계다(사전순 아님)', () => {
    const vault = initVault()
    try {
      seedDoc(vault, 'company/삼성', ID_A)
      // KST 09:00+09:00 = UTC 00:00(이른 순간)인데 **사전순으론 크다**('09' > '02').
      seedFeed(vault, 'company/삼성', ID_A, { date: '2026-03-01T09:00:00+09:00', subject: 'KST-이른' }) // prettier-ignore
      // UTC 02:00(2시간 뒤 순간)인데 사전순으론 작다('02').
      seedFeed(vault, 'company/삼성', ID_A, { date: '2026-03-01T02:00:00Z', subject: 'UTC-늦은' })

      // 정렬(F2): epoch 내림차순 → 늦은(02:00Z)이 먼저. 사전순 비교면 KST 문자열이 커서 뒤집힌다.
      expect(titlesOf(walkFeeds(vault, { count: 10 }))).toEqual(['UTC-늦은', 'KST-이른'])
      // from 경계(F3): 01:00Z 이후만 → UTC-늦은(02:00Z)만. 사전순이면 KST 문자열이 크게 잡혀 샌다.
      expect(titlesOf(walkFeeds(vault, { count: 10, from: '2026-03-01T01:00:00Z' }))).toEqual(['UTC-늦은']) // prettier-ignore
    } finally {
      cleanup(vault)
    }
  })
})
