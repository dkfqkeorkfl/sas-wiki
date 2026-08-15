// @vitest-environment node
//
// v3 P1 · Task 3·4·10 — **죽은 값 소거 4겹 가드** — tdd §3.4~§3.7 (SC · KY · MD · DV)
//
// 이 파일이 "제거했다" 를 **실행 계층**에 결속한다. 텍스트 grep 단독은 4개 파훼 중 3개가 green 이었다
//   (다이제스트 §3-A 실측) — 그래서 계층을 넷으로 쌓고, 텍스트는 **넷째 겹**으로만 둔다:
//     겹1 SC  스키마      — 지운 키를 되살린 페이로드가 `additionalProperties:false` 로 거부되는가
//     겹2 KY  산출물      — 실제로 쓰인 파일의 키 집합이 **긍정형 완전 열거**와 정확히 일치하는가
//     겹3 MD  모듈그래프  — 계산 모듈이 **해석 불가**인가(다른 export 이름으로 복원해도 걸린다)
//     겹4 DV  텍스트      — README 서술처럼 실행이 못 보는 자리에 판정 토큰이 남아 있지 않은가
//
// ★ 왜 `docs-contract.test.mjs` 가 아니라 새 파일인가: 그 파일 안에 이 phase 가 삭제해야 하는 PT3 이
//   살아 있어, **자기 파일 단위 제외가 그것을 가린다**(다이제스트 §3-C 실측).
//
// ★ 자기 제외를 **쓰지 않는다**(규범 H). 겹2 는 긍정형 완전 열거라 금지 토큰을 적을 필요가 없고,
//   겹4 의 토큰은 `helpers/dead-value-tokens.mjs` 가 **조각을 런타임에 이어 붙여** 만든다 —
//   그래서 이 소스에도, 그 데이터 모듈에도 판정 토큰의 **리터럴이 없다**. 면제 목록은 **길이 0**
//   이며 DV6 이 그것을 문다. 이 주석에도 토큰을 적지 않는다(주석도 스캔 대상이다).
//
// RED 사유:
//   · SC1 — pin(오늘도 green). 네 스키마가 전부 strict 다.
//   · SC2·SC3·SC4 — 🔴RED. 오늘 스키마가 두 키를 **required 로 요구**하므로 부활 페이로드가 통과한다.
//   · KY1·KY2·KY5·KY6 — 🔴RED. 오늘 산출물은 9키/7키이고 스키마 required 도 그 형태다.
//   · MD1·MD2·MD3 — 🔴RED. 계산 모듈과 전용 테스트 2파일이 살아 있다.
//   · DV0~DV2·DV5·DV6 — pair(오늘도 green). 스캐너 생존 앵커다.
//   · DV3 — 🔴RED. 실측 38파일 + README 7줄.
//
// ── ★ v3 P2(cursor-contract) 증분 — tdd §3.4 · §4.5-① ──────────────────────────────────────
//   겹1·겹2 를 **출력 6층 정합(LZ)** 으로 넓히고, 같은 자리의 개수·집합 리터럴 3건을 flip 한다.
//   · SC1  🔴RED(flip) 4종 → **3종** + `feeds-artifact.schema.json` **부재** (OQ-P2-5 (a) 폐지)
//   · KY2(=LZ3) 🔴RED(flip) 아티팩트 5키 → **6키**(`nextCursor` · D48)
//   · KY6  🔴RED(flip) 폐지되는 `feeds-artifact` 스키마 → **승계처 `feeds.schema.json`** 재조준
//   · LZ1·LZ4~LZ7 🔴RED 신규 — 층 ①④⑤⑥ + 커서 정의. **규범 Q**(층 라벨)·**규범 M**(properties 먼저).
//   ⇒ 위 flip 들은 **구현보다 먼저 뒤집힌 것**이라 C4 착륙 전까지 red 인 것이 정상이다(tdd §5.3).
//
// 규범 A: 기대 키 배열·스키마 required·계약 버전은 **전부 리터럴**이다(프로덕션 상수 import 금지).
// 규범 B: 모든 부재 단언 앞에 **위험 실재 앵커**를 둔다.
// 규범 C10: 신설 seam 은 `await import` 로 붙들어 **collection error 가 아니라 케이스 실패**로 만든다.
import { execFileSync, spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { readArtifactKeys } from './helpers/artifact-keys.mjs'
import { cleanup } from './helpers/tmp-git-vault.mjs'
import { seedCleanVault } from './helpers/polluted-vault.mjs'
import { listTracked, scanTracked } from './helpers/tracked-scan.mjs'
import {
  CRYPTO_SPECIFIER,
  DEAD_VALUE_TOKENS,
  SENTINEL_TOKEN,
  TOKEN,
  deadValuePattern,
  tokensInLine,
} from './helpers/dead-value-tokens.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SCRIPTS_DIR = path.resolve(HERE, '..')
const REPO_ROOT = path.resolve(SCRIPTS_DIR, '..')
const SCHEMA_DIR = path.join(SCRIPTS_DIR, 'schema')
const SUMMARY_CLI = path.join(SCRIPTS_DIR, 'summary.mjs')
const FEEDS_CLI = path.join(SCRIPTS_DIR, 'feeds.mjs')
const VALIDATE_CLI = path.join(SCRIPTS_DIR, 'validate.mjs')

// ── 계약 리터럴 (규범 A) ─────────────────────────────────────────────────────────────────────
/** 발행 아티팩트 봉투 — **정확 7키**(v3 P1 · D28·D29). 긍정형 완전 열거다. */
const SUMMARY_KEYS = ['docs', 'env', 'generatedAt', 'schemaVersion', 'sourceCommit', 'tags', 'tree']
/**
 * feeds 봉투 — 🔴RED(flip) **v3 P2**: 5 → **6키**(`nextCursor` 추가 · §4.5-① KY2).
 *
 * ★ 규범 Q — 이 배열이 덮는 층은 **③ 아티팩트 파일**·**④⑤ `feeds.schema.json` properties/required**·
 *   **① wire 실응답**이다. P2 가 여섯 층을 **한 형태**로 정합시키므로(D22 `env` + D48 `nextCursor`)
 *   같은 리터럴이 세 자리에서 쓰인다 — 층 라벨 없이 "6종" 이라 부르지 않는다.
 */
const FEEDS_ARTIFACT_KEYS = [
  'env',
  'generatedAt',
  'items',
  'nextCursor',
  'schemaVersion',
  'sourceCommit',
]
/** 리포트 required — **정확 9키**(발행자 표지·상관 토큰·`regenerated` 가 함께 빠진다 · OQ-P1-3). */
const REPORT_REQUIRED = [
  'env',
  'excluded',
  'generatedAt',
  'invalidExcludedRefs',
  'prunedFeeds',
  'schemaVersion',
  'sourceCommit',
  'summary',
  'unresolvedPaths',
]
/** 계약 버전 — 리터럴 **1**(D29). import 로 바꾸면 구현이 어떤 값이든 통과한다. */
const SCHEMA_VERSION = 1
const SOURCE_COMMIT = '9a1b2c3d4e5f60718293a4b5c6d7e8f901234567'
const GENERATED_AT = '2026-07-27T00:00:00.000Z'

/**
 * 층 ① wire 실응답의 **정상 봉투**(v3 P2 · 6키) — 리터럴이다. `nextCursor: null` 은 「히스토리 끝」이며
 * C16 상 `required` 를 통과한다(이름의 존재만 본다). LZ5·LZ7 의 pair 앵커가 이 값을 쓴다.
 */
const WIRE_ENVELOPE = {
  env: 'dev',
  generatedAt: GENERATED_AT,
  items: [],
  nextCursor: null,
  schemaVersion: SCHEMA_VERSION,
  sourceCommit: SOURCE_COMMIT,
}

/**
 * ★ **면제 목록은 비어 있다**(규범 H · DV6). 항목이 하나라도 생기면 DV6 이 red 가 되고, 그 red 는
 *   "가드를 고쳐라" 가 아니라 **메인 세션 컨펌 경로**로 가라는 신호다.
 */
const SCAN_EXEMPTIONS = []

const validator = await import(new URL('../lib/schema-validator.mjs', import.meta.url).href).then(
  (module) => module,
  (error) => ({ __loadError: error instanceof Error ? error.message : String(error) }),
)

/** 규범 C10 — seam 부재가 collection error 로 접혀 러너 요약에 PASS 로 오보고되는 것을 막는다. */
function expectValidatorSeam() {
  expect(validator.__loadError, 'scripts/lib/schema-validator.mjs 로드').toBeUndefined()
  expect(typeof validator.loadSchema, 'loadSchema export').toBe('function')
  expect(typeof validator.validateItem, 'validateItem export').toBe('function')
}

const readSchema = (name) => JSON.parse(readFileSync(path.join(SCHEMA_DIR, name), 'utf8'))

const tmps = []
afterAll(() => cleanup(...tmps))

// ── 겹2 준비: tmp vault 에 실제로 산출물을 쓴다(규범 F — 실 vault 는 건드리지 않는다) ────────
const built = { artifact: '', feeds: '', feedsRun: null, run: null, vault: '' }

beforeAll(() => {
  const seeded = seedCleanVault()
  tmps.push(seeded.vault)
  built.vault = seeded.vault
  built.artifact = path.join(seeded.vault, 'cache', 'summary.dev.json')
  built.feeds = path.join(seeded.vault, 'cache', 'feeds.dev.json')
  built.run = spawnSync(
    process.execPath,
    [SUMMARY_CLI, '--vault', seeded.vault, '--env', 'dev', '--out', built.artifact],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        GIT_CONFIG_COUNT: '1',
        GIT_CONFIG_KEY_0: 'safe.directory',
        // `'*'`(전 경로 허용) 대신 이 spawn 이 실제로 향하는 대상(seeded.vault)으로 좁힌다 —
        //   `helpers/tracked-scan.mjs` 의 `gitEnv(root)` 와 같은 형태.
        GIT_CONFIG_VALUE_0: seeded.vault,
      },
      maxBuffer: 64 * 1024 * 1024,
      // `spawnSync` 는 동기 호출이라 vitest 의 it()-레벨 타임아웃(비동기 타이머)으로는 자식의 hang
      //   을 끊을 수 없다 — `timeout` 옵션 자체가 유일한 안전장치다. 이 beforeAll 의 케이스 상한
      //   (300_000, 아래 두 번째 인자)과 같은 값을 재사용한다.
      timeout: 300_000,
    },
  )
  // `timeout` 만 넣고 결과를 안 보면 여전히 조용하다 — 타임아웃/spawn 실패로 죽은 자식은 진단 없이
  //   그냥 `built.artifact` 부재로만 뒤에서(KY1) 에둘러 드러난다. 여기서 원인을 바로 밝힌다.
  if (built.run.error || built.run.signal) {
    throw new Error(
      `[Arrange] summary --out 서브프로세스 비정상 종료: error=${built.run.error?.message ?? 'none'} signal=${built.run.signal ?? 'none'}`,
    )
  }
  built.feedsRun = spawnSync(
    process.execPath,
    [FEEDS_CLI, '--vault', seeded.vault, '--env', 'dev', '--count=200', '--out', built.feeds],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        GIT_CONFIG_COUNT: '1',
        GIT_CONFIG_KEY_0: 'safe.directory',
        GIT_CONFIG_VALUE_0: seeded.vault,
      },
      maxBuffer: 64 * 1024 * 1024,
      timeout: 300_000,
    },
  )
  if (built.feedsRun.error || built.feedsRun.signal) {
    throw new Error(
      `[Arrange] feeds --out 서브프로세스 비정상 종료: error=${built.feedsRun.error?.message ?? 'none'} signal=${built.feedsRun.signal ?? 'none'}`,
    )
  }
}, 300_000)

