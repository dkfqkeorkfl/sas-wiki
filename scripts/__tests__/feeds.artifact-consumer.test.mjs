// @vitest-environment node
//
// P5 · Task 3 — `feeds` 의 조회 계약 (D-E·D-G·D-B ②) — tdd §3.3 (FC2~FC10)
//
// ★★ **v3 P2 재조준(tdd §4.5-⑥ · D48·D20·D6).** 이 파일의 옛 전제는 _"`feeds()` 가 아티팩트를
//   **읽는다**"_ 였다. P2 는 조회 경로를 **라이브 커서 워크**로 교체하므로(해석 A · PU4·PU6b) 그
//   전제가 사라진다. 그러나 이 파일이 물던 계약 대부분은 **더 강한 형태로 살아남는다**:
//     · FC3 — 옛 뜻: "feeds 는 item 을 만들지 않는다(파일에서 고른다)". 새 뜻: **캐시 경로와 라이브
//       경로가 같은 해석기를 쓴다** — 두 산출의 item 이 여전히 deep-equal 이어야 한다(D48 등가
//       불변식의 **item 층**). 재구현이 생기면 여기서 갈린다.
//     · FC4·FC7·FC10 — 억제 축. D20 이후 억제는 **명시 인자**로만 걸리므로(암묵 로드 소멸 · IW6)
//       각 arm 이 `{ ignore }` 를 넘긴다. 무는 계약(응답에 없다 · generatedAt 은 억제 후 · malformed
//       는 fail-loud)은 **한 글자도 약해지지 않는다**.
//     · FC5 — 재구현 금지 트립와이어. 소유자가 `git-walk.mjs`(`pageFeeds`)에서
//       `lib/feed-cursor.mjs`(`walkCursorPage`)로 옮겨간다.
//     · FC6 — `from`/`to` 축은 **개념 소멸**(D6)이라 삭제하고 `count`·`after` 만 남긴다.
//
// 정적 폐쇄에서 렌더 툴체인이 사라지는 축은 **FC1**(기존 `summary.import-graph.test.mjs`)이,
//   런타임 로드·git 프로파일은 **PU4·TR3** 이 문다 — 구조 단언과 기능 단언을 한 케이스에 섞지 않는다.
//
// RED 사유:
//   · FC2 — **RED(오늘 동기)**. `feeds.mjs:27` 이 `export function feeds(...)` 다.
//   · FC3·FC7·FC8 — **RED(미구현)**. 아티팩트를 읽지 않고 자체 파싱이 item 을 만든다 · 서빙 시점
//     `generatedAt` 재집계가 없다 · 응답 세대가 아티팩트와 어긋난다.
//   · FC5 — **RED(소스 형태)**. 오늘은 `buildWirePayload` 를 정적으로 물고 `parse-vault.mjs` 가
//     정적 폐쇄에 있다. **CX 지목 = CX-E**.
//   · FC9 — **RED(경로 부재)**. 재생성 백스톱 자체가 없다.
//   · FC4 — tdd §3.3 은 RED 로 적었으나 **오늘도 억제는 걸린다**(경로만 다르다) → 이 파일에서는
//     green 이 정상이다. 짝인 "파일에는 있다" 는 **FA11** 이 소유한다(둘이 같은 것을 두 번 물지 않는다).
//   · FC10 — **극성 pin**. 형태를 async 로 못박지 않는다(그 축은 FC2 소유) — 동기 throw 도 rejection 도
//     같은 의미로 받도록 감싼다. summary 상태 조회가 없어져도 **여기는 남는다**(SU8 과 짝).
//
// 규범 A: 억제 엔트리·경로 조각·기대 시각은 **리터럴**이다. 아티팩트 대조는 `buildFeedsArtifact` 가
//   아니라 **파일을 읽어** 한다 — 생성기 출력과 생성기 함수를 비교하면 완전히 공허하다(tdd §2.3 함정 ①).
// 규범 C10: `rejects` 계열 앞에 seam 가드(대상이 함수인가)를 둔다 — 모듈이 죽어도 통과하는 모양 배제.
// 규범 F: 실 vault 를 건드리지 않는다.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'

import { prebuildArtifacts } from './helpers/prebuild-artifacts.mjs'
import { cleanup, commit, feedCommit, initVault, writeDoc } from './helpers/tmp-git-vault.mjs'

const feedsModule = await import(new URL('../feeds.mjs', import.meta.url).href)

