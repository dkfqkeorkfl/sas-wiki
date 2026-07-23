// @vitest-environment node
//
// P1 · Task 3 — endpoints.summary **on-demand git 파싱** 전환 (D5 재작업) — tdd §Task 3 (E-S)
//
// RED 사유(엔진 전환): 초판 `summary(payload, env)` 는 pre-parsed **payload 객체**를 자르기만 했다
//   (git 미접근). 재작업 계약은 `summary(vault, env)` — **vault(git) 경로**를 받아 buildWirePayload 로
//   전체 파싱 후 buildSummary 투영한다. 아래는 1번째 인자에 **vault 경로 문자열**을 넘긴다 →
//   현행 payload-슬라이서가 `vault.docs.filter` 를 호출해 **TypeError**(의도한 미구현)로 실패한다.
//   (지연 import 관례 유지 — endpoints.mjs 는 존재하나 시그니처가 payload→vault 로 전환돼야 green.)
//
// 계약(GREEN 이 구현):
//   summary(vault, env) = buildWirePayload(vault, env) 전체 파싱 → buildSummary 투영.
//     env='prod' → draft(dev/ 폴더·draft:true) 문서 제외(build.mjs visibleDocs 상속) · env='dev' → 전량.
//     active=10키 / disable=4키 투영(본문 없음 — 부팅 페이로드에 html·md 미유출).
//
// 실 git 시딩(tmp-git-vault) — 순수 함수라 mock 대신 결정적 실 실행.
import { describe, expect, it } from 'vitest'

import { cleanup, commit, initVault, writeDoc } from '../../__tests__/helpers/tmp-git-vault.mjs'

const { summary } = await import(new URL('../endpoints.mjs', import.meta.url).href)

const ID_A = '0192a000-0000-7000-8000-0000000000aa' // active, prod 가시
const ID_DRAFT = '0192b000-0000-7000-8000-0000000000bb' // dev/ 폴더 = draft

const ENVELOPE_KEYS = ['docs', 'generatedAt', 'schemaVersion', 'sourceCommit', 'tags', 'tree']
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
  commit(vault, 'cwiki: 삼성전자 + dev 실험문서 생성')
}

describe('endpoints.summary — on-demand git 파싱 (E-S1·E-S2 🔴RED 전환)', () => {
  it('E-S1: summary(vault, "prod") → 봉투 6키·draft 제외·본문 키 0', () => {
    const vault = initVault()
    try {
      seedMixed(vault)

      const out = summary(vault, 'prod')

      expect(Object.keys(out).toSorted()).toEqual(ENVELOPE_KEYS)
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
      commit(vault, 'cwiki: dev 전용 문서만 생성')

      const out = summary(vault, 'prod')

      expect(out.docs).toEqual([])
      expect(Object.keys(out).toSorted()).toEqual(ENVELOPE_KEYS)
    } finally {
      cleanup(vault)
    }
  })
})
