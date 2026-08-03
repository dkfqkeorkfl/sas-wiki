// @vitest-environment node
//
// P3 · Task 5 — 생성기 CLI 의 종료코드·stdout 계약 (**실 spawn** · P2 tier) — tdd §3.8 (XC1~XC7 · PC1~PC4)
//
// 이 파일만이 **프로세스 경계**를 넘는다(tdd §7.3 — CLI spawn 은 여기와 AT6 로 격리했다). 종료코드는
//   함수 반환값으로 대체할 수 없고, "stdout 이 정확히 1줄 JSON 인가" 도 프로세스 밖에서만 관측된다.
//
// RED 사유:
//   XC1·XC2·XC4·XC7 · PC1(flip) — 캐시/리포트/`--out`/`--max-excluded` 개념이 아직 없다.
//   (PC3 은 v3 P1 Task 5 에서 소멸했다 — 계약이 반전돼 RG4 로 승계됐다. 아래 OT/RG 블록 참조.)
//   XC3(flip) — 현행도 exit 1 이지만 stdout 무오염과 stderr 에러 채널을 프로세스 경계에서 못박는다.
//   XC5(flip) — 현행 `parseArgs` 는 알 수 없는 인자에 throw → **exit 1**. 호출 계약 위반은 2 로 가른다.
//   XC6 — ★ 현행 `summary.mjs` 는 `--env` 를 **검증하지 않는다**(`{ default: 'prod', type: 'string' }`)
//         → `--env staging` 이 조용히 `env !== 'dev'` 극성에 흡수돼 **prod 로 동작**한다. fail-closed
//         방향이라 사고는 안 나지만, 오타가 조용히 삼켜지는 것은 fail-loud 계약 위반이다.
//   PC4(flip) — ★ **plan 결함 프로브의 직접 반전**: 중복 id vault 에서 현행은 `summary`·`wiki` 둘 다
//         exit 1(실측). 이 phase 의 존재 이유를 프로세스 경계에서 증명한다.
//   PC2 — pin(현행도 통과). 봉투에 1키를 더해도 **문서 레코드는 안 건드린다**.
//
// 종료코드 계약(D-D · OQ-P3-4 확정):
//   0 = 산출물 있음(제외 0건이든 부분이든) · 1 = 전역 실패(산출물 없음) · 2 = 호출 계약 위반
//   3 = 제외가 문턱 초과(**산출물은 있다**) — 3 은 **생성기 전용**이고 `validate` 는 exit 1 을 쓴다.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterAll, describe, expect, it } from 'vitest'

import { loadSchema, validateItem } from '../lib/schema-validator.mjs'
import { prebuildArtifacts } from './helpers/prebuild-artifacts.mjs'
import { cleanup } from './helpers/tmp-git-vault.mjs'
import { seedCleanVault, seedPollutedVault } from './helpers/polluted-vault.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SCRIPT_DIR = path.resolve(HERE, '..')
const SCHEMA_DIR = path.join(SCRIPT_DIR, 'schema')
const SUMMARY = path.join(SCRIPT_DIR, 'summary.mjs')
const WIKI = path.join(SCRIPT_DIR, 'wiki.mjs')

/** summary active doc — 10키(현행 계약). 봉투가 7키가 돼도 이 집합은 불변이다(PC2). */
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

/**
 * `cli-contract.test.mjs:49 runCli` 를 mirror 한다.
 *
 * `GIT_CONFIG_COUNT`/`_KEY_0`/`_VALUE_0` 주입 이유: vitest 가 `GIT_CONFIG_GLOBAL=/dev/null` 로 전역
 * safe.directory 예외를 지우므로, 9p/컨테이너에서 소유자 uid 가 다르면 자식 git 이 dubious-ownership
 * 로 죽는다 — **테스트가 겨냥한 실패가 아니다**(tdd §7.1).
 */
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
  })
}

const tmps = []
afterAll(() => cleanup(...tmps))

function freshClean() {
  const { vault } = seedCleanVault()
  tmps.push(vault)
  return vault
}

function freshPolluted() {
  const { vault } = seedPollutedVault()
  tmps.push(vault)
  return vault
}

/**
 * 발행 아티팩트 경로 — **env 별로 갈린다**(P4 · D-G ② · §4 원장 신설행).
 *
 * `cache/summary.json`(env 무관 단일 슬롯)은 dev·prod 가 서로를 무효화하던 P3 까지의 형태다.
 * **리터럴 조립이다**(규범 A) — `artifact.mjs` 의 `artifactPath` 를 import 하면 "구현이 뭘 내든
 * 테스트가 따라가는" 자기참조가 된다. 드리프트 감지는 AR1·AR3 이 맡는다.
 */
