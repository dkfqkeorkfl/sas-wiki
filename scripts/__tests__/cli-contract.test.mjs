// @vitest-environment node
//
// P1 — sas-wiki CLI 계약 정비 (D3): `--vault` 필수→선택(기본값 = 스크립트 자기 리포 루트), 순수 함수
//   `vault` 인자 필수 유지, package.json 사람용 스크립트. RED 운반체 — tdd.md(P1.cli-contract) 케이스
//   매트릭스 C1~C6·V1·V2·T3 을 그대로 담는다.
//
// 실행 대상은 **절대 스크립트 경로**(cwd 무관 재현). subprocess 는 CLI 계약 회귀에만 쓰고(runCli),
//   순수 함수(C5)는 직접 import 로 격리 단언한다. 시딩은 helpers/tmp-git-vault(정상 원자만; 결함은
//   각 스펙 본문에서 한 곳만 주입).
//
// RED/green 지도 (저작 시점) — 각 케이스 헤더에 재명시:
//   RED 단계에서 실패했던 케이스: C1 · C4a · C6 · V1 · T3
//        사유: 당시 main()/validate parseArgs 의 `if(!vault) throw '--vault is required'`(성공 경로도
//        exit 1) · package.json 미추가. 첫 단언(status===0 / scripts.summary===…)이 clean assertion
//        으로 실패했다(문법/셋업 오류 아님 = 유효 RED).
//   당시에도 green 이던 회귀·대조 컨트롤: C2 · C3 · C4b · C5 · V2
//
// 비공허성(vacuity 방지): 각 단언은 tdd.md "무엇을 깨면 red" 를 반영한다 — status 만이 아니라
//   페이로드 실질(docs.length>0 · id 포함/제외 · null · sourceCommit 동일 · throw)을 확인한다.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// 순수 함수는 직접 import 로 격리 단언한다(C5) — vault 기본값이 없음을(= undefined 흡수 안 함) 확인.
import { feeds } from '../feeds.mjs'
// summary 는 P4 에서 `lib/summary-endpoint.mjs` 로 옮겼다 — `summary.mjs` 는 생성기 CLI 전용이 되고
//   판정 경로가 렌더 툴체인을 정적 import 하지 않게 하려면 이 export 가 그 파일에 있으면 안 된다(D-A).
import { summary } from '../lib/summary-endpoint.mjs'
import { wiki } from '../wiki.mjs'

import { summaryArtifactPath } from './helpers/prebuild-artifacts.mjs'
import { cleanup, commit, initVault, writeDoc } from './helpers/tmp-git-vault.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SCRIPT_DIR = path.resolve(HERE, '..') // /…/sas-wiki/scripts
const REPO_ROOT = path.resolve(HERE, '..', '..') // /…/sas-wiki (기본값이 파생해야 하는 루트)

const SUMMARY = path.join(SCRIPT_DIR, 'summary.mjs')
const FEEDS = path.join(SCRIPT_DIR, 'feeds.mjs')
const WIKI = path.join(SCRIPT_DIR, 'wiki.mjs')
const VALIDATE = path.join(SCRIPT_DIR, 'validate.mjs')
const PACKAGE_JSON = path.join(REPO_ROOT, 'package.json')

const ID_A = '0192a000-0000-7000-8000-0000000000aa' // active, prod 가시
const ID_DRAFT = '0192b000-0000-7000-8000-0000000000bb' // dev/ 폴더 = draft

// validate.cli.test.mjs:74 runCli 를 mirror + cwd 옵션. 절대 스크립트 경로라 cwd 는 기본값 파생을
//   흔들지 못해야 한다(C6 가 이를 증명). SOURCE_DATE_EPOCH 는 결정성 관례(기존 CLI 테스트 동일).
function runCli(script, args, { cwd } = {}) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd,
    encoding: 'utf8',
    // vitest 가 GIT_CONFIG_GLOBAL=/dev/null 로 전역 safe.directory 예외를 지우므로, 9p/컨테이너에서
    //   기본 vault(=실 repo)가 러너와 다른 소유자면 자식 git 이 dubious-ownership 로 죽는다. safe.directory=*
    //   를 자식 env 로 주입해 방어(build.uuidv7-e2e.test.mjs 관례). C1/C4a/C6/V1(실 repo) 필수·tmp 케이스 무해.
    env: {
      ...process.env,
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'safe.directory',
      GIT_CONFIG_VALUE_0: '*',
      SOURCE_DATE_EPOCH: '1700000000',
    },
  })
}

