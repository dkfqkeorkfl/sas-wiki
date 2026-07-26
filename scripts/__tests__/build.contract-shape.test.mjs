// @vitest-environment node
//
// P2 · Task 4·7 — 앵커를 계약에서 제거하고 `importance: fix` 를 더한다 — tdd §3.4(AN1~AN5) · §3.7(IM1~IM3)
//
// 무엇이 사라지는가: `feeds[].docs[].anchor`/`anchorText` 와 그것을 만드는 `deriveAnchor`·`NO_ANCHOR`,
//   그리고 그 둘을 검사하던 **불변식 6**(`checkAnchors`). 서빙 경로는 이미 `{anchor: null, anchorText: null}`
//   을 무조건 넣고 있었다(= 소비자가 받는 앵커는 언제나 null 이었다 · plan 「베이스라인」 실측).
//
// **무엇이 사라지지 않는가 (AN5 — 무수정 pin · 신규 케이스를 쓰지 않는다)**:
//   위키링크·heading 앵커는 **살아 있는 별개 기능**이다. 아래 기존 스펙이 **무수정 green** 인 것이
//   AN5 의 판정이며, 그래서 여기에 중복 케이스를 만들지 않는다(tdd §3.4 AN5 · §10.1-3):
//     · scripts/lib/__tests__/render.wikilink.test.mjs (전량)
//     · scripts/lib/__tests__/derive.test.mjs 의 `checkAnchorExists` 스펙
//     · scripts/schema/body.schema.json 의 headings[].anchor 스펙
//   GREEN 담당은 이 세 지점을 **경로 치환조차 하지 않는다.** 손대는 순간 plan Risks 2위(앵커 제거가
//   위키링크까지 삭제)가 실현된 것이다.
//
// RED 사유(라벨별):
//   AN1  RED(flip) — 현행 산출 docRef 는 `{anchor, anchorText, id}` 3키다(원장 ⑬·⑭).
//   AN2  RED(flip) — 현행 `feeds.schema.json` docRef 는 그 2필드를 **required** 로 요구한다(원장 ⑫).
//   AN3  RED(flip) — 현행 불변식 6(`checkAnchors`)이 anchorText 정합을 검사해 throw 한다(원장 ⑤).
//   AN4  RED(flip) — 현행 `deriveAnchor` 가 `headingsById` 를 읽는다(인자를 빼면 TypeError).
//   IM1  RED        — 현행 `IMPORTANCE` 에 `fix` 가 없어 normal 로 강등 + warning.
//   IM2  RED        — 현행 스키마 enum 3값.
//   IM3  RED        — 코드·스키마 양쪽 3값. **`feed.mjs` 가 `IMPORTANCE` 를 export 해야 한다**(신설 seam).
//
// 자기참조 공허성(§2.3 규범 A): IM3 의 기대값은 **리터럴 4값**이다 — 한쪽 SSOT 를 다른 쪽으로 비교하면
//   둘이 함께 틀려도 통과한다. 리터럴이 제3의 기준점이 되어 조용한 드리프트를 끊는다.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  aFeedItem,
  aFeeds,
  aWorld,
  DOC_A,
  GHOST_ID,
} from '../lib/__tests__/helpers/payload-builders.mjs'
import { buildFeedItems } from '../lib/feed.mjs'
import { checkInvariants } from '../lib/invariants.mjs'
import { loadSchema, validateItem } from '../lib/validate.mjs'
import { buildContent } from '../validate.mjs'
import { cleanup, commit, feedCommit, initVault, writeDoc } from './helpers/tmp-git-vault.mjs'

// `IMPORTANCE` 는 아직 export 가 아니다 → **namespace import** 로 받는다. named import 로 적으면 ESM
//   링크가 이 파일을 통째로 죽여(collection error) AN1~AN4·IM1·IM2 의 red 사유까지 사라진다(§2.4).
const feedModule = await import(new URL('../lib/feed.mjs', import.meta.url).href)

const SCHEMA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'schema')
const FEEDS_SCHEMA_PATH = path.join(SCHEMA_DIR, 'feeds.schema.json')

const ID_A = '0192a000-0000-7000-8000-0000000000aa'
const ID_B = '0192b000-0000-7000-8000-0000000000bb'
const T1 = '2026-01-01T00:00:00Z'

/** 한 `feed:` 커밋이 문서 **2건**을 고친 vault — docRef 를 2건 이상 만들어 AN1 의 앵커를 세운다. */
function seedTwoDocFeedVault() {
  const vault = initVault()
  writeDoc(vault, 'company/공개', { id: ID_A, wikiRoot: 'wiki' })
  writeDoc(vault, 'tech/메모리', { id: ID_B, wikiRoot: 'wiki' })
  commit(vault, 'chore: 초기 문서 2건')
  writeDoc(vault, 'company/공개', { body: '## 정의\n\n동시 갱신.\n', id: ID_A, wikiRoot: 'wiki' })
  writeDoc(vault, 'tech/메모리', { body: '## 정의\n\n동시 갱신.\n', id: ID_B, wikiRoot: 'wiki' })
  feedCommit(vault, { date: T1, subject: '동시 소식' })
  return vault
}