const artifactFile = (vault, env = 'dev') => path.join(vault, 'cache', `summary.${env}.json`)
// ────────────────────────────────────────────────────────────────────────────
// XC — 종료코드 6종
// ────────────────────────────────────────────────────────────────────────────

describe('종료코드 — 성공 경로 (XC1·XC2 · 🔴RED 미구현)', () => {
  it('XC1: 정상 vault → exit 0 · stdout payload', () => {
    // ★ **IG 의 짝 가드**다(tdd §3.2 · §10.3-4 ②). `summary.import-graph.test.mjs`(IG1·IG6)가 무는
    //   것은 구조뿐이라, 판정 경로에서 렌더 툴체인을 뗀 나머지로 **아무것도 계산하지 못하는** 구현도
    //   거기서는 green 이다. 프로세스 경계에서 payload 를 실제로 계산해 냈음을 보는 이 케이스가
    //   그 짝이다.
    const vault = freshClean()

    const result = runCli(SUMMARY, ['--vault', vault, '--env', 'dev'])

    expect(result.status, result.stderr).toBe(0)
    expect(JSON.parse(result.stdout).docs.length).toBeGreaterThan(0)
  })

  it('XC2: 오염 vault(문턱 미지정) → **exit 0** · stdout payload', () => {
    // ★ R6 "부분 성공 = exit 0". Node `execFile` 이 비-0 을 reject 하므로 부분 성공을 비-0 으로 내면
    //   dev 미들웨어가 정상 데이터를 **버린다**. 앵커를 먼저 본다 — stderr 요약이 실제 제외 수를
    //   담았는가. 리포트 소유가 `validate.mjs` 로 이관된 뒤에도, 이 채널이 "오염을 아예 감지 못 해서
    //   0" 인 상태와 구분해 준다(D5).
    const vault = freshPolluted()

    const result = runCli(SUMMARY, ['--vault', vault, '--env', 'dev'])

    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout).docs.length).toBeGreaterThan(0)
    expect(result.stderr).toMatch(/excluded=2/)
  })
})

describe('종료코드 — 전역 실패 (XC3·XC4 · 🔴RED(flip)/RED)', () => {
  it('XC3: git 리포가 아니면 exit 1 · stdout 은 비고 · stderr 에 에러가 있다', () => {
    // ★ 위험 실재 앵커는 OT5 가 `--out` 으로 승계했다. 기본 실행은 파일을 만들지 않으므로 여기서
    //   캐시 부재를 묻는 것은 공허하다. 이 케이스는 전역 실패의 exit code 와 stdout 무오염만 문다.
    const healthy = freshClean()
    expect(runCli(SUMMARY, ['--vault', healthy, '--env', 'dev']).status).toBe(0)

    const notARepo = mkdtempSync(path.join(tmpdir(), 'wiki-cli-nogit-'))
    tmps.push(notARepo)

    const result = runCli(SUMMARY, ['--vault', notARepo, '--env', 'dev'])

    expect(result.status).toBe(1)
    expect(result.stdout).toBe('') // 반쪽 payload 를 흘리지 않는다
    expect(result.stderr).not.toBe('')
  })

  it('XC4: 캐시 쓰기가 불가능한 `--out`(부모가 파일) → exit 1', () => {
    // ★ D-D "캐시 쓰기 실패는 exit 1". uid 무관하게 결정적인 실패 주입법이다(ENOTDIR).
    const vault = freshClean()

    // ★ 앵커가 필수다: 현행은 `--out` 자체가 **모르는 인자**라 exit 1 이 나온다 — 즉 "쓰기 실패라서
    //   1" 과 "옵션을 몰라서 1" 이 구분되지 않아 이 케이스가 공허하게 green 이 된다(실측으로 잡았다).
    //   먼저 **정상 `--out` 이 실제로 동작함**을 못박고, 그 다음에 실패 경로를 묻는다.
    const okPath = path.join(mkdtempSync(path.join(tmpdir(), 'wiki-cli-out-')), 'ok.json')
    tmps.push(path.dirname(okPath))
    const control = runCli(SUMMARY, ['--vault', vault, '--env', 'dev', '--out', okPath])
    expect(control.status, control.stderr).toBe(0)
    expect(existsSync(okPath)).toBe(true)

    const blocker = path.join(vault, 'blocker')
    writeFileSync(blocker, 'not a directory')
    const result = runCli(SUMMARY, [
      '--vault',
      vault,
      '--env',
      'dev',
      '--out',
      path.join(blocker, 'summary.json'),
    ])

    expect(result.status).toBe(1)
  })
})

