// @vitest-environment node
//
// P1 · Task 3 — endpoints.feeds **on-demand 바운디드 워크** 전환 (D5 재작업) — tdd §Task 3 (E-F)
//
// RED 사유(엔진 전환): 초판 `feeds(payload, {from,to,count})` 는 pre-parsed payload 를 억제→정렬→슬라이스
//   했다. 재작업 계약은 `feeds(vault, {from,to,count,after})` — **walkFeeds 엔진**(Task 2)으로 git 에서
//   바운디드 워크한 뒤 buildFeeds 봉투(+nextCursor)만 씌운다. 아래는 1번째 인자에 **vault 경로 문자열**을
//   넘긴다 → 현행 슬라이서가 `applyIgnoreFeeds(vault.items, vault.ignore)` = `applyIgnoreFeeds(undefined, …)`
//   에서 `entries.map` **TypeError**(의도한 미구현)로 실패한다.
//
// 계약(GREEN 이 구현):
//   feeds(vault, {from,to,count,after}) — P5 부터 **아티팩트 소비자**다(D-E). 억제·정렬·경계·
//   tie-break·continuation 은 `pageFeeds` 에 **위임**(endpoints 층 재구현 금지 · SSOT · FC5).
//     from/to/count 의미 표면 보존(값경계·상한) · nextCursor 필드 **가산**(당시 schemaVersion 불변).
//     ☞ P4 에서 공용 `SCHEMA_VERSION` 이 1 → 2, P5(D-G · §4 원장 ⑭)가 2 → **3** 이 된다 — feeds
//     봉투 **형태**는 `inputsFingerprint` 가산(D-G) 외엔 그대로다.
//   P5 · §4 원장 ③ — `feeds()` 가 async 가 됐다(신선도 확보가 `runSummaryGenerator` 재사용이라
//   async 다). 단언 **내용**은 무변경 — `await` 만 붙는다.
import { describe, expect, it } from 'vitest'

import { cleanup, commit, feedCommit, initVault, writeDoc } from './helpers/tmp-git-vault.mjs' // prettier-ignore
import { writeFileSync } from 'node:fs'
import path from 'node:path'

const { feeds } = await import(new URL('../feeds.mjs', import.meta.url).href)

const ID_A = '0192a000-0000-7000-8000-0000000000aa'
const T1 = '2026-01-01T00:00:00Z'
const T2 = '2026-01-02T00:00:00Z'
const T3 = '2026-01-03T00:00:00Z'
const T4 = '2026-01-04T00:00:00Z'

/**
 * `feeds()` 응답의 **키 전량**(정렬) — wire 봉투 4키 + `nextCursor` 가산 = **5키**.
 *
 * 🔴 v3 P1(§4.3 ③ · §4.10 「조용한 통과」 E-F1 · KY4 · D28): 상관 토큰이 wire 에서 빠진다.
 *   ★ 이 배열은 **정확 일치**로 쓰인다. 예전에는 `expect.arrayContaining(...)` 이었는데 그것은
 *   **부분집합** 판정이라 착륙 후 `inputsFingerprint` 가 응답에 그대로 남아 있어도 **green** 이다 —
 *   "빠졌다" 를 검사하겠다는 케이스가 정확히 그 반대를 통과시킨다. §4.3-③ 이 요구한 「원소 제거 +
 *   정렬 일치」(규범 N)를 여기서 이행한다.
 *   ★ `env` 는 **여기 신설되지 않는다** — 그것은 파이프라인 P2 소관이고, 이 배열은 "지금 상태"
 *   이지 미래 계약이 아니다(tdd §9). 값은 **리터럴**이다 — 구현 상수를 import 하지 않는다(규범 A).
 */
const PAGE_KEYS = ['generatedAt', 'items', 'nextCursor', 'schemaVersion', 'sourceCommit']
const titlesOf = (page) => page.items.map((item) => item.title)
const idsOf = (page) => page.items.map((item) => item.id)

