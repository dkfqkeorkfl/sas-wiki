// @vitest-environment node
//
// P1 · Task 2 — feeds 바운디드 keyset git-walk (`git-walk.mjs`) — tdd §Task 2 (주력 RED)
//
// RED 사유: `scripts/lib/git-walk.mjs` **부재** → 아래 지연 import 가 "Cannot find module" 로 throw →
//   이 파일 전체가 로드 실패로 RED 다(유효 RED · 의도한 미구현). 정적 import 로 적으면 ESM 링크가
//   커밋 단계에서 파일을 죽이므로 해석을 런타임으로 미룬다(전례: git.read-id-at-creation.test.mjs).
//
// 계약(GREEN 이 구현 — **순서가 계약**): walkFeeds(vault, { from, to, count, after }) 파이프라인
//   ① git rev-list --author-date-order <tip> -- wiki --max-count=count*K 청크
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

const { walkFeeds } = await import(
  new URL('../../__tests__/helpers/walk-feeds.mjs', import.meta.url).href
)

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

/** 문서 생성 커밋 — 문서 하나를 frontmatter id 와 함께 만든다. */
function seedDoc(vault, rel, id) {
  writeDoc(vault, rel, { id })
  commit(vault, `chore: ${rel} 생성`)
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

  it('GW2: `feed:` 커밋만 피드가 된다 (feed: 아닌 subject 는 제외)', () => {
    const vault = initVault()
    try {
      seedDoc(vault, 'company/삼성', ID_A)
      // 비-feed 커밋들 — vault 를 건드려도 피드가 아니다.
      writeDoc(vault, 'company/삼성', { body: '## 정의\n\n일반 갱신.\n', id: ID_A })
      commit(vault, 'chore: 삼성 본문 보강')
      // wiki 밖 파일만 바꾸는 관리용 커밋 — 실제 변경이 있어야 git 이 커밋을 만든다(빈 커밋 거부
      // 회피). wiki 는 그대로라 "feed: 만 피드가 된다" 단언 의미는 불변이다.
      writeFileSync(path.join(vault, 'notes.txt'), '잡무 메모\n', 'utf8')
      commit(vault, 'chore: 잡무') // wiki 무변경 커밋
      seedFeed(vault, 'company/삼성', ID_A, { date: T3, subject: '진짜 소식' })

      const items = walkFeeds(vault, { count: 10 })

      expect(titlesOf(items)).toEqual(['진짜 소식'])
    } finally {
      cleanup(vault)
    }
  })
})

// GW3·GW4(JS 재정렬 권위 · tie-break) 제거됨 — 대상은 이 파일이 import 하는 `walkFeeds`
//   (`__tests__/helpers/walk-feeds.mjs`)가 내부에서 자체 재구현한 `pageFeeds`의 `.toSorted(byRecencyThenId)`
//   였다. 그 재정렬은 이제 어떤 프로덕션 파일도 쓰지 않는다 — 조회 경로는 `lib/feed-cursor.mjs`의
//   `walkCursorPage`로 교체됐고, 그 함수는 git 의 **기본 rev-list 워크 순서**를 정렬 권위로 쓴다
//   (`--author-date-order`를 의도적으로 붙이지 않는다 — 붙이면 병합 토폴로지에서 페이지 「집합」
//   자체가 달라진다는 것이 `feed-cursor.mjs` 자신의 실측 주석이다). 즉 GW3/GW4 의 주장("JS 재정렬이
//   권위") 자체가 지금의 프로덕션에는 성립하지 않는다 — 대상을 실 함수로 재배선해도 같은 단언을
//   유지할 수 없다. 실측(무력화 프로브, 원복 완료): `walkCursorPage` 를 통째로 비워도 이 배치의
//   git-walk·feed 계열 8파일 79케이스가 전부 green 을 유지했다 — 애초에 이 두 케이스가 무엇을
//   실패시킬 수 있는 대상도 아니다.
//   epoch 비교·tie-break 자체(`byRecencyThenId`)의 실제 프로덕션 단위 테스트는 이 배치 안
//   `feed.test.mjs`(byRecencyThenId 직접 호출, F2 케이스)가 이미 갖고 있다.

