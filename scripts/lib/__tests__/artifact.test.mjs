// @vitest-environment node
//
// P4 · Task 3 — 발행 아티팩트 계약: 경로·스탬프 (D-D) — tdd §3.3 (AR1·AR2·AR5·AR7)
//
// RED 사유:
//   · AR1·AR5 — **RED(모듈 부재)**. `scripts/lib/artifact.mjs` 가 없다(`artifactPath`·`ARTIFACT_PRODUCER`).
//   · AR2 — **RED(오늘 리터럴이 소비자 쪽에 있다)**. `summary.mjs:46` 이 `path.join(vaultDir, 'cache',
//     'summary.json')` 으로 경로를 **직접 조립**한다 → 경로 리터럴의 거처가 생성기다.
//   · AR7 — **pair(지금도 green)**. 3 페이로드 공용 `SCHEMA_VERSION` 을 쪼개지 못하게 하는 못이다.
//
// 왜 `cache/` 의 파일이 "캐시" 가 아니라 **발행 아티팩트**인가(R3): 이번 phase 가 처음으로 **CLI 를
//   우회해 파일을 직접 읽는 소비자**를 만든다. Track B 가 "캐시는 생산자 사적 자산" 을 근거로 반대했고,
//   사용자 결정(파일 그대로 서빙)을 유지하는 **대가로 계약 4요소를 값으로 치른다**:
//     (a) `producer` 스탬프  (b) `schemaVersion` + 미지 버전 거동  (c) **경로는 단일 선언에서 파생**
//     (d) 독자 전면 불신(→ `artifact.read.test.mjs`)
//   이 파일은 (a)(c)를, `artifact.read.test.mjs` 가 (b)(d)를 문다.
//
// 규범 A: 기대값(`'sas-wiki/summary'`)은 **리터럴**이다. 프로덕션 상수에서 유도하면 값이 흔들려도
//   아무도 모른다 — 그 값이 흔들리면 소비자·픽스처가 **조용히** 어긋난다.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { buildBody, buildFeeds, buildSummary } from '../payloads.mjs'

// 신설 모듈 부재가 파일 전체를 죽이는 collection error 가 되지 않게 지연 import 로 붙든다(tdd §7.3).
const loaded = await import(new URL('../artifact.mjs', import.meta.url).href).catch((error) => ({
  __loadError: error instanceof Error ? error.message : String(error),
}))

function artifact() {
  if (loaded.__loadError !== undefined) {
    throw new Error(
      `[RED] scripts/lib/artifact.mjs 가 아직 없다 (P4 Task 3 미구현): ${loaded.__loadError}`,
    )
  }
  return loaded
}

const HERE = path.dirname(fileURLToPath(import.meta.url))
/** 트립와이어(AR2) 전용 — 소스를 **읽기만** 한다. */
const SUMMARY_SOURCE = path.resolve(HERE, '..', '..', 'summary.mjs')
const ARTIFACT_SOURCE = path.resolve(HERE, '..', 'artifact.mjs')

/** 아티팩트 발행자 — **리터럴**이다(D-D (a)). */
const PRODUCER = 'sas-wiki/summary'
/** 아티팩트가 사는 디렉토리명 — **리터럴**. AR2 트립와이어의 관측 대상이다. */
const CACHE_DIR = 'cache'
/** env 무관 단일 슬롯 시절의 파일명 — 이 리터럴이 `summary.mjs` 에 남아 있으면 D-D (c) 위반이다. */
const LEGACY_FILENAME = 'summary.json'

/** 경로 계산에만 쓰는 가상 vault 루트(리터럴). 파일시스템을 건드리지 않는다 — 순수 함수다. */
const VAULT = path.resolve('/tmp', 'wiki-ar-vault')

describe('artifactPath — env 별 경로 파생 (AR1 · 🔴RED 모듈 부재)', () => {
  it('AR1: dev·prod 가 서로 다른 파일이고 둘 다 vault 의 `cache/` 하위다', () => {
    // ★ **정확 경로 문자열은 단언하지 않는다** — 파일명은 GREEN 의 재량이다(tdd §3.3). 여기서 무는
    //   것은 D-G ② 가 요구하는 **성질**이다: 다르다 · 소속이 같다 · 파일명이 env 를 담는다.
    const dev = artifact().artifactPath(VAULT, 'dev')
    const prod = artifact().artifactPath(VAULT, 'prod')

    expect(dev).not.toBe(prod)
    expect(path.dirname(dev)).toBe(path.join(VAULT, CACHE_DIR))
    expect(path.dirname(prod)).toBe(path.join(VAULT, CACHE_DIR))
    expect(path.basename(dev)).toContain('dev')
    expect(path.basename(prod)).toContain('prod')
  })
})

