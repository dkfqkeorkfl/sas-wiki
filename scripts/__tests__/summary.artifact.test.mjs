// @vitest-environment node
//
// P4 · Task 1·3 — 발행 아티팩트의 종단 계약 (D-C·D-D·D-G) — tdd §3.1(FP7) · §3.3(AR3·AR4·AR6·AR8)
//
// RED 사유:
//   · AR3 — **RED(오늘 env 무관 단일 슬롯)**. `summary.mjs:46` 이 dev·prod 를 `cache/summary.json`
//     한 슬롯에 쓴다(plan B6) → 교대 실행이 서로를 무효화한다.
//   · AR4 — **RED(필드 부재)**. 봉투에 `env` 가 없다. OQ-P4-4 = **A** 확정:
//     아티팩트 = stdout payload = HTTP 응답, 셋이 **같은 7키**다.
//   · AR6 — **RED(flip)**. 오늘 `schemaVersion` 은 1 이다(`payloads.mjs:12`). §4 원장 ⑥~⑩ 이 뒤집히는
//     리터럴 6지점을 1:1 로 지목한다 — 그 지점들과 **같은 커밋**에서 움직인다.
//   · AR8 — **RED(스키마 미갱신)**. `summary.schema.json` 은 `additionalProperties:false` 이고
//     required 가 7키다 → 9키 산출물은 strict 스키마를 통과하지 못한다. 코드와 스키마가 **같은
//     커밋에서** 움직였는가를 무는 자리다(AR4 와 짝).
//
// 관측 층(tdd §7.5): 여기서는 **생성기 반환 객체**와 **발행된 파일**만 본다. exit code·stdout 은
//   `summary.cli-exit.test.mjs`(XC·PC)와 `cli.env-enum.test.mjs`(EV)가 별도로 문다.
//
// ★ `artifactPath` 는 **좌표를 얻는 seam** 으로만 쓴다(기대값이 아니다). 정확한 파일명은 GREEN 재량이고
//   (AR1 이 성질만 문다), 여기서 파일명을 리터럴로 박으면 D-D (c)(경로는 단일 선언에서 파생)를 테스트가
//   먼저 어기는 꼴이 된다. 대신 **파일 내용**(env 표지·키 집합·버전·스키마)이 전부 리터럴 단언이다.
//
// ★ 규범 F: 실 vault 를 건드리지 않는다. 억제 엔트리는 tmp git vault 에서만 만든다.
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterAll, describe, expect, it } from 'vitest'

import { loadSchema, validateItem } from '../lib/schema-validator.mjs'
import { cleanup } from './helpers/tmp-git-vault.mjs'
import { seedCleanVault } from './helpers/polluted-vault.mjs'

// P5 · OQ-P5-1=A — runSummaryGenerator 가 CLI 파일(summary.mjs)에서 lib/generator.mjs 로 이동했다.
//   경로만 바뀐다(§4 원장 ⑬) — 단언·시그니처는 무변경이다.
const loadedSummary = await import(new URL('../lib/generator.mjs', import.meta.url).href)
const loadedArtifact = await import(new URL('../lib/artifact.mjs', import.meta.url).href).catch(
  (error) => ({ __loadError: error instanceof Error ? error.message : String(error) }),
)

async function generate(options) {
  if (typeof loadedSummary.runSummaryGenerator !== 'function') {
    throw new Error('[RED] scripts/lib/generator.mjs 에 runSummaryGenerator export 가 없다')
  }
  // ★ `await` 는 **선제적**이다 — D-A 가 `runSummaryGenerator` 를 async 로 만든다(OQ-P4-3 승인).
  //   동기 반환값에 붙는 `await` 는 무해하므로 이 파일은 전후 양쪽에서 같은 의미를 갖는다.
  const env = options.env ?? 'prod'
  const artifactPath = options.artifactPath ?? artifactPathOf(options.vault, env)
  return await loadedSummary.runSummaryGenerator({ ...options, artifactPath, env })
}

/** 발행 파일의 **좌표**만 얻는다 — 기대값이 아니다(위 헤더 주석 참조). */
function artifactPathOf(vaultDir, env) {
  if (loadedArtifact.__loadError !== undefined) {
    throw new Error(
      `[RED] scripts/lib/artifact.mjs 가 아직 없다 (P4 Task 3 미구현): ${loadedArtifact.__loadError}`,
    )
  }
  if (typeof loadedArtifact.artifactPath !== 'function') {
    throw new Error('[RED] artifact.mjs 에 artifactPath export 가 아직 없다')
  }
  return loadedArtifact.artifactPath(vaultDir, env)
}

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SCHEMA_DIR = path.resolve(HERE, '..', 'schema')

