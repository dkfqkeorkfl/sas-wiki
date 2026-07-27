// @vitest-environment node
//
// P3 · Task 5 — 생성기 CLI 의 종료코드·stdout 계약 (**실 spawn** · P2 tier) — tdd §3.8 (XC1~XC7 · PC1~PC4)
//
// 이 파일만이 **프로세스 경계**를 넘는다(tdd §7.3 — CLI spawn 은 여기와 AT6 로 격리했다). 종료코드는
//   함수 반환값으로 대체할 수 없고, "stdout 이 정확히 1줄 JSON 인가" 도 프로세스 밖에서만 관측된다.
//
// RED 사유:
//   XC1·XC2·XC4·XC7 · PC1(flip)·PC3 — 캐시/리포트/`--out`/`--max-excluded` 개념이 아직 없다.
//   XC3(flip) — 현행도 exit 1 이지만 **산출물 부재 단언이 신설**이다.
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

import { loadSchema, validateItem } from '../lib/validate.mjs'
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
const reportJson = (vault) => path.join(vault, 'logs', 'summary.report.json')

// ────────────────────────────────────────────────────────────────────────────
// XC — 종료코드 6종
// ────────────────────────────────────────────────────────────────────────────

describe('종료코드 — 성공 경로 (XC1·XC2 · 🔴RED 미구현)', () => {
  it('XC1: 정상 vault → exit 0 · 캐시 파일 존재', () => {
    // ★ **IG 의 짝 가드**다(tdd §3.2 · §10.3-4 ②). `summary.import-graph.test.mjs`(IG1·IG6)가 무는
    //   것은 구조뿐이라, 판정 경로에서 렌더 툴체인을 뗀 나머지로 **아무것도 만들지 못하는** 구현도
    //   거기서는 green 이다. 프로세스 경계에서 산출물이 실제로 생겼음을 보는 이 케이스가 그 짝이다.
    const vault = freshClean()

    const result = runCli(SUMMARY, ['--vault', vault, '--env', 'dev'])

    expect(result.status, result.stderr).toBe(0)
    expect(existsSync(artifactFile(vault))).toBe(true)
  })

  it('XC2: 오염 vault(문턱 미지정) → **exit 0** · 리포트가 제외 2건을 담는다', () => {
    // ★ R6 "부분 성공 = exit 0". Node `execFile` 이 비-0 을 reject 하므로 부분 성공을 비-0 으로 내면
    //   dev 미들웨어가 정상 데이터를 **버린다**. 앵커를 먼저 본다 — 리포트가 실제로 제외를 담았는가.
    //   그러지 않으면 "오염을 아예 감지 못 해서 0" 인 상태와 구분되지 않는다.
    const vault = freshPolluted()

    const result = runCli(SUMMARY, ['--vault', vault, '--env', 'dev'])

    expect(existsSync(reportJson(vault)), result.stderr).toBe(true)
    expect(JSON.parse(readFileSync(reportJson(vault), 'utf8')).excluded).toHaveLength(2)
    expect(result.status).toBe(0)
    expect(existsSync(artifactFile(vault))).toBe(true)
  })
})

describe('종료코드 — 전역 실패 (XC3·XC4 · 🔴RED(flip)/RED)', () => {
  it('XC3: git 리포가 아니면 exit 1 · stdout 은 비고 · 캐시 미생성', () => {
    // ★ 위험 실재 앵커(규범 B): 이 CLI 는 **성공하면 캐시를 만든다**. 그 대조가 없으면 "실패했을 때
    //   캐시가 없다" 는 캐시 개념이 아예 없는 지금도 자동으로 참이라 단언이 공허하다.
    const healthy = freshClean()
    expect(runCli(SUMMARY, ['--vault', healthy, '--env', 'dev']).status).toBe(0)
    expect(existsSync(artifactFile(healthy))).toBe(true)

    const notARepo = mkdtempSync(path.join(tmpdir(), 'wiki-cli-nogit-'))
    tmps.push(notARepo)

    const result = runCli(SUMMARY, ['--vault', notARepo, '--env', 'dev'])

    expect(result.status).toBe(1)
    expect(result.stdout).toBe('') // 반쪽 payload 를 흘리지 않는다
    expect(result.stderr).not.toBe('')
    expect(existsSync(artifactFile(notARepo))).toBe(false)
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

    const result = runCli(SUMMARY, ['--vault', vault, '--env', 'dev', '--max-excluded=0'])

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

describe('stdout 계약 (PC1~PC3)', () => {
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

  it('PC3: 연속 2회 spawn 의 stdout 이 **바이트 동일**하고 2회차 stderr 가 hit 을 알린다', () => {
    // GN6 의 프로세스 경계 대응물. 캐시 hit 실행은 캐시 내용을 그대로 echo 해야 한다.
    const vault = freshClean()

    const first = runCli(SUMMARY, ['--vault', vault, '--env', 'dev'])
    const second = runCli(SUMMARY, ['--vault', vault, '--env', 'dev'])

    expect(first.status, first.stderr).toBe(0)
    expect(second.status, second.stderr).toBe(0)
    expect(second.stdout).toBe(first.stdout)
    expect(second.stderr).toMatch(/hit/i)
  })
})

describe('중복 id vault 가 서빙을 죽이지 않는다 (PC4 · 🔴RED(flip))', () => {
  it('PC4: `summary.mjs`·`wiki.mjs` 가 **둘 다 exit 0** 이다 (현행 실측은 둘 다 exit 1)', () => {
    // ★ plan 결함 프로브의 직접 반전 — 이 phase 의 존재 이유. 문서 하나가 깨졌다고 위키 전체가
    //   500 으로 죽는 상태를 끝낸다.
    const vault = freshPolluted()

    const summaryResult = runCli(SUMMARY, ['--vault', vault, '--env', 'dev'])
    const wikiResult = runCli(WIKI, ['--vault', vault, '--env', 'dev', '--path', 'company/정상'])

    expect(summaryResult.status, summaryResult.stderr).toBe(0)
    expect(wikiResult.status, wikiResult.stderr).toBe(0)
    // 앵커: 죽지 않았을 뿐 아니라 **정상 문서는 실제로 서빙된다**.
    expect(JSON.parse(wikiResult.stdout)).not.toBeNull()
  })
})