// ────────────────────────────────────────────────────────────────────────────
// 겹1 SC — 스키마 부활 거부 (1차 결속 · tdd §3.5)
// ────────────────────────────────────────────────────────────────────────────

describe('겹1 스키마 — 부활 거부 (SC1~SC4)', () => {
  it('SC1: 발행 스키마 **3종**이 전부 `additionalProperties: false` 다 (🔴RED(flip) v3 P2 · 4 → 3)', () => {
    // 이 단언이 깨지면 SC2~SC4 가 통째로 약해진다 — 미선언 키가 그냥 통과한다.
    // 🔴 flip 사유: **OQ-P2-5 (a)** — `feeds-artifact.schema.json` 이 폐지되고 `feeds.schema.json` 으로
    //   단일화된다(U2 통합의 스키마 층 귀결 · design-notes `:227`·`:269`). 개수만 줄이면 이 케이스는
    //   **조용히 green** 이 되므로(검사 대상이 줄 뿐이다) 폐지 자체를 부재 축으로 함께 문다(규범 N).
    const names = ['summary.schema.json', 'feeds.schema.json', 'report.schema.json']

    for (const name of names) {
      expect(readSchema(name).additionalProperties, name).toBe(false)
    }

    // ★ 앵커: 스키마 디렉토리가 비어 있지 않고, 3종이 **디스크에 실재한다**(부재 단언의 실재 축).
    const onDisk = readdirSync(SCHEMA_DIR).filter((name) => name.endsWith('.json'))
    expect(onDisk.length).toBeGreaterThan(names.length)
    for (const name of names) expect(onDisk, name).toContain(name)

    expect(onDisk, 'feeds-artifact.schema.json 이 아직 살아 있다 (OQ-P2-5 (a) 폐지 대상)').not.toContain('feeds-artifact.schema.json') // prettier-ignore
  })

  it('SC2: 발행자 표지를 되살린 summary 페이로드가 **"정의되지 않은 필드"** 로 거부된다', () => {
    // ★ 규범 M — `required` 만 지우면 검증이 **오류 0건으로 조용히 통과**한다(다이제스트 §2-D 실측).
    //   그래서 이 케이스는 *순서*를 검사하지 않고 **최종 상태의 거부 능력**을 검사한다.
    expectValidatorSeam()
    const schema = validator.loadSchema(path.join(SCHEMA_DIR, 'summary.schema.json'))
    const clean = {
      docs: [],
      env: 'dev',
      generatedAt: GENERATED_AT,
      schemaVersion: SCHEMA_VERSION,
      sourceCommit: SOURCE_COMMIT,
      tags: {},
      tree: [],
    }

    // ★ 앵커: **정상 페이로드는 통과한다** — "아무거나 다 거부" 하는 구현을 배제한다.
    expect(validator.validateItem(clean, schema, '$summary')).toEqual([])

    const revived = { ...clean, producer: TOKEN.SUMMARY_STAMP_VALUE }
    const errors = validator.validateItem(revived, schema, '$summary')

    expect(errors.join('\n')).toContain('정의되지 않은 필드')
  })

  it('SC3: 상관 토큰을 되살린 페이로드도 **3종 전수**에서 거부된다', () => {
    // ★ PL2 에는 짝이 없었다 — 되살림 방향을 무는 자리가 없으면 "지웠다" 는 한쪽 방향만 증명된다.
    // 🔴 v3 P2 · OQ-P2-5 (a) — arm 이 4 → **3종**이 된다. `feeds-artifact.schema.json` 이 폐지되고
    //   `feeds.schema.json` 으로 단일화됐기 때문이며(SC1·PT2 가 그 부재 자체를 문다), 남은 feeds arm 의
    //   정상 페이로드는 **6키**다(D22 `env` + D48 `nextCursor` · required 6종).
    expectValidatorSeam()
    const items = []
    const arms = [
      { name: 'summary.schema.json', payload: { docs: [], env: 'dev', generatedAt: GENERATED_AT, schemaVersion: SCHEMA_VERSION, sourceCommit: SOURCE_COMMIT, tags: {}, tree: [] } }, // prettier-ignore
      { name: 'feeds.schema.json', payload: { env: 'dev', generatedAt: GENERATED_AT, items, nextCursor: null, schemaVersion: SCHEMA_VERSION, sourceCommit: SOURCE_COMMIT } }, // prettier-ignore
      { name: 'report.schema.json', payload: { env: 'dev', excluded: [], generatedAt: GENERATED_AT, invalidExcludedRefs: [], prunedFeeds: 0, schemaVersion: SCHEMA_VERSION, sourceCommit: SOURCE_COMMIT, summary: { excluded: 0, included: 0, total: 0 }, unresolvedPaths: [] } }, // prettier-ignore
    ]

    for (const arm of arms) {
      const schema = validator.loadSchema(path.join(SCHEMA_DIR, arm.name))
      // 앵커: 정상 페이로드는 통과한다(같은 이유 — 전부 거부하는 구현 배제).
      expect(validator.validateItem(arm.payload, schema, `$${arm.name}`), arm.name).toEqual([])

      const revived = { ...arm.payload, [TOKEN.CORRELATION_FIELD]: '0'.repeat(16) }
      expect(
        validator.validateItem(revived, schema, `$${arm.name}`).join('\n'),
        arm.name,
      ).toContain('정의되지 않은 필드')
    }
  })

  it(
    'SC4: **프로세스 경계** — 두 키를 **요구하는** 스키마로 돌리면 `validate.mjs` 가 exit≠0 이다',
    { timeout: 300_000 },
    () => {
      // ★ tdd §3.5 는 _"되살린 페이로드를 산출물 경로에 둔 tmp vault"_ 라 적었으나, `validate.mjs` 는
      //   **산출물 파일을 읽지 않는다** — in-memory 로 조립한 payload 를 자기 스키마로 검증한다
      //   (`validate.mjs` 헤더 · `PAYLOAD_FILES` 는 라벨 매핑일 뿐이다). 그래서 같은 계약을 **뒤집어**
      //   관측한다. 이 케이스가 무는 것은 그대로다 — "생산자가 그 두 키를 더 이상 발행하지 않는가".
      //
      // ★★ **뒤집는 방향이 중요하다(C6 CX10 이 실측으로 잡은 결함).** 처음 구현은 두 키를 *지운*
      //   스키마 사본으로 돌렸는데, 두 키는 실 스키마에서 **이미 지워져 있다** — `stripKeys` 가
      //   아무것도 지우지 않아 두 사본이 **바이트 동일**이었고, 케이스는 control 을 두 번 돌린 것과
      //   같았다(CX10 에서 SC4 가 green 인 것으로 드러났다). 그래서 방향을 **요구**로 바꾼다:
      //     · 오늘  — 생산자가 그 키를 발행하지 않는다 → 필수 필드 누락 → **exit≠0** (이 단언)
      //     · 부활시 — 발행한다 → 통과 → exit 0 → **red** (CX1 이 그것을 증명한다)
      //   키마다 **사본을 따로** 둔다. 한 사본에 둘을 함께 요구하면 하나만 부활해도 다른 하나가
      //   여전히 실패시켜 exit≠0 이 유지되고, 그 부활이 **관측되지 않는다**.
      const seeded = seedCleanVault()
      tmps.push(seeded.vault)

      const pristine = mkdtempSync(path.join(tmpdir(), 'wiki-schema-pristine-'))
      tmps.push(pristine)
      cpSync(SCHEMA_DIR, pristine, { recursive: true })

      // ★ 앵커: **원본 스키마 사본에서는 exit 0** 이다(vault·CLI 가 통째로 죽어서 실패하는 것을 배제).
      const control = runCli(VALIDATE_CLI, ['--vault', seeded.vault, '--env', 'dev', '--schema', pristine]) // prettier-ignore
      expect(control.status, control.stderr).toBe(0)

      for (const key of ['producer', TOKEN.CORRELATION_FIELD]) {
        const demanding = mkdtempSync(path.join(tmpdir(), 'wiki-schema-demanding-'))
        tmps.push(demanding)
        cpSync(SCHEMA_DIR, demanding, { recursive: true })
        requireKey(path.join(demanding, 'summary.schema.json'), key)

        const result = runCli(VALIDATE_CLI, ['--vault', seeded.vault, '--env', 'dev', '--schema', demanding]) // prettier-ignore

        expect(result.status, `${key}: ${result.stderr}${result.stdout}`).not.toBe(0)
      }
    },
  )
})

