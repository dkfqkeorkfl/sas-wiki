// @vitest-environment node
//
// P5 · Task 1 — `generatedAt` 재정의 (D-B) — tdd §3.1 (GA1~GA5)
//
// 무엇이 바뀌는가: 아티팩트 `generatedAt` 의 원천이 `max(doc.updated ∪ item.ts)` 에서
//   **`max(doc.updated)`** 로 좁아진다. item ts 를 먹는 현행은 두 가지를 동시에 망가뜨린다.
//   ① **누출**: 억제된 항목의 ts 가 응답에 남는다(B14 실측 · CWE-204 클래스).
//   ② **결합**: 생성기가 `generatedAt` 하나 때문에 커밋 워크를 지불한다(F-15).
//   서빙 시점 재집계(억제 **후** item ts 와의 max)는 `feeds.mjs` 소관이고 **FC7** 이 문다 — 두 층을
//   한 케이스에 섞지 않는다(tdd §7.5).
//
// RED 사유:
//   · GA1 — **RED(오늘 2인자)**. `parse-vault.mjs:60` 이 `deriveGeneratedAt(derived.docs, items)` 로
//     부르고 `:75` 선언도 2인자다. plan Task 1 GOTCHA("인자를 남긴 채 무시하면 다음 사람이 되돌린다")를
//     소스 트립와이어로 물질화한다. **CX 지목 = CX-B**.
//   · GA2 — **RED(flip)**. 아래 픽스처에서 오늘은 item ts(2026)가 이긴다(실측).
//   · GA4 — **RED(시그니처 미축소)**. `deriveGeneratedAt([])` 는 오늘 `items` 가 undefined 라
//     `for (const item of items)` 에서 TypeError 다. tdd §3.1 은 이 행을 `pin` 으로 적었으나 실측상
//     1인자 호출은 지금 성립하지 않는다 — **경계값 계약을 post-GREEN 형태로 적고 red 를 받는다**.
//     (같은 단언의 2인자판은 `build.env-filter.test.mjs:250` 에 이미 있고 §4 원장 ⑤ 가 갱신한다.)
//   · GA5 — **RED(억제된 항목의 ts 가 값에 남는다)**. tdd §3.1 은 "억제하면 값이 변한다" 로 적었으나
//     실측상 `parseVault` 의 items 는 **억제 전**이라 값이 변하지 않는다 → 그 형태로 쓰면 오늘도
//     green 인 **공허 케이스**가 된다. 그래서 D-B 가 실제로 요구하는 속성 둘로 바꿔 문다:
//     (a) 억제 유무와 무관하게 같은 값 (b) 그 값이 **억제된 항목의 ts 가 아니다**. (b)가 오늘 red 다.
//
// 관측 층(tdd §7.5): 순수 함수 반환값(GA1·GA3·GA4) + `parseVault` 반환 wire(GA2·GA5) + 소스 텍스트
//   트립와이어(GA1). 파일·CLI·프로세스는 여기서 보지 않는다.
//
// 규범 A: 기대 시각 문자열·억제 엔트리·문서 id 는 전부 **리터럴**이거나 픽스처가 만든 값에서 유도한다.
//   `SOURCE_DATE_EPOCH` 키 이름조차 프로덕션에서 import 하지 않는다.
// 규범 F: 실 vault 를 건드리지 않는다 — 억제 엔트리는 tmp git vault 에서만 만든다.
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterAll, describe, expect, it } from 'vitest'

import { deriveGeneratedAt, parseVault } from '../parse-vault.mjs'
import { cleanup, commit, feedCommit, initVault, writeDoc } from '../../__tests__/helpers/tmp-git-vault.mjs' // prettier-ignore

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SCRIPTS_DIR = path.resolve(HERE, '..', '..')
const SCHEMA_DIR = path.join(SCRIPTS_DIR, 'schema')
const PARSE_VAULT_SOURCE = path.join(SCRIPTS_DIR, 'lib', 'parse-vault.mjs')

