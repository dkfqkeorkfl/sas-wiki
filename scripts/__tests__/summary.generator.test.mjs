// @vitest-environment node
//
// P3 · Task 5 — `summary` 를 생성기로 (`runSummaryGenerator`) — tdd §3.6 (GN1~GN9 · RP1~RP5 · FR1~FR7)
//
// RED 사유(전 케이스 공통 · **미구현**): `scripts/summary.mjs` 에 `runSummaryGenerator` export 가
//   **없다**. 파일 자체는 존재하므로 collection error 는 나지 않지만, 케이스별 명시 실패로 바꿔
//   "어느 축이 미구현인가" 가 실패 메시지에 드러나게 한다(tdd §2.4).
//
// 이 파일이 확정하는 seam (tdd §3.0 · **P4 갱신분 반영**):
//   await runSummaryGenerator({ artifactPath, env, force, maxExcluded, reportDir, runGit, vault,
//                               writeSideEffects = true })
//     → { artifactPath, excluded, excludedCount, inputsFingerprint, payload, regenerated,
//         report: { error, jsonPath, txtPath }, sourceCommit, status }
//        status: 'clean' | 'partial'
//        runGit 기본값 = makeGitRunner(vault) — **테스트가 주입해 호출을 계수한다**(FR7)
//   순수 export `summary(vault, env)` 는 **시그니처·동기성 그대로 `lib/summary-endpoint.mjs` 로
//   이동**했다(OQ-P4-1 = A · §4 원장 ⑮) — cli-contract C5 · summary.test.mjs E-S1~3 · webfront
//   `dev-api.contract.test.ts` 는 **import 경로만** 바뀌고 단언은 무변경이다.
//
// P4 가 이 파일에 남긴 계약 변경 3건(**약화가 아니라 반전** — §4 원장에 1:1 지목이 있다):
//   · **D-A** — 생성기가 `async` 다(파싱 툴체인을 재생성 분기에서만 동적으로 연다) → 호출부에
//     `await`, `toThrow` 는 `rejects.toThrow`(⑫). 단언 **내용**은 한 글자도 안 바뀌었다.
//   · **D-D** — 봉투가 7키 → **9키**(`producer`·`env` 스탬프 · ⑤) · `schemaVersion` 1 → **2**.
//     옵션·반환 키가 `cachePath` → `artifactPath`(plan 「후속」 F-28) — 그 파일은 생산자의 사적
//     캐시가 아니라 소비자가 직접 읽는 **발행 아티팩트**이고 `--status` 는 이미 그 이름이었다.
//   · **D-G ②** — 아티팩트 경로가 `cache/summary.json` → `cache/summary.<env>.json`(㉖).
//
// 관측 층 분리(tdd §7.4): 여기서는 **반환 객체와 파일**만 본다. exit code·stdout·stderr 는
//   `summary.cli-exit.test.mjs`(XC·PC)가 별도로 문다 — 두 층을 한 케이스에 섞으면 실패 원인이
//   프로세스 경계인지 로직인지 구분되지 않는다(P2 CX12 가 "층이 달라 미발동" 한 교훈).
//
// OQ-P3-2 = A 확정: 기본 동작 = **캐시 원자 발행 + 리포트 + 기존 payload 유지**. `--stdout`(=
//   `writeSideEffects: false`) 은 **부작용 없는 조회**다. 생성기 상태는 `--status` 로 나간다.
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterAll, describe, expect, it } from 'vitest'

import { loadSchema, validateItem } from '../lib/schema-validator.mjs'
import { cleanup, git } from './helpers/tmp-git-vault.mjs'
import { CONTROL_PATH, ID_A, seedCleanVault, seedPollutedVault } from './helpers/polluted-vault.mjs'

// P5 · OQ-P5-1=A — runSummaryGenerator 가 CLI 파일(summary.mjs)에서 lib/generator.mjs 로 이동했다.
//   경로만 바뀐다(§4 원장 ⑬) — 단언·시그니처는 무변경이다.
const loaded = await import(new URL('../lib/generator.mjs', import.meta.url).href)

function generate(options) {
  if (typeof loaded.runSummaryGenerator !== 'function') {
    throw new Error(
      '[RED] scripts/lib/generator.mjs 에 runSummaryGenerator export 가 아직 없다 (P5 OQ-P5-1=A 미구현)',
    )
  }
  return loaded.runSummaryGenerator(options)
}