describe('종료코드 — 호출 계약 위반은 2 다 (XC5·XC6 · 🔴RED(flip)/RED)', () => {
  it('XC5: 알 수 없는 인자 `--nope` → exit 2 (현행은 1)', () => {
    const vault = freshClean()

    expect(runCli(SUMMARY, ['--vault', vault, '--nope']).status).toBe(2)
  })

  it.each(['staging', ''])('XC6: `--env "%s"` → exit 2 · 허용값이 출력에 보인다', (value) => {
    // ★ fail-closed 극성. 현행은 검증이 없어 staging 이 **조용히 prod 로 흡수**된다 — 저자는 dev 예제를
    //   본다고 믿는데 실제로는 상용 뷰를 보는, 가장 늦게 발견되는 종류의 결함이다.
    const vault = freshClean()

    const result = runCli(SUMMARY, ['--vault', vault, '--env', value])
    const output = `${result.stderr}${result.stdout}`

    expect(result.status).toBe(2)
    expect(output).toContain('dev')
    expect(output).toContain('prod')
  })
})

describe('종료코드 — 문턱 초과는 3, 산출물은 있다 (XC7 · 🔴RED 미구현)', () => {
  it('XC7: `--max-excluded=0` + 오염 2건 → exit 3 · 캐시는 존재하고 스키마를 통과한다', () => {
    // ★ D-D "3 은 산출물 있음". 파일 존재를 함께 확인해야 "그냥 죽는" 구현이 배제된다 — 3 과 1 의
    //   차이는 **호출자가 산출물을 써도 되는가** 하나뿐이다.
    // ★ 동시에 **IG 의 짝 가드**다(tdd §3.2 · §10.3-4 ②) — 실패 종료 경로에서도 발행이 살아 있음을
    //   무는 유일한 자리라, IG1 이 구조만 보고 통과하는 것을 기능 쪽에서 받쳐 준다.
    const vault = freshPolluted()

    const result = runCli(SUMMARY, [
      '--vault',
      vault,
      '--env',
      'dev',
      '--max-excluded=0',
      '--out',
      artifactFile(vault),
    ])

    expect(result.status, result.stderr).toBe(3)
    expect(existsSync(artifactFile(vault))).toBe(true)
    expect(
      validateItem(
        JSON.parse(readFileSync(artifactFile(vault), 'utf8')),
        loadSchema(path.join(SCHEMA_DIR, 'summary.schema.json')),
        'cache/summary.<env>.json',
      ),
    ).toEqual([])
  })
})

// ────────────────────────────────────────────────────────────────────────────
// PC — stdout 프로세스 계약 (OQ-P3-2 = A: 기존 payload 를 그대로 유지한다)
// ────────────────────────────────────────────────────────────────────────────

describe('stdout 계약 (PC1·PC2)', () => {
  it('PC1: 기본 인자 실행의 stdout 이 **정확히 1줄** 파싱 가능한 JSON 이다', () => {
    // `cli-contract` C4a 관례 계승. 생성기 요약·진행 로그가 stdout 에 섞이면 dev 미들웨어의
    //   `JSON.parse` 가 죽는다 → 요약은 **stderr** 로 간다.
    const vault = freshClean()

    const result = runCli(SUMMARY, ['--vault', vault])

    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout.split('\n').filter((line) => line !== '')).toHaveLength(1)
    const payload = JSON.parse(result.stdout)
    expect(Array.isArray(payload.docs)).toBe(true)
  })

  it('PC2: stdout `docs[0]` 의 키 집합이 10키 그대로다 (pin · 소비 계약 무변경)', () => {
    const vault = freshClean()

    const result = runCli(SUMMARY, ['--vault', vault])
    const payload = JSON.parse(result.stdout)

    expect(payload.docs.length).toBeGreaterThan(0) // 앵커: 빈 배열에서 공허 통과 배제
    expect(Object.keys(payload.docs[0]).toSorted()).toEqual(ACTIVE_DOC_KEYS)
  })

  // ☞ **PC3 은 여기 없다 — 아래 RG4 가 승계했다**(tdd §3.8). PC3 은 _"2회차 stderr 가 hit 을 알린다"_
  //   를 물었는데 Task 5 가 스킵 블록을 없애 그 어휘가 **거짓 서술**이 됐다 — 그대로 두면 영원히
  //   red 다. 승계처 RG4 는 RED 커밋이 이미 저작해 두었고(규범 L: RED 커밋에 삭제 0건), **옛 케이스의
  //   제거가 GREEN 원자 커밋의 몫**이라 여기서 지운다(아래 OT/RG 블록 머리말이 같은 말을 한다).
})