/** feeds 아티팩트 경로 — **리터럴 조립**(규범 A). 정확 형태의 계약은 PL9 가 한 번만 고정한다. */
const feedsFile = (vault, env) => path.join(vault, 'cache', `feeds.${env}.json`)

const FEEDS_SOURCE = new URL('../feeds.mjs', import.meta.url)
const FEED_CURSOR_SOURCE = new URL('../lib/feed-cursor.mjs', import.meta.url)

const ID_A = '0192a000-0000-7000-8000-0000000000aa'
const REL_A = 'company/삼성전자'
const TS_OLD = '2026-01-01T00:00:00Z'
const TS_NEW = '2026-12-31T00:00:00Z'
const TITLE_OLD = '오래된 소식'
const TITLE_NEW = '최신 소식'
const IGNORE_FILE = 'ignore-feeds.json'
const IGNORE_WHEN = '2026-07-28T00:00:00Z'

const tmps = []
afterAll(() => cleanup(...tmps))

function feedsFn() {
  // 규범 C10 seam 가드 — 대상이 실제로 함수인지 먼저 확인한다.
  if (typeof feedsModule.feeds !== 'function') {
    throw new Error('[RED] scripts/feeds.mjs 에 feeds export 가 없다')
  }
  return feedsModule.feeds
}

/**
 * 피드 2건(ts 오름차순 OLD → NEW) + 문서 1건.
 *
 * 마지막 커밋이 tick(≈2006) author-date 로 문서를 다시 손대므로 `doc.updated` 가 피드 ts 보다
 * **한참 이르다** — 그래야 FC7 의 "응답 generatedAt = 억제 **후** item ts" 가 관측 가능해진다.
 */
function seedTwoFeeds() {
  const vault = initVault()
  tmps.push(vault)
  writeDoc(vault, REL_A, { body: '## 정의\n\n초판.\n', id: ID_A, title: '삼성전자', type: 'company' }) // prettier-ignore
  commit(vault, 'chore: 문서 생성')

  writeDoc(vault, REL_A, { body: '## 정의\n\n갱신 1.\n', id: ID_A, title: '삼성전자', type: 'company' }) // prettier-ignore
  const oldSha = feedCommit(vault, { date: TS_OLD, subject: TITLE_OLD })

  writeDoc(vault, REL_A, { body: '## 정의\n\n갱신 2.\n', id: ID_A, title: '삼성전자', type: 'company' }) // prettier-ignore
  const newSha = feedCommit(vault, { date: TS_NEW, subject: TITLE_NEW })

  writeDoc(vault, REL_A, { body: '## 정의\n\n갱신 3.\n', id: ID_A, title: '삼성전자', type: 'company' }) // prettier-ignore
  commit(vault, 'chore: 후속 갱신(문서 updated 를 피드 ts 보다 이르게)')

  return { newFeedId: newSha.slice(0, 12), oldFeedId: oldSha.slice(0, 12), vault }
}

async function seedTwoFeedsWithArtifacts(env = 'dev') {
  const seeded = seedTwoFeeds()
  await prebuildArtifacts(seeded.vault, env)
  return seeded
}

function suppress(vault, feedId) {
  writeFileSync(
    path.join(vault, IGNORE_FILE),
    JSON.stringify([{ id: feedId, when: IGNORE_WHEN }]),
    'utf8',
  )
}

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'))
const idsOf = (page) => page.items.map((item) => item.id)
const titlesOf = (page) => page.items.map((item) => item.title)

describe('feeds 는 async 다 (FC2 · 🔴RED 오늘 동기)', () => {
  it('FC2: `feeds` 가 함수이고 호출 결과가 **Promise** 다', async () => {
    // 이후 케이스 전부의 전제이자 규범 C10 의 seam 가드다. 신선도 확보(생성기 재사용)가 async 이므로
    //   `feeds()` 도 async 가 된다 — 이관 비용은 §4.3 이 22파일로 전수 계상했다.
    const { vault } = await seedTwoFeedsWithArtifacts()
    const feeds = feedsFn()

    const returned = feeds(vault, 'dev', {})

    expect(returned).toBeInstanceOf(Promise)
    await expect(returned).resolves.toBeDefined()
  })
})