/**
 * **`toThrow` 케이스 전용 seam 가드.** `generate` 자신이 미구현 시 throw 하므로, `toThrow()` 만 쓰면
 * "seam 이 없어서 throw" 가 "전역 실패라서 throw" 로 위장돼 **RED 가 공허하게 green** 이 된다
 * (실측으로 잡았다 — GN8 이 그렇게 통과했다). 그래서 그런 케이스는 seam 존재를 **먼저** 단언한다.
 */
function expectSeamPresent() {
  expect(typeof loaded.runSummaryGenerator, 'runSummaryGenerator export').toBe('function')
}

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SCHEMA_DIR = path.resolve(HERE, '..', 'schema')

/**
 * 발행 아티팩트 봉투 **9키** — 7키(P3) + `producer`·`env`(P4 가산). **리터럴**이며 정확 일치로 문다.
 *
 * P4 원장 §4.2 ⑤ (OQ-P4-4 = **A**): 아티팩트 = stdout payload = HTTP 응답, **셋이 같은 9키**다.
 * 파일만 9키로 두고 stdout 을 7키로 쪼개면 `summary.schema.json`(strict)도 두 벌이 필요해지고,
 * 그것이 이 PRD 가 금지한 「호환 분기」다. 소비 zod 는 tolerant 라 **클라이언트 변경은 0** 이다.
 */
const ENVELOPE_KEYS = [
  'docs',
  'env',
  'generatedAt',
  'inputsFingerprint',
  'producer',
  'schemaVersion',
  'sourceCommit',
  'tags',
  'tree',
]

const tmps = []
afterAll(() => cleanup(...tmps))

function freshClean() {
  const { vault } = seedCleanVault()
  tmps.push(vault)
  return vault
}

function freshPolluted() {
  const seeded = seedPollutedVault()
  tmps.push(seeded.vault)
  return seeded.vault
}

/**
 * 발행 아티팩트 경로 — **env 별로 갈린다**(P4 · D-G ② · §4 원장 신설행).
 *
 * `cache/summary.json`(env 무관 단일 슬롯)은 dev·prod 가 서로를 무효화하던 P3 까지의 형태다.
 * **리터럴 조립이다**(규범 A) — `artifact.mjs` 의 `artifactPath` 를 import 하면 "구현이 뭘 내든
 * 테스트가 따라가는" 자기참조가 된다. 드리프트 감지는 AR1·AR3 이 맡는다.
 */
const artifactFile = (vault, env = 'dev') => path.join(vault, 'cache', `summary.${env}.json`)
// P5 · F-29 — 리포트 경로도 env 로 갈린다(§4 원장 ⑳). 리터럴 조립은 유지한다(규범 A).
const reportJson = (vault, env = 'dev') => path.join(vault, 'logs', `summary.report.${env}.json`)
const reportTxt = (vault, env = 'dev') => path.join(vault, 'logs', `summary.report.${env}.txt`)
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'))

// ────────────────────────────────────────────────────────────────────────────
// GN — 생성기 본체
// ────────────────────────────────────────────────────────────────────────────

describe('runSummaryGenerator — 캐시 발행 (GN1~GN3 · 🔴RED 미구현)', () => {
  it('GN1: `<vault>/cache/summary.<env>.json` 이 만들어지고 summary.schema.json 을 통과한다', async () => {
    const vault = freshClean()
    expect(existsSync(artifactFile(vault))).toBe(false) // 앵커: 실행 **전에는** 없다

    await generate({ env: 'dev', vault })

    expect(existsSync(artifactFile(vault))).toBe(true)
    const errors = validateItem(
      readJson(artifactFile(vault)),
      loadSchema(path.join(SCHEMA_DIR, 'summary.schema.json')),
      'cache/summary.<env>.json',
    )
    expect(errors).toEqual([])
  })

  it('GN2: 아티팩트 봉투 키가 **정확히** 9키다 (필드를 흘리는 구현 배제)', async () => {
    const vault = freshClean()

    await generate({ env: 'dev', vault })

    expect(Object.keys(readJson(artifactFile(vault))).toSorted()).toEqual(ENVELOPE_KEYS)
  })

  it('GN3: 클린 vault → status "clean" · excludedCount 0 · regenerated true', async () => {
    // ★ **IG 의 짝 가드**다(tdd §3.2 · §10.3-4 ②). `summary.import-graph.test.mjs`(IG1·IG6)는
    //   "판정 경로가 렌더 툴체인을 정적으로 물지 않는다" 만 문으므로, **아예 재생성을 못 하는**
    //   구현도 거기서는 통과한다. 그 구멍을 이 케이스(재생성이 실제로 일어난다)와 FR1(2회차는
    //   안 일어난다)이 막는다 — "IG 와 무관" 이라며 지우면 IG1 이 장식이 된다.
    const vault = freshClean()

    const result = await generate({ env: 'dev', vault })

    expect(result.status).toBe('clean')
    expect(result.excludedCount).toBe(0)
    expect(result.regenerated).toBe(true)
    expect(result.inputsFingerprint).toMatch(/^[0-9a-f]{16}$/)
  })
})