// ────────────────────────────────────────────────────────────────────────────
// 겹2 KY — 산출물 키 긍정형 완전 열거 (tdd §3.4)
// ────────────────────────────────────────────────────────────────────────────

describe('겹2 산출물 — 키 집합 완전 열거 (KY1·KY2)', () => {
  it('KY1: `--out` 이 쓴 summary 산출물의 키가 **정확히 7키**다', () => {
    // 부정형("표지가 없다")이 아니라 **긍정형 완전 열거**다 — 빈 객체도, 다른 잔재 키도 함께 잡고,
    //   가드 소스에 금지 토큰을 적지 않아도 되므로 자기 제외 문제가 원천 소거된다.
    expect(built.run?.status, built.run?.stderr).toBe(0) // 앵커 ①: 실행이 성공했다
    expect(existsSync(built.artifact)).toBe(true) // 앵커 ②: 파일이 실재한다

    const parsed = JSON.parse(readFileSync(built.artifact, 'utf8'))
    expect(parsed.docs.length, '빈 산출물로 키 집합만 맞추는 구현 배제').toBeGreaterThan(0) // 앵커 ③

    expect(readArtifactKeys(built.artifact)).toEqual(SUMMARY_KEYS)
  })

  it('KY2(=LZ3): 빌드가 쓴 feeds 아티팩트(층 ③)의 키가 **정확히 6키**다 (🔴RED(flip) v3 P2 · 5 → 6)', () => {
    // summary 실행은 더 이상 feeds 를 함께 쓰지 않는다. 빌드처럼 feeds 생산자를 명시 호출한 결과를 본다.
    // 🔴 flip 사유: **D48** — 캐시 파일과 라이브 응답이 같은 형태여야 하므로 아티팩트도 `nextCursor` 를
    //   싣는다(U2 통합 · §4.5-①). 이 키가 없으면 "중간 페이지에서 파일 꼬리 커서를 흘리는" 함정 자체가
    //   성립하지 않아 QX2 가 관측할 대상이 사라진다.
    expect(built.feedsRun?.status, built.feedsRun?.stderr).toBe(0) // 앵커 ①
    expect(existsSync(built.feeds), built.feedsRun?.stderr).toBe(true) // 앵커 ②
    const parsed = JSON.parse(readFileSync(built.feeds, 'utf8'))
    expect(Array.isArray(parsed.items), 'items 가 배열이다').toBe(true) // 앵커 ③

    expect(readArtifactKeys(built.feeds)).toHaveLength(FEEDS_ARTIFACT_KEYS.length) // 규범 N
    expect(readArtifactKeys(built.feeds)).toEqual(FEEDS_ARTIFACT_KEYS)
  })

  it('KY6: `feeds`·`report` 스키마의 `required` 가 완전 열거와 일치한다 (🔴RED(flip) v3 P2 · 승계처 재조준)', () => {
    // ★ `report.schema.json` 은 `regenerated` 도 함께 빠진다(OQ-P1-3 — plan Task 5 VALIDATE 가
    //   `scripts/` 하위 grep 0 을 요구하므로 이 파일은 그 요구의 대상이다).
    // 🔴 재구성 사유: 이 케이스의 feeds 축은 **`feeds-artifact.schema.json`** 을 물던 자리다. 그 파일이
    //   OQ-P2-5 (a) 로 폐지되므로 **승계처인 `feeds.schema.json`(층 ⑤)** 로 재조준한다 — 삭제가 아니다.
    //   거동 축(이름 존재만 본다 · `nextCursor: null` 통과)은 같은 파일의 **LZ5** 가 따로 문다.
    // 규범 N: 개수와 **집합**을 함께 문다.
    const feeds = readSchema('feeds.schema.json')
    const report = readSchema('report.schema.json')

    expect(feeds.required).toHaveLength(FEEDS_ARTIFACT_KEYS.length)
    expect([...feeds.required].sort()).toEqual(FEEDS_ARTIFACT_KEYS)
    expect(report.required).toHaveLength(REPORT_REQUIRED.length)
    expect([...report.required].sort()).toEqual(REPORT_REQUIRED)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// LZ — 출력 6층 정합 (v3 P2 · Task 6 · tdd §3.4 · **규범 Q 가 지배한다**)
//
//   ① wire 실응답(stdout)          LZ1        · 5 → 6
//   ② `buildFeeds()` 반환           (KY4 — `lib/__tests__/payloads.test.mjs`)  4 → 5
//   ③ feeds 아티팩트 파일           KY2(=LZ3)  · 5 → 6
//   ④ `feeds.schema.json` props     LZ4        · 5 → 6   ← **규범 M: properties 가 먼저다**
//   ⑤ 같은 파일 `required`          LZ5        · 4 → 6
//   ⑥ `validate.mjs` 인메모리 게이트 LZ6       · 4키 → 6키
//   (+ 커서 정의 자체)              LZ7
//
// ★ 층 라벨 없이 "출력 필드 6종" 이라 쓰지 않는다 — 같은 말이 실측상 **6개의 수**를 가리킨다.
// ────────────────────────────────────────────────────────────────────────────

describe('출력 6층 정합 (LZ1·LZ4~LZ7 · 🔴RED v3 P2 미구현)', () => {
  it('LZ1: 층 ① — `feeds.mjs` stdout 의 키가 **정확히 6키**다', { timeout: 300_000 }, () => {
    // 🔴 오늘은 5키다(`env` 없음). D22 축자: 캐시 최소 검증의 **유일한 실질 판별축**이 `env` 라서
    //   wire 에도 남긴다 — `SCHEMA_VERSION` 동결로 표지 대조의 구분력이 "1 vs 1" 로 사라졌기 때문이다.
    const result = runCli(FEEDS_CLI, ['--vault', built.vault, '--env', 'dev', '--count=5'])

    // 앵커: stdout 이 1줄 JSON 으로 파싱되고 `items` 가 배열이다.
    expect(result.status, result.stderr).toBe(0)
    const payload = JSON.parse(result.stdout)
    expect(Array.isArray(payload.items)).toBe(true)

    const wireKeys = Object.keys(payload).toSorted()
    expect(wireKeys).toHaveLength(FEEDS_ARTIFACT_KEYS.length) // 규범 N
    expect(wireKeys).toEqual(FEEDS_ARTIFACT_KEYS)
  })

  it('LZ4: 층 ④ — `feeds.schema.json` 의 `properties` 가 **정확히 6종**이다 (규범 M)', () => {
    // ★ 규범 M — **properties 를 먼저** 문다. `required` 만 고치면 `additionalProperties:false` 가
    //   미선언 키를 막아 스키마가 자기모순이 되고, 그 실패는 "생산자가 안 싣는다" 로 오독된다.
    const properties = Object.keys(readSchema('feeds.schema.json').properties).toSorted()

    expect(properties).toHaveLength(FEEDS_ARTIFACT_KEYS.length) // 규범 N
    expect(properties).toEqual(FEEDS_ARTIFACT_KEYS)
  })

  it('LZ5: 층 ⑤ — `required` 가 **정확히 6종**이고 `nextCursor: null` 은 통과한다', () => {
    // ★ 근거(C16 · JSON Schema 2020-12 §6.5.3 축자): `required` 는 _"every item in the array is the
    //   **name of a property** in the instance"_ — **이름의 존재만** 본다. 그래서 `{"nextCursor": null}`
    //   은 통과하고 **키 누락은 실패**한다. required 를 5로 두면 _"`nextCursor` 를 아예 안 싣는"_ 변이가
    //   스키마를 그대로 통과해 **D48 등가 불변식이 조용히 무력화**된다(M6).
    expectValidatorSeam()
    const schema = validator.loadSchema(path.join(SCHEMA_DIR, 'feeds.schema.json'))
    const required = [...readSchema('feeds.schema.json').required].sort()

    expect(required).toHaveLength(FEEDS_ARTIFACT_KEYS.length) // 규범 N
    expect(required).toEqual(FEEDS_ARTIFACT_KEYS)

    // 거동 — 앵커: 정상 봉투(커서 null)는 오류 0건이다.
    expect(validator.validateItem(WIRE_ENVELOPE, schema, '$feeds')).toEqual([])

    const missingCursor = { ...WIRE_ENVELOPE }
    delete missingCursor.nextCursor
    expect(validator.validateItem(missingCursor, schema, '$feeds').length).toBeGreaterThan(0)
  })

  it(
    'LZ6: 층 ⑥ — `validate.mjs` 가 스키마에 **`env`+`nextCursor` 를 넘긴다**',
    { timeout: 300_000 },
    () => {
      // ★★ **하드 블로커의 관측점**이다. `validate.mjs:101-105` 는 `buildFeeds({generatedAt, items,
      //   sourceCommit})` = **4키**를 이 스키마로 검증한다 — `required` 를 6으로 올리면서 이 자리를 함께
      //   고치지 않으면 `pnpm validate`(= build 체인 1스텝)가 **죽는다**.
      const seeded = seedCleanVault()
      tmps.push(seeded.vault)

      const pristine = mkdtempSync(path.join(tmpdir(), 'wiki-lz6-pristine-'))
      tmps.push(pristine)
      cpSync(SCHEMA_DIR, pristine, { recursive: true })

      // ★ 앵커: 원본 스키마 사본에서는 exit 0 이다(vault·CLI 가 통째로 죽어서 실패하는 것을 배제).
      const control = runCli(VALIDATE_CLI, ['--vault', seeded.vault, '--env', 'dev', '--schema', pristine]) // prettier-ignore
      expect(control.status, control.stderr).toBe(0)

      // 두 키를 **요구하는** 사본에서도 exit 0 이어야 한다 = 인메모리 게이트가 그 두 키를 실제로 넘긴다.
      const demanding = mkdtempSync(path.join(tmpdir(), 'wiki-lz6-demanding-'))
      tmps.push(demanding)
      cpSync(SCHEMA_DIR, demanding, { recursive: true })
      demandKeys(path.join(demanding, 'feeds.schema.json'), ['env', 'nextCursor'])

      const result = runCli(VALIDATE_CLI, ['--vault', seeded.vault, '--env', 'dev', '--schema', demanding]) // prettier-ignore

      expect(result.status, `${result.stderr}${result.stdout}`).toBe(0)
    },
  )

  it('LZ7: 커서 정의가 **12-hex 문자열**이다 — 옛 `{ts,feedId}` 객체를 거부한다', () => {
    // 🔴 오늘은 정반대다: `definitions.feedCursor` 가 `{ts, feedId}` **객체**라 문자열이 거부된다.
    expectValidatorSeam()
    // 선언 축을 **먼저** 본다 — 거동 축만 두면 같은 봉투의 `env` 결손(LZ4·LZ5)이 먼저 걸려
    //   실패 메시지가 커서를 가리키지 못한다(진단이 층을 잃는다 · 규범 Q).
    expect(readSchema('feeds.schema.json').definitions.feedCursor.type).toBe('string')

    const schema = validator.loadSchema(path.join(SCHEMA_DIR, 'feeds.schema.json'))

    // 앵커(pair): 정상 12-hex 는 통과 · **`null` 도 통과**(끝 표시) — "전부 거부" 구현 배제.
    const withCursor = { ...WIRE_ENVELOPE, nextCursor: '65fc53636938' }
    expect(validator.validateItem(withCursor, schema, '$feeds')).toEqual([])
    expect(validator.validateItem(WIRE_ENVELOPE, schema, '$feeds')).toEqual([])

    const legacy = { ...WIRE_ENVELOPE, nextCursor: { feedId: '65fc53636938', ts: '2026-05-01T00:00:00Z' } } // prettier-ignore
    const notHex = { ...WIRE_ENVELOPE, nextCursor: 'main' }
    expect(validator.validateItem(legacy, schema, '$feeds').length, '옛 객체 커서가 통과했다').toBeGreaterThan(0) // prettier-ignore
    expect(validator.validateItem(notHex, schema, '$feeds').length, "'main' 이 통과했다").toBeGreaterThan(0) // prettier-ignore
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 겹3 MD — 모듈 부재 (tdd §3.6)
// ────────────────────────────────────────────────────────────────────────────

describe('겹3 모듈그래프 — 계산 모듈 부재 (MD1~MD3)', () => {
  it('MD1: 지운 계산 모듈의 import 가 `ERR_MODULE_NOT_FOUND` 로 reject 된다', async () => {
    // ★ 이 겹이 파훼 ④(**다른 export 이름으로 복원**)를 잡는 유일한 자리다 — 텍스트 겹의 토큰
    //   어느 것도 그 복원을 걸지 못한다(CX8 이 그것을 증명한다).
    // 앵커: 같은 방식으로 `payloads.mjs` 는 **resolve 한다**(경로 오타로 통과하는 것을 배제).
    const anchor = await import(new URL('../lib/payloads.mjs', import.meta.url).href)
    expect(typeof anchor.buildSummary, 'payloads.mjs 앵커').toBe('function')

    const outcome = await import(new URL('../lib/fingerprint.mjs', import.meta.url).href).then(
      () => ({ resolved: true }),
      (error) => ({ code: error?.code, resolved: false }),
    )

    expect(outcome.resolved, 'scripts/lib/fingerprint.mjs 가 아직 살아 있다').toBe(false)
    expect(outcome.code).toBe('ERR_MODULE_NOT_FOUND')
  })

  it('MD2: 그 모듈의 전용 테스트 2파일이 추적 목록에 없다', () => {
    const { files } = listTracked(REPO_ROOT)

    // 앵커: 같은 목록에 살아남는 테스트가 **있다**(목록이 비어서 통과하는 것을 배제).
    expect(files).toContain('scripts/lib/__tests__/artifact.read.test.mjs')

    const orphans = [
      'scripts/lib/__tests__/fingerprint.test.mjs',
      'scripts/lib/__tests__/fingerprint.suppression-independent.test.mjs',
    ].filter((rel) => files.includes(rel))
    expect(orphans, '삭제된 모듈의 전용 테스트가 남아 있다').toEqual([])
  })

  it('MD3: `scripts/**/*.mjs` 중 그 내장 모듈을 여는 파일이 0개다', () => {
    const { files } = listTracked(REPO_ROOT)
    const mjs = files.filter((rel) => rel.startsWith('scripts/') && rel.endsWith('.mjs'))
    expect(mjs.length, '스캔 대상이 비었다').toBeGreaterThan(0) // 앵커 ①

    // 앵커 ②: 같은 스캐너가 **살아 있는** 내장 모듈은 실제로 여럿 관측한다.
    const alive = scanTracked({ files: mjs, pattern: /node:path/u, repoRoot: REPO_ROOT })
    expect(alive.hits.length).toBeGreaterThan(1)

    const dead = scanTracked({
      files: mjs,
      pattern: new RegExp(CRYPTO_SPECIFIER, 'u'),
      repoRoot: REPO_ROOT,
    })
    expect(dead.hits.map((hit) => `${hit.path}:${hit.line}`)).toEqual([])
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 겹4 DV — 텍스트 스캔 (tdd §3.7) · 앵커가 먼저다
// ────────────────────────────────────────────────────────────────────────────

describe('겹4 텍스트 — 판정 토큰 0 (DV0~DV6)', () => {
  it('DV0: 스캔 목록이 비어 있지 않다 (pair)', () => {
    // ★ 파훼 ②(`0 === 0` 통과) 방어. gitleaks #1450 _"scanning zero files, which succeeds trivially"_.
    const { files } = listTracked(REPO_ROOT)

    expect(files.length).toBeGreaterThan(0)
  })

  it('DV1: 목록에 결속 대상 3파일이 전부 들어 있다 (pair)', () => {
    // 파훼 ② 의 pathspec 오타 판(版) — 목록이 비지 않았더라도 **엉뚱한 것만** 담을 수 있다.
    const { files } = listTracked(REPO_ROOT)

    for (const rel of ['scripts/lib/payloads.mjs', 'scripts/lib/artifact.mjs', 'README.md']) {
      expect(files, rel).toContain(rel)
    }
  })

  it('DV2: 센티넬 토큰 히트가 1건 이상이다 (pair)', () => {
    // 읽기가 죽어 전부 빈 문자열인 상태를 배제한다 — 살아 있어야 하는 토큰으로 관측기를 증명한다.
    const { files } = listTracked(REPO_ROOT)
    const scan = scanTracked({ files, pattern: new RegExp(SENTINEL_TOKEN, 'u'), repoRoot: REPO_ROOT }) // prettier-ignore

    expect(scan.scannedFiles).toBeGreaterThan(0)
    expect(scan.scannedLines).toBeGreaterThan(0)
    expect(scan.hits.length).toBeGreaterThanOrEqual(1)
  })

  it('DV3: 판정 토큰 10종의 히트가 **0** 이다', () => {
    // ☞ DV0~DV2 가 선행 앵커다. 토큰 리터럴은 이 소스에 없다(데이터 모듈이 런타임에 조립한다) —
    //   그래서 **자기 히트가 구조적으로 불가능**하고 면제가 필요 없다(DV6).
    //
    // ★ 11 → 10: 맨단어(접두사 없는 낱말 하나) 항목을 뺐다. 그것이 무는 유일한 자리가 tdd §4.4 가
    //   **무변경 pin** 으로 못박은 동시성 어휘였고(판정 토큰이 아니라고 사유까지 적혀 있다), 접두사
    //   3종·값 3종이 스탬프 상수를 이름으로도 값으로도 이미 잡으므로 **중복이면서 과잉**이었다.
    // ★ 규범 N 은 개수 flip 에 집합 단언 동반을 요구하지만 **이 자리는 그것이 구조적으로 불가능**하다
    //   — 기대 집합을 리터럴로 적으면 스캐너가 자기 자신을 물어 DV3 이 영원히 red 가 되고, 그 red 의
    //   "자연스러운 수리" 가 자기 파일 제외(= 면제 1건)다. 바로 이 파일이 없애려는 형태다.
    //   그래서 비공허성은 개수가 아니라 **DV2 센티넬**(살아 있어야 하는 토큰의 히트 ≥ 1)이 진다 —
    //   조립이 죽어 전부 빈 문자열이면 DV2 가 먼저 red 다. 아래 개수 단언은 그 위의 얇은 앵커다.
    expect(DEAD_VALUE_TOKENS).toHaveLength(10) // 앵커: 토큰 조립이 죽지 않았다
    const { files } = listTracked(REPO_ROOT)

    const scan = scanTracked({ files, pattern: deadValuePattern(), repoRoot: REPO_ROOT })
    const offenders = scan.hits.map((hit) => `${hit.path}:${hit.line} [${tokensInLine(hit.text).join(',')}]`) // prettier-ignore

    expect(offenders.slice(0, 40), `판정 토큰 잔재 ${offenders.length}건`).toEqual([])
  })

  it('DV5: 스캐너가 **미추적 파일까지** 훑는다 (pair)', () => {
    // ★ 파훼 ③(`git add` 전 파일에 토큰 부활) 방어. `.gitignore` 를 존중하므로 `cache/`·`logs/` 는
    //   자동 제외된다 — **별도 경로 제외를 쓰지 않는다**(그 자체가 면제의 다른 이름이다).
    //
    // ★ 소스 문자열만 보지 않는다 — `'--others'`·`'--exclude-standard'` 가 주석으로만 남아도(실제
    //   git 호출에서는 빠져도) 문자열 검사는 통과한다. 실제 tmp git 저장소로 동작을 태운다.
    const repo = mkdtempSync(path.join(tmpdir(), 'wiki-dv5-untracked-'))
    tmps.push(repo)
    const identity = {
      GIT_AUTHOR_EMAIL: 'bot@sas.wiki',
      GIT_AUTHOR_NAME: 'SAS Wiki Bot',
      GIT_COMMITTER_EMAIL: 'bot@sas.wiki',
      GIT_COMMITTER_NAME: 'SAS Wiki Bot',
    }
    const run = (args) =>
      execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', env: { ...process.env, ...identity } }) // prettier-ignore

    run(['init', '-q', '-b', 'main'])
    writeFileSync(path.join(repo, 'tracked.txt'), 'tracked\n', 'utf8')
    run(['add', 'tracked.txt'])
    run(['commit', '-q', '--no-gpg-sign', '-m', 'init'])
    // .gitignore 는 커밋되지 않아도(워킹트리에만 있어도) git 이 존중한다.
    writeFileSync(path.join(repo, '.gitignore'), 'ignored.txt\n', 'utf8')
    writeFileSync(path.join(repo, 'untracked.txt'), 'untracked\n', 'utf8') // git add 하지 않는다
    writeFileSync(path.join(repo, 'ignored.txt'), 'ignored\n', 'utf8')

    const { files } = listTracked(repo)

    expect(files, '--others 가 실제로 미추적 파일을 담는다').toContain('untracked.txt')
    expect(files, '--exclude-standard 가 .gitignore 를 존중한다').not.toContain('ignored.txt')
  })

  it('DV6: 면제 목록의 길이가 **0** 이다 (pair · 규범 H)', () => {
    // 예외는 목록이 아니라 계약이다 — 1 이 되는 순간 red 가 되고, 그 red 는 컨펌 경로로 가라는 신호다.
    expect(SCAN_EXEMPTIONS).toEqual([])
  })
})

// ── 로컬 프리미티브(판정하지 않는다) ─────────────────────────────────────────────────────────

function runCli(script, args) {
  return spawnSync(process.execPath, [script, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'safe.directory',
      GIT_CONFIG_VALUE_0: '*',
      SOURCE_DATE_EPOCH: '1700000000',
    },
    maxBuffer: 64 * 1024 * 1024,
  })
}

/**
 * 스키마 사본이 주어진 키를 **요구하게** 만든다 — `properties`·`required` **양쪽**에 넣는다.
 *
 * 규범 M 의 순서 규범이 여기에도 걸린다: `required` 에만 넣으면 `additionalProperties:false` 가
 * 그 키를 미선언으로 막아 *어떤* 페이로드도 통과할 수 없고, 그러면 exit≠0 이 "생산자가 발행하지
 * 않는다" 가 아니라 "스키마가 자기모순이다" 를 재는 단언이 된다.
 */
function requireKey(schemaFile, key) {
  const schema = JSON.parse(readFileSync(schemaFile, 'utf8'))
  schema.properties[key] = { type: 'string' }
  if (!schema.required.includes(key)) schema.required.push(key)
  writeFileSync(schemaFile, `${JSON.stringify(schema, null, 2)}\n`)
}

/**
 * 스키마 사본이 주어진 키들을 **요구하게** 만든다 — `requireKey` 와 달리 **타입을 좁히지 않는다**.
 *
 * LZ6 이 요구하는 `nextCursor` 는 `string|null` 이라 `{type:'string'}` 로 덮으면 정상값(`null`)이
 * 실패하고, 그러면 exit≠0 이 "게이트가 그 키를 안 넘긴다" 가 아니라 "우리가 타입을 틀리게 좁혔다" 를
 * 재게 된다. 이미 있는 `properties` 는 **그대로 두고** `required` 에만 이름을 얹는다.
 */
function demandKeys(schemaFile, keys) {
  const schema = JSON.parse(readFileSync(schemaFile, 'utf8'))
  for (const key of keys) {
    if (schema.properties[key] === undefined) schema.properties[key] = {}
    if (!schema.required.includes(key)) schema.required.push(key)
  }
  writeFileSync(schemaFile, `${JSON.stringify(schema, null, 2)}\n`)
}