/** 산출 feeds payload 를 실물 스키마로 검증한다(에러 문자열 배열 — validate.mjs 와 같은 경로). */
const errorsFor = (feeds) => validateItem(feeds, loadSchema(FEEDS_SCHEMA_PATH), 'wiki_feeds.json')

/**
 * AN2·AN3 이 **공유하는 한 payload** — 앵커 2필드를 단 docRef.
 *
 * 앵커 값은 그 문서 headings 에 **없는** 것(`'x'`)이고 라벨도 무관한 값(`'y'`)이다. 일부러 그렇게 둔다:
 *   · 현행 불변식 6(`checkAnchors`)은 이것을 "죽은 앵커" 로 보고 **throw** 한다 → AN3 이 지금 red 다.
 *   · P2 이후엔 그 불변식이 사라져 통과하고, 대신 **스키마 strict** 가 여분 필드로 잡는다(AN2).
 * 유효한 앵커를 넣으면 현행에서도 통과해 AN3 의 flip 이 공허해진다(첫 초안의 실측 함정).
 */
const anchoredFeeds = () =>
  aFeeds()
    .withItem(aFeedItem().refs([{ anchor: 'x', anchorText: 'y', id: DOC_A.id }]))
    .build()

describe('산출 docRef 는 정확히 1키다 (AN1 🔴RED(flip) · 원장 ⑬⑭)', () => {
  it('AN1: docs 참조가 2건 이상이고, 전부 키가 정확히 ["id"] 다', () => {
    const vault = seedTwoDocFeedVault()
    try {
      const { feeds } = buildContent({ env: 'dev', vault })
      const refs = feeds.items.flatMap((item) => item.docs)

      // ★ 위험 실재 앵커(규범 B): 개수 하한이 **먼저**다. D9 도입으로 `docs: []` 가 실제로 생기므로,
      //   앵커가 없으면 "참조 0건 대 0건" 으로 공허 통과한다.
      expect(refs.length).toBeGreaterThanOrEqual(2)
      for (const ref of refs) expect(Object.keys(ref).toSorted()).toEqual(['id'])
    } finally {
      cleanup(vault)
    }
  })
})

describe('스키마가 여분 앵커 필드를 거부한다 (AN2 🔴RED(flip) · 원장 ⑫)', () => {
  it('AN2: `{anchor, anchorText, id}` docRef 는 스키마 위반이고 메시지가 anchor 를 가리킨다', () => {
    // strict(`additionalProperties: false`)가 그물이다 — 이 그물을 풀면(CX7) 여분 필드가 조용히 흘러간다.
    const errors = errorsFor(anchoredFeeds())

    expect(errors.length).toBeGreaterThanOrEqual(1)
    expect(errors.join(' ')).toContain('anchor')
  })

  it('AN2-pair: `{id}` 1키 docRef 는 스키마를 통과한다(과잉 차단 가드 · 지금은 required 라 red)', () => {
    const feeds = aFeeds()
      .withItem(aFeedItem().refs([{ id: DOC_A.id }]))
      .build()

    expect(errorsFor(feeds)).toEqual([])
  })
})

describe('불변식 6 은 계약에서 사라지되 게이트는 남는다 (AN3 🔴RED(flip) · 원장 ⑤)', () => {
  it('AN3: 앵커 필드가 붙은 payload 로도 checkInvariants 가 throw 하지 않는다', () => {
    // 부재 단언 — 짝(아래)이 없으면 "불변식 게이트를 통째로 껐다" 와 구분되지 않는다.
    // 보호가 사라지지 않는다는 증명은 AN2 가 담당한다(같은 payload 를 **스키마**가 잡는다).
    const { body, summary } = aWorld()

    expect(() => checkInvariants(summary, anchoredFeeds(), body)).not.toThrow()
  })

  it('AN3-pair: 불변식 1 위반(summary 에 없는 doc id)은 여전히 throw 한다', () => {
    const { body, summary } = aWorld()
    const feeds = aFeeds()
      .withItem(aFeedItem().refs([{ id: GHOST_ID }]))
      .build()

    expect(() => checkInvariants(summary, feeds, body)).toThrow(new RegExp(GHOST_ID))
  })
})

