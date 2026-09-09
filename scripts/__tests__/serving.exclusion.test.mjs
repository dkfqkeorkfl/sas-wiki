// @vitest-environment node
//
// P3 · Task 3 — 서빙 3 엔드포인트에서 throw 를 걷어낸다 (`summary`·`wiki`·`feeds`) — tdd §3.3 (SR1~SR5)
//
// RED 사유(SR1~SR4 · **RED(flip)**): 세 엔드포인트가 모두 `buildWirePayload` → `parseVault` → `derive`
//   를 타므로, `derive.mjs:51,53` 의 중복 path/id throw 가 **서빙 요청 하나를 위키 전체의 죽음으로**
//   만든다(plan 결함 프로브 실측: 중복 id vault 에서 `summary`·`wiki` 둘 다 exit 1). P3 이후에는 판정이
//   `doc-gate` 에서 값으로 끝나므로 서빙은 **깨진 문서만 빼고 계속 돈다**.
//
// ★ 착륙 순서(tdd §5.1): Task 2(전파)가 green 이 되기 **전에** Task 3(throw 제거)을 하면 중복이 조용히
//   통과한다(Spark PERMISSIVE 붕괴 조건 — corrupt 컬럼이 없으면 drop). 이 파일이 green 이라고 해서
//   Task 2 를 건너뛴 것이 아닌지는 `build.doc-exclusion.test.mjs`(PG2·PG4)가 별도로 증명한다.
//
// ★ 현재 상태(원 RED 이후): `wiki` 축은 이 층을 떠났다 — 그 CLI 는 호출자가 지정한 마크다운 파일
//   1건을 파싱할 뿐이고, 어느 문서를 서빙할지 가르는 명부 게이트는 소비자(서버 층)가 진다. 그래서
//   이 파일이 무는 것은 **`summary`·`feeds` 두 엔드포인트의 생존**과 **명부가 제외를 반영하는가**다
//   (SR2 문단 참조).
//
// 왜 3 엔드포인트를 다 무는가: 세 함수는 같은 파싱 엔진을 공유하지만 **소비 형태가 다르다**(전체
//   payload / 단건 조회 / 피드 창). 하나만 고치고 나머지가 여전히 죽는 상태를 배제한다.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { feeds } from '../feeds.mjs'
import { summary } from '../lib/summary-endpoint.mjs'
import { prebuildArtifacts } from './helpers/prebuild-artifacts.mjs'
import { cleanup } from './helpers/tmp-git-vault.mjs'
import {
  CONTROL_FEED_TITLE,
  CONTROL_REL,
  ID_A,
  ID_DUP,
  seedCleanVault,
  seedPollutedVault,
  TWIN_A_REL,
  TWIN_B_REL,
  TWIN_FEED_TITLE,
} from './helpers/polluted-vault.mjs'

const tmps = []
afterAll(() => cleanup(...tmps))

const polluted = seedPollutedVault()
tmps.push(polluted.vault)

beforeAll(async () => {
  await prebuildArtifacts(polluted.vault, 'dev')
})

const titlesOf = (items) => items.map((item) => item.title)

