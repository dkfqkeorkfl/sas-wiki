// @vitest-environment node
//
// P2 RED-7 · scripts/wiki/lib/invariants.mjs (불변식 8종) — data-contract §10 / tdd §7
// RED 사유: `lib/invariants.mjs` 미구현(모듈 부재) → import 실패.
//
// 계약: checkInvariants(summary, feeds, body) — 위반 시 **구체 메시지와 함께 throw**, 정상이면 void.
//
// **green 픽스처만 두면 불변식이 실제로 잡는지 알 수 없다**(vacuous pass).
//   → 8종 각각에 **위반 픽스처**를 둔다: 정상 세계(aWorld)를 받아 **딱 한 곳만** 망가뜨린다.
//   → 정상 케이스(통과)도 함께 둔다: **과잉 검출**(정상 운영이 빌드를 죽임)을 막기 위해서다.
//     특히 불변식 1 — disable 문서를 가리키는 피드는 **통과해야 한다**(실 vault 커밋 13·14).
//
// 메시지 계약: "invariant 1 violated" 류는 거부한다. **무엇이 무엇을 못 찾았는지**를 담아야
//   대량 실패 시 원인을 추적할 수 있다(예: `feed f1f1f1f1f1f1 → doc ffffffffffff`).
import { describe, expect, it } from 'vitest'

import {
  aBodyDoc,
  aDoc,
  aFeedItem,
  aFeeds,
  aWorld,
  DOC_A,
  DOC_B,
  DOC_D,
  GHOST_ID,
} from './helpers/payload-builders.mjs'

// RED 시점에 이 모듈은 존재하지 않는다. 정적 import 로 적으면 eslint 의 import-x/no-unresolved 가
// 에러를 내고, pre-commit(lint-staged)이 **RED 커밋 자체를 막는다** — 규칙을 억제하는 대신 해석을
// 런타임으로 미룬다. 실패는 "Cannot find module …" 로 명확히 드러나고, in-process 호출이므로
// coverage 계측(vitest.config.ts:20)은 그대로 유지된다.
const { checkInvariants } = await import(new URL('../invariants.mjs', import.meta.url).href)

/** 정상 세계에 한 가지 변형만 가한다(DAMP — 무엇이 틀렸는지 본문에 보인다). */
function worldWith(mutate) {
  const world = aWorld()
  mutate(world)
  return world
}

describe('checkInvariants — 정상 3 페이로드(과잉 검출 방지)', () => {
  it('정상 세계는 throw 하지 않는다', () => {
    const { body, feeds, summary } = aWorld()

    expect(() => checkInvariants(summary, feeds, body)).not.toThrow()
  })
})

describe('불변식 1 — feeds[].docs[].id ⊆ summary.docs.id (disable 포함)', () => {
  it('summary 에 없는 doc id 를 가리키는 피드는 throw 한다', () => {
    const { body, feeds, summary } = worldWith((world) => {
      world.feeds.items[0].docs[0].id = GHOST_ID
    })

    expect(() => checkInvariants(summary, feeds, body)).toThrow(
      // 메시지가 **어느 피드**가 **어느 doc** 을 못 찾았는지 담아야 한다.
      new RegExp(String.raw`f1f1f1f1f1f1[\s\S]*${GHOST_ID}|${GHOST_ID}[\s\S]*f1f1f1f1f1f1`),
    )
  })

  it('[과잉검출 가드] disable 문서만 가리키는 피드는 통과한다', () => {
    // 정상적인 disable 운영(vault 커밋 14)이 빌드를 죽이면 계약이 틀린 것이다.
    const { body, summary } = aWorld()
    const feeds = aFeeds()
      .withItem(aFeedItem().refs([{ anchor: null, anchorText: null, id: DOC_D.id }]))
      .build()

    expect(() => checkInvariants(summary, feeds, body)).not.toThrow()
  })
})

describe('불변식 2 — keys(body.docs) == active 문서의 breadcrumb.join("/") (양방향)', () => {
  it('active 문서의 본문이 빠지면 throw 한다', () => {
    const { body, feeds, summary } = worldWith((world) => {
      delete world.body.docs[DOC_A.path]
    })

    expect(() => checkInvariants(summary, feeds, body)).toThrow(new RegExp(DOC_A.path))
  })

  it('disable 문서의 본문이 실려 있으면 throw 한다', () => {
    const { body, feeds, summary } = worldWith((world) => {
      world.body.docs[DOC_D.path] = aBodyDoc().build()
    })

    expect(() => checkInvariants(summary, feeds, body)).toThrow(new RegExp(DOC_D.path))
  })

  it('summary 에 없는 경로 키가 body 에 있으면 throw 한다', () => {
    const { body, feeds, summary } = worldWith((world) => {
      world.body.docs['ghost/문서'] = aBodyDoc().build()
    })

    expect(() => checkInvariants(summary, feeds, body)).toThrow(/ghost\/문서/)
  })
})

describe('불변식 3 — tree 문서 ⊆ active, 모든 active 가 정확히 한 노드', () => {
  it('active 문서가 tree 에서 누락되면 throw 한다', () => {
    const { body, feeds, summary } = worldWith((world) => {
      world.summary.tree[0].docs = []
    })

    expect(() => checkInvariants(summary, feeds, body)).toThrow(new RegExp(DOC_A.id))
  })

  it('같은 문서가 두 노드에 들어가면 throw 한다', () => {
    const { body, feeds, summary } = worldWith((world) => {
      world.summary.tree.push({ children: [], docs: [DOC_A.id], path: 'company' })
    })

    expect(() => checkInvariants(summary, feeds, body)).toThrow(new RegExp(DOC_A.id))
  })

  it('disable 문서가 tree 에 들어가면 throw 한다', () => {
    const { body, feeds, summary } = worldWith((world) => {
      world.summary.tree[0].docs.push(DOC_D.id)
    })

    expect(() => checkInvariants(summary, feeds, body)).toThrow(new RegExp(DOC_D.id))
  })
})