describe('두 경로가 같은 item 을 낸다 (FC3 · D48 등가의 item 층)', () => {
  it('FC3: 반환된 모든 item 이 **아티팩트 파일의 item 과 deep-equal** 이다', async () => {
    // ★ 규범 A 함정 ② 회피형이다: `feeds() == pageFeeds(...)` 로 쓰면 같은 함수를 두 번 부르는 것이라
    //   아무것도 증명하지 못한다. 여기서는 **파일에서 읽은** item 과 대조한다 — feeds 가 하는 일은
    //   고르는 것뿐이고, 만드는 것은 생성기다(D-A: 판정 권위는 하나).
    const { vault } = await seedTwoFeedsWithArtifacts()
    const page = await feedsFn()(vault, 'dev', {})

    expect(existsSync(feedsFile(vault, 'dev'))).toBe(true)
    const artifactItems = readJson(feedsFile(vault, 'dev')).items
    const byId = new Map(artifactItems.map((item) => [item.id, item]))

    // 앵커 ①·②: 아티팩트도 응답도 **비어 있지 않다**(빈 아티팩트로 공허 통과 배제 · plan 비공허성 ①).
    expect(artifactItems.length).toBeGreaterThan(0)
    expect(page.items.length).toBeGreaterThan(0)

    for (const item of page.items) expect(item).toEqual(byId.get(item.id))
  })
})

describe('억제는 서빙 시점에 걸린다 (FC4 · 🟢오늘도 성립 — 짝은 FA11)', () => {
  it('FC4: 억제 엔트리가 걸린 id 가 응답에 **없다**', async () => {
    const { newFeedId, vault } = await seedTwoFeedsWithArtifacts()
    const feeds = feedsFn()
    const ignoreOpts = { ignore: path.join(vault, IGNORE_FILE) }

    // 앵커: 억제 **전에는 있었다**(빈 응답으로 부재 단언이 공허해지는 것을 배제).
    expect(idsOf(await feeds(vault, 'dev', {}))).toContain(newFeedId)

    suppress(vault, newFeedId)

    // ★ v3 P2 · D20 — 억제 배선은 **호출부 책임**이다(암묵 로드 소멸). 필터의 단일 구현은 그대로다.
    expect(idsOf(await feeds(vault, 'dev', ignoreOpts))).not.toContain(newFeedId)
  })
})

