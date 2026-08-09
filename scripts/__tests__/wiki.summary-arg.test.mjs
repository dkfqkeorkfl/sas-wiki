// @vitest-environment node
//
// v3 P4 · Task 3 — `wiki.mjs --summary <경로>` **필수 인자화** (D27) — tdd §3.2 (SUM-1~SUM-4)
//
// 무엇이 결함인가: 나머지 3 CLI 는 전부 산출/입력 경로를 **명시 인자**로 받는데(`summary --out` ·
//   `feeds --out` · `validate --out`) `wiki.mjs` 만 `artifactPath(vaultDir, env)` 로 경로를
//   **스스로 유추**한다(`wiki.mjs:39`·`:44`). 호출자가 소유해야 할 좌표를 스크립트가 파생하면
//   미래 소비자(Rust 서버)가 같은 파생을 복제해야 하고, 두 벌이 갈리는 순간 조용히 어긋난다.
//
// RED 사유:
//   · SUM-1 — **RED**. 오늘은 `--summary` 없이도 파생으로 동작해 **exit 0** 이다.
//   · SUM-2 — **RED**. 오늘 `--summary` 는 unknown option 이라 `parseArgs`(strict)가 throw →
//     `wiki.mjs:83-86` 의 `.catch` 가 **양쪽 다 exit 1** 로 만든다. 두 사유가 갈리지 않는다.
//   · SUM-3 — **RED**. 같은 사유(unknown option → exit 1).
//   · SUM-4 — 🟢**앵커(오늘도 green · RED 아님)**. 아래 케이스 주석 참조.
//
// ★ 왜 이 파일이 따로 있는가(tdd §2.3 결정 ②): `SUM-*` 은 **exit code · stderr 어휘**를 무는
//   프로세스 경계 케이스라 in-process 순수 파일(`wiki.single-doc.test.mjs`)에 들어갈 수 없고,
//   `cli.env-enum.test.mjs` 는 주제가 **env 열거**라 인자 계약을 얹으면 파일 주제가 흐려진다.
//
// ★ exit code 분담(규범 O): 미지정 = **2**(인자 계약 · `main()` 이 종료를 소유) / 부재 경로 = **1**
//   (런타임 · 현행 throw 유지). 「안전선을 발명하지 마라」 — 함수층(`wiki()`)에 미지정 검사를
//   넣는 것이 아니라 `main()` 이 판정한다.
//
// 관측 층: 이 파일은 **프로세스 경계만** 본다 — exit code · stdout · stderr. 실 spawn 이다.
// 규범 A: 경로 조각·종료코드·ref 는 전부 **리터럴**이다(`artifact.mjs` 를 import 하지 않는다 —
//   그 함수는 이 Task 가 제거하는 대상이기도 하다).
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prebuildArtifacts } from './helpers/prebuild-artifacts.mjs'
import { cleanup, commit, initVault, writeDoc } from './helpers/tmp-git-vault.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SCRIPT_DIR = path.resolve(HERE, '..')
const WIKI = path.join(SCRIPT_DIR, 'wiki.mjs')

const ID_A = '0192a000-0000-7000-8000-0000000000aa'
const ACTIVE_REF = 'company/삼성전자'

/** 종료코드 — `argparse`/`clap` 관례(사용법 오류 = 2 · 런타임 실패 = 1). 리터럴이다. */
const EXIT_ARG_CONTRACT = 2
const EXIT_RUNTIME = 1

/** `--summary` 에 넘길 **vault 상대** 경로 — 리터럴이다. 해석 기준이 `--vault` 임을 SUM-3 이 문다. */
const REL_SUMMARY_DEV = 'cache/summary.dev.json'

/** summary 아티팩트 절대 경로 — **리터럴 조립**(규범 A). 정확 형태의 계약은 PL9 가 한 번만 고정한다. */
const summaryFile = (vault, env) => path.join(vault, 'cache', `summary.${env}.json`)

const tmps = []
afterAll(() => cleanup(...tmps))

