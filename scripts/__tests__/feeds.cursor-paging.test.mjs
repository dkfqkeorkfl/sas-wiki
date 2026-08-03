// @vitest-environment node
//
// v3 P2 · Task 5·6 — 페이지 경계·집합 계약 (WA4~WA8·WA10) · 생존 판정 경로(JS1·JS2) ·
//                    D48 등가 불변식(QX1·QX2) — tdd §3.2·§3.6·§3.7·§3.9
//
// ★ **집합 계층**은 P2 가 신설하는 계층이다(규범 Q 표 밖). 개수 단독으로는 아무것도 못 문다 —
//   "중복 0" 은 인접 두 페이지의 **국소** 단언이고 "합집합 == 전체" 는 **전역** 단언이라 3페이지
//   이상에서 **중간이 통째로 빠지는** 형태는 후자만 잡는다. 그래서 WA4 와 WA10 을 합치지 않는다.
//
// ── 관측 층 ─────────────────────────────────────────────────────────────────────────────────
//   `feeds.mjs` **stdout**(= 규범 Q 층 ①). 모듈 API `feeds(vault, env, window)` 를 쓰지 않는 이유는
//   `helpers/cursor-vault.mjs` 헤더에 있다 — 억제·count 의 전달 계약을 PRD 가 **CLI 인자로** 못박았고
//   모듈 window 키는 tdd 가 확정하지 않았다(이름을 발명하면 RED 가 "미구현" 이 아니라 "이름 불일치"로
//   실패한다).
//
// ── RED 사유 (전부 **미구현**) ──────────────────────────────────────────────────────────────
//   · WA4~WA8·WA10 — 조회 경로가 아직 **아티팩트 읽기**다(`feeds.mjs:31-54`). 캐시가 없는 tmp vault
//     에서 exit 1 이고, 캐시가 있어도 `--after` 가 **JSON 커서**라 12-hex 문자열을 못 받는다.
//   · JS1 — 워크 1회 실행 자체가 성립하지 않는다(같은 사유).
//   · JS2 — 라이브 워크가 없으니 생존 판정이 조회 경로에서 돌지 않는다.
//   · QX1·QX2 — `--ignore` 가 **Unknown option** 이고 아티팩트에 `nextCursor` 가 없다.
//
// 규범 A: 기대 id 집합은 **테스트가 시딩한 커밋 해시**다(구현이 계산한 `nextCursor` 와 독립한 축).
//   페이지 크기·상한 루프 횟수·억제 건수는 전부 본문 리터럴이다.
// 규범 B: 부재·집합 단언 앞에 앵커 — 페이지 수 ≥ 2 · 각 arm 이 비어 있지 않다 · 대조 vault.
// 규범 F: 실 vault 를 건드리지 않는다. `ignore-feeds.json` 은 tmp vault 안에서만 만든다.
import { readFileSync, rmSync } from 'node:fs'
import path from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'

import { runCliWithLoadLog } from './helpers/runtime-load.mjs'
import { cleanup, commit, feedCommit, initVault, writeDoc } from './helpers/tmp-git-vault.mjs'
import { collectPages, readFeedPage, runFeedsCli, seedFeedVault } from './helpers/cursor-vault.mjs'

/** 12-hex 정규식 — 리터럴이다(스키마·프로덕션에서 유도하지 않는다). */
const HEX12 = /^[0-9a-f]{12}$/u
/** 순회 상한 — 리터럴. 초과하면 그 사실 자체가 실패다(무한 루프 방지 · §3.9 G1). */
const MAX_PAGES = 20
/** 실 git 을 훑는 케이스의 케이스별 상한. **전역 `testTimeout` 은 올리지 않는다**(P1 OQ-P1-2 (c)). */
const WALK_TIMEOUT = 300_000

const tmps = []
afterAll(() => cleanup(...tmps))

const idsOf = (page) => page.items.map((item) => item.id)
const sortedUnique = (values) => [...new Set(values)].sort()

// ────────────────────────────────────────────────────────────────────────────
// WA4·WA5·WA6 — 인접 페이지 경계 (CJ2 · D45)
// ────────────────────────────────────────────────────────────────────────────

