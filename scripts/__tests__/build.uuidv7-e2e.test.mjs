// @vitest-environment node
//
// P1(통합) · R8 — 실 vault 빌드 수렴 (Task 1~4 착지 후 green) — tdd §3 Task 4
//
// RED 사유(수렴 · tdd §6-4): 마이그레이션(Task 4)이 실 6문서 frontmatter 에 UUIDv7 을 써 넣은 뒤에야
//   산출물 doc id 가 UUIDv7 이 된다. 현행은 doc id 를 git 해시 12자로 유도하므로, 아래 "doc id=UUIDv7"
//   단언이 실패한다(현재 실측: 12-hex). 스키마만 먼저 UUIDv7 로 바뀌고 마이그레이션이 안 됐다면 build
//   자체가 12-hex 주입을 거부해 throw 한다 — 어느 쪽도 유효 RED(의도된 미구현)다.
//
// 폭 3종 동시(오전환 0): doc id=UUIDv7 · feed id=12-hex(D6 KEEP) · sourceCommit=40-hex(불가침).
//   feed id·sourceCommit 단언은 green-stay(지금도·GREEN 후에도 통과) — doc id 만 전환됨을 못박는다.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { buildContent } from '../validate.mjs'

const UUIDV7_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const HEX12_RE = /^[0-9a-f]{12}$/u
const HEX40_RE = /^[0-9a-f]{40}$/u

const HERE = path.dirname(fileURLToPath(import.meta.url))
const VAULT = path.resolve(HERE, '..', '..') // sas-wiki 리포 루트(wiki/ 를 품는다)

// 이 스펙만 **실 vault**(tmp 시딩이 아닌 서브모듈 자체)를 빌드한다. vitest.config.js 가 결정성용으로
// GIT_CONFIG_GLOBAL=/dev/null 을 걸어 전역 safe.directory 예외가 사라지므로, 컨테이너에서 vault 가
// 러너와 다른 소유자면 `git rev-parse` 가 dubious-ownership 로 죽는다(셋업 붕괴). safe.directory 를
// **이 vault 경로에 한해** GIT_CONFIG 로 주입해 실행 가능하게 만든다 — 단언은 그대로다(약화 아님).
const GIT_CONFIG_KEYS = ['GIT_CONFIG_COUNT', 'GIT_CONFIG_KEY_0', 'GIT_CONFIG_VALUE_0']

const ctx = { out: '', prevGitConfig: {}, result: null }

beforeAll(() => {
  ctx.out = mkdtempSync(path.join(tmpdir(), 'wiki-uuidv7-e2e-'))
  for (const key of GIT_CONFIG_KEYS) ctx.prevGitConfig[key] = process.env[key]
  process.env.GIT_CONFIG_COUNT = '1'
  process.env.GIT_CONFIG_KEY_0 = 'safe.directory'
  process.env.GIT_CONFIG_VALUE_0 = VAULT
  // 마이그레이션 전엔 12-hex 주입이 UUIDv7 스키마에 걸려 throw 할 수 있다(수렴 RED — 정상).
  //
  // ★ `env` 를 빼면 안 된다. 기본값이 `prod` 인데 이 vault 의 문서는 전부 `wiki/dev/` 아래라
  //   prod 에서는 문서 모집단이 통째로 비어(docs=0) 아래 단언들이 빈 배열끼리 비교하는 공허
  //   통과가 된다. 여기서 `dev` 를 명시하는 것이 이 파일의 검사 대상을 존재하게 만드는 조건이다.
  ctx.result = buildContent({ env: 'dev', out: ctx.out, vault: VAULT })
})

afterAll(() => {
  for (const key of GIT_CONFIG_KEYS) {
    if (ctx.prevGitConfig[key] === undefined) delete process.env[key]
    else process.env[key] = ctx.prevGitConfig[key]
  }
  if (ctx.out) rmSync(ctx.out, { force: true, recursive: true })
})