describe('죽은 배선 금지 — headingsById 는 인자에서 사라진다 (AN4 🔴RED(flip))', () => {
  it('AN4: headingsById 를 넘기지 않아도 buildFeedItems 결과가 동일하다', () => {
    // 현행은 `deriveAnchor` 가 `headingsById.get(...)` 을 부르므로 인자를 빼면 TypeError 다.
    // 앵커가 사라지면 이 인자는 **쓸모를 잃는다** — 남긴 채 무시하는 구현도 통과시키지만, 그 잔재는
    // §10.3-1 REFACTOR 가 걷는다(Task 4 GOTCHA: 인자 제거는 전 호출부 grep 선행).
    const SAMSUNG_FILE = 'wiki/company/삼성전자.md'
    const commitObj = {
      authorDate: T1,
      body: '본문 한 줄.\n\nImportance: normal',
      hash: 'f1f1f1f1f1f1000000000000000000000000aaaa',
      subject: 'feed: 헤드라인',
    }
    const diff = [
      `diff --git a/${SAMSUNG_FILE} b/${SAMSUNG_FILE}`,
      `--- a/${SAMSUNG_FILE}`,
      `+++ b/${SAMSUNG_FILE}`,
      '@@ -20,0 +20,2 @@',
    ].join('\n')
    const baseContext = {
      deletedPaths: new Set(),
      docsById: new Map([[ID_A, { bodyLineOffset: 8, status: 'active' }]]),
      pathIndex: new Map([[`${commitObj.hash}:${SAMSUNG_FILE}`, ID_A]]),
      runGit: () => diff,
      wikiPrefix: 'wiki/',
    }
    const headings = new Map([[ID_A, [{ anchor: '개요', level: 2, line: 1, text: '개요' }]]])

    const withHeadings = buildFeedItems([commitObj], { ...baseContext, headingsById: headings })
    const withoutHeadings = buildFeedItems([commitObj], { ...baseContext })

    expect(withHeadings.items).toHaveLength(1) // 앵커: 픽스처가 실제로 피드를 만들었다
    expect(withoutHeadings.items).toEqual(withHeadings.items)
  })
})

describe('importance: fix (IM1·IM2·IM3 🔴RED)', () => {
  it('IM1: `Importance: fix` 트레일러가 강등되지 않고 warning 도 남기지 않는다', () => {
    const vault = initVault()
    try {
      writeDoc(vault, 'company/공개', { id: ID_A, wikiRoot: 'wiki' })
      commit(vault, 'chore: 문서 생성')
      writeDoc(vault, 'company/공개', { body: '## 정의\n\n정정 갱신.\n', id: ID_A, wikiRoot: 'wiki' }) // prettier-ignore
      feedCommit(vault, { date: T1, importance: 'fix', subject: '정정 알림' })

      const { feeds, stats } = buildContent({ env: 'dev', vault })

      expect(feeds.items).toHaveLength(1) // 앵커: 피드가 실제로 발행됐다
      expect(feeds.items[0].importance).toBe('fix')
      // warning 부재까지 본다 — 값은 통과시키면서 경고는 남기는 절반 구현을 배제한다.
      expect(stats.warnings).toEqual([])
    } finally {
      cleanup(vault)
    }
  })

  it('IM2: 스키마가 `fix` 를 받고 `urgent` 는 거부한다(짝이 없으면 enum 을 열어버린 구현이 통과)', () => {
    const fixFeeds = aFeeds()
      .withItem(aFeedItem().with({ importance: 'fix' }))
      .build()
    const urgentFeeds = aFeeds()
      .withItem(aFeedItem().with({ importance: 'urgent' }))
      .build()

    expect(errorsFor(fixFeeds)).toEqual([])
    expect(errorsFor(urgentFeeds).length).toBeGreaterThanOrEqual(1)
  })

  it('IM3: 코드 IMPORTANCE 와 스키마 enum 이 **같은 4값**이다(두 SSOT 드리프트 트립와이어)', () => {
    // 계약 enum 이 두 곳(`feed.mjs` · `feeds.schema.json`)에 있다. 한쪽만 넓히면 산출은 통과하는데
    //   스키마가 죽거나(또는 그 반대) — 조용히 갈린다. 기대값을 **리터럴**로 둬 제3의 기준점을 만든다.
    const expected = ['breaking', 'fix', 'highlight', 'normal']
    const schemaJson = JSON.parse(readFileSync(FEEDS_SCHEMA_PATH, 'utf8'))
    const schemaEnum = schemaJson.definitions.feedItem.properties.importance.enum

    expect(feedModule.IMPORTANCE, 'feed.mjs 가 IMPORTANCE 를 export 해야 한다(IM3 seam)').toBeDefined() // prettier-ignore
    expect([...feedModule.IMPORTANCE].toSorted()).toEqual(expected)
    expect([...schemaEnum].toSorted()).toEqual(expected)
  })
})