// ────────────────────────────────────────────────────────────────────────────
// OT · RG(프로세스 층) — v3 P1 Task 5·7 · tdd §3.8(RG4·RG5) · §3.10(OT1~OT6)
//
// D2(stdout 기본 + `--out` 명시) · D5(리포트 소유가 `validate.mjs` 로 이관) · Task 5(스킵 소멸)가
//   이 파일의 **프로세스 계약**을 바꾼다. XC1·XC2·XC3·XC7 의 「캐시 파일 존재」 앵커는 기본 실행이
//   더 이상 파일을 만들지 않으므로 **공허해지고**(§4.6 ②), 그 자리를 아래 OT5 가 `--out` 기반으로
//   승계한다. 옛 앵커의 제거 자체는 **GREEN 원자 커밋의 몫**이다(규범 L: RED 커밋에 삭제 0건).
//
// ☞ 함수 층 대응물은 `summary.generator.test.mjs` 의 RG1~RG3 다. 두 층을 한 케이스에 섞지 않는다 —
//   in-process 는 통과하는데 spawn 은 깨지는 형태가 이 리포에 실재했다(GN6 ↔ PC3 가 그 쌍이었다).
// ────────────────────────────────────────────────────────────────────────────

/** 발행 아티팩트 봉투 — **정확 7키**(v3 P1 · D28·D29). 리터럴이며 정확 일치로 문다. */
const OUT_ENVELOPE_KEYS = [
  'docs',
  'env',
  'generatedAt',
  'schemaVersion',
  'sourceCommit',
  'tags',
  'tree',
]

function freshOut(name = 'out.json') {
  const dir = mkdtempSync(path.join(tmpdir(), 'wiki-ot-'))
  tmps.push(dir)
  return path.join(dir, name)
}

describe('`--out` / stdout 계약 (OT1~OT4 · 🔴RED(flip) 미구현)', () => {
  it('OT1: `--out` 미지정 실행은 stdout 1줄 JSON 만 내고 **어떤 파일도 만들지 않는다**', () => {
    // ★ D2 「이중 출력 금지」. 기본 실행이 파일도 쓰고 stdout 도 내면 "저 경로가 갱신됐다" 는 사실이
    //   호출자 모르게 발생하고, 그것이 이 phase 가 끊는 lazy 부작용의 마지막 통로다.
    const vault = freshClean()

    const result = runCli(SUMMARY, ['--vault', vault, '--env', 'dev'])

    expect(result.status, result.stderr).toBe(0)
    // 앵커: stdout 이 **실제로 payload** 다(아무것도 안 내면서 "파일 안 만든다" 가 참이 되는 것 배제).
    expect(result.stdout.split('\n').filter((line) => line !== '')).toHaveLength(1)
    expect(JSON.parse(result.stdout).docs.length).toBeGreaterThan(0)

    expect(existsSync(path.join(vault, 'cache'))).toBe(false)
  })

  it('OT2: `--out <경로>` 는 **그 경로에 7키 봉투를 쓰고 stdout 은 빈 출력**이다', () => {
    const vault = freshClean()
    const out = freshOut()

    const result = runCli(SUMMARY, ['--vault', vault, '--env', 'dev', '--out', out])

    expect(result.status, result.stderr).toBe(0)
    // ★ 앵커: 파일 내용이 **파싱 가능한 7키 봉투**다 — 빈 파일을 쓰고 stdout 만 비운 구현을 배제한다.
    expect(existsSync(out)).toBe(true)
    const payload = JSON.parse(readFileSync(out, 'utf8'))
    expect(Object.keys(payload).toSorted()).toEqual(OUT_ENVELOPE_KEYS)
    expect(payload.docs.length).toBeGreaterThan(0)

    expect(result.stdout).toBe('')
  })

  it('OT3: `--stdout` 은 **알 수 없는 인자**다 → exit 2', () => {
    // 플래그 소멸(D2) — stdout 이 기본이 되면 그 플래그는 no-op 이거나 거짓말이다.
    const vault = freshClean()
    const out = freshOut('anchor.json')

    // 앵커: 같은 파서가 `--out` 은 **정상 처리**한다(파서 전체가 죽어서 2가 나오는 것 배제).
    const anchor = runCli(SUMMARY, ['--vault', vault, '--env', 'dev', '--out', out])
    expect(anchor.status, anchor.stderr).toBe(0)

    expect(runCli(SUMMARY, ['--vault', vault, '--env', 'dev', '--stdout']).status).toBe(2)
  })

  it('OT4: `--status` 도 **알 수 없는 인자**다 → exit 2', () => {
    // 신선도 판정 개념이 사라지므로 상태 응답도 사라진다(D1·D2). 소비자는 파일을 그대로 읽는다.
    const vault = freshClean()

    expect(runCli(SUMMARY, ['--vault', vault, '--env', 'dev', '--status']).status).toBe(2)
  })
})