describe('페이지 경계 — 중복 0 · 누락 0 (WA4·WA5 · CJ2 · 🔴RED 라이브 워크 부재)', () => {
  it(
    'WA4: 연속 두 페이지가 서로소이고 합집합이 시딩 6건 전량이다',
    { timeout: WALK_TIMEOUT },
    () => {
      // ★ `--skip=1` 이 없으면 `git rev-list <hash>` 가 **그 커밋 자신을 포함**하므로 페이지마다
      //   정확히 1건 겹친다(C7 축자: _"`<rev>` and its ancestors"_). 중복이 1건뿐이라 "대충 맞아
      //   보이는" 형태라서 **개수 단독**으로는 못 잡는다 — 집합 단언이 함께 있어야 한다(규범 N).
      const seeded = seedFeedVault({ feedCount: 6 })
      tmps.push(seeded.vault)

      const page1 = readFeedPage(seeded.vault, { count: 3 })
      // 앵커: 커서가 **12-hex 문자열**이다(옛 `{feedId, ts}` 객체면 여기서 죽는다 · D7·D8).
      expect(typeof page1.nextCursor, `nextCursor=${JSON.stringify(page1.nextCursor)}`).toBe(
        'string',
      )
      expect(page1.nextCursor).toMatch(HEX12)

      const page2 = readFeedPage(seeded.vault, { after: page1.nextCursor, count: 3 })

      const ids1 = idsOf(page1)
      const ids2 = idsOf(page2)
      expect(ids1).toHaveLength(3)
      expect(ids2).toHaveLength(3)
      for (const id of [...ids1, ...ids2]) expect(id).toMatch(HEX12)

      // 중복 0 (국소)
      expect(
        ids1.filter((id) => ids2.includes(id)),
        '경계에서 항목이 겹친다',
      ).toEqual([])
      // 누락 0 (집합) — 기대는 **시딩 리터럴**이지 구현 산출이 아니다.
      expect(sortedUnique([...ids1, ...ids2])).toEqual([...seeded.feedIds].sort())
    },
  )

  it(
    'WA5: `nextCursor` 가 그 페이지 **마지막 항목의 id** 와 같다',
    { timeout: WALK_TIMEOUT },
    () => {
      const seeded = seedFeedVault({ feedCount: 5 })
      tmps.push(seeded.vault)

      const page = readFeedPage(seeded.vault, { count: 2 })

      expect(page.items.length, '앵커: 페이지가 비어 있지 않다').toBe(2)
      expect(page.nextCursor, '빈 문자열은 커서가 아니다').not.toBe('')
      expect(page.nextCursor).toMatch(HEX12)
      expect(page.nextCursor).toBe(page.items.at(-1).id)
    },
  )

  it('WA6: 히스토리 끝에서만 `nextCursor === null` 이다', { timeout: WALK_TIMEOUT }, () => {
    // ★ 한 축만 두면 **"항상 null"** 구현이 통과한다. C12 축자: _"끝에 도달했을 때만 next token 이
    //   비어야 하고, 그것이 「끝」을 알리는 **유일한** 방법"_ — 0건에 null 을 주면 「끝」의 거짓 신고다.
    const seeded = seedFeedVault({ feedCount: 4 })
    tmps.push(seeded.vault)

    const middle = readFeedPage(seeded.vault, { count: 2 })
    expect(middle.nextCursor, '끝이 아닌 페이지인데 null 이다').not.toBeNull()

    const rest = readFeedPage(seeded.vault, { after: middle.nextCursor, count: 10 })
    expect(rest.items.length, '앵커: 남은 항목을 실제로 냈다').toBeGreaterThan(0)
    expect(rest.nextCursor, '히스토리 끝인데 커서가 남았다').toBeNull()
  })
})

// ────────────────────────────────────────────────────────────────────────────
// WA7·WA8 — 0건 페이지에서 커서가 이어진다 (CJ3 · D45 · GW12 대체)
// ────────────────────────────────────────────────────────────────────────────