describe('R8 실 vault 빌드 — 폭 3종 동시 검증', () => {
  it('summary 6문서 id 가 전부 UUIDv7 이다', () => {
    // 앵커: 검사할 문서가 실재한다. 빌드가 문서를 한 건도 담지 않으면 아래 "규격 위반 0건" 단언은
    //   빈 배열끼리 비교하는 공허 통과가 된다 — 그 자리를 닫는다. 수는 세지 않는다(문서가 늘고 줄어도
    //   이 앵커는 성립해야 하며, 정확한 개수를 박으면 vault 히스토리에 하드결합된다).
    expect(ctx.result.summary.docs.length, '앵커: 검사할 문서 0건(공허 통과)').toBeGreaterThan(0)

    const nonUuidv7 = ctx.result.summary.docs.filter((doc) => !UUIDV7_RE.test(doc.id))

    expect(nonUuidv7.map((doc) => doc.id)).toEqual([])
  })

  it('feed item id 는 전부 12-hex 다(피드 정체성=커밋해시 · green-stay)', () => {
    // 앵커: 검사할 feed item 이 실재한다. 문서 모집단과 feed 모집단은 서로 다른 축이라
    //   한쪽이 차 있어도 다른 쪽이 빌 수 있다 — 이 케이스의 모집단을 따로 못박는다.
    expect(ctx.result.feeds.items.length, '앵커: 검사할 feed item 이 없다').toBeGreaterThan(0)

    const bad = ctx.result.feeds.items.filter((item) => !HEX12_RE.test(item.id))

    expect(bad.map((item) => item.id)).toEqual([])
  })

  it('sourceCommit 은 40-hex full sha 다(불가침 · green-stay)', () => {
    expect(ctx.result.summary.sourceCommit).toMatch(HEX40_RE)
    expect(ctx.result.feeds.sourceCommit).toMatch(HEX40_RE)
  })
})

describe('R8 피드 전환 회귀 0 — DocRef 가 UUIDv7 문서를 가리킨다', () => {
  it('feed docRef.id 가 전부 UUIDv7 이다(피드→문서 포인터 전환)', () => {
    const refIds = ctx.result.feeds.items.flatMap((item) => item.docs.map((ref) => ref.id))

    // 앵커: 해석할 docRef 가 실재한다. item 이 있어도 각 item 의 docs 가 전부 비면 refIds 는 0건이 되고,
    //   그러면 "UUIDv7 아닌 것 0건"은 검사 대상 없이 통과한다 — 포인터 자체가 사라진 회귀를 통과로 읽는다.
    expect(refIds.length, '앵커: feed item 에 docRef 가 하나도 달려 있지 않다').toBeGreaterThan(0)

    const bad = refIds.filter((id) => !UUIDV7_RE.test(id))

    expect(bad).toEqual([])
  })

  it('모든 feed docRef.id 가 실제 summary 문서 id 로 해석된다(prune/dangling 0)', () => {
    // 값 출처만 UUIDv7 로 바뀌어도 buildPathIndex 메커니즘은 불변 — 참조 무결성은 지금도·GREEN 후에도 유지.
    const docIds = new Set(ctx.result.summary.docs.map((doc) => doc.id))
    const refIds = ctx.result.feeds.items.flatMap((item) => item.docs.map((ref) => ref.id))

    // 앵커 ①: 대조 기준이 실재한다. 문서 id 집합이 비면 이 케이스는 "모든 참조가 dangling" 이거나
    //   "참조도 없다" 둘 중 하나인데, 후자면 아래 단언이 통과해 버린다 — 기준 부재를 무결성으로 오독한다.
    expect(docIds.size, '앵커: 참조를 해석할 summary 문서 id 집합이 비었다').toBeGreaterThan(0)
    // 앵커 ②: 해석할 참조가 실재한다. 참조가 0건이면 dangling 이 0건인 것은 무결성이 아니라 공백이다.
    expect(refIds.length, '앵커: 해석할 docRef 0건(dangling 0 자동 성립)').toBeGreaterThan(0)

    const dangling = refIds.filter((id) => !docIds.has(id))

    expect(dangling).toEqual([])
  })
})