describe('`--out` 이 승계하는 위험 실재 앵커 (OT5·OT6)', () => {
  it('OT5: 성공한 `--out` 실행은 파일을 만들고, 전역 실패는 만들지 않는다 (XC3 앵커 승계)', () => {
    // ★ XC3 의 위험 실재 앵커였던 _"성공하면 캐시를 만든다"_ 가 D2 이후 **거짓**이 된다 — 기본 실행이
    //   파일을 안 만들기 때문이다. 그러면 XC3 의 "실패했을 때 캐시가 없다" 는 **자동으로 참**이 되어
    //   공허해진다(§4.1 변이 ⑥). 앵커를 `--out` 쪽으로 옮겨 같은 방어를 유지한다.
    const healthy = freshClean()
    const okPath = freshOut('healthy.json')
    const control = runCli(SUMMARY, ['--vault', healthy, '--env', 'dev', '--out', okPath])
    expect(control.status, control.stderr).toBe(0)
    expect(existsSync(okPath)).toBe(true)

    const notARepo = mkdtempSync(path.join(tmpdir(), 'wiki-ot-nogit-'))
    tmps.push(notARepo)
    const failPath = freshOut('failed.json')

    const result = runCli(SUMMARY, ['--vault', notARepo, '--env', 'dev', '--out', failPath])

    expect(result.status).toBe(1)
    expect(result.stdout).toBe('') // 반쪽 payload 를 흘리지 않는다
    expect(existsSync(failPath)).toBe(false)
  })

  it('OT6: `--out` 경로가 원자 쓰기(`lib/atomic.mjs`)에 결속돼 있다 (D47 — 존치가 계약)', async () => {
    // ★ D47: `lib/atomic.mjs` 는 **지우지 않는다**. `--out` 이 그 함수를 타야 쓰기 중 반쪽 파일이
    //   소비자에게 보이지 않는다. 여기서는 정적 그래프 + export 실재로 결속만 확인한다 —
    //   경쟁 자체의 관측은 `atomic.concurrency.test.mjs`(pin)가 이미 소유한다.
    const { staticImportClosure } = await import(
      new URL('./helpers/static-import-graph.mjs', import.meta.url).href
    )
    const atomicModule = await import(new URL('../lib/atomic.mjs', import.meta.url).href)

    expect(typeof atomicModule.writeFileAtomic, 'writeFileAtomic export').toBe('function')

    const closure = staticImportClosure(SUMMARY)
    // 앵커: 폐포가 비어 있지 않다(파서가 죽어 `includes` 가 false 인 것과 구분된다).
    expect(closure.files.length).toBeGreaterThan(1)
    expect(closure.files).toContain(path.join(SCRIPT_DIR, 'lib', 'atomic.mjs'))
  })
})