describe('runSummaryGenerator — 부분 성공과 경로 (GN4·GN5 · 🔴RED 미구현)', () => {
  it('GN4: 오염 vault → status "partial" · excludedCount 2 · **캐시는 그래도 발행된다**', async () => {
    // ★ 부분 성공의 정의(D-D): 제외가 있어도 **나머지는 서빙 가능한 산출물**로 나간다. 앵커로 캐시
    //   안에 대조군이 실제로 들어 있음을 본다 — "빈 캐시를 쓰고 partial 이라 부르는" 구현을 배제.
    const vault = freshPolluted()

    const result = await generate({ env: 'dev', vault })

    expect(result.status).toBe('partial')
    expect(result.excludedCount).toBe(2)
    expect(existsSync(artifactFile(vault))).toBe(true)
    expect(readJson(artifactFile(vault)).docs.map((doc) => doc.id)).toContain(ID_A)
  })

  it('GN5: `artifactPath` 를 주면 그 경로에 쓰고 `<vault>/cache/` 는 만들지 않는다', async () => {
    // 옵션·반환 키가 P3 의 `cachePath` 에서 `artifactPath` 로 바뀌었다(plan 「후속」 F-28). 계약이
    //   바뀐 이유는 **D-D** 다 — 이 phase 가 그 파일을 생산자의 사적 캐시가 아니라 소비자가 직접 읽는
    //   **발행 아티팩트**로 재규정했고, `--status` 출력은 이미 `artifactPath` 였다. 한 파일이 두 이름을
    //   갖는 상태를 없앤 것이지 **단언을 완화한 것이 아니다**(대상·강도·개수 무변경).
    const vault = freshClean()
    const out = path.join(mkdtempSync(path.join(tmpdir(), 'wiki-gen-out-')), 'other.json')
    tmps.push(path.dirname(out))

    const result = await generate({ artifactPath: out, env: 'dev', vault })

    expect(existsSync(out)).toBe(true) // 앵커: 지정 경로에는 **실제로** 썼다
    expect(result.artifactPath).toBe(out)
    // 부재 단언의 대조군은 GN1 이다 — 기본 실행에서는 같은 픽스처에 `cache/` 가 생긴다.
    expect(existsSync(path.join(vault, 'cache'))).toBe(false)
  })
})

describe('runSummaryGenerator — hit 도 payload 를 낸다 (GN6 · 🔴RED 미구현)', () => {
  it('GN6: 연속 2회 실행의 payload 가 **직렬화 바이트까지 동일**하다', async () => {
    // ★ OQ-P3-2 = A 의 핵심. 캐시 hit 경로가 payload 를 못 내면 dev 미들웨어(`plugin.ts:132`)의
    //   `summaryEnvelope.parse` 가 throw 하고 위키 탭이 500 으로 죽는다. hit 은 **캐시 내용을 그대로**
    //   내보내야 한다(프로세스 경계 대응물은 PC3).
    const vault = freshClean()

    const first = await generate({ env: 'dev', vault })
    const second = await generate({ env: 'dev', vault })

    expect(first.regenerated).toBe(true) // 앵커: 1회차는 실제로 생성했다
    expect(second.regenerated).toBe(false)
    expect(JSON.stringify(second.payload)).toBe(JSON.stringify(first.payload))
  })
})

