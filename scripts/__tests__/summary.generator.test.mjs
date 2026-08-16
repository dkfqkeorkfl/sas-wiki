// @vitest-environment node
//
// P3 · Task 5 — `summary` 를 생성기로 (`runSummaryGenerator`) — tdd §3.6 (GN1~GN8)
//
// RED 사유(전 케이스 공통 · **미구현**): `scripts/summary.mjs` 에 `runSummaryGenerator` export 가
//   **없다**. 파일 자체는 존재하므로 collection error 는 나지 않지만, 케이스별 명시 실패로 바꿔
//   "어느 축이 미구현인가" 가 실패 메시지에 드러나게 한다(tdd §2.4).
//
// 이 파일이 확정하는 seam (tdd §3.0 · **P4 갱신분 반영**):
//   await runSummaryGenerator({ artifactPath, env, runGit, vault })
//     → { artifactPath, excluded, excludedCount, payload, sourceCommit, status }
//        status: 'clean' | 'partial'
//        runGit 기본값 = makeGitRunner(vault) — **테스트가 주입해 호출을 계수한다**(FR7)
//   순수 export `summary(vault, env)` 는 **시그니처·동기성 그대로 `lib/summary-endpoint.mjs` 로
//   이동**했다(OQ-P4-1 = A · §4 원장 ⑮) — cli-contract C5 · summary.test.mjs E-S1~3 · webfront
//   `dev-api.contract.test.ts` 는 **import 경로만** 바뀌고 단언은 무변경이다.
//
// P4 가 이 파일에 남긴 계약 변경 3건(**약화가 아니라 반전** — §4 원장에 1:1 지목이 있다):
//   · **D-A** — 생성기가 `async` 다(파싱 툴체인을 재생성 분기에서만 동적으로 연다) → 호출부에
//     `await`, `toThrow` 는 `rejects.toThrow`(⑫). 단언 **내용**은 한 글자도 안 바뀌었다.
//   · **D-D** — 봉투가 7키이며 `env` 스탬프를 포함한다.
//     옵션·반환 키가 `cachePath` → `artifactPath`(plan 「후속」 F-28) — 그 파일은 생산자의 사적
//     캐시가 아니라 소비자가 직접 읽는 **발행 아티팩트**다.
//   · **D-G ②** — 아티팩트 경로가 `cache/summary.json` → `cache/summary.<env>.json`(㉖).
//
// 관측 층 분리(tdd §7.4): 여기서는 **반환 객체와 파일**만 본다. exit code·stdout·stderr 는
//   `summary.cli-exit.test.mjs`(XC·PC)가 별도로 문다 — 두 층을 한 케이스에 섞으면 실패 원인이
//   프로세스 경계인지 로직인지 구분되지 않는다(P2 CX12 가 "층이 달라 미발동" 한 교훈).
//
// v3 P1 Task 7: `artifactPath` 가 있을 때만 summary 아티팩트를 쓴다. 리포트는 validate 소유다.
import { existsSync, mkdtempSync, readFileSync, statSync } from 'node:fs'
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
  const env = options.env ?? 'prod'
  const artifactPath = options.artifactPath ?? artifactFile(options.vault, env)
  return loaded.runSummaryGenerator({ ...options, artifactPath, env })
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
 * 발행 아티팩트 봉투 **7키** — **리터럴**이며 정확 일치로 문다(긍정형 완전 열거).
 *
 * P4 원장 §4.2 ⑤ (OQ-P4-4 = **A**): 아티팩트 = stdout payload = HTTP 응답, **셋이 같은 형태**다.
 * 파일과 stdout 을 다른 형태로 쪼개면 `summary.schema.json`(strict)도 두 벌이 필요해지고,
 * 그것이 이 PRD 가 금지한 「호환 분기」다. 소비 zod 는 tolerant 라 **클라이언트 변경은 0** 이다.
 *
 * 🔴 v3 P1(§4.3 ③ · plan Task 3·4): 발행자 표지와 상관 토큰이 **아무도 읽지 않는 값**이라 사라진다
 *   (D28). 9키 → **7키**이고, 개수 단언만 내리지 않고 이 **집합**을 계약으로 둔다(규범 N).
 */
