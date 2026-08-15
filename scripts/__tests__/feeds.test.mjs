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
//   feeds(vault, {from,to,count,after}) — 매 호출마다 `walkCursorPage`(`lib/feed-cursor.mjs`)로
//   커서 기반 **라이브 워크**해 페이지를 계산한다(D-E). `pageFeeds` 는 개념째 사라졌고 이 함수는
//   사전 빌드된 아티팩트를 소비하지 않는다 — 억제·정렬·경계·tie-break·continuation 은 그 워크
//   안에서 결정된다(endpoints 층 재구현 금지 원칙은 유지된다).
//     from/to/count 의미 표면 보존(값경계·상한) · nextCursor 필드 **가산**(당시 schemaVersion 불변).
//     ☞ P4 에서 공용 `SCHEMA_VERSION` 이 1 → 2, P5(D-G · §4 원장 ⑭)가 2 → **3** 이 된다 — feeds
//     봉투 **형태**는 스키마 버전 리셋 외엔 그대로다.
//   P5 · §4 원장 ③ — `feeds()` 가 async 가 됐다(신선도 확보가 `runSummaryGenerator` 재사용이라
//   async 다). 단언 **내용**은 무변경 — `await` 만 붙는다.
import { describe, expect, it } from 'vitest'

import { prebuildArtifacts } from './helpers/prebuild-artifacts.mjs'
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
 *   **부분집합** 판정이라 착륙 후 잉여 키가 응답에 그대로 남아 있어도 **green** 이다 —
 *   "빠졌다" 를 검사하겠다는 케이스가 정확히 그 반대를 통과시킨다. §4.3-③ 이 요구한 「원소 제거 +
 *   정렬 일치」(규범 N)를 여기서 이행한다.
 *   ★ **v3 P2(D22) 로 `env` 가 들어왔다** — 이 배열이 예고한 그 변경이다. `SCHEMA_VERSION` 동결로
 *   표지 대조의 구분력이 "1 vs 1" 이 되면서 `env` 가 캐시 최소 검증의 유일한 판별축으로 남았고,
 *   그래서 wire 응답에도 실린다(규범 Q 층 ① = **6키**). 값은 **리터럴**이다(규범 A).
 */
const PAGE_KEYS = ['env', 'generatedAt', 'items', 'nextCursor', 'schemaVersion', 'sourceCommit']
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
      await prebuildArtifacts(vault, 'dev')

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
      await prebuildArtifacts(vault, 'dev')

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

describe('endpoints.feeds — 억제는 `ignore.mjs` 한 곳이다 (E-F3 🔴RED SSOT)', () => {
  it('E-F3: 명시한 억제 목록이 결과에 반영된다(자체 재구현 아님)', async () => {
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
      await prebuildArtifacts(vault, 'dev')

      // ★ v3 P2 · D20 — 억제는 **명시 인자로만** 걸린다(암묵 `loadIgnoreFeeds` 소멸 · IW6). 배선이
      //   호출부 책임이 되면서 이 arm 이 경로를 넘긴다 — 필터의 단일 구현(`lib/ignore.mjs`)은 그대로다.
      const page = await feeds(vault, 'dev', { count: 10, ignore: path.join(vault, 'ignore-feeds.json') }) // prettier-ignore

      expect(titlesOf(page)).toEqual(['n3-남음', 'n1']) // 억제(n2) + git 워크 순서(최신 → 과거)
    } finally {
      cleanup(vault)
    }
  })

  it('E-F3 소유권 앵커: 스키마 위반 억제 목록에서 로더의 fail-loud 가 그대로 올라온다', async () => {
    // ★ 위 케이스의 단언은 **출력 동치성뿐**이다 — `feeds.mjs` 가 로더를 인라인 재구현해도 같은
    //   출력을 내면 통과한다. 그래서 소유권을 따로 문다.
    //
    // ★★ 관측 수단으로 기각한 두 가지(둘 다 이 축에서 **공허**하다 · 실측):
    //   ① 실행 계측(`NODE_V8_COVERAGE`) — `lib/feed-cursor.mjs` 가 억제 **필터**(`applyIgnoreFeeds`)
    //      때문에 이미 `lib/ignore.mjs` 를 import 하고 `feeds.mjs` 는 어차피 `walkCursorPage` 를
    //      부른다. 그래서 **로더**를 재구현해도 그 모듈은 다른 경로로 여전히 로드된다.
    //   ② 정적 import 존재 확인 — 재구현자가 쓰지 않는 import 를 남겨 두면 그대로 통과한다.
    //      이 리포에는 미사용 import 를 잡는 린터가 없어서(훅·CI·ESLint 부재가 계약이다) 그 형태가
    //      실제로 관측됐다: import 를 남긴 채 로더만 인라인했더니 이 파일이 전부 green 이었다.
    //
    // 그래서 **로더만 갖는 계약**을 문다. `lib/ignore.mjs` 의 `loadIgnoreFeedsAt` 은 파일이
    // 존재하되 스키마를 위반하면 **throw** 한다(fail-open 은 부재일 때뿐이다 — "신뢰 못 할 억제
    // 목록을 조용히 무시하지 않는다"). 아래 목록은 **JSON 으로는 멀쩡하고** 스키마만 위반하므로,
    // 소박한 `JSON.parse` 재구현은 이것을 통과시켜 **검증되지 않은 억제**를 적용해 버린다.
    const vault = initVault()
    try {
      writeDoc(vault, 'company/삼성', { id: ID_A })
      commit(vault, 'chore: 삼성 생성')
      const target = seedFeed(vault, { date: T1, subject: 'n1' })
      const ignorePath = path.join(vault, 'ignore-feeds.json')
      // 필수 필드 `when` 이 없다 — 파싱은 되고 검증만 실패한다. `id` 는 유효해서, 검증을 건너뛰는
      //   구현이라면 이 항목으로 **실제 억제가 일어난다**(그래서 부작용이 관측 가능한 형태다).
      writeFileSync(ignorePath, JSON.stringify([{ id: target }]), 'utf8')
      await prebuildArtifacts(vault, 'dev')

      await expect(feeds(vault, 'dev', { count: 10, ignore: ignorePath })).rejects.toThrow(
        /스키마 위반/u,
      )
    } finally {
      cleanup(vault)
    }
  })
})
