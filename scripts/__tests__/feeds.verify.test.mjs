// @vitest-environment node
//
// P1 (hidden verify) · Task 3 — endpoints.feeds spec-gaming 차단 (walkFeeds 위임) — tdd §Task 3/§노후화
//
// 규약: `*.verify.test.*` 는 **GREEN 완료 후**에만 판정에 쓴다(RED 작성자·GREEN 구현자 비노출).
//   visible E-F1~F3 만으로는 "walkFeeds 를 우회해 endpoints.feeds 가 자체 억제·정렬·슬라이스를 재구현"
//   해도 통과할 수 있다 — 아래가 그 우회를 막는다(Complete Mediation).
//
// RED 사유: `git-walk.mjs`(walkFeeds) **부재** → 지연 import 가 "Cannot find module" 로 throw → 전 케이스
//   로드 실패 RED. 그리고 `feeds` 는 vault 경로 전환 미구현이라 TypeError(엔진 전환).
//
// 게이트 방식: endpoints.feeds(vault, opts).items 가 **walkFeeds(vault, opts) 와 deep-equal** 임을 강제한다
//   — 봉투(+nextCursor)만 씌우고 억제·정렬·오프셋을 재구현하지 않으면 항상 일치한다. 재구현으로 조금이라도
//   갈리면(slice-후-억제·다른 comparator·offset 드리프트) 실패한다. 세계관 손계산(titles)도 병행해 순환 방지.
import { writeFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { cleanup, commit, feedCommit, initVault, writeDoc } from './helpers/tmp-git-vault.mjs' // prettier-ignore

const { walkFeeds } = await import(new URL('../lib/git-walk.mjs', import.meta.url).href)
const { feeds } = await import(new URL('../feeds.mjs', import.meta.url).href)

const ID_A = '0192a000-0000-7000-8000-0000000000aa'
const T1 = '2026-01-01T00:00:00Z'
const T2 = '2026-01-02T00:00:00Z'
const T3 = '2026-01-03T00:00:00Z'
const T4 = '2026-01-04T00:00:00Z'
const T5 = '2026-01-05T00:00:00Z'

const titlesOf = (items) => items.map((item) => item.title)

function seedFeed(vault, { date, subject }) {
  writeDoc(vault, 'company/삼성', { body: `## 정의\n\n${subject} 갱신.\n`, id: ID_A })
  return feedCommit(vault, { date, subject }).slice(0, 12)
}

function writeIgnore(vault, feedIds) {
  const entries = feedIds.map((id) => ({ id, when: '2026-07-23T00:00:00Z' }))
  writeFileSync(path.join(vault, 'ignore-feeds.json'), JSON.stringify(entries), 'utf8')
}

describe('endpoints.feeds.verify — 억제 ⟂ 슬라이스 위임 (V1 🔴RED)', () => {
  it('V1: 창 안 억제 시 endpoints.feeds == walkFeeds, count 정확(slice-후-억제로 새지 않음)', () => {
    const vault = initVault()
    try {
      writeDoc(vault, 'company/삼성', { id: ID_A })
      commit(vault, 'cwiki: 생성')
      seedFeed(vault, { date: T1, subject: 'n1' })
      seedFeed(vault, { date: T2, subject: 'n2' })
      seedFeed(vault, { date: T3, subject: 'n3' })
      const suppressed = seedFeed(vault, { date: T4, subject: 'n4' }) // 정렬 후 top-3 창 안
      seedFeed(vault, { date: T5, subject: 'n5' })
      writeIgnore(vault, [suppressed])
      const opts = { count: 3 }

      const page = feeds(vault, 'dev', opts)

      expect(page.items).toEqual(walkFeeds(vault, opts)) // 봉투만 — 재구현 아님
      expect(page.items).toHaveLength(3) // 억제-후-slice: 창이 꽉 찬다(slice-후-억제면 2)
      expect(titlesOf(page.items)).toEqual(['n5', 'n3', 'n2'])
    } finally {
      cleanup(vault)
    }
  })
})

describe('endpoints.feeds.verify — 정렬 위임 (V2 🔴RED)', () => {
  it('V2: author-date 를 커밋순서와 역행 시딩 → ts 내림차순(재정렬 위임 · 입력 순서 무의존)', () => {
    const vault = initVault()
    try {
      writeDoc(vault, 'company/삼성', { id: ID_A })
      commit(vault, 'cwiki: 생성')
      seedFeed(vault, { date: T2, subject: '최고참' })
      seedFeed(vault, { date: T5, subject: '최신' })
      seedFeed(vault, { date: T3, subject: '중간' })
      const opts = { count: 10 }

      const page = feeds(vault, 'dev', opts)

      expect(page.items).toEqual(walkFeeds(vault, opts))
      expect(titlesOf(page.items)).toEqual(['최신', '중간', '최고참'])
    } finally {
      cleanup(vault)
    }
  })
})

describe('endpoints.feeds.verify — offset 무드리프트 (V3 🔴RED)', () => {
  it('V3: 창 안 억제로 빠진 자리를 다음 항목이 승격해 채운다(구멍·undefined 없음)', () => {
    const vault = initVault()
    try {
      writeDoc(vault, 'company/삼성', { id: ID_A })
      commit(vault, 'cwiki: 생성')
      seedFeed(vault, { date: T1, subject: 'n1' })
      seedFeed(vault, { date: T2, subject: 'n2' })
      const suppressed = seedFeed(vault, { date: T3, subject: 'n3' }) // top-3 창 안 억제
      seedFeed(vault, { date: T4, subject: 'n4' })
      seedFeed(vault, { date: T5, subject: 'n5' })
      writeIgnore(vault, [suppressed])
      const opts = { count: 3 }

      const page = feeds(vault, 'dev', opts)

      expect(page.items).toEqual(walkFeeds(vault, opts))
      expect(page.items).toHaveLength(3) // 드리프트로 length 2 가 되면 안 된다
      expect(titlesOf(page.items)).toEqual(['n5', 'n4', 'n2']) // n3 자리를 n2 가 승격
      expect(page.items.every((item) => item && typeof item.ts === 'string')).toBe(true)
    } finally {
      cleanup(vault)
    }
  })
})
