// 파싱·생성·피드의 실제 기능 결과를 확인한다.
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

import { loadSchema, validateItem } from '../lib/schema-validator.mjs'

import { parsePayloads } from '../test-utils/vaultPayloads.mjs'

import { cleanup, commit, feedCommit, initVault, writeDoc } from './helpers/tmp-git-vault.mjs'

// `IMPORTANCE` 는 정적 export 다. namespace import 로 모듈 표면을 받아 IM3 에서 export 존재와
//   리터럴 4값을 함께 검증하고, 나머지 계약 케이스도 동일 모듈 인스턴스를 사용한다.
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
      const { feeds } = parsePayloads({ env: 'dev', vault })
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

describe('importance: fix (IM1·IM2·IM3 🔴RED)', () => {
  it('IM1: `Importance: fix` 트레일러가 강등되지 않고 warning 도 남기지 않는다', () => {
    const vault = initVault()
    try {
      writeDoc(vault, 'company/공개', { id: ID_A, wikiRoot: 'wiki' })
      commit(vault, 'chore: 문서 생성')
      writeDoc(vault, 'company/공개', { body: '## 정의\n\n정정 갱신.\n', id: ID_A, wikiRoot: 'wiki' }) // prettier-ignore
      feedCommit(vault, { date: T1, importance: 'fix', subject: '정정 알림' })

      const { feeds, stats } = parsePayloads({ env: 'dev', vault })

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