/** 문서 id · 경로 · 억제 파일명 · 억제 `when` — 전부 리터럴이다(규범 A). */
const ID_GAMMA = '0192f000-0000-7000-8000-0000000000f1'
const REL_GAMMA = 'company/감마'
const IGNORE_FILE = 'ignore-feeds.json'
const IGNORE_WHEN = '2026-07-28T00:00:00Z'

/** 피드 author-date — 문서 커밋(tick ≈ 2006)보다 **20년 늦다**. 이 비대칭이 GA2·GA5 의 전부다. */
const FEED_TS = '2026-12-31T00:00:00Z'
const FEED_TITLE = '감마 소식'

/** 빈 집합 경계값 — 리터럴(프로덕션에서 유도하지 않는다). */
const EPOCH_ZERO = '1970-01-01T00:00:00.000Z'

const tmps = []
afterAll(() => cleanup(...tmps))

/**
 * `max(item.ts) > max(doc.updated)` 가 **실재하는** vault.
 *
 * 세 번째 커밋이 핵심이다 — 피드 커밋 **뒤에** 문서를 다시 손대되 author-date 는 tick(2006)이므로
 * `getFileCommitDates` 의 `updated`(= git log 최신 항목의 ts)가 2006 으로 되돌아온다. 그 커밋이
 * 없으면 문서 updated 가 피드 ts 와 같아져 비대칭이 사라지고 GA2 가 공허해진다(실측으로 확인했다).
 */
function seedAsymmetricVault() {
  const vault = initVault()
  tmps.push(vault)
  writeDoc(vault, REL_GAMMA, { body: '## 정의\n\n초판 본문이다.\n', id: ID_GAMMA, title: '감마' })
  commit(vault, 'chore: 감마 생성')

  writeDoc(vault, REL_GAMMA, { body: '## 정의\n\n갱신 본문이다.\n', id: ID_GAMMA, title: '감마' })
  const feedSha = feedCommit(vault, { date: FEED_TS, subject: FEED_TITLE })

  writeDoc(vault, REL_GAMMA, { body: '## 정의\n\n후속 갱신 본문이다.\n', id: ID_GAMMA, title: '감마' }) // prettier-ignore
  commit(vault, 'chore: 감마 후속 갱신')

  return { feedId: feedSha.slice(0, 12), vault }
}

const parseDeep = (vault) => parseVault(vault, 'dev', SCHEMA_DIR, { deepDocGate: true }).wire
const maxOf = (values) => values.toSorted().at(-1)

describe('deriveGeneratedAt 시그니처 — items 는 인자에서 사라진다 (GA1 · 🔴RED 오늘 2인자)', () => {
  it('GA1: arity 1 · `parse-vault.mjs` 안의 모든 `deriveGeneratedAt(...)` 이 인자 1개다', () => {
    const source = readFileSync(PARSE_VAULT_SOURCE, 'utf8')
    const occurrences = [...source.matchAll(/deriveGeneratedAt\(([^)]*)\)/gu)].map((m) => m[1])

    // 앵커: 선언 + 호출 최소 2곳을 **실제로 찾았다**(정규식이 죽어서 0건이면 부재 단언이 공허하다).
    expect(occurrences.length).toBeGreaterThanOrEqual(2)
    expect(occurrences.map((args) => args.split(',').length)).toEqual(occurrences.map(() => 1))
    expect(deriveGeneratedAt).toHaveLength(1)
  })
})

describe('generatedAt 원천 — 문서 updated 만 (GA2 · 🔴RED flip: 오늘 item ts 가 이긴다)', () => {
  it('GA2: `wire.generatedAt` === max(doc.updated) 이고 max(item.ts) 와 **다르다**', () => {
    const { vault } = seedAsymmetricVault()

    const wire = parseDeep(vault)
    const maxDocUpdated = maxOf(wire.docs.map((doc) => new Date(doc.updated).toISOString()))
    const maxItemTs = maxOf(wire.items.map((item) => new Date(item.ts).toISOString()))

    // 앵커 ①: 비대칭이 **실재한다** — items 가 비어 있지 않고 그 최대 ts 가 문서 updated 보다 크다.
    expect(wire.items.length).toBeGreaterThan(0)
    expect(maxItemTs > maxDocUpdated).toBe(true)

    // 앵커 ②: 문서 updated 가 실제로 그 값이다(둘 다 undefined 여서 같은 것을 배제).
    expect(maxDocUpdated).toMatch(/^\d{4}-/u)

    expect(wire.generatedAt).toBe(maxDocUpdated)
    expect(wire.generatedAt).not.toBe(maxItemTs)
  })
})

