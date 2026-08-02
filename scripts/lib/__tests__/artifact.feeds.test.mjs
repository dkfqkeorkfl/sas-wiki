// @vitest-environment node
//
// P5 · Task 2·5 — 두 번째 발행 아티팩트의 **순수부** (D-C·D-D) — tdd §3.2 (FA1~FA4)
//
// 무엇이 생기는가: `cache/feeds.<env>.json`(내부 아티팩트)과 그 봉투 조립기·스키마, 그리고 리포트가
//   `readArtifact` 를 탈 수 있게 하는 발행 표지 3종이다. 이 파일은 **파일시스템도 git 도 보지 않는다**
//   — 경로 파생 함수와 봉투 조립 함수와 스키마 파일, 셋 다 순수하게 관측 가능하다(tdd §7.5).
//   실제 발행(3종 · 순서 · 3중 신선도)은 `summary.artifact-set.test.mjs`(FA5~FA12)가 문다.
//
// RED 사유(전부 **미구현**):
//   · FA1 — `artifact.mjs` 에 `feedsArtifactPath` 가 없다(오늘 `artifactPath` 하나뿐 · §2.5).
//   · FA2 — `payloads.mjs` 에 `FEEDS_ARTIFACT_PRODUCER`·`REPORT_PRODUCER` 가 없다.
//   · FA3 — `buildFeedsArtifact` 가 없다.
//   · FA4 — `scripts/schema/feeds-artifact.schema.json` 파일 자체가 없다.
//
// ★ 왜 named import 가 아니라 namespace import 인가(tdd §7.3): 없는 export 를 named 로 물면 ESM 링크가
//   **파일을 통째로 죽여** collection error 가 되고, `rtk` 는 그것을 PASS 로 오보고한다. 그래서 모듈
//   전체를 받아 케이스별로 "그 export 가 아직 없다" 를 **명시 실패**로 만든다.
//
// 규범 A: 기대 producer 문자열·키 집합·env 값·경로 조각은 **리터럴**이다. 프로덕션 상수를 import 해
//   기대값을 만들면 "상수가 자기 자신과 같다" 는 공허한 단언이 된다. 정확 경로 형태의 고정은
//   **PL9** 한 곳이 맡는다 — FA1 은 **성질**만 문다(둘이 같은 것을 두 번 물지 않는다 · P4 AR1↔㉖ 선례).
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { loadSchema, validateItem } from '../schema-validator.mjs'

const artifactModule = await import(new URL('../artifact.mjs', import.meta.url).href)
const payloadsModule = await import(new URL('../payloads.mjs', import.meta.url).href)

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SCHEMA_DIR = path.resolve(HERE, '..', '..', 'schema')
const FEEDS_ARTIFACT_SCHEMA = path.join(SCHEMA_DIR, 'feeds-artifact.schema.json')

/** 발행 표지 3종 — **리터럴**이다. 셋이 서로 달라야 파일이 서로를 자기 것으로 읽지 않는다. */
const SUMMARY_PRODUCER = 'sas-wiki/summary'
const FEEDS_PRODUCER = 'sas-wiki/feeds'
const REPORT_PRODUCER = 'sas-wiki/report'

/**
 * feeds 아티팩트 봉투 — **정확 5키**. `items` 가 빠지면 봉투가 아니라 스탬프다.
 *
 * 🔴 v3 P1(§4.3 ③ · KY2 · D28): 발행자 표지·상관 토큰이 사라진다. ★ `env` 는 **아티팩트에 남는다** —
 *   D22 상 그것이 잔여 판별층 중 **유일하게 실질 판별력을 갖는 축**이다.
 */
const FEEDS_ARTIFACT_KEYS = ['env', 'generatedAt', 'items', 'schemaVersion', 'sourceCommit']

/** 계약 버전 — 리터럴 **1**(v3 P1 · D29 · §4.3 ②). 리터럴 복제는 복제로 유지한다(규범 A). */
const SCHEMA_VERSION = 1

/** 스키마에 먹일 유효 feed item(정확 7키 · feeds.schema.json feedItem 과 같은 모양) — 리터럴이다. */
const SAMPLE_ITEM = {
  body: '본문 문단이다.',
  docs: [{ id: '0192a000-0000-7000-8000-0000000000aa' }],
  id: '0123456789ab',
  importance: 'normal',
  keywords: ['반도체'],
  title: '샘플 소식',
  ts: '2026-05-01T00:00:00Z',
}

const SAMPLE_ENVELOPE = {
  env: 'dev',
  generatedAt: '2026-05-01T00:00:00.000Z',
  inputsFingerprint: '0123456789abcdef',
  items: [SAMPLE_ITEM],
  producer: FEEDS_PRODUCER,
  schemaVersion: SCHEMA_VERSION,
  sourceCommit: '0'.repeat(40),
}

function feedsArtifactPath(vaultDir, env) {
  if (typeof artifactModule.feedsArtifactPath !== 'function') {
    throw new Error('[RED] scripts/lib/artifact.mjs 에 feedsArtifactPath export 가 아직 없다')
  }
  return artifactModule.feedsArtifactPath(vaultDir, env)
}

function buildFeedsArtifact(input) {
  if (typeof payloadsModule.buildFeedsArtifact !== 'function') {
    throw new Error('[RED] scripts/lib/payloads.mjs 에 buildFeedsArtifact export 가 아직 없다')
  }
  return payloadsModule.buildFeedsArtifact(input)
}

function feedsArtifactSchema() {
  if (!existsSync(FEEDS_ARTIFACT_SCHEMA)) {
    throw new Error(`[RED] scripts/schema/feeds-artifact.schema.json 이 아직 없다`)
  }
  return loadSchema(FEEDS_ARTIFACT_SCHEMA)
}