describe('0건 페이지 커서 (WA7·WA8 · CJ3 · 🔴RED `--ignore` 미구현)', () => {
  it(
    'WA7: 억제 밀집 구간에서 items 0건인데 커서가 **끊기지 않는다**',
    { timeout: WALK_TIMEOUT },
    () => {
      // 억제 밀도가 `count × (2~3)` 과 2차 `×4` 를 **모두 덮어야** 0건이 확정된다 → count 1 · 억제 6 · 총 8.
      const seeded = seedFeedVault({ feedCount: 8, suppressLatest: 6 })
      tmps.push(seeded.vault)
      const survivors = seeded.feedIds.slice(6)
      expect(survivors, '시딩 전제: 생존 2건').toHaveLength(2)

      // ★ 앵커 ①: **억제 없는 대조 vault** 에서 같은 `count=1` 이 1건을 낸다(억제가 실제로 걸렸음).
      const control = seedFeedVault({ feedCount: 8 })
      tmps.push(control.vault)
      const controlPage = readFeedPage(control.vault, { count: 1, ignore: control.ignorePath })
      expect(controlPage.items).toHaveLength(1)

      const page0 = readFeedPage(seeded.vault, { count: 1, ignore: seeded.ignorePath })
      expect(page0.items, '억제 밀집 구간인데 항목이 나왔다').toHaveLength(0)
      // ★ D45 — 0건이어도 커서를 낸다. 여기서 null 을 내면 「끝」을 거짓 신고하는 것이다.
      expect(page0.nextCursor, '0건 페이지가 커서를 끊었다').not.toBeNull()
      expect(page0.nextCursor).toMatch(HEX12)

      const page1 = readFeedPage(seeded.vault, {
        after: page0.nextCursor,
        count: 1,
        ignore: seeded.ignorePath,
      })
      expect(page1.items).toHaveLength(1)
      expect(survivors).toContain(page1.items[0].id)
      // ★ 앵커 ②: 커서가 **전진**한다(같은 자리를 맴도는 무한 루프 배제).
      expect(page1.nextCursor).not.toBe(page0.nextCursor)
    },
  )

  it(
    'WA8: 「0건 + null」 조합은 **히스토리 끝에서만** 나온다 (pair)',
    { timeout: WALK_TIMEOUT },
    () => {
      // WA6(끝에서 null)과 WA7(0건인데 non-null)의 **교차 pin**이다 — 층은 같지만 방향이 반대라
      //   한 케이스로 합치지 않는다.
      const seeded = seedFeedVault({ feedCount: 8, suppressLatest: 6 })
      tmps.push(seeded.vault)

      const walked = collectPages(
        (after) => readFeedPage(seeded.vault, { after, count: 1, ignore: seeded.ignorePath }),
        { maxPages: MAX_PAGES },
      )

      expect(walked.exhausted, `상한 ${MAX_PAGES}페이지를 넘겼다 — 커서가 전진하지 않는다`).toBe(
        true,
      )
      // 앵커: **0건인데 커서가 남은 페이지가 실제로 있었다**(없으면 이 케이스는 공허하다).
      const emptyMidPages = walked.pages
        .map((ids, index) => ({ ids, next: walked.cursors[index] }))
        .filter((page) => page.ids.length === 0 && page.next !== null)
      expect(emptyMidPages.length, '0건 + 커서 페이지가 한 번도 없었다').toBeGreaterThan(0)

      // null 은 **정확히 한 번**, 그리고 **마지막**에만 나온다.
      const nullAt = walked.cursors.map((cursor, index) => (cursor === null ? index : -1)).filter((index) => index !== -1) // prettier-ignore
      expect(nullAt).toEqual([walked.cursors.length - 1])
    },
  )
})

// ────────────────────────────────────────────────────────────────────────────
// WA10 — 무유실 (G1 · GW16 대체 · §7 논거의 실행 형태)
// ────────────────────────────────────────────────────────────────────────────

describe('무유실 — 합집합 == 전체 (WA10 · G1 · 🔴RED 라이브 워크 부재)', () => {
  it(
    'WA10: 커서를 소진할 때까지 넘긴 페이지 합집합이 시딩 7건 전량이다',
    { timeout: WALK_TIMEOUT },
    () => {
      // ★ `prd.md:513` 의 "경계 중복 0·누락 0" 은 **인접 두 페이지의 국소 단언**이라 3페이지 이상에서
      //   **중간이 통째로 빠지는** 형태를 못 잡는다. 그래서 전역 축이 따로 필요하다.
      const seeded = seedFeedVault({ feedCount: 7 })
      tmps.push(seeded.vault)

      const walked = collectPages((after) => readFeedPage(seeded.vault, { after, count: 2 }), {
        maxPages: MAX_PAGES,
      })

      expect(walked.exhausted, `상한 ${MAX_PAGES}페이지 초과`).toBe(true)
      // ★ 앵커 ①: 페이지 수 ≥ 2 — 1페이지로 끝나면 이 케이스는 공허하다.
      expect(walked.pages.length).toBeGreaterThanOrEqual(2)
      // ★ 앵커 ②: 각 페이지가 비어 있지 않다(이 vault 에는 억제가 없다).
      for (const [index, ids] of walked.pages.entries()) {
        expect(ids.length, `page ${index} 가 비었다`).toBeGreaterThan(0)
      }

      const flat = walked.pages.flat()
      // 합집합 == 전체 (기대는 시딩 리터럴)
      expect(sortedUnique(flat)).toEqual([...seeded.feedIds].sort())
      // 중복 0 — 집합과 **개수를 함께** 문다(규범 N)
      expect(flat).toHaveLength(7)
      // 마지막만 null · 그 앞은 전부 non-null
      expect(walked.cursors.at(-1)).toBeNull()
      for (const cursor of walked.cursors.slice(0, -1)) expect(cursor).toMatch(HEX12)
    },
  )
})

