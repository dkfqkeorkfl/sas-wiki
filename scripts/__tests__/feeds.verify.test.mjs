// @vitest-environment node
//
// P1 (hidden verify) · Task 3(P5 재작성) — endpoints.feeds spec-gaming 차단 — tdd §Task 3/§노후화 ·
//   P5 tdd §4 원장 ②
//
// 규약: `*.verify.test.*` 는 **GREEN 완료 후**에만 판정에 쓴다(RED 작성자·GREEN 구현자 비노출).
//   visible E-F1~F3 만으로는 "endpoints.feeds 가 자체 억제·정렬·슬라이스를 재구현" 해도 통과할 수
//   있다 — 아래가 그 우회를 막는다(Complete Mediation).
//
// P5 재작성 사유(§4 원장 ②): 전환 전에는 `endpoints.feeds(vault,opts).items` 를 `walkFeeds(vault,opts)`
//   와 직접 deep-equal 로 대조했다 — **같은 얕은 엔진**을 두 경로가 각자 불렀기 때문에 성립하는
//   동치였다. P5 이후 `feeds()` 는 발행 아티팩트(깊은 티어 · 생성기 co-derive)를 읽고, `walkFeeds` 는
//   여전히 **얕은 티어 참조 구현**이다(D-I 이전) — 실 vault 드리프트 0(tdd M7)에서는 우연히 같아도,
//   그 동치는 더 이상 "위임 증명" 이 아니다(다른 티어를 대조하는 것이라 재구현 여부와 무관해진다).
//   위임 증명의 자리는 이제 **아티팩트 파일 자체**가 잇는다(FC3 형태) — feeds() 가 반환하는 모든
//   item 이 파일에서 읽은 item 과 deep-equal 이면, feeds() 는 item 을 만들지 않고 고르기만 한 것이다.
//
// 게이트 방식: endpoints.feeds(vault, opts).items 의 모든 원소가 **feeds 아티팩트 파일의 item 과
//   deep-equal**(id 매칭) 임을 강제한다 — 봉투(+nextCursor)만 씌우고 억제·정렬·오프셋을 재구현하지
//   않으면 항상 성립한다. 세계관 손계산(titles·length)도 병행해 순환 방지.
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { cleanup, commit, feedCommit, initVault, writeDoc } from './helpers/tmp-git-vault.mjs' // prettier-ignore

const { feeds } = await import(new URL('../feeds.mjs', import.meta.url).href)

const ID_A = '0192a000-0000-7000-8000-0000000000aa'
const T1 = '2026-01-01T00:00:00Z'
const T2 = '2026-01-02T00:00:00Z'
const T3 = '2026-01-03T00:00:00Z'
const T4 = '2026-01-04T00:00:00Z'
const T5 = '2026-01-05T00:00:00Z'

const titlesOf = (items) => items.map((item) => item.title)

/** feeds 아티팩트 경로 — **리터럴 조립**(규범 A). 정확 형태의 계약은 PL9 가 한 번만 고정한다. */
const feedsArtifactFile = (vault, env) => path.join(vault, 'cache', `feeds.${env}.json`)

function seedFeed(vault, { date, subject }) {
  writeDoc(vault, 'company/삼성', { body: `## 정의\n\n${subject} 갱신.\n`, id: ID_A })
  return feedCommit(vault, { date, subject }).slice(0, 12)
}

function writeIgnore(vault, feedIds) {
  const entries = feedIds.map((id) => ({ id, when: '2026-07-23T00:00:00Z' }))
  writeFileSync(path.join(vault, 'ignore-feeds.json'), JSON.stringify(entries), 'utf8')
}

/** 아티팩트 파일에서 읽은 item(id 매칭) — 위임 증명의 좌표(FC3 형태). */
function artifactItemsOf(vault, env = 'dev') {
  return JSON.parse(readFileSync(feedsArtifactFile(vault, env), 'utf8')).items
}

/** feeds() 가 item 을 **만들지 않는다** — 반환된 모든 item 이 파일에서 읽은 item 과 deep-equal. */
function expectDelegated(page, vault) {
  const byId = new Map(artifactItemsOf(vault).map((item) => [item.id, item]))
  expect(page.items.length).toBeGreaterThan(0) // 앵커: 빈 응답으로 공허 통과하는 것을 배제
  for (const item of page.items) expect(item).toEqual(byId.get(item.id))
}

describe('endpoints.feeds.verify — 억제 ⟂ 슬라이스 위임 (V1 🔴RED)', () => {
  it('V1: 창 안 억제 시 응답 item 이 아티팩트와 deep-equal, count 정확(slice-후-억제로 새지 않음)', async () => {
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

      const page = await feeds(vault, 'dev', opts)

      expectDelegated(page, vault) // 봉투만 — 재구현 아님(FC3 형태)
      expect(page.items).toHaveLength(3) // 억제-후-slice: 창이 꽉 찬다(slice-후-억제면 2)
      expect(titlesOf(page.items)).toEqual(['n5', 'n3', 'n2'])
    } finally {
      cleanup(vault)
    }
  })
})

describe('endpoints.feeds.verify — 정렬 위임 (V2 🔴RED)', () => {
  it('V2: author-date 를 커밋순서와 역행 시딩 → ts 내림차순(재정렬 위임 · 입력 순서 무의존)', async () => {
    const vault = initVault()
    try {
      writeDoc(vault, 'company/삼성', { id: ID_A })
      commit(vault, 'cwiki: 생성')
      seedFeed(vault, { date: T2, subject: '최고참' })
      seedFeed(vault, { date: T5, subject: '최신' })
      seedFeed(vault, { date: T3, subject: '중간' })
      const opts = { count: 10 }

      const page = await feeds(vault, 'dev', opts)

      expectDelegated(page, vault)
      expect(titlesOf(page.items)).toEqual(['최신', '중간', '최고참'])
    } finally {
      cleanup(vault)
    }
  })
})

describe('endpoints.feeds.verify — offset 무드리프트 (V3 🔴RED)', () => {
  it('V3: 창 안 억제로 빠진 자리를 다음 항목이 승격해 채운다(구멍·undefined 없음)', async () => {
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

      const page = await feeds(vault, 'dev', opts)

      expectDelegated(page, vault)
      expect(page.items).toHaveLength(3) // 드리프트로 length 2 가 되면 안 된다
      expect(titlesOf(page.items)).toEqual(['n5', 'n4', 'n2']) // n3 자리를 n2 가 승격
      expect(page.items.every((item) => item && typeof item.ts === 'string')).toBe(true)
    } finally {
      cleanup(vault)
    }
  })
})