/**
 * 실 repo(REPO_ROOT) 를 spawn 하는 케이스 전용 타임아웃 — **OQ-P1-2 (c) 「케이스별 `{ timeout: N }`」**
 * 의 적용이다(plan 결정 ⑧ / tdd §2.6). 전역 상향은 **금지**다(모든 케이스의 hang 감지가 둔해진다),
 * 선제적으로도 올리지 않는다 — 대상은 **실측으로 확정**했다.
 *
 * ★ 원인은 구현 결함이 아니라 **실 repo 생성기 spawn 비용**이다. Task 5 가 skip 블록(`readFreshSet`·
 *   `--force`)을 없애 이제 매 실행이 vault 를 전량 재계산하므로, 이 컨테이너(9p 마운트)에서 1회
 *   **25~31초**가 든다. 기본 `testTimeout: 30000` 은 그 비용 **하나**를 겨우 담는 크기다.
 *   ☞ 테스트를 느슨하게 한 것이 아니다. 느슨해진 쪽이 있다면 그것은 **문턱이 아니라 워크로드**다.
 *
 * 실측(2026-08-01 · 기본 설정 1회 실행):
 *   | C1-summary | 30,975ms | 초과                                     |
 *   | C6         | 51,546ms | 초과 — 실 repo 생성기를 **2회** spawn 한다 |
 *   | V1         | 41,198ms | 초과                                     |
 *   | C4a-summary| 29,395ms | 문턱의 **98%** — 부하가 조금만 올라가면 넘는다 |
 *
 * ★ `C1`·`C4a` 는 `it.each` 3 arm 이고 **arm 별 타임아웃은 API 상 불가능**하다(`EachFunctionReturn`:
 *   `(name, options|timeout, fn)` — 값이 **그룹당 하나**다). 두 그룹의 나머지 arm 도 같은 실 repo
 *   spawn 계열이라(`wiki` 12~13초) 그룹 단위 적용이 뜻과 어긋나지 않는다.
 */
const REAL_REPO_SPAWN_TIMEOUT = 120_000

// 생성한 tmp 는 전부 등록 후 afterAll 에서 일괄 정리(누수 0).
const tmps = []
function makeVault() {
  const vault = initVault()
  tmps.push(vault)
  return vault
}

// 존재하지 않는 vault 경로(부모는 존재, 자식은 미생성) — C4b 의 에러 경로 입력.
const ABSENT_BASE = mkdtempSync(path.join(tmpdir(), 'wiki-cli-absent-'))
tmps.push(ABSENT_BASE)
const ABSENT_VAULT = path.join(ABSENT_BASE, 'no-such-vault')

afterAll(() => cleanup(...tmps))

// 실 repo(REPO_ROOT) 산출물 프리빌드 — `--vault` 생략 경로(C1·C4a·C6)가 읽을 아티팩트를 만든다.
//   "앞서 누가 만들어 뒀는지" 에 기대지 않으려면 이 파일이 스스로 만들어야 한다.
//
// ★ **in-process 프리빌드를 쓰지 않는다.** `vitest.config.js` 가 `GIT_CONFIG_GLOBAL=/dev/null` 로 git
//   설정을 의도적으로 격리하는데(개발자 `~/.gitconfig` 가 identity 를 몰래 공급하는 것 차단 — 이
//   격리는 옳다), 이 컨테이너의 실 repo 는 러너와 소유자가 달라 격리된 git 이 `safe.directory` 예외를
//   못 보고 **dubious ownership 으로 거부**한다. 러너 프로세스 안에서 생성기를 부르면 그 자리에서
//   `beforeAll` 이 죽고 **이 파일 19케이스가 통째로 가려진다**(suite 레벨 실패 · 실측).
//   위 `runCli`(:53-68)는 자식 env 에 `safe.directory=*` 를 주입하는 **이 파일이 이미 채택한 관례**라,
//   프리빌드를 그 통로에 태우면 같은 방어를 그대로 받는다(환경 우회를 새로 심는 것이 아니다).
//
// ★ **Task 7(C4) 착륙 시 `--out <경로>` 로 바꾼다.** OT1 이 _"`--out` 미지정 실행은 어떤 파일도 만들지
//   않는다"_ 를 계약으로 세우므로 그 뒤에는 아래 형태가 아무것도 만들지 않는다. 그때 조용히 빈손이
//   되지 않도록 exit 0 과 **산출물 실재**를 함께 문다 — 프리빌드가 실패하면 여기서 크게 터진다.
beforeAll(() => {
  const prebuilt = runCli(SUMMARY, ['--vault', REPO_ROOT, '--env', 'dev'])

  expect(prebuilt.status, prebuilt.stderr).toBe(0)
  expect(
    existsSync(summaryArtifactPath(REPO_ROOT, 'dev')),
    '프리빌드가 exit 0 인데 산출물이 없다',
  ).toBe(true)
}, 300_000)