// ────────────────────────────────────────────────────────────────────────────
// IW6 — 암묵 `loadIgnoreFeeds` 소멸 (Task 7 · D20)
//   ★ CX9(「`--ignore` 를 받고도 무시」)의 red 집합은 **IW1 · IW6** 이다. 행동 겹이 조회 층에도
//     있어야 CX9 가 배선(IW5·텍스트 겹)과 구분된다.
// ────────────────────────────────────────────────────────────────────────────

describe('억제는 명시 인자로만 걸린다 (IW6 · 🔴RED `--ignore` 미구현)', () => {
  it(
    'IW6: `--ignore` 를 주면 억제되고, 주지 않으면 **적용되지 않는다**',
    { timeout: WALK_TIMEOUT },
    () => {
      // prettier-ignore
      // 🔴 오늘은 정반대다 — `feeds.mjs:46-48` 이 vault 기준으로 **암묵 로드**해서 인자와 무관하게 건다.
      //   D20 이후 억제 배선은 **호출부의 책임**이며(캐시 빌드·서버 라이브 폴백 둘 다 붙인다) 그래야
      //   "두 번째 필터 경로" 가 생기지 않는다. ★ `lib/ignore.mjs` 자체는 무변경 pin 이다(단일 구현).
      const seeded = seedFeedVault({ feedCount: 4, suppressLatest: 1 })
      tmps.push(seeded.vault)
      const suppressed = seeded.suppressed[0]

      // ★ 앵커: `--ignore <경로>` 를 주면 **실제로 걸린다**(억제 기능 자체가 죽은 것을 배제).
      const applied = readFeedPage(seeded.vault, { count: 10, ignore: seeded.ignorePath })
      expect(applied.items.length, '앵커 arm 이 비었다').toBeGreaterThan(0)
      expect(idsOf(applied), '`--ignore` 를 줬는데 억제가 안 걸렸다').not.toContain(suppressed)

      // 본 축: 인자가 없으면 억제도 없다(암묵 로드 소멸).
      const bare = readFeedPage(seeded.vault, { count: 10 })
      expect(idsOf(bare), '`--ignore` 없이도 억제가 걸렸다 — 암묵 로드가 살아 있다').toContain(suppressed) // prettier-ignore
    },
  )
})

// ────────────────────────────────────────────────────────────────────────────
// JS — `judgeFeedSurvival` 경로 유지 (N2 — **능동 요구**)
// ────────────────────────────────────────────────────────────────────────────

