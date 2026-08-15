// @vitest-environment node
//
// P1 (hidden verify) · Task 3(P5 재작성) — endpoints.feeds spec-gaming 차단 — tdd §Task 3/§노후화 ·
//   P5 tdd §4 원장 ②
//
// 규약: `*.verify.test.*` 는 **GREEN 완료 후**에만 판정에 쓴다(RED 작성자·GREEN 구현자 비노출).
//   ★ 다만 이 파일은 "재구현 우회를 막는 게이트" 가 **아니다.** 한때 그렇게 적혀 있었고 그 서술이
//   거짓이었다 — 아래 「이 파일이 실제로 무엇을 검증하는가」를 읽어라.
//
// ★ v3 P2 재조준 사유(tdd §4.5-⑥ · D20·D39): 조회 경로가 **라이브 커서 워크**로 교체되면서 두 축이
//   움직인다. ① 억제는 **명시 인자**(`--ignore`/`{ignore}`)로만 걸린다(D20 — 암묵 로드 소멸 · IW6)라
//   각 arm 이 경로를 넘긴다. ② **정렬 권위가 JS 재정렬에서 git 워크 순서로 이전**된다(D39) —
//   `git-walk.test.mjs` GW3 가 같은 사유로 정리됐고, V2 는 그 이전을 **엔드포인트 층에서** 문다
//   (기대를 뒤집은 것이지 약화가 아니다: 재정렬을 되살린 구현이 이제 red 다).
//
// P5 재작성 사유(§4 원장 ②): 전환 전에는 `endpoints.feeds(vault,opts).items` 를 `walkFeeds(vault,opts)`
//   와 직접 deep-equal 로 대조했다 — **같은 얕은 엔진**을 두 경로가 각자 불렀기 때문에 성립하는
//   동치였다. P5 이후 `feeds()` 는 발행 아티팩트(깊은 티어 · 생성기 co-derive)를 읽고, `walkFeeds` 는
//   여전히 **얕은 티어 참조 구현**이다(D-I 이전) — 실 vault 드리프트 0(tdd M7)에서는 우연히 같아도,
//   그 동치는 더 이상 "위임 증명" 이 아니다(다른 티어를 대조하는 것이라 재구현 여부와 무관해진다).
//   그 뒤 이 자리에 "위임 증명의 자리는 이제 아티팩트 파일과의 deep-equal 이 잇는다" 고 적혀
//   있었는데, **그것도 성립하지 않는다.**
//
// 이 파일이 실제로 무엇을 검증하는가 (변이를 걸어 실측 확정):
//   · 서빙 층에 억제 필터를 한 번 더 적용하는 재구현(멱등이라 출력이 동일)을 넣으면 이 파일 3케이스가
//     **전부 green** 이다. 값이 같으면 통과하는 단언은 "그 값을 어떻게 만들었는가" 를 원리적으로 볼 수
//     없다. 재구현 금지의 소유자는 **소스를 읽는** `feeds.artifact-consumer.test.mjs` 의 FC5 이고,
//     아티팩트를 손수 읽지 않음의 소유자는 `lib/__tests__/artifact.read.test.mjs` 의 RD11 이다. 같은
//     변이에서 그 둘만 red 가 되는 것을 확인했다.
//   · 남아 있는 아티팩트 대조(`expectItemsMatchArtifact`)는 **캐시 티어와 라이브 워크가 같은 item 을
//     낸다**는 등가 확인이다. 위임 증명이 아니다. 세계관 손계산(titles·length)이 순환을 막는다.
//   · ★ **V2 는 이 스위트에서 단독 소유하는 축이 있다**(그 케이스 주석 참조). 이 파일을 "중복" 으로
//     지우면 그 축의 보호가 통째로 사라진다.
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { prebuildArtifacts } from './helpers/prebuild-artifacts.mjs'
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

/** 아티팩트 파일에서 읽은 item(id 매칭). */
function artifactItemsOf(vault, env = 'dev') {
  return JSON.parse(readFileSync(feedsArtifactFile(vault, env), 'utf8')).items
}

/**
 * 캐시 티어(발행 아티팩트)와 라이브 워크가 **같은 item 을 낸다** — 반환된 모든 item 이 파일에서 읽은
 * 같은 id 의 item 과 deep-equal.
 *
 * ★ 이것은 **위임 증명이 아니다.** 값이 같기만 하면 통과하므로, 서빙 층이 억제·정렬·슬라이스를
 *   재구현해도 결과가 같으면 그대로 통과한다(실측 확인). 그 축은 소스를 읽는 정적 케이스가 소유한다.
 */
function expectItemsMatchArtifact(page, vault) {
  const byId = new Map(artifactItemsOf(vault).map((item) => [item.id, item]))
  expect(page.items.length).toBeGreaterThan(0) // 앵커: 빈 응답으로 공허 통과하는 것을 배제
  for (const item of page.items) expect(item).toEqual(byId.get(item.id))
}