const ENVELOPE_KEYS = [
  'docs',
  'env',
  'generatedAt',
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

  it('GN2: 아티팩트 봉투 키가 **정확히** 7키다 (필드를 흘리는 구현 배제)', async () => {
    const vault = freshClean()

    await generate({ env: 'dev', vault })

    const keys = Object.keys(readJson(artifactFile(vault))).toSorted()
    // 규범 N — 개수는 빠른 진단, **집합이 계약**이다. 개수만 두면 엉뚱한 키가 하나 들어오고 하나
    //   빠져도 통과한다.
    expect(keys).toHaveLength(7)
    expect(keys).toEqual(ENVELOPE_KEYS)
  })

  it('GN3: 클린 vault → status "clean" · excludedCount 0 · 아티팩트 발행', async () => {
    // ★ **IG 의 짝 가드**다(tdd §3.2 · §10.3-4 ②). `summary.import-graph.test.mjs`(IG1·IG6)는
    //   "판정 경로가 렌더 툴체인을 정적으로 물지 않는다" 만 문으므로, **아예 재생성을 못 하는**
    //   구현도 거기서는 통과한다. 그 구멍을 이 케이스가 막는다 — "IG 와 무관" 이라며 지우면 IG1 이
    //   장식이 된다.
    const vault = freshClean()

    const result = await generate({ env: 'dev', vault })

    expect(result.status).toBe('clean')
    expect(result.excludedCount).toBe(0)
    expect(existsSync(artifactFile(vault))).toBe(true)
    expect(result.payload.docs.length).toBeGreaterThan(0)
  })
})