// ── C1: 3 스크립트 parametrize — --vault 생략 + --env dev(cwd=repo) → exit0 · 유효 JSON · 페이로드 실질.
//    RED 단계에서는 `if(!vault) throw` 존치 → exit1 → status 단언 실패. (docs.length>0 는 REPO_ROOT
//       오파생(`wiki` 부재 → 빈 docs)까지 잡는다 — 단순 exit0 이 아니다.)
const C1_CASES = [
  { assert: (p) => expect(p.docs.length).toBeGreaterThan(0), args: ['--env', 'dev'], name: 'summary', script: SUMMARY }, // prettier-ignore
  // ★ v3 P2 · D15(§4.5-③ arm 갱신) — `--count` 는 CLI 필수다. 안 실으면 이 arm 의 red 사유가
  //   「기본 vault 파생이 틀렸다」에서 「인자가 모자라다」로 조용히 바뀐다(규범 P).
  { assert: (p) => expect(Array.isArray(p.items)).toBe(true), args: ['--env', 'dev', '--count', '5'], name: 'feeds', script: FEEDS }, // prettier-ignore
  // ★ v3 P4 · D27(§4.1 arm 갱신) — `--summary` 는 CLI 필수다. 안 실으면 이 arm 의 사유가
  //   「기본 vault 파생이 틀렸다」에서 「인자가 모자라다」로 조용히 바뀐다(규범 P · 위 feeds 와 같다).
  //   ★ **상대 경로**를 준다 — 그래야 `--vault` 기본값(REPO_ROOT) 파생이 이 arm 의 판정에 계속 걸린다
  //     (기본값이 틀리면 아티팩트를 못 읽어 exit 1 이다). 이 케이스가 무는 것은 기본 vault 파생이다.
  { assert: (p) => expect(p).toBeNull(), args: ['--env', 'dev', '--path', 'no/such', '--summary', 'cache/summary.dev.json'], name: 'wiki', script: WIKI }, // prettier-ignore
]

describe('C1 — 기본 vault(REPO_ROOT) · --vault 생략 (RED 단계 회귀 가드)', () => {
  // timeout: OQ-P1-2 (c) — summary arm 실측 **30,975ms**(> 기본 30s). 사유·측정표는
  //   `REAL_REPO_SPAWN_TIMEOUT` 주석 참조. arm 별 지정은 `it.each` API 상 불가능하다.
  it.each(C1_CASES)(
    '$name: --env dev(cwd=repo) → exit0 · 1건 유효 JSON · 페이로드 계약',
    { timeout: REAL_REPO_SPAWN_TIMEOUT },
    ({ args, assert, script }) => {
      const result = runCli(script, args, { cwd: REPO_ROOT })

      expect(result.status).toBe(0) // RED 단계 신호였던 단언. 아래 JSON.parse 전에 clean 실패했다.
      const payload = JSON.parse(result.stdout)
      assert(payload)
    },
  )
})

// ── C2: override 존중 — --vault <tmp seed(ID_A)> --env dev → docs 에 ID_A. 🟢 green(회귀).
//    무엇을 깨면 red: GREEN 이 override 무시하고 REPO_ROOT 를 **과잉** 적용 → ID_A 부재 → red.
describe('C2 — --vault override 존중 (🟢 회귀)', () => {
  it('summary --vault <tmp seed(ID_A)> --env dev → exit0 · docs 에 ID_A', () => {
    const vault = makeVault()
    writeDoc(vault, 'company/삼성전자', { id: ID_A, title: '삼성전자', type: 'company' })
    commit(vault, 'chore: 삼성전자 생성')

    const result = runCli(SUMMARY, ['--vault', vault, '--env', 'dev'])

    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout).docs.map((doc) => doc.id)).toContain(ID_A)
  })
})