describe('endpoints.feeds.verify — 억제 ⟂ 슬라이스 위임 (V1 🔴RED)', () => {
  it('V1: 창 안 억제 시 응답 item 이 아티팩트와 deep-equal, count 정확(slice-후-억제로 새지 않음)', async () => {
    const vault = initVault()
    try {
      writeDoc(vault, 'company/삼성', { id: ID_A })
      commit(vault, 'chore: 생성')
      seedFeed(vault, { date: T1, subject: 'n1' })
      seedFeed(vault, { date: T2, subject: 'n2' })
      seedFeed(vault, { date: T3, subject: 'n3' })
      const suppressed = seedFeed(vault, { date: T4, subject: 'n4' }) // 정렬 후 top-3 창 안
      seedFeed(vault, { date: T5, subject: 'n5' })
      writeIgnore(vault, [suppressed])
      await prebuildArtifacts(vault, 'dev')
      const opts = { count: 3, ignore: path.join(vault, 'ignore-feeds.json') }

      const page = await feeds(vault, 'dev', opts)

      expectItemsMatchArtifact(page, vault) // 캐시 티어 등가 — 재구현 여부는 여기서 안 갈린다
      expect(page.items).toHaveLength(3) // 억제-후-slice: 창이 꽉 찬다(slice-후-억제면 2)
      expect(titlesOf(page.items)).toEqual(['n5', 'n3', 'n2'])
    } finally {
      cleanup(vault)
    }
  })
})

describe('endpoints.feeds.verify — 정렬 권위는 git 워크 순서다 (V2 · v3 P2 · D39)', () => {
  it('V2: author-date 를 커밋순서와 역행 시딩 → **커밋 순서**대로 나온다(JS 재정렬 없음)', async () => {
    // ★★ **기대를 뒤집었다(D39).** 옛 계약은 _"walkFeeds 가 무엇을 주든 ts 내림차순으로 재정렬한다"_
    //   였고 `byRecencyThenId` 가 그 권위였다. v3 P2 는 조회를 커서 기반 git 워크로 바꾸면서 권위를
    //   **워크 순서**로 옮긴다 — `nextCursor` 가 「이 페이지 마지막 항목의 커밋」이라 페이지 순서가
    //   워크 순서와 어긋나면 다음 페이지의 시작점 자체가 틀어지기 때문이다(중복·누락).
    //   ⇒ 이 케이스는 **재정렬을 되살린 구현을 red 로 만드는** 자리로 극성이 반전됐다. 옛 방향의
    //   보상(클라이언트가 한 번 더 시간순 정렬)은 **D37 = 파이프라인 P5** 소관이다.
    //
    // ★★ **이 케이스는 스위트 전체에서 이 축을 단독 소유한다 — 실측으로 확정했다.** 서빙 층에 `ts`
    //   내림차순 재정렬을 되살리는 변이를 걸고 대체 후보 5파일(`feeds.artifact-consumer` ·
    //   `feeds.cursor-paging` · `serving.cost-profile` · `lib/artifact.read` · `lib/feed-cursor`)을
    //   전부 돌렸더니 55케이스가 **전부 green** 이었고 red 는 이 케이스뿐이었다.
    //   원인은 시딩에 있다 — 공용 헬퍼 `helpers/cursor-vault.mjs` 의 `seedFeedVault` 는 커밋에 날짜를
    //   주지 않아 author-date 가 단조 증가한다. 그러면 워크 순서와 ts 내림차순이 **우연히 같아져**
    //   재정렬을 되살려도 결과가 변하지 않는다. 아래 역행 시딩(T2 → T5 → T3)만 그 둘을 갈라 놓는다.
    //   ⇒ 이 시딩의 날짜를 "정리" 하지 마라. 그 순간 이 케이스는 아무것도 검증하지 않게 된다.
    const vault = initVault()
    try {
      writeDoc(vault, 'company/삼성', { id: ID_A })
      commit(vault, 'chore: 생성')
      seedFeed(vault, { date: T2, subject: '최고참' })
      seedFeed(vault, { date: T5, subject: '최신' })
      seedFeed(vault, { date: T3, subject: '중간' })
      await prebuildArtifacts(vault, 'dev')
      const opts = { count: 10 }

      const page = await feeds(vault, 'dev', opts)

      expectItemsMatchArtifact(page, vault)
      // 커밋 순서(최신 커밋 → 과거)다. ts 내림차순이면 `['최신','중간','최고참']` 이 됐을 것이다 —
      //   두 배열이 **다르다**는 것이 이 시딩의 존재 이유이고, 그래서 이 단언이 방향을 가른다.
      expect(titlesOf(page.items)).toEqual(['중간', '최신', '최고참'])
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
      commit(vault, 'chore: 생성')
      seedFeed(vault, { date: T1, subject: 'n1' })
      seedFeed(vault, { date: T2, subject: 'n2' })
      const suppressed = seedFeed(vault, { date: T3, subject: 'n3' }) // top-3 창 안 억제
      seedFeed(vault, { date: T4, subject: 'n4' })
      seedFeed(vault, { date: T5, subject: 'n5' })
      writeIgnore(vault, [suppressed])
      await prebuildArtifacts(vault, 'dev')
      const opts = { count: 3, ignore: path.join(vault, 'ignore-feeds.json') }

      const page = await feeds(vault, 'dev', opts)

      expectItemsMatchArtifact(page, vault)
      expect(page.items).toHaveLength(3) // 드리프트로 length 2 가 되면 안 된다
      expect(titlesOf(page.items)).toEqual(['n5', 'n4', 'n2']) // n3 자리를 n2 가 승격
      expect(page.items.every((item) => item && typeof item.ts === 'string')).toBe(true)
    } finally {
      cleanup(vault)
    }
  })
})