function seedFeed(vault, { date, subject }) {
  writeDoc(vault, 'company/삼성', { body: `## 정의\n\n${subject} 갱신.\n`, id: ID_A })
  return feedCommit(vault, { date, subject }).slice(0, 12)
}

/** 4 feed(ts T1..T4, 제목 n1..n4). */
function seedFour(vault) {
  writeDoc(vault, 'company/삼성', { id: ID_A })
  commit(vault, 'chore: 삼성 생성')
  seedFeed(vault, { date: T1, subject: 'n1' })
  seedFeed(vault, { date: T2, subject: 'n2' })
  seedFeed(vault, { date: T3, subject: 'n3' })
  seedFeed(vault, { date: T4, subject: 'n4' })
}

describe('endpoints.feeds — on-demand 슬라이스 봉투 (E-F1 🔴RED 전환)', () => {
  it('E-F1: feeds(vault, {count}) → 최신순 count건·유효 봉투(schemaVersion=1)', async () => {
    const vault = initVault()
    try {
      seedFour(vault)

      const page = await feeds(vault, 'dev', { count: 3 })

      expect(titlesOf(page)).toEqual(['n4', 'n3', 'n2'])
      // 🔴 v3 P1 · D29(§4.3 ②) — `SCHEMA_VERSION` 은 3 페이로드 **공용**이다(P2 확정: 쪼개면
      //   `WikiDataProvider` 부팅 게이트가 영구 false). 그 공용 상수를 **1 로 리셋**한다.
      expect(page.schemaVersion).toBe(1)
      // 앵커(규범 B): 봉투가 **비어 있지 않다** — 키 0개짜리 응답이 "여분 키 없음" 으로 통과하는
      //   것을 배제한다(정확 일치는 그 자체로 개수도 문다).
      expect(Object.keys(page).length).toBeGreaterThan(0)
      // ★ 부분집합(`arrayContaining`)이 아니라 **정렬 정확 일치**다 — 여분 키 1개가 곧 red 다.
      expect(Object.keys(page).toSorted()).toEqual(PAGE_KEYS)
    } finally {
      cleanup(vault)
    }
  })
})

describe('endpoints.feeds — nextCursor 연속 seam (E-F2 🔴RED 신규 필드)', () => {
  it('E-F2: 1페이지 nextCursor 로 2페이지 → 연속(누락·중복 0)', async () => {
    const vault = initVault()
    try {
      seedFour(vault)

      const page1 = await feeds(vault, 'dev', { count: 2 }) // [n4, n3]
      const page2 = await feeds(vault, 'dev', { after: page1.nextCursor, count: 2 }) // [n2, n1]

      expect(titlesOf(page1)).toEqual(['n4', 'n3'])
      expect(page1.nextCursor).toBeDefined()
      expect(titlesOf(page2)).toEqual(['n2', 'n1'])
      expect(idsOf(page2).filter((id) => idsOf(page1).includes(id))).toEqual([]) // 중복 0
    } finally {
      cleanup(vault)
    }
  })
})

describe('endpoints.feeds — 억제·정렬 재구현 안 함(pageFeeds 위임) (E-F3 🔴RED SSOT)', () => {
  it('E-F3: 억제·정렬이 pageFeeds 로 위임돼 결과에 반영된다(자체 재구현 아님)', async () => {
    const vault = initVault()
    try {
      writeDoc(vault, 'company/삼성', { id: ID_A })
      commit(vault, 'chore: 삼성 생성')
      seedFeed(vault, { date: T1, subject: 'n1' })
      seedFeed(vault, { date: T3, subject: 'n3-남음' })
      const suppressed = seedFeed(vault, { date: T2, subject: 'n2-억제' })
      writeFileSync(
        path.join(vault, 'ignore-feeds.json'),
        JSON.stringify([{ id: suppressed, when: '2026-07-23T00:00:00Z' }]),
        'utf8',
      )

      const page = await feeds(vault, 'dev', { count: 10 })

      expect(titlesOf(page)).toEqual(['n3-남음', 'n1']) // 억제(n2) + ts 내림차순 위임 결과
    } finally {
      cleanup(vault)
    }
  })
})