/**
 * 절대 스크립트 경로로 실행한다(cwd 무관 재현) + **cwd 주입 지원**(SUM-3 의 디코이).
 *
 * `GIT_CONFIG_*` 주입은 `cli-contract.test.mjs:52-67`·`cli.env-enum.test.mjs:60-71` 관례다 —
 * vitest 가 `GIT_CONFIG_GLOBAL=/dev/null` 로 전역 safe.directory 예외를 지우므로 9p/컨테이너에서
 * 소유자가 다르면 자식 git 이 dubious-ownership 로 죽는다. `SOURCE_DATE_EPOCH` 는 결정성 관례다.
 *
 * 규범 D: 헬퍼에 `expect` 를 두지 않는다 — spawn 결과를 그대로 돌려준다.
 */
function runCli(script, args, { cwd } = {}) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd,
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

let VAULT
let DECOY_CWD

beforeAll(async () => {
  VAULT = initVault()
  tmps.push(VAULT)
  writeDoc(VAULT, ACTIVE_REF, {
    body: '## 정의\n\n삼성 본문이다.\n',
    id: ID_A,
    title: '삼성전자',
    type: 'company',
  })
  commit(VAULT, 'chore: active 1건 생성')
  await prebuildArtifacts(VAULT, 'dev')

  // 디코이 — **cwd 기준 해석 구현을 판별하는 유일한 장치**다(SUM-3). 같은 상대 경로
  //   `cache/summary.dev.json` 가 **두 곳에 실재**하고 **서로 다른 답**을 낸다: vault 쪽은 문서를
  //   주고, 디코이 쪽은 `docs: []` 라 `null` 을 준다. 디코이가 없으면 「cwd 기준」 구현도 통과한다.
  // ★ 봉투는 **실 아티팩트에서 복사**하고 `docs` 만 비운다(WK10 과 같은 형태) — `schemaVersion` 을
  //   테스트가 다시 적으면 그 숫자가 어긋날 때 디코이가 stale 로 접혀 앵커가 조용히 죽는다.
  DECOY_CWD = mkdtempSync(path.join(tmpdir(), 'wiki-summary-decoy-'))
  tmps.push(DECOY_CWD)
  const healthy = JSON.parse(readFileSync(summaryFile(VAULT, 'dev'), 'utf8'))
  mkdirSync(path.join(DECOY_CWD, 'cache'), { recursive: true })
  writeFileSync(
    path.join(DECOY_CWD, 'cache', 'summary.dev.json'),
    JSON.stringify({ ...healthy, docs: [], tags: {}, tree: [] }),
  )
}, 300_000)

describe('`--summary` 미지정은 인자 계약 위반이다 (SUM-1 · 🔴RED 오늘 exit 0)', () => {
  it('SUM-1: `--summary` 없이 실행하면 **exit 2** 이고 stderr 가 `--summary` 를 말한다', () => {
    const missing = runCli(WIKI, ['--vault', VAULT, '--env', 'dev', '--path', ACTIVE_REF])

    expect(missing.status).toBe(EXIT_ARG_CONTRACT)
    expect(missing.stderr).toContain('--summary')
    expect(missing.stdout).toBe('')

    // 앵커(케이스 내): **같은 vault·같은 문서**에 유효한 `--summary` 를 실으면 exit 0 이고 그 문서가
    //   나온다 → 「무엇을 줘도 exit 2」인 과잉 구현을 배제한다.
    const supplied = runCli(WIKI, [
      '--vault',
      VAULT,
      '--env',
      'dev',
      '--path',
      ACTIVE_REF,
      '--summary',
      summaryFile(VAULT, 'dev'),
    ])
    expect(supplied.status).toBe(0)
    expect(JSON.parse(supplied.stdout).path).toBe(ACTIVE_REF)
  })
})