describe('결정성 seam — SOURCE_DATE_EPOCH 가 이긴다 (GA3 · 🟢pin)', () => {
  it('GA3: `SOURCE_DATE_EPOCH` 가 있으면 그 값이 반환된다(벽시계 미사용)', () => {
    // 규범 E 의 근거이기도 하다 — 이 seam 이 있어 재빌드가 흔들리지 않는다.
    const before = process.env.SOURCE_DATE_EPOCH
    try {
      process.env.SOURCE_DATE_EPOCH = '1000000000'

      // 인자 1개로 부른다(post-GREEN 형태). epoch 분기는 items 를 만지기 **전에** 반환하므로
      //   오늘의 2인자 시그니처에서도 성립한다 — 그래서 이 행만 진짜 pin 이다.
      expect(deriveGeneratedAt([{ updated: '2026-01-01T00:00:00Z' }])).toBe(
        '2001-09-09T01:46:40.000Z',
      )
    } finally {
      if (before === undefined) delete process.env.SOURCE_DATE_EPOCH
      else process.env.SOURCE_DATE_EPOCH = before
    }
  })
})

describe('빈 집합 경계값 (GA4 · 🔴RED 시그니처 미축소)', () => {
  it('GA4: `deriveGeneratedAt([])` === epoch 0', () => {
    const before = process.env.SOURCE_DATE_EPOCH
    try {
      // epoch 오버라이드가 남아 있으면 이 경계값이 그 값으로 가려진다 — 명시적으로 걷어낸다.
      delete process.env.SOURCE_DATE_EPOCH

      expect(deriveGeneratedAt([])).toBe(EPOCH_ZERO)
    } finally {
      if (before !== undefined) process.env.SOURCE_DATE_EPOCH = before
    }
  })
})

describe('억제 독립 + 누출 폐쇄 (GA5 · 🔴RED 억제된 항목의 ts 가 값에 남는다)', () => {
  it('GA5: 억제해도 값이 같고, 그 값은 **억제된 항목의 ts 가 아니다**', () => {
    const { feedId, vault } = seedAsymmetricVault()
    const ignorePath = path.join(vault, IGNORE_FILE)
    const suppressedTs = new Date(FEED_TS).toISOString()

    const withoutIgnore = parseDeep(vault).generatedAt

    writeFileSync(ignorePath, JSON.stringify([{ id: feedId, when: IGNORE_WHEN }]), 'utf8')
    const withIgnore = parseDeep(vault)

    // 앵커 ①: 억제가 **실제로 걸린다** — 같은 vault 의 억제 후 페이지에서 그 피드가 사라진다.
    //   (`pageFeeds` 는 여기서 부르지 않는다 — 억제 목록이 로드됐는지만 wire 로 확인한다.)
    expect(withIgnore.ignore.map((entry) => entry.id)).toContain(feedId)
    // 앵커 ②: 억제 대상 항목이 **여전히 아티팩트 재료**에 있다(억제 전 전량 — D-C).
    expect(withIgnore.items.map((item) => item.id)).toContain(feedId)

    // (a) 억제 독립 — R1 채택안이 뒤집히지 않는다.
    expect(withIgnore.generatedAt).toBe(withoutIgnore)
    // (b) 누출 폐쇄 — 억제된 항목의 ts 가 값이 되어서는 안 된다(D-B · CWE-204 클래스).
    expect(withIgnore.generatedAt).not.toBe(suppressedTs)

    rmSync(ignorePath, { force: true })
  })
})