/**
 * 아티팩트 봉투 **7키** — 리터럴이고 **정확 일치**로 문다(하한이 아니다).
 *
 * 🔴 v3 P1(§4.3 ③ · plan Task 3·4): 발행자 표지와 상관 토큰은 **아무도 읽지 않는 값**이라 사라진다
 *   (D28). 정확 일치여야 "필드를 흘리는" 구현이 배제된다.
 */
const ARTIFACT_KEYS = [
  'docs',
  'env',
  'generatedAt',
  'schemaVersion',
  'sourceCommit',
  'tags',
  'tree',
]

/** 계약 버전 — **리터럴 1**(v3 P1 · D29 · §4.3 ②). 발행물 3종 + wire 3 페이로드 공용. */
const SCHEMA_VERSION = 1

const tmps = []
afterAll(() => cleanup(...tmps))

function freshClean() {
  const { vault } = seedCleanVault()
  tmps.push(vault)
  return vault
}

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'))

describe('발행 아티팩트 — env 격리 (AR3 · 🔴RED 단일 슬롯)', () => {
  it('AR3: dev·prod 가 **서로 다른 파일**에 공존하고 각자 자기 `env` 를 선언한다', async () => {
    // ★ D-G ②③ 의 심장. 앵커는 **prod 발행 후에도 dev 파일 내용이 스냅샷과 동일**하다는 것이다 —
    //   그게 없으면 "둘 다 없어서" 나 "덮어써서" 통과하는 구현을 배제하지 못한다.
    const vault = freshClean()

    await generate({ env: 'dev', vault })
    const devPath = artifactPathOf(vault, 'dev')
    const devSnapshot = readFileSync(devPath, 'utf8')

    await generate({ env: 'prod', vault })
    const prodPath = artifactPathOf(vault, 'prod')

    expect(existsSync(devPath)).toBe(true)
    expect(existsSync(prodPath)).toBe(true)
    expect(readFileSync(devPath, 'utf8')).toBe(devSnapshot) // 앵커: prod 발행이 dev 를 안 건드렸다
    expect(readJson(devPath).env).toBe('dev')
    expect(readJson(prodPath).env).toBe('prod')
  })
})

describe('발행 아티팩트 — 봉투·버전·스키마 (AR4·AR6·AR8 · 🔴RED)', () => {
  it('AR4: 발행 파일의 top-level 키가 **정확히 7키**다 (필드를 흘리는 구현 배제)', async () => {
    // OQ-P4-4 = A: 아티팩트 = stdout payload = HTTP 응답, 셋이 같은 형태다. 형태를 쪼개면
    //   `summary.schema.json` 도 두 벌이 되고, 그것이 이 PRD 가 금지한 「호환 분기」다.
    const vault = freshClean()

    await generate({ env: 'dev', vault })

    const keys = Object.keys(readJson(artifactPathOf(vault, 'dev'))).toSorted()
    // 규범 N — 개수는 빠른 진단, **집합이 계약**이다(§4.3 ①).
    expect(keys).toHaveLength(7)
    expect(keys).toEqual(ARTIFACT_KEYS)
  })

  it('AR6: 발행 파일의 `schemaVersion` 이 정수 **1** 다 (v3 P1 · D29 리셋)', async () => {
    // 헤더 3키가 늘었으므로 옛 파일은 "미지 버전" 이 아니라 **구 버전**이고, 독자가 stale 로
    //   떨어뜨려 재생성한다(마이그레이션 없음 — 파생 데이터다). 단위 대응물은 RD5 다.
    const vault = freshClean()

    await generate({ env: 'dev', vault })
    const published = readJson(artifactPathOf(vault, 'dev'))

    expect(published.schemaVersion).toBe(SCHEMA_VERSION)
    expect(Number.isInteger(published.schemaVersion)).toBe(true)
  })

  it('AR8: 발행 파일이 strict `summary.schema.json` 을 통과한다 (코드·스키마 동시 이동)', async () => {
    // ★ AR4 와 짝이다(키 집합 ↔ 스키마). `additionalProperties:false` 이므로 코드만 9키로 옮기고
    //   스키마를 안 고치면 **산출물 전체가 자기 스키마를 어긴다** — 그 상태로 릴리스되면 검증
    //   게이트가 있는데도 통과하는 산출물이 하나도 없다.
    const vault = freshClean()

    await generate({ env: 'dev', vault })
    const errors = validateItem(
      readJson(artifactPathOf(vault, 'dev')),
      loadSchema(path.join(SCHEMA_DIR, 'summary.schema.json')),
      'cache/summary.<env>.json',
    )

    expect(errors).toEqual([])
  })
})