describe('runSummaryGenerator — 주입한 runGit 이 실제로 쓰인다 (FR7)', () => {
  it('FR7: `runGit` 을 주입하면 기본 `makeGitRunner(vault)` 대신 그 러너가 불린다', async () => {
    // ★ 헤더(§ :13)가 "runGit 기본값 = makeGitRunner(vault) — 테스트가 주입해 호출을 계수한다" 고
    //   주장하는데, 그 주장을 실행하는 케이스가 이 파일에 하나도 없었다. 주입 자리가 있어도 안
    //   쓰이는(조용히 기본 러너로 되돌아가는) 구현을 잡으려면 **호출을 실제로 계수**해야 한다 —
    //   `generate()` 가 실제로 산출물을 냈다는 앵커만으로는 어느 러너가 불렸는지 구분되지 않는다.
    const vault = freshClean()
    const calls = []
    // `git()`(tmp-git-vault) 는 `(cwd, args)` 시그니처다 — `runGit` 계약(`(args) => stdout`)에 맞춰
    //   vault 를 닫아 감싼다. 실제 git 실행은 위임하므로 생성기가 정상적으로 완주한다(스텁이 아니다).
    const spyRunGit = (args) => {
      calls.push(args)
      return git(vault, args)
    }

    const result = await generate({ env: 'dev', runGit: spyRunGit, vault })

    // 앵커: 주입된 러너로도 생성이 **실제로 끝났다**(러너가 무시되고 기본값이 대신 도는 것과, 계수만
    //   되고 실행 자체가 실패하는 것을 함께 배제한다).
    expect(result.payload.docs.length).toBeGreaterThan(0)
    // 본체: 주입한 러너가 **실제로** 불렸다 — 계수하지 않으면 주입 자리만 있고 안 쓰이는 구현도 통과한다.
    expect(calls.length, '주입한 runGit 이 한 번도 호출되지 않았다').toBeGreaterThan(0)
    // 위험 실재 앵커: `runSummaryGenerator` 자신이 `sourceCommit` 을 얻으려 첫 줄에서 그 러너로
    //   `rev-parse HEAD` 를 직접 부른다(`lib/generator.mjs`) — 계수가 다른 축(예: 로깅)이 아니라
    //   실제 git 호출을 잡았음을 확인한다.
    expect(calls.some((args) => args.includes('rev-parse'))).toBe(true)
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
    //   **발행 아티팩트**로 재규정했다. 한 파일이 두 이름을 갖는 상태를 없앤 것이지
    //   **단언을 완화한 것이 아니다**(대상·강도·개수 무변경).
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

describe('runSummaryGenerator — 항상 결정적으로 계산한다 (GN6 · 승계)', () => {
  it('GN6: 연속 2회 실행의 payload 가 **직렬화 바이트까지 동일**하다', async () => {
    // ★ OQ-P3-2 = A 의 핵심. 연속 계산이 같은 payload 를 내야 dev 미들웨어(`plugin.ts:132`)의
    //   `summaryEnvelope.parse` 가 안정적으로 통과한다(프로세스 경계 대응물은 PC3).
    const vault = freshClean()

    const first = await generate({ env: 'dev', vault })
    const second = await generate({ env: 'dev', vault })

    expect(existsSync(artifactFile(vault))).toBe(true)
    expect(JSON.stringify(second.payload)).toBe(JSON.stringify(first.payload))
  })
})

describe('runSummaryGenerator — 부작용 없는 조회 · 전역 실패 (GN7·GN8 · 🔴RED 미구현)', () => {
  it('GN7: `artifactPath` 미지정 → payload 는 나오지만 `cache/`·`logs/` 둘 다 미생성', async () => {
    const vault = freshClean()

    const result = await loaded.runSummaryGenerator({ env: 'dev', vault })

    expect(result.payload.docs.map((doc) => doc.id)).toContain(ID_A) // 앵커: 조회는 됐다
    expect(existsSync(path.join(vault, 'cache'))).toBe(false)
    expect(existsSync(path.join(vault, 'logs'))).toBe(false)

    // 대조군: 같은 픽스처에 `artifactPath` 를 주면 summary 파일을 만든다.
    await generate({ env: 'dev', vault })
    expect(existsSync(path.join(vault, 'cache'))).toBe(true)
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

// ────────────────────────────────────────────────────────────────────────────
// RG — **항상 생성한다** (v3 P1 Task 5 · tdd §3.8 · CX4 의 대상)
//
// 항상 새로 계산한다 — 같은 관측 기법으로 "두 번째도 갱신한다" 를 문다(§4.2 승계표).
//
// ★ 층을 셋으로 나눈 이유(tdd §3.8): 층이 하나면 그 층을 우회하는 구현이 통과한다. 그리고
//   _"2회 다 갱신한다"_ 만 단언하면 **매번 다른 값을 만드는 구현**(비결정적 생성기)도 통과한다 —
//   결정성 축(RG3)을 함께 물어야 "항상 생성 = 항상 같은 것을 생성" 이라는 진짜 계약이 선다.
//   그것이 D3 의 `build` 가 성립하는 전제다.
// ☞ 프로세스 층(RG4 stdout 결정성 · RG5 제거된 플래그 exit 2)은 **`summary.cli-exit.test.mjs`** 가
//   진다 — 이 파일은 헤더가 선언한 대로 **반환 객체와 파일만** 본다(GN6 ↔ PC3 가 이미 그 쌍이었다).
// ────────────────────────────────────────────────────────────────────────────

describe('항상 생성한다 (RG1~RG3 · 🔴RED 미구현)', () => {
  it('RG1: 2회차 실행이 산출물을 **실제로 다시 쓴다** (FR2 의 계약 반전)', async () => {
    const vault = freshClean()

    const first = await generate({ env: 'dev', vault })
    // 앵커 ①: 1회차가 **실제로 파일을 만들었다**(아무것도 안 만들고 비교가 무의미해지는 것 배제).
    expect(existsSync(artifactFile(vault))).toBe(true)
    // 앵커 ②: payload 가 비어 있지 않다(빈 산출물을 두 번 쓰는 것으로 통과하는 것 배제).
    expect(first.payload.docs.length).toBeGreaterThan(0)
    // ★ `mtimeMs` 는 파일시스템 시계 해상도에 걸린다 — 두 실행이 같은 해상도 구간 안에서 끝나면
    //   값이 같아 플레이크가 난다. `lib/atomic.mjs` 의 `writeFileAtomic` 은 임시 파일을 쓰고
    //   `rename` 으로 덮어써 실행마다 디렉토리 엔트리가 **새 inode** 를 가리키게 된다 — 이 축은
    //   시계 해상도와 무관하게 "실제로 다시 썼다" 를 구분한다. 대기(sleep)로 해상도를 피하는 방식은
    //   스위트 시간만 늘리고 플레이크를 옮길 뿐이라 쓰지 않는다.
    const before = statSync(artifactFile(vault)).ino

    await generate({ env: 'dev', vault })

    expect(statSync(artifactFile(vault)).ino).not.toBe(before)
  })

  it('RG2: 반환 객체에 옛 상태 플래그 키가 **없다** (항상 참인 플래그는 정보가 없다)', async () => {
    const vault = freshClean()

    const result = await generate({ env: 'dev', vault })

    // 앵커: 나머지 반환 키는 **여전히 있다**(반환이 통째로 비어서 통과하는 것을 배제).
    for (const key of ['payload', 'sourceCommit', 'excludedCount', 'status']) {
      expect(result, key).toHaveProperty(key)
    }

    const removedStatusKey = ['regener', 'ated'].join('')
    expect(removedStatusKey in result).toBe(false)
  })

  it('RG3: 두 **독립 계산**의 payload 가 직렬화 바이트까지 동일하다 (GN6 승계·강화)', async () => {
    // ★ GN6 은 "캐시 hit 이 캐시 내용을 그대로 echo 한다" 를 물었다 — 두 번째 값이 첫 번째의
    //   **복사본**이라 결정성을 증명하지 못한다. 여기서는 두 실행이 **각각 계산**했음을 앵커로
    //   못박은 뒤 바이트 동일을 요구한다.
    // ★ 앵커(벽시계 무관 근거): payload 의 `generatedAt` 은 `parse-vault.mjs` 의
    //   `deriveGeneratedAt(docs)` = `max(doc.updated)` 라 **시계를 읽지 않는다**. 이 앵커가 없으면
    //   GREEN 이 결정성 상실을 flaky 로 오진한다.
    const vault = freshClean()

    const first = await generate({ env: 'dev', vault })
    const before = statSync(artifactFile(vault)).mtimeMs
    const second = await generate({ env: 'dev', vault })

    // 앵커: 2회차가 **캐시 에코가 아니라 재계산**이었다.
    expect(statSync(artifactFile(vault)).mtimeMs).not.toBe(before)

    expect(JSON.stringify(second.payload)).toBe(JSON.stringify(first.payload))
  })

  it('RG3b: 생성기 시그니처에 `force` 파라미터가 없다 (⑥ · 거짓 인상 금지)', () => {
    // `generator.mjs:42-45` 가 이미 세운 규범 — 본문에서 안 쓰는 구조분해 인자를 남기면 "이 함수가
    //   임계를 강제한다" 는 **거짓 인상**만 준다. 스킵 블록이 사라지면 `force` 가 정확히 그 형태가 된다.
    const source = readFileSync(path.resolve(HERE, '..', 'lib', 'generator.mjs'), 'utf8')
    const startToken = 'export async function runSummaryGenerator({'
    const startIndex = source.indexOf(startToken)
    // ★ 시작 토큰을 못 찾으면 `slice(-1, …)` 이 우연히 빈 문자열을 낼 때가 많지만 그건 계약이
    //   아니다 — 종료 토큰이 시작 자리보다 뒤에서 다른 함수에 우연히 걸리면 비어 있지 않은 엉뚱한
    //   구간이 나올 수 있다(포맷 변경에 조용히 어긋난다). "못 찾았다" 자체를 여기서 즉시 red 로
    //   만들어 원인을 지목한다(빈 결과가 통과가 되지 않게 한다).
    expect(startIndex, `시그니처 시작 토큰을 찾지 못했다: ${startToken}`).not.toBe(-1)
    const endIndex = source.indexOf('}) {', startIndex)
    expect(endIndex, '시그니처 종료 토큰(}) {)을 찾지 못했다').not.toBe(-1)
    const signature = source.slice(startIndex, endIndex)

    // 앵커: 시그니처 구간을 **실제로 찾았고** 살아남는 파라미터가 그 안에 있다(빈 문자열 통과 배제).
    expect(signature.length).toBeGreaterThan(0)
    expect(signature).toContain('vault')
    expect(signature).toContain('env')

    expect(signature).not.toMatch(/\bforce\b/u)
  })
})