describe('두 실패는 다른 코드·다른 어휘다 (SUM-2 · 🔴RED 오늘 둘 다 exit 1)', () => {
  it('SUM-2: 미지정 = **2**(인자 계약) · 부재 경로 = **1**(런타임 · 「빌드」 어휘)', () => {
    // ★ 이 케이스가 없으면 exit 분담을 무는 케이스가 **하나도 없다** — `PU6`
    //   (`serving.cost-profile.test.mjs`)는 `not.toBe(0)` 이라 2 와 1 을 가르지 못한다.
    // ⚠️ 부재 메시지의 「빌드」 어휘 pin 은 계속 `PU6` 가 소유한다. 여기서는 **분담**을 문다.
    const missing = runCli(WIKI, ['--vault', VAULT, '--env', 'dev', '--path', ACTIVE_REF])
    const absent = runCli(WIKI, [
      '--vault',
      VAULT,
      '--env',
      'dev',
      '--path',
      ACTIVE_REF,
      '--summary',
      path.join(VAULT, 'cache', '없는-아티팩트.json'),
    ])

    expect([missing.status, absent.status]).toEqual([EXIT_ARG_CONTRACT, EXIT_RUNTIME])
    expect(missing.stderr).toContain('--summary')
    expect(absent.stderr).toMatch(/빌드|build/i)
    expect(absent.stdout).toBe('')
  })
})

describe('상대 경로는 `--vault` 기준이다 (SUM-3 · 🔴RED 오늘 unknown option)', () => {
  it('SUM-3: cwd 에 같은 상대 경로가 **실재해도** vault 쪽을 읽는다', () => {
    // `RESOLVE_FROM_VAULT` — `summary.mjs:94-96`·`validate.mjs:220-222`·`feeds.mjs:181-183` 과
    //   같은 계약이다. cwd 기준으로 풀면 호출자가 어디서 부르느냐에 따라 답이 달라진다.
    const fromVault = runCli(
      WIKI,
      ['--vault', VAULT, '--env', 'dev', '--path', ACTIVE_REF, '--summary', REL_SUMMARY_DEV],
      { cwd: DECOY_CWD },
    )

    expect(fromVault.status).toBe(0)
    expect(JSON.parse(fromVault.stdout).path).toBe(ACTIVE_REF)

    // 앵커(케이스 내): **디코이가 실제로 판별력을 갖는다** — 같은 실행에서 디코이를 절대경로로
    //   직접 지정하면 `docs: []` 라 `null` 이 나온다. 이 행이 없으면 위 단언은 「디코이가 애초에
    //   읽히지 않는 쓰레기 파일」이어도 통과한다(WC5 의 디코이 설계와 동형).
    const fromDecoy = runCli(
      WIKI,
      [
        '--vault',
        VAULT,
        '--env',
        'dev',
        '--path',
        ACTIVE_REF,
        '--summary',
        path.join(DECOY_CWD, 'cache', 'summary.dev.json'),
      ],
      { cwd: DECOY_CWD },
    )
    expect(fromDecoy.status).toBe(0)
    expect(JSON.parse(fromDecoy.stdout)).toBeNull()
  })
})

describe('검증 순서는 `--env` 먼저다 (SUM-4 · 🟢앵커(오늘도 green · RED 아님))', () => {
  it('SUM-4: env 오타 + summary 미지정 → **env 사유**로 죽는다(`--summary` 를 말하지 않는다)', () => {
    // ★★ **이 케이스는 RED 가 아니다.** 오늘은 `--summary` 검사 자체가 없어 세 단언이 전부 참이다
    //   (공허 참). 그럼에도 지금 쓰는 이유는 **C4 착륙 이후**에만 값어치가 생기기 때문이다:
    //   GREEN 이 검증 순서를 뒤집으면(summary 를 먼저 보면) 이 케이스가 red 가 된다.
    //   ★ 이 케이스가 없으면 순서 역전이 `EV2`·`EV5` 를 **동시에** red 로 만들어 사유가
    //     「env 를 안 잡는다」로 오독된다(plan Risks · CX-3).
    //   짝은 SUM-1 이다(정상 env + summary 미지정 → `--summary` 문면).
    const result = runCli(WIKI, ['--vault', VAULT, '--env', 'Dev'])

    expect(result.status).toBe(EXIT_ARG_CONTRACT)
    // 앵커: 유효값 제시라는 성질(clap `[possible values: …]` 형태). 문구는 리터럴로 박지 않는다.
    expect(result.stderr).toContain('dev')
    expect(result.stderr).toContain('prod')

    expect(result.stderr).not.toContain('--summary')
  })
})