const posix = (value) => value.split(path.sep).join('/')

describe('feeds 아티팩트 경로 — summary 와 다른 슬롯 (FA1 · 🔴RED 함수 부재)', () => {
  it('FA1: env 별로 갈리고 `cache/` 하위이며 **summary 아티팩트와 다른 파일**이다', () => {
    const dev = feedsArtifactPath('/v', 'dev')
    const prod = feedsArtifactPath('/v', 'prod')

    expect(dev).not.toBe(prod)
    expect(posix(dev)).toContain('/cache/')
    expect(posix(prod)).toContain('/cache/')
    expect(path.basename(dev)).toContain('dev')
    expect(path.basename(prod)).toContain('prod')

    // ★ 이 절이 핵심이다 — 같은 파일에 쓰면 두 산출물이 서로를 덮어쓴다(그러면 3중 신선도가 무의미).
    expect(dev).not.toBe(artifactModule.artifactPath('/v', 'dev'))
    expect(prod).not.toBe(artifactModule.artifactPath('/v', 'prod'))
  })
})

describe('발행 표지 3종 — 셋이 서로 다르다 (FA2 · 🔴RED 상수 부재)', () => {
  it('FA2: summary·feeds·report 의 `producer` 가 각자 리터럴이고 서로 다르다', () => {
    // 앵커: 셋이 **전부 정의돼 있다**. 하나만 만들고 나머지를 `undefined` 로 두면 `!==` 가 우연히
    //   통과한다(P4 RD4 교훈 — "다르다" 는 "둘 다 있다" 를 전제해야 의미가 있다).
    expect(typeof payloadsModule.ARTIFACT_PRODUCER).toBe('string')
    expect(typeof payloadsModule.FEEDS_ARTIFACT_PRODUCER).toBe('string')
    expect(typeof payloadsModule.REPORT_PRODUCER).toBe('string')

    expect(payloadsModule.ARTIFACT_PRODUCER).toBe(SUMMARY_PRODUCER)
    expect(payloadsModule.FEEDS_ARTIFACT_PRODUCER).toBe(FEEDS_PRODUCER)
    expect(payloadsModule.REPORT_PRODUCER).toBe(REPORT_PRODUCER)

    expect(
      new Set([
        payloadsModule.ARTIFACT_PRODUCER,
        payloadsModule.FEEDS_ARTIFACT_PRODUCER,
        payloadsModule.REPORT_PRODUCER,
      ]).size,
    ).toBe(3)
  })
})

describe('feeds 아티팩트 봉투 — 정확 5키 (FA3 · 🔴RED(flip) v3 P1 · 7 → 5)', () => {
  it('FA3: top-level 키가 **정확히 5키**이고 `items` 를 그대로 싣는다', () => {
    // **정확 일치**다(하한이 아니다) — 필드를 흘리는 구현을 배제한다. `items` 는 `toEqual` 로 물어
    //   "봉투를 씌우면서 항목을 깎지 않았다" 를 함께 고정한다(파일을 자르면 필터가 조용히 틀어진다).
    const built = buildFeedsArtifact({
      env: 'dev',
      generatedAt: '2026-05-01T00:00:00.000Z',
      inputsFingerprint: '0123456789abcdef',
      items: [SAMPLE_ITEM],
      sourceCommit: '0'.repeat(40),
    })

    expect(Object.keys(built).toSorted()).toEqual(FEEDS_ARTIFACT_KEYS)
    expect(built.items).toEqual([SAMPLE_ITEM])
    expect(built.producer).toBe(FEEDS_PRODUCER)
    expect(built.schemaVersion).toBe(SCHEMA_VERSION)
    expect(built.env).toBe('dev')
  })

  it('FA3b: `buildFeeds`(wire)와 `buildFeedsArtifact`(내부)는 **다른 함수**다', () => {
    // plan Task 2 GOTCHA. 합치면 **억제 전 항목이 wire 로 샌다**(FA11·CS8·HV5 의 전제).
    expect(typeof payloadsModule.buildFeeds).toBe('function')
    expect(typeof payloadsModule.buildFeedsArtifact).toBe('function')
    expect(payloadsModule.buildFeeds).not.toBe(payloadsModule.buildFeedsArtifact)
  })
})

describe('feeds 아티팩트 스키마 — 선언이 아니라 거동 (FA4 · 🔴RED 스키마 파일 부재)', () => {
  it('FA4: 정상 봉투는 통과하고, 위조 producer·미지 env·잉여 키는 **실제로 거부된다**', () => {
    const schema = feedsArtifactSchema()

    // 앵커: 정상 봉투는 오류 0건이다(전부 거부하는 스키마로 통과하는 것을 배제).
    expect(validateItem(SAMPLE_ENVELOPE, schema, 'cache/feeds.<env>.json')).toEqual([])

    const forgedProducer = { ...SAMPLE_ENVELOPE, producer: SUMMARY_PRODUCER }
    const unknownEnv = { ...SAMPLE_ENVELOPE, env: 'staging' }
    const extraKey = { ...SAMPLE_ENVELOPE, leaked: 'x' }
    const missingItems = { ...SAMPLE_ENVELOPE }
    delete missingItems.items

    expect(validateItem(forgedProducer, schema, 'forged').length).toBeGreaterThan(0)
    expect(validateItem(unknownEnv, schema, 'unknown-env').length).toBeGreaterThan(0)
    expect(validateItem(extraKey, schema, 'extra-key').length).toBeGreaterThan(0)
    expect(validateItem(missingItems, schema, 'missing-items').length).toBeGreaterThan(0)
  })
})