// ── C3: env 배선이 강등과 무관함 고정 — (a) --env 생략(=prod) → draft 제외, (b) --env dev → draft 포함.
//    🟢 green(회귀). 무엇을 깨면 red: GREEN 이 env{default:'prod'} 를 훼손 → (a) 에서 draft 누출.
//    ID_A 존재도 함께 단언해 "docs 가 비어 not.toContain 이 공허히 통과" 하는 vacuity 를 막는다.
describe('C3 — env 기본값(prod) 무변경 · draft 필터 (🟢 회귀)', () => {
  it('--env 생략 → draft 제외 · --env dev → draft 포함', () => {
    const vault = makeVault()
    writeDoc(vault, 'company/삼성전자', { id: ID_A, title: '삼성전자', type: 'company' })
    writeDoc(vault, 'dev/실험문서', { id: ID_DRAFT, title: '실험 문서', type: 'concept' })
    commit(vault, 'chore: active + draft 생성')

    const prod = runCli(SUMMARY, ['--vault', vault]) // --env 생략 → parseArgs default 'prod'
    expect(prod.status).toBe(0)
    const prodIds = JSON.parse(prod.stdout).docs.map((doc) => doc.id)
    expect(prodIds).toContain(ID_A) // active 는 항상 보인다(비공허)
    expect(prodIds).not.toContain(ID_DRAFT) // draft 는 prod 에서 숨는다

    const dev = runCli(SUMMARY, ['--vault', vault, '--env', 'dev'])
    expect(dev.status).toBe(0)
    expect(JSON.parse(dev.stdout).docs.map((doc) => doc.id)).toContain(ID_DRAFT)
  })
})

// ── C4a: 성공 경로 stdout = 정확히 1줄 JSON(선/후행 비-JSON 0). RED 단계에서는 exit1·stdout 0.
//    무엇을 깨면 red(GREEN 후): main() 에 디버그 log 혼입 → 2줄 → lines 단언 실패 / 파싱 throw.
const C4A_CASES = [
  { args: ['--env', 'dev'], name: 'summary', script: SUMMARY },
  // ★ v3 P2 · D15(§4.5-③ arm 갱신) — 같은 사유. 이 케이스가 무는 것은 stdout 순수성이지 인자 개수가 아니다.
  { args: ['--env', 'dev', '--count', '5'], name: 'feeds', script: FEEDS },
  // ★ v3 P4 · D27(§4.1 arm 갱신) — 같은 사유. 이 케이스가 무는 것은 stdout 순수성이지 인자 개수가 아니다.
  { args: ['--env', 'dev', '--summary', 'cache/summary.dev.json'], name: 'wiki', script: WIKI },
]

describe('C4a — stdout 순수(정확히 1줄 JSON) (RED 단계 회귀 가드)', () => {
  // timeout: OQ-P1-2 (c) — summary arm 실측 **29,395ms** = 기본 30s 의 **98%**. 통과했지만 부하가
  //   조금만 올라가면 넘는다(같은 일을 하는 C1-summary 는 같은 실행에서 30,975ms 로 실제 초과했다).
  //   「선제적 상향 금지」가 막는 것은 *측정 없는* 상향이고, 98% 는 그 자체가 측정이다.
  it.each(C4A_CASES)(
    '$name: --env dev(--vault 생략) → stdout 은 단 1줄의 파싱 가능한 JSON',
    { timeout: REAL_REPO_SPAWN_TIMEOUT },
    ({ args, script }) => {
      const result = runCli(script, args, { cwd: REPO_ROOT })

      expect(result.status).toBe(0) // RED 단계 신호였던 단언.
      const lines = result.stdout.split('\n').filter((line) => line.length > 0)
      expect(lines).toHaveLength(1) // 선행/후행 비-JSON 로그 0
      expect(() => JSON.parse(result.stdout)).not.toThrow()
    },
  )
})

// ── C4b: 에러 채널 분리 — --vault <존재X> --env dev → exit≠0 · stdout 비어있음 · stderr 에 에러.
//    🟢 green(회귀). 무엇을 깨면 red: 에러를 stdout 으로 흘리거나 부분 JSON 방출.
const C4B_CASES = [
  { name: 'summary', script: SUMMARY },
  { name: 'feeds', script: FEEDS },
  { name: 'wiki', script: WIKI },
]