describe('runSummaryGenerator — 부작용 없는 조회 · 전역 실패 (GN7·GN8 · 🔴RED 미구현)', () => {
  it('GN7: `writeSideEffects:false` → payload 는 나오지만 `cache/`·`logs/` 둘 다 미생성', async () => {
    const vault = freshClean()

    const result = await generate({ env: 'dev', vault, writeSideEffects: false })

    expect(result.payload.docs.map((doc) => doc.id)).toContain(ID_A) // 앵커: 조회는 됐다
    expect(existsSync(path.join(vault, 'cache'))).toBe(false)
    expect(existsSync(path.join(vault, 'logs'))).toBe(false)

    // 대조군: 같은 픽스처의 **기본 실행**은 두 디렉토리를 만든다 → 위 부재가 "원래 안 만든다" 가 아니다.
    await generate({ env: 'dev', vault })
    expect(existsSync(path.join(vault, 'cache'))).toBe(true)
    expect(existsSync(path.join(vault, 'logs'))).toBe(true)
  })

  it('GN8: git 리포가 아니면 throw 하고 캐시 파일을 남기지 않는다 (전역 실패)', async () => {
    expectSeamPresent() // 미구현 throw 가 "전역 실패 throw" 로 위장하는 것을 막는다
    // 전역 실패에서는 **부분 산출물이 0** 이어야 한다 — 반쪽 캐시가 남으면 다음 요청이 그것을 서빙한다.
    const notARepo = mkdtempSync(path.join(tmpdir(), 'wiki-gen-nogit-'))
    tmps.push(notARepo)

    await expect(generate({ env: 'dev', vault: notARepo })).rejects.toThrow()
    expect(existsSync(artifactFile(notARepo))).toBe(false)
  })
})