describe('생존 판정 경로 유지 (JS1·JS2 · N2)', () => {
  it(
    'JS1: 커서 워크 1회 실행이 `lib/feed-survival.mjs` 를 **실제로 로드**한다',
    { timeout: WALK_TIMEOUT },
    () => {
      // prettier-ignore
      // 규범 G — "무엇을 열었는가" 의 유일한 결정적 채널은 실행 계측(`NODE_V8_COVERAGE`)이다.
      const seeded = seedFeedVault({ feedCount: 3 })
      tmps.push(seeded.vault)

      const run = runCliWithLoadLog('feeds.mjs', ['--env', 'dev', '--count=2'], {
        vault: seeded.vault,
      })

      // ★ 앵커: **워크가 실제로 1회 돌았다**. 이 줄이 없으면 "실패해도 정적 import 는 로드된다" 는
      //   사실 때문에 케이스가 공허하게 통과한다.
      expect(run.exitCode, `exit=${run.exitCode}\n${run.stderr}`).toBe(0)
      expect(JSON.parse(run.stdout).items.length).toBeGreaterThan(0)

      expect(run.loadedUrls.some((url) => url.endsWith('/lib/feed-survival.mjs'))).toBe(true)
      // ★ §4.2 PU2(=TR3) pin 과 정합 — 조회 폐포 밖 3종은 **0회**여야 한다.
      for (const forbidden of ['/lib/render.mjs', '/lib/derive.mjs', '/node_modules/']) {
        const hits = run.loadedUrls.filter((url) => url.includes(forbidden))
        expect(hits, `조회가 ${forbidden} 를 열었다`).toEqual([])
      }
    },
  )

  it(
    'JS2: 삭제 문서 참조 feed 는 제외 · draft 참조는 prod 제외 / dev 포함',
    { timeout: WALK_TIMEOUT },
    () => {
      // prettier-ignore
      // ★★ 로드 관측(JS1)만으로는 부족하다 — **import 만 하고 안 부르는** 구현을 이 케이스가 잡는다.
      const seeded = seedSurvivalVault()
      tmps.push(seeded.vault)

      const dev = readFeedPage(seeded.vault, { count: 10, env: 'dev' })
      const prod = readFeedPage(seeded.vault, { count: 10, env: 'prod' })

      // ★ 앵커: 정상 참조 feed 는 **양쪽 다 포함**된다(전부 거르는 구현 배제).
      expect(idsOf(dev), 'dev 에 정상 feed 가 없다').toContain(seeded.normalFeed)
      expect(idsOf(prod), 'prod 에 정상 feed 가 없다').toContain(seeded.normalFeed)

      // 삭제된 문서만 가리키는 feed 는 양쪽에서 제외된다.
      expect(idsOf(dev), 'dev 에 삭제 문서 feed 가 남았다').not.toContain(seeded.deletedFeed)
      expect(idsOf(prod), 'prod 에 삭제 문서 feed 가 남았다').not.toContain(seeded.deletedFeed)

      // draft 참조는 dev 에서만 보인다(fail-closed 방향).
      expect(idsOf(dev), 'dev 에 draft feed 가 없다').toContain(seeded.draftFeed)
      expect(idsOf(prod), 'prod 로 draft feed 가 샜다').not.toContain(seeded.draftFeed)
    },
  )
})

// ────────────────────────────────────────────────────────────────────────────
// QX — D48 등가 불변식 (N1)
// ────────────────────────────────────────────────────────────────────────────

