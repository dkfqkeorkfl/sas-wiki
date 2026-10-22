import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { aFeedItem, aFeeds, aWorld, DOC_A, GHOST_ID } from '../../test-utils/payload-builders.mjs'

import { checkInvariants } from '../document-invariants.mjs'

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

describe('불변식 6 은 계약에서 사라지되 게이트는 남는다 · 원장 ⑤)', () => {
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