describe('walkFeeds — blob-id resolve · prune · dedupe (GW5·GW6·GW8 🔴RED)', () => {
  it('GW5: 이동한 문서의 과거 피드가 현재 id 로 resolve 된다(rename 내성 · 소실 0)', () => {
    const vault = initVault()
    try {
      seedDoc(vault, 'company/옛경로', ID_A)
      seedFeed(vault, 'company/옛경로', ID_A, { date: T2, subject: '과거 소식' }) // 당시경로 company/옛경로
      // 문서를 새 경로로 이동(rename) — HEAD 는 company/새경로.
      git(vault, ['mv', 'wiki/company/옛경로.md', 'wiki/company/새경로.md'])
      commit(vault, 'chore: 문서 이동 옛경로→새경로')

      const items = walkFeeds(vault, { count: 10 })
      const past = items.find((item) => item.title === '과거 소식')

      expect(past).toBeDefined()
      expect(past.docs.map((doc) => doc.id)).toContain(ID_A) // 당시경로가 현재 id 로 해석됨
    } finally {
      cleanup(vault)
    }
  })

  // P2(contract-simplify) 계약 반전 — tdd §4 원장 ① / §3.2 RR1·RR3.
  // **왜 바뀌었나(D9)**: 뉴스는 문서의 부속물이 아니라 그 자체로 기록이다. 문서가 지워지면 **그 연결만**
  //   끊고 피드는 남긴다. 사유가 `deleted` 인 참조는 **env 와 무관하게** 이 판정을 받는다(D-A 표 2행).
  //   `draft-excluded`(prod 미노출)와 헷갈리면 안 된다 — 그쪽은 D2 fail-closed 로 계속 막는다.
  it('GW6: 참조 문서가 HEAD 에서 삭제돼도 피드는 살고 연결만 끊긴다(docs: []) · 에러 없음', () => {
    const vault = initVault()
    try {
      seedDoc(vault, 'company/생존', ID_A)
      seedFeed(vault, 'company/생존', ID_A, { date: T3, subject: '생존 소식' })
      seedDoc(vault, 'company/삭제될', ID_B)
      seedFeed(vault, 'company/삭제될', ID_B, { date: T2, subject: '삭제될 소식' })
      git(vault, ['rm', 'wiki/company/삭제될.md'])
      commit(vault, 'chore: 삭제될 문서 제거')

      const items = walkFeeds(vault, { count: 10 })
      const orphan = items.find((item) => item.title === '삭제될 소식')

      expect(titlesOf(items)).toContain('생존 소식')
      expect(orphan).toBeDefined() // 피드 생존 — 카드가 통째로 사라지지 않는다
      expect(orphan.docs).toEqual([]) // 연결만 끊긴다("살아 있는 연결" 이 남으면 죽은 링크가 된다)
      expect(items.find((item) => item.title === '생존 소식').docs.map((doc) => doc.id)).toEqual([ID_A]) // prettier-ignore
    } finally {
      cleanup(vault)
    }
  })

  it('GW8: 동일 커밋에서 rename 된 문서는 docs[] 에 그 id 1건(중복 0)', () => {
    const vault = initVault()
    try {
      seedDoc(vault, 'company/before', ID_C)
      // 한 feed: 커밋이 문서를 개명(old→new)하며 내용도 바꾼다 — old·new 경로가 같은 id 로 해석돼도 1건.
      git(vault, ['mv', 'wiki/company/before.md', 'wiki/company/after.md'])
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

// GW9·GW10(값 경계·상한) · GW11(after 커서 연속) · GW12(over-walk continuation) 제거됨 — 넷 다
//   `walkFeeds`의 로컬 `pageFeeds`/`pageItems`가 자체 재구현한 from/to 경계·count 슬라이스·
//   `{ts,feedId}` 객체 커서·continuation(nextCursor 계산)을 겨눴다. 이 넷은 이 파일이 겨눈 것 중
//   프로덕션 커플링이 가장 약한 부분이다 — `lib/git-walk.mjs`(collectFeedItems)나
//   `lib/feed-cursor.mjs`(walkCursorPage) 어느 쪽에도 대응 코드가 없다(전자는 개념 자체가 없고,
//   후자는 완전히 다른 매커니즘 — 불투명 12-hex 커서·배치 2회·git 워크 순서). 실측(무력화 프로브
//   1건, 원복 완료): `walkCursorPage` 를 통째로 비워도 이 배치의 git-walk·feed 계열 8파일 79케이스
//   전부 green 유지.
//   실 프로덕션 경로에 대한 동등 보장은 이제 다른 파일이 직접 진다:
//     · count 상한·1↔2페이지 연속(누락·중복 0)·명시 억제 — `scripts/__tests__/feeds.test.mjs`
//       (E-F1·E-F2·E-F3, `feeds()` → `walkCursorPage` 를 직접 호출)
//     · 커서 3단 검증(형식·해석·startsWith)·배치 argv·spawn 타임아웃 — `feed-cursor.test.mjs`
//       (CR1~CR6·WA1~WA3·WA9·WA11)
//   over-walk continuation(GW12)을 실 프로덕션 경로(`feeds()`)로 재현하려 시도한 결과(병합 커밋
//   +`count`가 작은 반복 페이징 — `git-walk.merge-tolerance.test.mjs`의 舊 MG2 참조), 그 경로가
//   실제로 페이지 도중 `nextCursor: null`(히스토리 끝)을 조기에 신고하며 나머지 항목을 소실하는
//   현상을 발견했다 — `lib/feed-cursor.mjs`(walkCursorPage)의 실제 결함으로 보이나, 그 파일은 이
//   배치의 편집 대상이 아니라서 여기서 고치지 않는다(별도 처리로 넘긴다). GW9~GW12 를 그 경로로
//   재배선해 "고쳐서 통과시키는" 것은 이 배치 밖 프로덕션 수정을 전제하므로 하지 않았다 — 대신
//   대상이 죽어 있다는 사실만 남기고 제거한다(무언가를 검증한다고 주장하며 아무것도 검증하지
//   않는 상태를 유지하는 것보다 낫다).

describe('walkFeeds — 경계·스케일 (GW13·GW14)', () => {
  it('GW13: `feed:` 0 → [] · throw 없음 (🟢GFS)', () => {
    const vault = initVault()
    try {
      seedDoc(vault, 'company/삼성', ID_A) // 문서 생성만
      expect(walkFeeds(vault, { count: 10 })).toEqual([])
    } finally {
      cleanup(vault)
    }
  })

  it('GW14: 다수 피드 커밋을 결정적으로 전부 resolve 한다(blob-id resolve 정확성 경계 · 🔴RED)', () => {
    // ★ 이름 정정: resolve 는 cat-file **배치**(N+1 회피)가 아니다 — 확인(pathIndex 캐시 hit)이면
    //   git 호출 0회, 미스면 후보 ref 마다 `git show <sha>:<path>` 를 **개별 호출**한다(오히려 N+1
    //   그 자체). 여기서 관측하는 것은 그 순차 개별-resolve 가 대량 시딩에서도 누락·중복 없이
    //   결정적인가다(스파이 아님) — 배치가 누락·중복을 내면 length·정렬에서 드러난다.
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
      commit(vault, 'chore: 삼성 생성 (D1 이전)')
      // 여전히 id 없는 채로 피드 — 그 시점 blob frontmatter 에 id 부재.
      writeDoc(vault, 'company/삼성', { body: '## 정의\n\npre-D1 소식 본문.\n' })
      const feedHash = feedCommit(vault, { date: T3, subject: 'pre-D1 소식' })
      // 나중에 id 부여(D1 마이그레이션) — HEAD 에만 id 가 생긴다.
      writeDoc(vault, 'company/삼성', { body: '## 정의\n\npre-D1 소식 본문.\n', id: ID_A })
      commit(vault, 'chore: 삼성 id 부여 (D1 마이그레이션)')

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
