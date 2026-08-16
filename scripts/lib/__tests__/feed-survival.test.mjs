// @vitest-environment node
//
// P2 · Task 1 — 피드 생존 판정 순수 함수 (`feed-survival.mjs`) — tdd §3.1 (SV1~SV12)
//
// RED 사유(전 케이스 공통 · **미구현**): `scripts/lib/feed-survival.mjs` 가 **부재**하고
//   `judgeFeedSurvival` export 도 없다. 정적 named import 로 적으면 ESM 링크가 파일을 통째로 죽여
//   collection error 가 되고(= 테스트 0건), rtk 래퍼는 그것을 PASS 로 오보고한다(tdd §2.4).
//   그래서 모듈 해석을 **런타임으로 미루고**(dynamic import + catch) 케이스마다 명시적으로 실패시킨다
//   → SV1~SV12 가 **각각** red 가 되고 어느 축이 미구현인지 즉시 보인다.
//   (webfront `news.payloads.schema.test.ts` 의 `schema()` 헬퍼와 P1 지연 import 관례의 결합.)
//
// 이 파일이 확정하는 seam (tdd §3.0 — GREEN 은 이 형태로 구현한다):
//   judgeFeedSurvival({ importance, refs })
//     refs: { id: string|null, reason: null|'deleted'|'draft-excluded'|'unresolved' }[]
//     →     { counters: { deleted, draftExcluded, unresolved }, docs: [{ id }], feedSurvives }
//   **`env` 를 인자로 받지 않는다**(OQ-P2-3 확정 = 제거) — 사유가 env 를 이미 운반한다. SV12 가 못.
//
// 판정 규칙(우선순위 · 이 표가 전수한다):
//   docs = refs 중 id !== null (등장 순 · 중복 id 제거)
//   1) docs.length > 0                      → true               (fix 여도 생존)
//   2) docs.length === 0 이고
//      a) importance === 'fix'               → false  (D9 예외)
//      b) reason 에 'draft-excluded' 있음     → false  (D2 fail-closed · prod 누출 차단)
//      c) reason 에 'unresolved' 있음         → false  (기존 유지)
//      d) 그 외(전부 'deleted' 또는 refs 0건) → true   (D9 — 기사 전용 피드)
//
// 자기참조 공허성 금지(tdd §2.3 규범 A): 사유 문자열·docId 는 **리터럴**이다 — `FEED_REF_REASONS`·
//   `IMPORTANCE` 를 import 해 입력을 만들지 않는다(선택자 드리프트를 따라가면 가드가 무력해진다).
//
// 비용(tdd §7.3): 순수 함수 + 리터럴 테이블. git·fs 접근 0 → 9p 마운트 spawn 비용을 여기서 전부 회피한다.
import { describe, expect, it } from 'vitest'

import { judgeFeedSurvival } from '../feed-survival.mjs'

function judge(input) {
  return judgeFeedSurvival(input)
}

// 유효 UUIDv7 리터럴(feeds.schema.json docRef pattern 준수) — 문서 정체성.
const ID_A = '0192a000-0000-7000-8000-0000000000aa'

/** counters 기본값 — 각 행은 필요한 축만 덮어쓴다(무엇이 세어졌는지가 표에 보인다 · DAMP). */
const zero = { deleted: 0, draftExcluded: 0, invalidExcluded: 0, unresolved: 0 }

