// @vitest-environment node
//
// P3 · Task 2 — 생존 판정에 `invalid-excluded` 사유 추가 (`feed-survival.mjs`) — tdd §3.4 (SVX1~SVX6)
//
// RED 사유(SVX1·SVX2·SVX5·SVX6 · **미구현**): `judgeFeedSurvival` 의 counters 가 3키
//   (`deleted`·`draftExcluded`·`unresolved`)뿐이라 `invalidExcluded` 가 **없다**. 새 사유를 넘기면
//   지금은 어느 카운터도 늘지 않고 조용히 무시된다 → 반환 객체 전체 `toEqual` 이 red 다.
//   SVX3·SVX4 는 **혼합 우선순위**를 못박는 짝 가드로, 지금도 우연히 통과할 수 있다(§5.1 참조).
//
// **P2 의 `feed-survival.test.mjs` 는 건드리지 않는다.** 그 파일의 12 CASES 행은 무수정 pin 이고,
//   §4 원장 ⑥(`zero` 1줄에 `invalidExcluded: 0` 추가)만이 허용된 변경이다. 이 파일은 **자기 `zero`(4키)**
//   를 갖는다 — 새 축을 새 파일에서 문다.
//
// 생존 판정 규칙(P2 규칙에 `invalid-excluded` **행만** 추가 · 이 표가 전수한다):
//   docs = refs 중 id !== null (등장 순 · 중복 id 제거)
//   1) docs.length > 0                                        → true
//   2) docs.length === 0 이고
//      a) importance === 'fix'                                 → false  (D9 예외)
//      b) 'draft-excluded' 있음                                 → false  (D2 fail-closed · prod 누출 차단)
//      c) 'unresolved' 있음                                     → false  (기존 유지)
//      d) 그 외('deleted' · **'invalid-excluded'** · refs 0건)   → true
//
// 왜 `deleted` 와 결론이 같은데 카운터를 나누는가(D-B): 결론은 같아도 **원인이 다르다**. 합치면
//   "예제 문서가 draft 라 숨은 것" 과 "문서가 깨져서 빠진 것" 과 "문서가 지워진 것" 이 한 숫자로
//   뭉개져, 오분류가 관측되지 않는다(tdd §6 CX7 이 그 사실 자체를 증명한다).
//
// 자기참조 공허성 금지(규범 A): 사유 문자열·docId 는 **리터럴**이다 — `FEED_REF_REASONS`·`IMPORTANCE`
//   를 import 하지 않는다. 상수 드리프트는 트립와이어 PG9 가 따로 잡는다.
import { describe, expect, it } from 'vitest'

import { judgeFeedSurvival } from '../feed-survival.mjs'

const ID_A = '0192a000-0000-7000-8000-0000000000aa'

/** counters 기본값 — **4키**(P3 가 추가하는 `invalidExcluded` 포함). 각 행은 필요한 축만 덮어쓴다. */
const zero = { deleted: 0, draftExcluded: 0, invalidExcluded: 0, unresolved: 0 }

// 반환 **객체 전체**를 toEqual 로 못박는다 — 부분 단언이면 "docs 는 맞는데 counters 를 조용히
//   삼키는" 절반 구현이 통과한다(P1 CF5 형).
const CASES = [
  {
    expected: { counters: { ...zero, invalidExcluded: 1 }, docs: [], feedSurvives: true },
    id: 'SVX1',
    input: { importance: 'normal', refs: [{ id: null, reason: 'invalid-excluded' }] },
    why: '★ D-B 의 심장 — `deleted` 와 **같은 결론**(생존)이지만 **다른 카운터**여야 한다',
  },
  {
    expected: {
      counters: { ...zero, invalidExcluded: 1 },
      docs: [{ id: ID_A }],
      feedSurvives: true,
    },
    id: 'SVX2',
    input: {
      importance: 'normal',
      refs: [
        { id: ID_A, reason: null },
        { id: null, reason: 'invalid-excluded' },
      ],
    },
    why: '부분 소실 — 남은 문서가 있으면 그대로 산다(과잉 차단 가드)',
  },
  {
    expected: {
      counters: { ...zero, draftExcluded: 1, invalidExcluded: 1 },
      docs: [],
      feedSurvives: false,
    },
    id: 'SVX3',
    input: {
      importance: 'normal',
      refs: [
        { id: null, reason: 'invalid-excluded' },
        { id: null, reason: 'draft-excluded' },
      ],
    },
    why: '★ 혼합 우선순위 — fail-closed(draft)가 이긴다. 이 행이 없으면 prod 누출 경로가 열린다',
  },
  {
    expected: { counters: { ...zero, invalidExcluded: 1 }, docs: [], feedSurvives: false },
    id: 'SVX4',
    input: { importance: 'fix', refs: [{ id: null, reason: 'invalid-excluded' }] },
    why: 'D9 예외가 새 사유에도 적용된다 — SVX1 과 **importance 만** 다르다',
  },
  {
    expected: {
      counters: { ...zero, invalidExcluded: 1, unresolved: 1 },
      docs: [],
      feedSurvives: false,
    },
    id: 'SVX5',
    input: {
      importance: 'normal',
      refs: [
        { id: null, reason: 'invalid-excluded' },
        { id: null, reason: 'unresolved' },
      ],
    },
    why: 'unresolved 우선(기존 유지) — "새 사유가 기존 규칙을 덮는다" 를 배제',
  },
  {
    expected: {
      counters: { ...zero, deleted: 1, invalidExcluded: 1 },
      docs: [],
      feedSurvives: true,
    },
    id: 'SVX6',
    input: {
      importance: 'normal',
      refs: [
        { id: null, reason: 'deleted' },
        { id: null, reason: 'invalid-excluded' },
      ],
    },
    why: 'pair — 두 생존 사유가 섞여도 카운터가 **각각** 는다(합산 뭉개기 배제)',
  },
]

describe('judgeFeedSurvival — invalid-excluded 사유 전수 (SVX1~SVX6 · 🔴RED 미구현)', () => {
  it.each(CASES)('$id: $why', ({ expected, input }) => {
    expect(judgeFeedSurvival(input)).toEqual(expected)
  })
})