describe('재구현 금지 트립와이어 (FC5 · 🔴RED 소스 형태 · CX-E)', () => {
  it('FC5: `feeds.mjs` 가 억제·페이지 계산을 **재구현하지 않고** `walkCursorPage` 만 문다', () => {
    // `ignore.mjs` 헤더가 금지하는 "두 번째 필터 경로" 의 물질화다. 토큰이 `feeds.mjs` 로 넘어오면
    //   우회가 시작된 것이다. ★ v3 P2 — **소유자가 옮겨갔다**: 페이지 계산은 `lib/feed-cursor.mjs`
    //   (`walkCursorPage`)가, 억제 필터는 여전히 `lib/ignore.mjs`(`applyIgnoreFeeds`)가 소유한다.
    //   `pageFeeds` 는 프로덕션에서 사라졌으므로(호출자 0) 그 토큰은 이제 **부재 축**이다.
    const source = readFileSync(FEEDS_SOURCE, 'utf8')
    const owner = readFileSync(FEED_CURSOR_SOURCE, 'utf8')
    const count = (text, token) => text.split(token).length - 1

    // 앵커: 그 토큰들은 **소유자 쪽에 실제로 있다**(어디에도 없어서 0 인 것을 배제).
    for (const token of ['applyIgnoreFeeds', 'rev-list', '--skip=1']) {
      expect(count(owner, token)).toBeGreaterThan(0)
      expect(count(source, token)).toBe(0)
    }
    // 페이지 슬라이스는 `slice(0, …)` 형태다 — `process.argv.slice(2)`(CLI 배관)와 구분해서 센다.
    expect([...source.matchAll(/\.slice\(\s*0/gu)]).toHaveLength(0)
    // 전환의 소스 측 증거 — 정적 결합이 사라진다(짝: FC1·TR3). `pageFeeds` 는 개념째 사라졌다.
    expect(count(source, 'buildWirePayload')).toBe(0)
    expect(count(source, 'parse-vault.mjs')).toBe(0)
    expect(count(source, 'pageFeeds')).toBe(0)
    expect(count(source, 'walkCursorPage')).toBeGreaterThan(0)
  })
})

describe('페이지·커서 위임 2축 (FC6 · 🟩pair)', () => {
  it('FC6: `count`·`after` 가 전부 반영된다', async () => {
    // 과잉 축소(전부 빈 페이지를 내는 구현) 배제. 앵커는 무인자 호출이 전량을 낸다는 것이다.
    // ★ v3 P2 · D6 — `from`/`to` 축 2건은 **개념 소멸**이라 삭제했다(§4.5-⑥). 날짜 구간은 wire 에서
    //   사라지고 화면 기간 프리셋은 **클라이언트 로컬 필터**로 남는다 — 이 층의 계약이 아니다.
    const { newFeedId, oldFeedId, vault } = await seedTwoFeedsWithArtifacts()
    const feeds = feedsFn()

    const all = await feeds(vault, 'dev', {})
    expect(idsOf(all).toSorted()).toEqual([newFeedId, oldFeedId].toSorted())

    const limited = await feeds(vault, 'dev', { count: 1 })
    expect(titlesOf(limited)).toEqual([TITLE_NEW])

    const after = await feeds(vault, 'dev', { after: limited.nextCursor, count: 1 })
    expect(titlesOf(after)).toEqual([TITLE_OLD])
  })
})

describe('서빙 시점 generatedAt 재집계 (FC7 · 🔴RED 억제 전 값이 나간다 · CX-B′)', () => {
  it('FC7: 응답 `generatedAt` 이 **억제 후** item ts 이고 억제된 항목의 ts 가 아니다', async () => {
    // ★ D-B 의 CWE-204 클로즈다. 아티팩트 값은 억제를 보지 않고(GA5), 서빙 층이 억제 **후** 집합으로
    //   다시 max 를 낸다 — 두 층이다. 아티팩트 층만 고치면(CX-B′) 여기가 red 로 남는다.
    const { newFeedId, vault } = await seedTwoFeedsWithArtifacts()
    const feeds = feedsFn()

    // 앵커: 억제하지 않으면 그 ts 가 **실제로** 응답 generatedAt 이 된다(누출이 실재했다).
    expect((await feeds(vault, 'dev', {})).generatedAt).toBe(new Date(TS_NEW).toISOString())

    suppress(vault, newFeedId)
    const page = await feeds(vault, 'dev', { ignore: path.join(vault, IGNORE_FILE) })

    expect(page.generatedAt).toBe(new Date(TS_OLD).toISOString())
    expect(page.generatedAt).not.toBe(new Date(TS_NEW).toISOString())
  })
})

describe('생산자가 자기 출력을 스탬프한다 (FC8 · 🔴RED 필드 부재 · CX-T)', () => {
  it('FC8: 응답 `sourceCommit` 이 feeds 아티팩트와 같다', async () => {
    const { vault } = await seedTwoFeedsWithArtifacts()
    const page = await feedsFn()(vault, 'dev', {})

    expect(page.sourceCommit).toMatch(/^[0-9a-f]{40}$/u)
    expect(page.sourceCommit).toBe(readJson(feedsFile(vault, 'dev')).sourceCommit)
  })
})

describe('malformed 억제 목록은 fail-loud 다 (FC10 · 🟢pin · OQ-P5-6 무변경)', () => {
  it('FC10: 스키마 위반 `ignore-feeds.json` 이면 실패한다(조용히 무시하지 않는다)', async () => {
    // 상태 조회의 조기 검출은 사라지지만(D-H 수용) **여기는 남는다** — SU8 이
    //   그 경계를 계약으로 못박는다. 동기 throw 든 rejection 이든 같은 의미로 받는다(형태 축은 FC2 소유).
    const { vault } = await seedTwoFeedsWithArtifacts()
    const feeds = feedsFn()
    writeFileSync(path.join(vault, IGNORE_FILE), JSON.stringify([{ id: 'not-12hex' }]), 'utf8')

    // ★ v3 P2 · D20 — 억제 목록은 **명시 인자**로 들어온다. 「신뢰 못 할 목록은 조용히 무시하지
    //   않는다」는 계약은 그대로이고, 그 fail-loud 가 도는 자리만 인자 경로로 옮겨졌다(SU8 이 짝).
    const opts = { ignore: path.join(vault, IGNORE_FILE) }
    await expect(Promise.resolve().then(() => feeds(vault, 'dev', opts))).rejects.toThrow(
      /ignore-feeds\.json/u,
    )
  })
})