describe('불변식 4 — tags[*] ⊆ active ids', () => {
  it('disable 문서 id 가 태그 색인에 있으면 throw 한다', () => {
    const { body, feeds, summary } = worldWith((world) => {
      world.summary.tags['반도체'].push(DOC_D.id)
    })

    expect(() => checkInvariants(summary, feeds, body)).toThrow(new RegExp(DOC_D.id))
  })

  it('존재하지 않는 문서 id 가 태그 색인에 있으면 throw 한다', () => {
    const { body, feeds, summary } = worldWith((world) => {
      world.summary.tags['반도체'].push(GHOST_ID)
    })

    expect(() => checkInvariants(summary, feeds, body)).toThrow(new RegExp(GHOST_ID))
  })
})

describe('불변식 5 — tree[].path == 그 노드 문서들의 breadcrumb.slice(0,-1).join("/")', () => {
  it('문서가 엉뚱한 폴더 노드에 있으면 throw 한다', () => {
    // A(breadcrumb ['company','삼성전자'])를 'tech' 노드로 옮긴다 → 서브트리 필터가 엉뚱한 문서를 집계한다.
    const { body, feeds, summary } = worldWith((world) => {
      world.summary.tree[0].docs = []
      world.summary.tree[1].docs.push(DOC_A.id)
    })

    expect(() => checkInvariants(summary, feeds, body)).toThrow(new RegExp(DOC_A.id))
    expect(() => checkInvariants(summary, feeds, body)).toThrow(/company|tech/)
  })
})

describe('불변식 6 — feeds[].docs[].anchor ∈ headings(그 문서) 또는 null · anchorText 정합', () => {
  it('죽은 앵커(그 문서 headings 에 없음)는 throw 한다', () => {
    const { body, feeds, summary } = worldWith((world) => {
      world.feeds.items[0].docs[0].anchor = 'ghost-heading'
    })

    expect(() => checkInvariants(summary, feeds, body)).toThrow(/ghost-heading/)
  })

  it('disable 문서를 가리키는 피드에 앵커가 있으면 throw 한다(body 가 없다)', () => {
    // 생산 측(feed.mjs)이 null 로 강등해야 한다 — 강등을 빠뜨리면 여기서 죽는다.
    const { body, feeds, summary } = worldWith((world) => {
      world.feeds.items[1].docs[0].anchor = '적용-사례'
    })

    expect(() => checkInvariants(summary, feeds, body)).toThrow(/적용-사례/)
  })

  it('anchorText 가 그 앵커의 heading 원문과 다르면 throw 한다', () => {
    // 앵커는 살아 있으므로(hbm-사업 ∈ headings) 앵커 검사만으로는 **통과한다** — 그런데 카드는
    // 엉뚱한 섹션 이름("공급망")을 보여준다. 조용히 틀리는 표시를 여기서 끊는다.
    const { body, feeds, summary } = worldWith((world) => {
      world.feeds.items[0].docs[0].anchorText = '공급망'
    })

    expect(() => checkInvariants(summary, feeds, body)).toThrow(/공급망/)
    expect(() => checkInvariants(summary, feeds, body)).toThrow(/HBM 사업/) // 진짜 원문도 메시지에 있다
  })

  it('anchor 가 null 인데 anchorText 만 남아 있으면 throw 한다', () => {
    // 가리킬 섹션이 없는데 라벨만 있으면 카드가 존재하지 않는 섹션으로 안내한다.
    const { body, feeds, summary } = worldWith((world) => {
      world.feeds.items[1].docs[0].anchorText = '적용 사례'
    })

    expect(() => checkInvariants(summary, feeds, body)).toThrow(/적용 사례/)
  })
})

describe('불변식 7 — 3 페이로드의 sourceCommit 이 동일', () => {
  it('feeds 의 sourceCommit 만 다르면 throw 한다', () => {
    const skew = '0000000000000000000000000000000000000000'
    const { body, feeds, summary } = worldWith((world) => {
      world.feeds.sourceCommit = skew
    })

    // 메시지에 3개 값이 다 있어야 어느 페이로드가 뒤처졌는지 안다.
    expect(() => checkInvariants(summary, feeds, body)).toThrow(new RegExp(skew))
    expect(() => checkInvariants(summary, feeds, body)).toThrow(new RegExp(summary.sourceCommit))
  })
})

describe('불변식 8 — summary.docs[].id 가 유일 (cwiki 1파일 규칙의 최후 방어선)', () => {
  it('같은 id 를 가진 문서가 2건이면 throw 한다', () => {
    // 한 커밋이 문서 2개를 만들면 둘이 같은 생성 해시를 갖는다 →
    // byId Map 이 하나를 덮어써 참조가 **틀린 문서**를 가리킨다(비는 게 아니라 틀린다).
    const { body, feeds, summary } = worldWith((world) => {
      world.summary.docs.push(aDoc().with({ title: '삼성전자(중복)' }).build())
    })

    expect(() => checkInvariants(summary, feeds, body)).toThrow(new RegExp(DOC_A.id))
  })

  it('[과잉검출 가드] 서로 다른 id 는 통과한다', () => {
    const { body, feeds, summary } = aWorld()

    expect(summary.docs.map((doc) => doc.id)).toEqual([DOC_A.id, DOC_B.id, DOC_D.id])
    expect(() => checkInvariants(summary, feeds, body)).not.toThrow()
  })
})