describe('C4b — 에러는 stderr, stdout 무오염 (🟢 회귀)', () => {
  it.each(C4B_CASES)(
    '$name: --vault <존재X> --env dev → exit≠0 · stdout="" · stderr 에 에러',
    ({ script }) => {
      const result = runCli(script, ['--vault', ABSENT_VAULT, '--env', 'dev'])

      expect(result.status).not.toBe(0)
      expect(result.stdout).toBe('') // 부분 JSON 0
      expect(result.stderr.length).toBeGreaterThan(0)
    },
  )
})

// ── C5: 순수 함수 격리 불변식 — 직접 호출은 vault 기본값으로 흡수하지 않고 **throw**. 🟢 green(대조).
//    무엇을 깨면 red: GREEN 이 순수 summary/feeds/wiki 에 `vault = vault ?? REPO_ROOT` 를 부여하면
//    undefined 가 흡수돼 throw 안 함 → red. (기본값은 오직 main()/validate parseArgs 의 imperative shell.)
describe('C5 — 순수 함수는 vault 기본값을 흡수하지 않는다(격리 불변) (🟢 대조)', () => {
  // **seam 가드 — 이 케이스는 실제로 한 번 조용히 공허해졌다.** P4 가 `summary` 를
  //   `lib/summary-endpoint.mjs` 로 옮겼을 때 여기 import 경로가 낡은 채였고, Vite SSR 은 미존재
  //   named export 를 link error 가 아니라 **`undefined`** 로 준다. 그래서 `summary(...)` 가
  //   "undefined 를 호출해서" TypeError 를 냈고 `toThrow()` 는 **통과**했다 — collection error 조차
  //   나지 않아 red 로 드러나지도 않았다. 아래 세 줄이 그 상태를 다시 만들 수 없게 한다.
  it('세 순수 함수가 실제로 함수로 로드됐다 (import 드리프트 방지)', () => {
    expect(typeof summary).toBe('function')
    expect(typeof feeds).toBe('function')
    expect(typeof wiki).toBe('function')
  })

  it('summary(undefined, "dev") → throw', () => {
    expect(() => summary(undefined, 'dev')).toThrow()
  })

  // P5 · §4 원장 ㉖-a — `feeds`·`wiki` 가 async 가 됐다(신선도 확보가 `runSummaryGenerator` 재사용이라
  //   async 다). 동기 `toThrow()` 는 `rejects.toThrow()` 로 번역한다 — **의도·강도는 무변경**(vault
  //   기본값 미흡수 격리 불변식). 규범 C10 seam 가드를 함께 둔다(모듈이 죽어서 통과하는 모양 배제).
  it('feeds(undefined, "dev") → reject', async () => {
    expect(typeof feeds).toBe('function')
    await expect(feeds(undefined, 'dev')).rejects.toThrow()
  })

  it('wiki(undefined, "dev", "") → reject', async () => {
    expect(typeof wiki).toBe('function')
    await expect(wiki(undefined, 'dev', '')).rejects.toThrow()
  })
})

// ── C6: 기본값이 import.meta.url 파생(≠ cwd) 임을 증명 — cwd=os.tmpdir() 에서도 REPO_ROOT 를 읽는다.
//    RED 단계에서는 exit1. 무엇을 깨면 red(GREEN 후): 기본값을 process.cwd() 파생으로 하면 tmpdir 에
//    `wiki` 부재 → red. 두 cwd 의 sourceCommit 동일 = 같은 REPO_ROOT 확증.
describe('C6 — 기본 vault 는 cwd 무관(import.meta.url 파생) (RED 단계 회귀 가드)', () => {
  // timeout: OQ-P1-2 (c) — 실측 **51,546ms**. 이 케이스만 실 repo 생성기를 **2회** spawn 한다
  //   (cwd=repo · cwd=tmpdir 대조) → 1회 25~31초의 두 배라 기본 30s 로는 구조적으로 불가능하다.
  it(
    'summary --env dev(--vault 생략), cwd=tmpdir → exit0 · docs>0 · sourceCommit=cwd repo 실행값',
    { timeout: REAL_REPO_SPAWN_TIMEOUT },
    () => {
      const inRepo = runCli(SUMMARY, ['--env', 'dev'], { cwd: REPO_ROOT })
      const inTmp = runCli(SUMMARY, ['--env', 'dev'], { cwd: tmpdir() })

      expect(inTmp.status).toBe(0) // RED 단계 신호였던 단언. 아래 parse 전에 clean 실패했다.
      const tmpPayload = JSON.parse(inTmp.stdout)
      expect(tmpPayload.docs.length).toBeGreaterThan(0)
      // cwd 만 다르고 대상 리포는 같아야 한다 → HEAD sourceCommit 이 동일.
      expect(tmpPayload.sourceCommit).toBe(JSON.parse(inRepo.stdout).sourceCommit)
    },
  )
})