// 각 행 = 개별 케이스(it.each). 반환 **객체 전체**를 toEqual 로 못박는다 — 부분 단언이면
//   "docs 는 맞는데 counters 를 조용히 삼키는" 절반 구현이 통과한다(P1 CF5 형).
const CASES = [
  {
    expected: { counters: { ...zero }, docs: [{ id: ID_A }], feedSurvives: true },
    id: 'SV1',
    input: { importance: 'normal', refs: [{ id: ID_A, reason: null }] },
    why: '정상 경로 대조군 — 이것이 없으면 "항상 false" 구현이 SV3~SV6 을 통과한다',
  },
  {
    expected: { counters: { ...zero, deleted: 1 }, docs: [{ id: ID_A }], feedSurvives: true },
    id: 'SV2',
    input: {
      importance: 'normal',
      refs: [
        { id: ID_A, reason: null },
        { id: null, reason: 'deleted' },
      ],
    },
    why: '부분 소실 — 남은 게 있으면 그대로 산다. counters 를 함께 봐 "조용히 삼키기"를 막는다',
  },
  {
    expected: { counters: { ...zero, deleted: 1 }, docs: [], feedSurvives: true },
    id: 'SV3',
    input: { importance: 'normal', refs: [{ id: null, reason: 'deleted' }] },
    why: '★ D9 의 심장 — `docs: []` 를 명시 기대값으로 못박아 "생존했지만 연결이 살아 있는" 반쪽 구현을 배제',
  },
  {
    expected: { counters: { ...zero, draftExcluded: 1 }, docs: [], feedSurvives: false },
    id: 'SV4',
    input: { importance: 'normal', refs: [{ id: null, reason: 'draft-excluded' }] },
    why: '★ 누출 차단 — SV3 과 한 글자만 다른 입력이라 "사유를 실제로 읽는가"를 정확히 문다',
  },
  {
    expected: { counters: { ...zero, draftExcluded: 1 }, docs: [{ id: ID_A }], feedSurvives: true },
    id: 'SV5',
    input: {
      importance: 'normal',
      refs: [
        { id: ID_A, reason: null },
        { id: null, reason: 'draft-excluded' },
      ],
    },
    why: '과잉 차단 가드 — 남은 문서가 있으면 prod 에서도 산다(D-A 를 "draft 섞이면 무조건 숨김"으로 읽으면 red)',
  },
  {
    expected: { counters: { ...zero, deleted: 1 }, docs: [], feedSurvives: false },
    id: 'SV6',
    input: { importance: 'fix', refs: [{ id: null, reason: 'deleted' }] },
    why: '★ D9 예외 — SV3 과 importance 만 다르다 → "사유만 보고 importance 를 무시"를 배제',
  },
  {
    expected: { counters: { ...zero }, docs: [{ id: ID_A }], feedSurvives: true },
    id: 'SV7',
    input: { importance: 'fix', refs: [{ id: ID_A, reason: null }] },
    why: 'fix 의 과잉 드랍 가드(대상이 있으면 산다) — SV6 의 짝',
  },
  {
    expected: { counters: { ...zero, unresolved: 1 }, docs: [], feedSurvives: false },
    id: 'SV8',
    input: { importance: 'normal', refs: [{ id: null, reason: 'unresolved' }] },
    why: '기존 동작 보존 — 설명되지 않은 참조는 생존 근거가 아니다. SV3 과의 대비가 "전부 살린다"를 배제',
  },
  {
    expected: {
      counters: { ...zero, deleted: 1, draftExcluded: 1 },
      docs: [],
      feedSurvives: false,
    },
    id: 'SV9',
    input: {
      importance: 'normal',
      refs: [
        { id: null, reason: 'deleted' },
        { id: null, reason: 'draft-excluded' },
      ],
    },
    why: '혼합 사유의 우선순위 — 안전한 쪽(차단)이 이긴다. 이 행이 없으면 첫 사유만 보는 구현이 통과',
  },
  {
    expected: { counters: { ...zero }, docs: [{ id: ID_A }], feedSurvives: true },
    id: 'SV10',
    input: {
      importance: 'normal',
      refs: [
        { id: ID_A, reason: null },
        { id: ID_A, reason: null },
      ],
    },
    why: 'dedupe — 서빙 경로가 이미 갖는 성질(git-walk.mjs:165)을 순수 함수로 이관할 때 잃지 않게 한다',
  },
  {
    expected: { counters: { ...zero }, docs: [], feedSurvives: true },
    id: 'SV11',
    input: { importance: 'normal', refs: [] },
    why: '★ OQ-P2-2 확정(생존 + warning 제거) — 기사 전용 피드가 D9 의 1차 사용 사례다',
  },
]

describe('judgeFeedSurvival — 사유별 생존 판정 전수 테이블 (SV1~SV11 · 🔴RED 미구현)', () => {
  it.each(CASES)('$id: $why', ({ expected, input }) => {
    expect(judge(input)).toEqual(expected)
  })
})

describe('judgeFeedSurvival — env 이중 인코딩 부재 (SV12 · pair)', () => {
  it('SV12: 판정은 env 를 축으로 삼지 않는다 — 사유가 이미 env 를 운반한다(OQ-P2-3 = 제거)', () => {
    // 같은 refs·importance 에 env 를 얹어도 판정이 흔들리면 진실원이 둘이 된다(P1 이 `env === 'prod'`
    //   vs `env !== 'dev'` 로 겪은 극성 발산의 축소판). draft-excluded 는 **prod 에서만 발생 가능한
    //   사유**이므로, 그것을 'dev' 와 함께 넘겨도 판정이 사유를 따라야 한다.
    const refs = [{ id: null, reason: 'draft-excluded' }]
    const base = judge({ importance: 'normal', refs })

    expect(base.feedSurvives).toBe(false) // 앵커: 사유 판정이 실제로 작동한다(공허 대조 방지)
    expect(judge({ env: 'dev', importance: 'normal', refs })).toEqual(base)
    expect(judge({ env: 'prod', importance: 'normal', refs })).toEqual(base)
  })
})