describe('ARTIFACT_PRODUCER — 발행자 스탬프 (AR5 · 🔴RED 상수 부재)', () => {
  it('AR5: `ARTIFACT_PRODUCER` 가 리터럴 `sas-wiki/summary` 다', () => {
    // 이 값이 흔들리면 소비자의 `expect.producer` 와 커밋 픽스처가 **조용히** 어긋나 모든 읽기가
    //   producer-mismatch(stale)로 접히고, dev 가 영원히 재생성만 한다. RD10 이 픽스처 쪽 짝이다.
    expect(artifact().ARTIFACT_PRODUCER).toBe(PRODUCER)
  })
})

describe('경로 소유권 트립와이어 (AR2 · 🔴RED 리터럴이 생성기에 있다)', () => {
  it('AR2: `summary.mjs` 는 경로 리터럴을 재기입하지 않고 `artifact.mjs` 가 소유한다', () => {
    // ★ D-D (c). 경로 리터럴이 **두 곳**(생성기·소비자, 나아가 두 리포)에 생기면 파일명이 바뀔 때
    //   한쪽만 따라가고, 소비자는 옛 경로를 "부재" 로 읽어 매 요청 18초 재생성을 돈다.
    //   소비자 쪽 짝은 webfront `PS6`(`dev/wiki-backend/**` 에 경로 리터럴 0회)이다.
    const summarySource = readFileSync(SUMMARY_SOURCE, 'utf8')

    expect(countLiteral(summarySource, CACHE_DIR)).toBe(0)
    expect(countLiteral(summarySource, LEGACY_FILENAME)).toBe(0)

    // 앵커(규범 B): 소유자 쪽에는 디렉토리 리터럴이 **있다** — "아무 데도 없어서" 통과하는 것을 배제.
    //   파일명은 env 로 조립되므로(AR1) 리터럴 대조 대신 `artifactPath` 의 반환이 증거다.
    expect(countLiteral(readFileSync(ARTIFACT_SOURCE, 'utf8'), CACHE_DIR)).toBeGreaterThan(0)
  })
})

describe('SCHEMA_VERSION — 3 페이로드 공용 (AR7 · 🟢pair)', () => {
  it('AR7: `buildSummary`·`buildFeeds`·`buildBody` 의 schemaVersion 이 **서로 같다**', () => {
    // ★ 페이로드별 분리 금지 pin(P2 확정). 쪼개면 소비자 `sameGeneration`(`src/api/news.ts:118`)이
    //   영원히 false 가 되고 `WikiDataProvider` 부팅 게이트가 통째로 막힌다 — 화면이 죽는데 테스트는
    //   전부 green 인 상태가 만들어진다. 값 자체(1→2)는 AR6 이 문다.
    const summary = buildSummary({
      docs: [],
      generatedAt: '2026-07-27T00:00:00.000Z',
      inputsFingerprint: '0123456789abcdef',
      sourceCommit: '9a1b2c3d4e5f60718293a4b5c6d7e8f901234567',
      tags: {},
      tree: [],
    })
    const feeds = buildFeeds({
      generatedAt: '2026-07-27T00:00:00.000Z',
      items: [],
      sourceCommit: '9a1b2c3d4e5f60718293a4b5c6d7e8f901234567',
    })
    const body = buildBody({
      docs: [],
      sourceCommit: '9a1b2c3d4e5f60718293a4b5c6d7e8f901234567',
    })

    expect(Number.isInteger(summary.schemaVersion)).toBe(true)
    expect([feeds.schemaVersion, body.schemaVersion]).toEqual([
      summary.schemaVersion,
      summary.schemaVersion,
    ])
  })
})

/** 소스 텍스트의 **문자열 리터럴** 등장 횟수(작은따옴표·큰따옴표). 산문 주석은 세지 않는다. */
function countLiteral(source, value) {
  let count = 0
  for (const quote of ["'", '"']) {
    const needle = `${quote}${value}${quote}`
    let index = source.indexOf(needle)
    while (index !== -1) {
      count += 1
      index = source.indexOf(needle, index + needle.length)
    }
  }
  return count
}