// ── V1: validate 도 동일 강등 — --env dev(--vault 생략) → exit0 · stats stdout(`[wiki] docs=`).
//    RED 단계에서는 parseArgs:122 throw. validate 는 JSON 이 아니라 stats 를 stdout 에 낸다(다른 계약).
describe('V1 — validate 기본 vault(REPO_ROOT) (RED 단계 회귀 가드)', () => {
  // timeout: OQ-P1-2 (c) — 실측 **41,198ms**(> 기본 30s). `validate.mjs` 도 실 repo 를 전량 훑는다.
  it(
    'validate --env dev(--vault 생략) → exit0 · stdout 에 "[wiki] docs="',
    { timeout: REAL_REPO_SPAWN_TIMEOUT },
    () => {
      const result = runCli(VALIDATE, ['--env', 'dev'], { cwd: REPO_ROOT })

      expect(result.status).toBe(0) // RED 단계 신호였던 단언.
      expect(result.stdout).toContain('[wiki] docs=')
    },
  )
})

// ── V2: env fail-closed 불변 — --vault <tmp> --env staging → exit≠0 · dev|prod 거부. 🟢 green(회귀).
//    무엇을 깨면 red: 강등 리팩터가 validate 의 unknown-env fail-closed 를 깨면 staging 이 통과.
describe('V2 — validate unknown-env 거부(fail-closed) (🟢 회귀)', () => {
  it('validate --vault <tmp> --env staging → exit≠0 · 출력에 dev|prod 거부', () => {
    const vault = makeVault()

    const result = runCli(VALIDATE, ['--vault', vault, '--env', 'staging'])

    expect(result.status).not.toBe(0)
    expect(`${result.stderr}${result.stdout}`).toMatch(/dev\|prod/)
  })
})

// ── T3: package.json 정적 드리프트 — 사람용 스크립트 추가 · validate 에서 `--vault` 제거.
//    RED 단계에서는 scripts.summary undefined · validate 에 `--vault .` 잔존.
describe('T3 — package.json 사람용 스크립트 (RED 단계 회귀 가드)', () => {
  it('scripts.summary/feeds/wiki 는 node 직행 · validate 에 --vault 없음', () => {
    const pkg = JSON.parse(readFileSync(PACKAGE_JSON, 'utf8'))

    expect(pkg.scripts.summary).toBe('node scripts/summary.mjs')
    // ★ v3 P2 · D15 — `--count` 가 필수 인자가 됐다(§4.5-⑤ flip). 사람용 스크립트도 그것을 실어야
    //   `pnpm run feeds` 가 exit 2 로 죽지 않는다. CQ4 가 「`--count` 를 싣는다」를 성질로 물고,
    //   여기서는 **정확 문자열**로 못박는다(소비자가 파일명을 spawn 하므로 형태가 계약이다).
    expect(pkg.scripts.feeds).toBe('node scripts/feeds.mjs --count 40')
    // ★ v3 P4 · D27 — `--summary` 가 필수 인자가 됐다(D-P4-1 flip). 사람용 스크립트도 그것을 실어야
    //   `pnpm run wiki` 가 exit 2 로 죽지 않는다. 위 `feeds` 줄과 **같은 사유·같은 형태**다 —
    //   SUM-1 이 「미지정은 exit 2」를 성질로 물고, 여기서는 **정확 문자열**로 못박는다
    //   (소비자가 파일명을 spawn 하므로 형태가 계약이다).
    expect(pkg.scripts.wiki).toBe('node scripts/wiki.mjs --summary cache/summary.prod.json')
    expect(pkg.scripts.validate).not.toContain('--vault')
  })
})