describe('D48 등가 불변식 (QX1·QX2 · N1 · 🔴RED `--ignore` 미구현)', () => {
  /** 캐시 arm 공통 Arrange — 억제 2건이 반영된 **6건 윈도우** 캐시를 굽는다. */
  function bakeCache() {
    const seeded = seedFeedVault({ feedCount: 10, suppressLatest: 2 })
    tmps.push(seeded.vault)
    const cachePath = path.join(seeded.vault, 'cache', 'feeds.dev.json')
    const built = runFeedsCli(seeded.vault, {
      count: 6,
      ignore: seeded.ignorePath,
      out: 'cache/feeds.dev.json',
    })
    if (built.status !== 0) {
      throw new Error(`[RED] feeds --ignore --out exit=${built.status}\n${built.stderr}`)
    }
    return { cache: JSON.parse(readFileSync(cachePath, 'utf8')), seeded }
  }

  it(
    'QX1: 같은 구간을 캐시 슬라이스와 라이브 워크로 얻으면 **id 배열이 정확히 같다**',
    { timeout: WALK_TIMEOUT },
    () => {
      // prettier-ignore
      // ★★ 비교축은 **`items` 의 id 배열 + `nextCursor`** 다. 봉투를 통째로 `toEqual` 하면 **정상 동작이
      //   red 로 뒤집힌다** — D50(경계 함정 ⑦): 캐시는 **빌드 시점 HEAD**, 라이브는 **요청 시점 HEAD** 를
      //   `sourceCommit` 에 싣고 그 차이는 무해하다. `generatedAt` 도 같은 이유로 비교축이 아니다.
      // ★ 인계: (a) 의 참조 슬라이스는 **파이프라인 P3 착륙 시 서버 슬라이스 구현으로 교체**한다.
      const { cache, seeded } = bakeCache()
      const cacheIds = cache.items.map((item) => item.id)
      expect(cacheIds.length, '캐시 윈도우 6건').toBe(6)

      const boundary = cacheIds[1]
      const sliced = cacheIds.slice(cacheIds.indexOf(boundary) + 1, cacheIds.indexOf(boundary) + 3)
      const live = readFeedPage(seeded.vault, {
        after: boundary,
        count: 2,
        ignore: seeded.ignorePath,
      })

      // ★ 앵커: **두 arm 이 각각 비어 있지 않다** — 둘 다 0건이면 `[] === []` 로 자동 참이다.
      expect(sliced).toHaveLength(2)
      expect(live.items).toHaveLength(2)

      expect(idsOf(live)).toEqual(sliced)
    },
  )

  it(
    'QX2: **중간 페이지**의 `nextCursor` 가 파일 전체의 꼬리 커서가 **아니다**',
    { timeout: WALK_TIMEOUT },
    () => {
      // prettier-ignore
      // ★ D48 함정의 본체다 — 아티팩트에 `nextCursor` 를 싣는 순간 "중간 페이지에서 **파일 꼬리 커서**를
      //   흘리는" 경로가 신설된다. 한 축만 두면 방향을 못 가르므로 마지막 페이지 arm 을 짝으로 둔다.
      const { cache, seeded } = bakeCache()
      const cacheIds = cache.items.map((item) => item.id)
      const tail = cache.nextCursor

      // 앵커: 파일 꼬리 커서가 실재한다(6건 윈도우 뒤로 히스토리가 남아 있다).
      expect(tail, '캐시 꼬리 커서가 없다').toMatch(HEX12)

      const middle = readFeedPage(seeded.vault, {
        after: cacheIds[1],
        count: 2,
        ignore: seeded.ignorePath,
      })
      expect(middle.items).toHaveLength(2)
      expect(middle.nextCursor, '중간 페이지가 파일 꼬리 커서를 흘렸다').not.toBe(tail)

      // ★ 짝(방향 가르기): **마지막 페이지**에서는 두 값이 같다.
      const last = readFeedPage(seeded.vault, {
        after: cacheIds[3],
        count: 2,
        ignore: seeded.ignorePath,
      })
      expect(last.items).toHaveLength(2)
      expect(last.nextCursor).toBe(tail)
    },
  )
})

// ── JS2 전용 Arrange (케이스별 결함 주입은 스펙 본문이 소유한다 · DAMP) ──────────────────────

const ID_NORMAL = '0192a000-0000-7000-8000-0000000000aa'
const ID_DELETED = '0192b000-0000-7000-8000-0000000000bb'
const ID_DRAFT = '0192c000-0000-7000-8000-0000000000cc'

/**
 * 정상·삭제·draft 문서를 각각 가리키는 `feed:` 커밋 3건. **판정하지 않는다**(사실만 돌려준다).
 * draft 는 `wiki/dev/**` 경로로 만든다 — `lib/draft.mjs` 의 OR 결합 중 **폴더 축**이다.
 */
function seedSurvivalVault() {
  const vault = initVault()
  writeDoc(vault, 'concept/정상', { body: '## 정의\n\n초판.\n', id: ID_NORMAL })
  writeDoc(vault, 'concept/삭제될것', { body: '## 정의\n\n초판.\n', id: ID_DELETED })
  writeDoc(vault, 'dev/초안', { body: '## 정의\n\n초판.\n', id: ID_DRAFT })
  commit(vault, 'chore: 문서 3건 생성')

  writeDoc(vault, 'concept/정상', { body: '## 정의\n\n갱신.\n', id: ID_NORMAL })
  const normalFeed = feedCommit(vault, { subject: '정상 소식' }).slice(0, 12)

  writeDoc(vault, 'concept/삭제될것', { body: '## 정의\n\n갱신.\n', id: ID_DELETED })
  const deletedFeed = feedCommit(vault, { subject: '삭제될 소식' }).slice(0, 12)

  writeDoc(vault, 'dev/초안', { body: '## 정의\n\n갱신.\n', id: ID_DRAFT })
  const draftFeed = feedCommit(vault, { subject: '초안 소식' }).slice(0, 12)

  rmSync(path.join(vault, 'wiki', 'concept', '삭제될것.md'))
  commit(vault, 'chore: 문서 1건 삭제')

  return { deletedFeed, draftFeed, normalFeed, vault }
}
