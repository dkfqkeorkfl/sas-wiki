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
//   feeds(vault, {from,to,count,after}) = walkFeeds(vault, {...}) + buildFeeds 봉투.
//     from/to/count 의미 표면 보존(값경계·상한) · nextCursor 필드 **가산**(schemaVersion 불변=1).
//     억제·정렬·경계·tie-break·continuation 은 walkFeeds 에 **위임**(endpoints 층 재구현 금지 · SSOT).
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

const ENVELOPE_KEYS = ['generatedAt', 'items', 'schemaVersion', 'sourceCommit']
const titlesOf = (page) => page.items.map((item) => item.title)
const idsOf = (page) => page.items.map((item) => item.id)

function seedFeed(vault, { date, subject }) {
  writeDoc(vault, 'company/삼성', { body: `## 정의\n\n${subject} 갱신.\n`, id: ID_A })
  return feedCommit(vault, { date, subject }).slice(0, 12)
}

/** 4 feed(ts T1..T4, 제목 n1..n4). */
function seedFour(vault) {
  writeDoc(vault, 'company/삼성', { id: ID_A })
  commit(vault, 'cwiki: 삼성 생성')
  seedFeed(vault, { date: T1, subject: 'n1' })
  seedFeed(vault, { date: T2, subject: 'n2' })
  seedFeed(vault, { date: T3, subject: 'n3' })
  seedFeed(vault, { date: T4, subject: 'n4' })
}

describe('endpoints.feeds — on-demand 슬라이스 봉투 (E-F1 🔴RED 전환)', () => {
  it('E-F1: feeds(vault, {count}) → 최신순 count건·유효 봉투(schemaVersion=1)', () => {
    const vault = initVault()
    try {
      seedFour(vault)

      const page = feeds(vault, 'dev', { count: 3 })

      expect(titlesOf(page)).toEqual(['n4', 'n3', 'n2'])
      expect(page.schemaVersion).toBe(1)
      expect(Object.keys(page).toSorted()).toEqual(expect.arrayContaining(ENVELOPE_KEYS))
    } finally {
      cleanup(vault)
    }
  })
})

describe('endpoints.feeds — nextCursor 연속 seam (E-F2 🔴RED 신규 필드)', () => {
  it('E-F2: 1페이지 nextCursor 로 2페이지 → 연속(누락·중복 0)', () => {
    const vault = initVault()
    try {
      seedFour(vault)

      const page1 = feeds(vault, 'dev', { count: 2 }) // [n4, n3]
      const page2 = feeds(vault, 'dev', { after: page1.nextCursor, count: 2 }) // [n2, n1]

      expect(titlesOf(page1)).toEqual(['n4', 'n3'])
      expect(page1.nextCursor).toBeDefined()
      expect(titlesOf(page2)).toEqual(['n2', 'n1'])
      expect(idsOf(page2).filter((id) => idsOf(page1).includes(id))).toEqual([]) // 중복 0
    } finally {
      cleanup(vault)
    }
  })
})

describe('endpoints.feeds — walkFeeds 위임(억제·정렬 재구현 안 함) (E-F3 🔴RED SSOT)', () => {
  it('E-F3: 억제·정렬이 walkFeeds 로 위임돼 결과에 반영된다(자체 재구현 아님)', () => {
    const vault = initVault()
    try {
      writeDoc(vault, 'company/삼성', { id: ID_A })
      commit(vault, 'cwiki: 삼성 생성')
      seedFeed(vault, { date: T1, subject: 'n1' })
      seedFeed(vault, { date: T3, subject: 'n3-남음' })
      const suppressed = seedFeed(vault, { date: T2, subject: 'n2-억제' })
      writeFileSync(
        path.join(vault, 'ignore-feeds.json'),
        JSON.stringify([{ id: suppressed, when: '2026-07-23T00:00:00Z' }]),
        'utf8',
      )

      const page = feeds(vault, 'dev', { count: 10 })

      expect(titlesOf(page)).toEqual(['n3-남음', 'n1']) // 억제(n2) + ts 내림차순 위임 결과
    } finally {
      cleanup(vault)
    }
  })
})