describe('서빙 경로 — 오염 vault 에서 죽지 않는다 (SR1~SR3 · 🔴RED(flip))', () => {
  it('SR1: `summary` 가 throw 하지 않고 대조군 문서를 담는다', () => {
    // ★ 베이스라인 결함 프로브의 직접 반전. 앵커(ID_A 존재)가 "빈 payload 로 통과" 를 배제한다 —
    //   throw 만 안 하면 되는 게 아니라 **나머지 문서는 온전히 서빙돼야** 한다.
    let payload
    expect(() => {
      payload = summary(polluted.vault, 'dev')
    }).not.toThrow()

    expect(payload.docs.map((doc) => doc.id)).toContain(ID_A)
    expect(payload.docs.map((doc) => doc.id)).not.toContain(ID_DUP)
  })

  // ★★ **SR2 축 교체 — 「승계」가 아니라 「대체」다. 이 문단을 지우면 다음 독자가 «제외 문서가
  //    서빙된다는 것을 아무도 안 본다»고 읽는다.**
  //
  //    옛 SR2 는 자식 `wiki(vault, env, ref)` 로 제외 문서를 조회해 `null` 인지 봤다. 그 함수는 이제
  //    **호출자가 지정한 마크다운 파일 1건을 파싱하는 것**이고, 어느 문서를 서빙할지 가르는 명부
  //    게이트는 소비자(서버 층)로 옮겨갔다.
  //
  //    지키던 것 → 지키게 된 것: 「제외 문서를 조회하면 `null` 이다」 → **「제외 문서의 **경로**가
  //    발행 명부에 아예 없다」**. 소비자의 게이트는 명부의 `breadcrumb` 를 키로 조회해 미스면 404 를
  //    내므로, 경로가 명부에 없다는 것이 곧 그 문서가 서빙되지 않는다는 것이다. 종단(404) 관측은
  //    소비자 저장소가 지고, 이 층은 **그 입력이 옳은지**를 진다.
  //
  //    🔴 SR1 과 겹치지 않는다 — SR1 은 **id 축**(`ID_DUP` 부재)이고 여기는 **경로 축**이다. 소비자가
  //    조회 키로 쓰는 것은 경로이므로, id 만 보면 「id 는 빠졌는데 경로는 남았다」를 놓친다.
  it('SR2: 제외 문서의 경로가 발행 명부에 **없다** (대조군 경로는 있다)', () => {
    const refs = summary(polluted.vault, 'dev').docs.map((doc) => doc.breadcrumb.join('/'))

    expect(refs).toContain(CONTROL_REL) // 앵커: 명부가 비어서 통과하는 것을 배제한다

    expect(refs).not.toContain(TWIN_A_REL)
    expect(refs).not.toContain(TWIN_B_REL)
  })

  it('SR3: `feeds` 가 throw 하지 않고 피드 2건을 그대로 낸다', async () => {
    // P5 · §4 원장 ㉖-b — `feeds()` 가 async 가 됐다(D-E). "던지지 않는다" 는 이제 **reject 하지
    //   않는다** 로 옮긴다 — `await` 가 실패(rejection)를 그대로 전파하므로 감싸지 않아도 "안
    //   던진다" 가 암묵 보존된다(단언 약화가 아니다).
    const payload = await feeds(polluted.vault, 'dev', { count: 10 })

    // 개수와 **신원**을 함께 본다 — 개수만 보면 엉뚱한 2건이어도 통과한다.
    expect(payload.items).toHaveLength(2)
    expect(titlesOf(payload.items).toSorted()).toEqual(
      [CONTROL_FEED_TITLE, TWIN_FEED_TITLE].toSorted(),
    )
  })

  it('SR4: 같은 "빈 docs" 라도 하나는 살고 하나는 연결만 끊긴다 (pair · 최종 관측점)', async () => {
    const payload = await feeds(polluted.vault, 'dev', { count: 10 })
    const twin = payload.items.find((item) => item.title === TWIN_FEED_TITLE)
    const control = payload.items.find((item) => item.title === CONTROL_FEED_TITLE)

    expect(twin.docs).toEqual([])
    expect(control.docs).toEqual([{ id: ID_A }])
  })
})

describe('서빙 경로 — 과잉 차단 가드 (SR5 · 대조군 vault)', () => {
  it('SR5: 오염 0건 vault 에서 세 엔드포인트가 제외 모델 도입 전과 같은 것을 돌려준다', async () => {
    // 정상 데이터가 제외 모델 때문에 사라지지 않는지 — SR1~SR4 의 반대 방향 가드다.
    const clean = seedCleanVault()
    tmps.push(clean.vault)
    await prebuildArtifacts(clean.vault, 'dev')

    const summaryPayload = summary(clean.vault, 'dev')
    expect(summaryPayload.docs.map((doc) => doc.id)).toContain(ID_A)
    expect(summaryPayload.docs).toHaveLength(3)

    // ★ 조회 축은 이 층을 떠났다(SR2 문단 참조) — 정상 문서가 명부에 **경로로** 남아 있는지를 본다.
    const cleanRefs = summaryPayload.docs.map((doc) => doc.breadcrumb.join('/'))
    expect(cleanRefs).toContain(CONTROL_REL)

    const feedPayload = await feeds(clean.vault, 'dev', { count: 10 })
    expect(titlesOf(feedPayload.items)).toEqual([CONTROL_FEED_TITLE])
    expect(feedPayload.items[0].docs).toEqual([{ id: ID_A }])
  })
})