describe('runSummaryGenerator — 미커밋 편집이 재생성을 유발한다 (GN9 · 🔴RED 미구현)', () => {
  it('GN9: 캐시가 있는 상태에서 문서를 미커밋 편집 → regenerated true · 지문이 바뀐다', async () => {
    // ★ FG3 의 통합 대응물 — 지문이 실제로 **재생성 결정에 쓰이는가**. 계산만 하고 안 쓰면 여기서 red.
    const vault = freshClean()
    const first = await generate({ env: 'dev', vault })
    const headBefore = git(vault, ['rev-parse', 'HEAD'])

    const docPath = path.join(vault, CONTROL_PATH)
    writeFileSync(docPath, `${readFileSync(docPath, 'utf8')}\n추가 문장이다.\n`)
    expect(git(vault, ['status', '--porcelain'])).not.toBe('') // 앵커 ①: 워킹트리가 더러워졌다
    expect(git(vault, ['rev-parse', 'HEAD'])).toBe(headBefore) // 앵커 ②: HEAD 는 그대로다

    const second = await generate({ env: 'dev', vault })

    expect(second.regenerated).toBe(true)
    expect(second.inputsFingerprint).not.toBe(first.inputsFingerprint)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// RP — 리포트 (D-F)
// ────────────────────────────────────────────────────────────────────────────

describe('리포트 발행 (RP1~RP3 · 🔴RED 미구현)', () => {
  it('RP1: `logs/` 가 없어도 json·txt **2파일**이 만들어진다', async () => {
    const vault = freshClean()
    expect(existsSync(path.join(vault, 'logs'))).toBe(false) // 앵커: 실행 전 부재

    const result = await generate({ env: 'dev', vault })

    expect(existsSync(reportJson(vault))).toBe(true)
    expect(existsSync(reportTxt(vault))).toBe(true)
    expect(result.report.jsonPath).toBe(reportJson(vault))
    expect(result.report.txtPath).toBe(reportTxt(vault))
  })

  it('RP2: 두 리포트가 **캐시와 같은 `inputsFingerprint`** 를 담는다 (세대 어긋남 방어)', async () => {
    // ★ D-F. 캐시 hit 실행은 리포트를 다시 쓰지 않는다 → 리포트는 **직전 세대**의 것이 남는다.
    //   지문을 심어두지 않으면 "이 리포트가 저 캐시의 것인가" 를 판별할 방법이 없다.
    const vault = freshClean()

    const result = await generate({ env: 'dev', vault })

    const cached = readJson(artifactFile(vault))
    expect(readJson(reportJson(vault)).inputsFingerprint).toBe(cached.inputsFingerprint)
    expect(readFileSync(reportTxt(vault), 'utf8')).toContain(cached.inputsFingerprint)
    expect(result.inputsFingerprint).toBe(cached.inputsFingerprint)
  })

  it('RP3: 오염 vault 리포트의 excluded 가 2건이고 각 항목이 4키다 · summary 카운터와 정합', async () => {
    const vault = freshPolluted()

    await generate({ env: 'dev', vault })

    const report = readJson(reportJson(vault))
    expect(report.excluded).toHaveLength(2)
    for (const entry of report.excluded) {
      expect(Object.keys(entry).toSorted()).toEqual(['id', 'message', 'path', 'reasonCode'])
      expect(entry.reasonCode).toBe('DUPLICATE_ID')
    }
    // 배열 길이와 카운터의 **정합**까지 본다 — 둘이 갈리면 리포트를 믿을 수 없다.
    expect(report.summary.excluded).toBe(2)
  })
})

describe('리포트 실패는 산출물 실패가 아니다 (RP4 · 🔴RED 미구현)', () => {
  it('RP4: `logs` 가 파일이면 report.error 가 채워지고 캐시·status 는 정상이다', async () => {
    // ★ D-F "관측 실패를 산출물 실패로 승격하지 않는다". 로그를 못 썼다고 **서빙 데이터를 안 만드는**
    //   것은 우선순위가 뒤집힌 것이다(tdd §6 CX20).
    const vault = freshClean()
    writeFileSync(path.join(vault, 'logs'), 'not a directory')

    const result = await generate({ env: 'dev', vault })

    expect(existsSync(artifactFile(vault))).toBe(true) // 앵커: 캐시는 **실제로** 만들어졌다
    expect(result.status).toBe('clean')
    // `toBeTruthy()` 로는 부족하다 — 구현이 원인과 무관하게 상수를 채워도 통과한다.
    //   **문자열**이어야 하고(형태), 실패한 자원을 지목해야 한다(무엇이 왜).
    expect(typeof result.report.error).toBe('string')
    expect(result.report.error).toContain('logs')
  })

  it('RP5: 생성된 report.json 이 `report.schema.json` 을 통과한다', async () => {
    const vault = freshPolluted()
    const schemaPath = path.join(SCHEMA_DIR, 'report.schema.json')

    await generate({ env: 'dev', vault })

    expect(existsSync(schemaPath)).toBe(true) // 앵커: 스키마가 실재한다(자기 스키마 드리프트 차단)
    expect(
      validateItem(readJson(reportJson(vault)), loadSchema(schemaPath), 'report.json'),
    ).toEqual([])
  })
})

// ────────────────────────────────────────────────────────────────────────────
// FR — 신선도 스킵 (D-I)
// ────────────────────────────────────────────────────────────────────────────

describe('신선도 스킵 (FR1~FR6 · 🔴RED 미구현)', () => {
  it('FR1: 1회차 regenerated true → 2회차 false', async () => {
    // ★ **IG 의 짝 가드**다(tdd §3.2 · §10.3-4 ②) — GN3 과 한 쌍이다. GN3 이 "재생성이 일어난다" 를,
    //   여기가 "두 번째는 안 일어난다" 를 문다. 둘이 없으면 `summary.import-graph.test.mjs` 의
    //   구조 단언만으로는 판정·재생성이 통째로 죽은 구현을 구분하지 못한다.
    const vault = freshClean()

    const first = await generate({ env: 'dev', vault })
    const second = await generate({ env: 'dev', vault })

    expect(first.regenerated).toBe(true) // 앵커(규범 B): 1회차가 실제로 생성했다
    expect(second.regenerated).toBe(false)
  })

  it('FR2: 스킵 실행이 캐시 파일 mtime 을 건드리지 않는다', async () => {
    // "regenerated 만 false 로 보고하고 실제로는 다시 쓴" 구현을 배제한다 — 그러면 매 요청 9.8초를
    //   여전히 지불하면서 로그만 hit 이라고 말한다.
    const vault = freshClean()
    await generate({ env: 'dev', vault })
    const before = statSync(artifactFile(vault)).mtimeMs

    await generate({ env: 'dev', vault })

    expect(statSync(artifactFile(vault)).mtimeMs).toBe(before)
  })

  it('FR3: 캐시 파일을 삭제하면 재생성한다', async () => {
    const vault = freshClean()
    await generate({ env: 'dev', vault })
    rmSync(artifactFile(vault))

    expect((await generate({ env: 'dev', vault })).regenerated).toBe(true)
  })

  it('FR4: 캐시가 **절단**돼 JSON 이 아니면 throw 없이 재생성한다', async () => {
    // R5 소비자 방어 규약 — fsync 를 생략한 대가를 여기서 갚는다. 파싱 실패는 stale 과 **동일 취급**이다.
    const vault = freshClean()
    await generate({ env: 'dev', vault })
    const truncated = readFileSync(artifactFile(vault), 'utf8').slice(0, 20)
    writeFileSync(artifactFile(vault), truncated)

    let result
    // §4 원장 ⑫ — `await` 만 붙는 **기계적** 변경이다. 단언 **내용은 무변경**이고, "throw 하지
    //   않는다" 를 async 계약에서 표현하면 "reject 하지 않는다" 다. async IIFE 로 감싸는 이유는
    //   `runSummaryGenerator` 가 동기든 비동기든 이 형태가 **양쪽에서 같은 의미**를 갖게 하기 위함이다
    //   (계약 반전은 GN8 하나뿐이고, 그 자리는 원장이 1:1 로 지목한다).
    await expect(
      (async () => {
        result = await generate({ env: 'dev', vault })
      })(),
    ).resolves.toBeUndefined()
    expect(result.regenerated).toBe(true)
  })

  it('FR5: 캐시 봉투의 지문만 다르면 재생성한다', async () => {
    // **리터럴** 지문 값을 쓴다 — 계산을 흉내 내면 그 순간 자기참조가 된다(tdd §2.3 지문 규범).
    const vault = freshClean()
    await generate({ env: 'dev', vault })
    const cached = readJson(artifactFile(vault))
    expect(cached.inputsFingerprint).not.toBe('0000000000000000') // 앵커: 원래 값은 이게 아니다
    writeFileSync(
      artifactFile(vault),
      JSON.stringify({ ...cached, inputsFingerprint: '0000000000000000' }),
    )

    expect((await generate({ env: 'dev', vault })).regenerated).toBe(true)
  })

  it('FR8: 리포트가 사라진 캐시는 신선하지 않다 — 제외 건수를 0 으로 위장하지 않는다', async () => {
    // ★ 리뷰에서 실측으로 잡힌 결함의 회귀 가드. 캐시만 보고 스킵하면 제외 건수를 **리포트에서** 읽어야
    //   하는데, 그 파일이 없으면 예전 구현은 `?? 0` 으로 메워 `status:'clean'` 을 돌려줬다 — 문서 2건이
    //   빠진 vault 가 "깨끗함" 이 되고 `--max-excluded 0` 게이트가 exit 3 → exit 0 으로 뒤집혔다.
    //   RP4("리포트 실패는 산출물 실패가 아니다")가 바로 이 상태를 정상적으로 만들어내므로 가정이 아니다.
    const vault = freshPolluted()
    const first = await generate({ env: 'dev', vault })

    // 앵커: 이 vault 는 **실제로** 제외 문서를 갖는다(0 == 0 으로 공허 통과하는 것을 배제).
    expect(first.excludedCount).toBeGreaterThan(0)

    rmSync(reportJson(vault))
    const second = await generate({ env: 'dev', vault })

    expect(second.regenerated).toBe(true)
    expect(second.excludedCount).toBe(first.excludedCount)
    expect(second.status).toBe(first.status)
  })

  it('FR6: 신선한 캐시라도 `force:true` 면 재생성한다', async () => {
    const vault = freshClean()
    await generate({ env: 'dev', vault })
    expect((await generate({ env: 'dev', vault })).regenerated).toBe(false) // 앵커: 원래는 스킵된다

    expect((await generate({ env: 'dev', force: true, vault })).regenerated).toBe(true)
  })
})

describe('신선도 스킵의 비용 (FR7 · 🔴RED 미구현)', () => {
  it('FR7: 스킵 경로가 부르는 git 은 **정확히 `rev-parse HEAD` 1건**이다', async () => {
    // ★ plan Task 5 「비용 역설」 GOTCHA 의 유일한 결정적 관측점이다. 지문 입력에 `sourceCommit` 이
    //   있으므로 스킵 판정도 git 을 한 번은 불러야 한다 — 그러나 거기서 `collectGitLog` 같은 전체
    //   히스토리 질의를 부르면 스킵의 의미가 사라진다.
    //   **개수 1 + 형태**를 함께 봐 "git 을 아예 안 부르는"(0건 → sourceCommit 을 캐시에서 베끼는)
    //   구현도 red 로 만든다. 그 구현은 커밋이 바뀌어도 캐시를 갱신하지 않는다.
    const vault = freshClean()
    await generate({ env: 'dev', vault })

    const calls = []
    const countingRunGit = (args) => {
      calls.push(args)
      return git(vault, args)
    }
    const result = await generate({ env: 'dev', runGit: countingRunGit, vault })

    expect(result.regenerated).toBe(false) // 앵커: 이 실행이 실제로 **스킵 경로**였다
    expect(calls).toEqual([['rev-parse', 'HEAD']])
  })
})