describe('항상 생성한다 — 프로세스 층 (RG4·RG5 · 🔴RED(flip) 미구현)', () => {
  it('RG4: 연속 2회 spawn 의 stdout 이 바이트 동일하고 2회차가 **hit 을 알리지 않는다**', () => {
    // ★ PC3 의 계약 반전이다. PC3 은 _"2회차 stderr 가 hit 을 알린다"_ 를 물었다 — 스킵 블록의
    //   직접 단언이다. 스킵이 사라지면 그 어휘는 **거짓 서술**이 되고, 남는 계약은 "두 독립 계산이
    //   같은 바이트를 낸다"(결정성)뿐이다.
    const vault = freshClean()

    const first = runCli(SUMMARY, ['--vault', vault, '--env', 'dev'])
    const second = runCli(SUMMARY, ['--vault', vault, '--env', 'dev'])

    // 앵커: 두 실행 모두 exit 0 이고 stdout 이 **파싱 가능한 1줄 JSON** 이다.
    expect(first.status, first.stderr).toBe(0)
    expect(second.status, second.stderr).toBe(0)
    expect(second.stdout.split('\n').filter((line) => line !== '')).toHaveLength(1)
    expect(JSON.parse(second.stdout).docs.length).toBeGreaterThan(0)

    expect(second.stdout).toBe(first.stdout)
    expect(second.stderr, '스킵이 사라졌는데 hit 을 알린다').not.toMatch(/hit/i)
  })

  it('RG5: 제거된 강제 재생성 플래그는 **알 수 없는 인자**다 → exit 2', () => {
    // ⑥ — 스킵 블록이 사라지면 `force` 는 본문에서 한 번도 안 쓰이는 인자가 된다. 같은 파일이 정확히
    //   그 형태를 **거짓 인상**으로 기록했다(`generator.mjs:42-45`). no-op 으로 남기지 않는다.
    const vault = freshClean()
    const out = freshOut('force-anchor.json')

    // 앵커: 살아남는 인자 3종은 **여전히 받아들여진다**(파서가 통째로 죽은 것 배제).
    const anchor = runCli(SUMMARY, ['--vault', vault, '--env', 'dev', '--out', out])
    expect(anchor.status, anchor.stderr).toBe(0)

    const removedFlag = ['--', 'force'].join('')
    expect(runCli(SUMMARY, ['--vault', vault, '--env', 'dev', removedFlag]).status).toBe(2)
  })
})

/**
 * 실 spawn + `prebuildArtifacts` 를 함께 지는 케이스의 상한 — **P1 OQ-P1-2 (c) 「케이스별
 * `{ timeout: N }`」의 적용**이다(전역 `testTimeout` 상향은 금지 · 모든 케이스의 hang 감지가 둔해진다).
 * `cli-contract.test.mjs` 의 `REAL_REPO_SPAWN_TIMEOUT` 과 같은 형태이고 대상은 **실측으로 확정**했다.
 *
 * ★ 실측(2026-08-04 · 전 스위트 동시 실행 3회):
 *   | 격리 실행       | < 20,000ms  | 통과                                       |
 *   | 전 스위트 동시  | 28,405ms    | 통과했으나 기본 30s 의 **95%**             |
 *   | 전 스위트 동시  | 35,170ms    | **초과** — `Test timed out in 30000ms`     |
 *   | 전 스위트 동시  | 38,019ms    | **초과**                                   |
 *   문턱을 느슨하게 한 것이 아니라 **워크로드가 커졌다**: v3 P2 에서 `prebuildArtifacts` 의 feeds 단계가
 *   커서 워크(D48 등가 불변식)를 함께 지므로 Arrange 비용이 올라간다. 격리하면 green 인 것을 「환경
 *   경합」으로 결론짓지 않는다 — 부하를 얹으면 재현되는 **부하 의존 타임아웃**이다(tdd §7.3).
 */
const PREBUILD_SPAWN_TIMEOUT = 120_000

describe('중복 id vault 가 서빙을 죽이지 않는다 (PC4 · 🔴RED(flip))', () => {
  it(
    'PC4: `summary.mjs`·`wiki.mjs` 가 **둘 다 exit 0** 이다 (현행 실측은 둘 다 exit 1)',
    { timeout: PREBUILD_SPAWN_TIMEOUT },
    async () => {
      // ★ plan 결함 프로브의 직접 반전 — 이 phase 의 존재 이유. 문서 하나가 깨졌다고 위키 전체가
      //   500 으로 죽는 상태를 끝낸다.
      const vault = freshPolluted()
      await prebuildArtifacts(vault, 'dev')

      const summaryResult = runCli(SUMMARY, ['--vault', vault, '--env', 'dev'])
      const wikiResult = runCli(WIKI, ['--vault', vault, '--env', 'dev', '--path', 'company/정상'])

      expect(summaryResult.status, summaryResult.stderr).toBe(0)
      expect(wikiResult.status, wikiResult.stderr).toBe(0)
      // 앵커: 죽지 않았을 뿐 아니라 **정상 문서는 실제로 서빙된다**.
      expect(JSON.parse(wikiResult.stdout)).not.toBeNull()
    },
  )
})
