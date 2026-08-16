// @vitest-environment node
//
// P1 · Task 3 — endpoints.summary **on-demand git 파싱** 전환 (D5 재작업) — tdd §Task 3 (E-S)
//
// RED 사유(엔진 전환): 초판 `summary(payload, env)` 는 pre-parsed **payload 객체**를 자르기만 했다
//   (git 미접근). 재작업 계약은 `summary(vault, env)` — **vault(git) 경로**를 받아 buildWirePayload 로
//   전체 파싱 후 buildSummary 투영한다. 아래는 1번째 인자에 **vault 경로 문자열**을 넘긴다 →
//   현행 payload-슬라이서가 `vault.docs.filter` 를 호출해 **TypeError**(의도한 미구현)로 실패한다.
//   (지연 import 관례 유지 — summary.mjs(구 endpoints.summary)로 접힘 · payload→vault 시그니처.)
//
// 계약(GREEN 이 구현):
//   summary(vault, env) = buildWirePayload(vault, env) 전체 파싱 → buildSummary 투영.
//     env='prod' → draft(dev/ 폴더·draft:true) 문서 제외(build.mjs visibleDocs 상속) · env='dev' → 전량.
//     active=10키 / disable=4키 투영(본문 없음 — 부팅 페이로드에 html·md 미유출).
//
// 실 git 시딩(tmp-git-vault) — 순수 함수라 mock 대신 결정적 실 실행.
import { describe, expect, it } from 'vitest'

import { cleanup, commit, initVault, writeDoc } from './helpers/tmp-git-vault.mjs'

const { summary } = await import(new URL('../lib/summary-endpoint.mjs', import.meta.url).href)

const ID_A = '0192a000-0000-7000-8000-0000000000aa' // active, prod 가시
const ID_DRAFT = '0192b000-0000-7000-8000-0000000000bb' // dev/ 폴더 = draft

/**
 * wire 봉투 **7키**(v3 P1 · D28 이후 확정) — 아래 배열이 정확 일치 계약이다.
 *
 * 아티팩트 파일 = stdout payload = HTTP 응답이 **같은 형태**여야 한다. 이 엔드포인트가 곧 그 형태이고
 * (webfront `dev/wiki-backend/__tests__/dev-api.contract.test.ts` 가 봉투 계약으로 문다), 쪼개면
 * `summary.schema.json`(strict)이 두 벌 필요해진다 = 「호환 분기」.
 */
// 🔴 v3 P1(§4.3 ③ · D28): 발행자 표지·상관 토큰이 wire 에서 사라져 **7키**가 된다 — 옛 "9키 =
//   7키 + 두 가산" 서술은 D28 이전 세대였다. 아래 배열이 오늘의 계약이고 그 안에 발행자 표지 키는
//   없다(배열 자체가 유일한 정의처다 — 여기서 키 이름을 다시 나열하지 않는다).
const ENVELOPE_KEYS = [
  'docs',
  'env',
  'generatedAt',
  'schemaVersion',
  'sourceCommit',
  'tags',
  'tree',
]
const ACTIVE_DOC_KEYS = [
  'aliases',
  'breadcrumb',
  'created',
  'excerpt',
  'id',
  'status',
  'tags',
  'title',
  'type',
  'updated',
]

/** active 1(prod 가시) + draft 1(dev/ 폴더) 세계관. */
function seedMixed(vault) {
  writeDoc(vault, 'company/삼성전자', { id: ID_A, title: '삼성전자', type: 'company' })
  writeDoc(vault, 'dev/실험문서', { id: ID_DRAFT, title: '실험 문서', type: 'concept' })
  commit(vault, 'chore: 삼성전자 + dev 실험문서 생성')
}

describe('endpoints.summary — on-demand git 파싱 (E-S1·E-S2 🔴RED 전환)', () => {
  it('E-S1: summary(vault, "prod") → 봉투 7키·schemaVersion 1·draft 제외·본문 키 0', () => {
    const vault = initVault()
    try {
      seedMixed(vault)

      const out = summary(vault, 'prod')

      expect(Object.keys(out).toSorted()).toEqual(ENVELOPE_KEYS)
      // 🔴 v3 P1 · D29(§4.3 ②) — 내부 wire 계약 번호를 **1 로 리셋**한다. 리터럴 복제는 **복제로
      //   유지**한다(import 로 바꾸면 구현이 어떤 값이든 통과한다 · 규범 A). 단언이 약해진 것이
      //   아니라 **계약이 바뀐** 자리다.
      expect(out.schemaVersion).toBe(1)
      expect(out.docs.map((doc) => doc.id)).toContain(ID_A)
      expect(out.docs.map((doc) => doc.id)).not.toContain(ID_DRAFT) // draft 제외
      const active = out.docs.find((doc) => doc.id === ID_A)
      expect(Object.keys(active).toSorted()).toEqual(ACTIVE_DOC_KEYS) // 본문(html·md) 미유출
    } finally {
      cleanup(vault)
    }
  })

  it('E-S2: summary(vault, "dev") → 같은 vault 가 draft 문서를 포함한다', () => {
    const vault = initVault()
    try {
      seedMixed(vault)

      const out = summary(vault, 'dev')

      expect(out.docs.map((doc) => doc.id)).toContain(ID_DRAFT)
    } finally {
      cleanup(vault)
    }
  })
})

describe('endpoints.summary — 경계 (E-S3 🔴RED)', () => {
  it('E-S3: 전부 draft 인 prod → docs=[]·유효 봉투·throw 없음', () => {
    const vault = initVault()
    try {
      writeDoc(vault, 'dev/실험1', { id: ID_A, title: '실험1', type: 'concept' })
      writeDoc(vault, 'dev/실험2', { id: ID_DRAFT, title: '실험2', type: 'concept' })
      commit(vault, 'chore: dev 전용 문서만 생성')

      const out = summary(vault, 'prod')

      expect(out.docs).toEqual([])
      expect(Object.keys(out).toSorted()).toEqual(ENVELOPE_KEYS)
    } finally {
      cleanup(vault)
    }
  })
})
