// @vitest-environment node
//
// prod 전용 draft↔public 문서 ID 충돌 — 검증 CLI 표면 (DC0-CLI · DC4~DC7)
//
// 배경(자기완결): HEAD 문서 판정은 `env === 'dev'` 일 때만 draft 를 문서 게이트에 넘기고 prod 에서는
//   걸러낸다. 그래서 같은 id 를 쓰는 public + draft 가 있어도 **prod 검증이 무언 통과**한다(본 세션
//   실측: dev exit 1 · prod exit 0). 비공개 문서가 공개 문서의 정체성을 조용히 겹쳐 쓰는 상태다.
//
//   제외 게이트의 허용치 기본값이 0 이므로, 충돌 문서를 제외 목록에 넣으면 **prod 빌드가 실패**한다.
//   "보고만 하고 통과" 는 구조적으로 불가능하다 — fail-closed 가 의도된 방향이다: vault 에 실수로
//   id 를 복사하면 고치기 전에는 배포가 되지 않는다.
//
// 결과 계약(GREEN 이 만족해야 할 것):
//   ① 충돌이 있으면 `--env prod` 실행이 **실패**하고 출력이 사유(`DUPLICATE_ID`)와 두 경로를 담는다.
//   ② `--env dev` 동작은 **오늘과 동일**하다.
//   ③ 충돌이 없으면 prod·dev 모두 종전대로 통과한다 — 실 vault 형태(공개 0건 + 고유 id draft만)
//      에서도 마찬가지다.
//
// RED 사유(케이스별 · 본 세션 실측):
//   DC0-CLI — 🟢 seam 선단언. 모듈 로드 + `--help` 종료코드 0 을 먼저 못박는다.
//             ★ 이 앵커가 없으면 DC4 의 「종료코드가 0 이 아니다」가 **공허하게 green** 이 된다 —
//               CLI 가 아예 못 뜨는 상태에서도 종료코드는 0 이 아니기 때문이다.
//   DC4 — 🔴RED. 오늘 충돌 vault 의 `--env prod` 는 exit **0** 이고 사유를 한 줄도 내지 않는다.
//   DC5 — 🟢pin. 오늘 `--env dev` 는 exit 1 이고 `DUPLICATE_ID` 2건 + 두 경로를 낸다. prod 를
//         고치려다 dev 공통 경로를 건드리면 여기가 red 다.
//   DC6 — 🟢앵커. id 만 다른 대조군은 prod·dev 모두 exit 0 이다(오탐 배제).
//   DC7 — 🟢앵커. 공개 0건 + 고유 id draft 3건(= 실 vault 형태)에서 prod 가 계속 빌드된다.
//
// ★ **draft ↔ draft 충돌은 여기서 규정하지 않는다.** 계약은 draft 와 non-draft **사이**의 충돌이다.
//   요구되지 않은 규칙을 테스트로 굳히지 않는다.
//
// 규범 A: id·경로·기대 문자열은 전부 **리터럴**이다(프로덕션 상수에서 유도하지 않는다).
// 규범 N: 개수 단독 단언 금지 — 집합·출현을 리터럴 배열로 못박는다.
// 규범 B/U: 부재·성공 단언 앞에 양성 대조(같은 vault 의 반대 env)를 케이스 안에 둔다.
// 규범 D: 시딩 헬퍼에는 `expect` 를 두지 않는다.
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterAll, describe, expect, it } from 'vitest'

import { seedCollisionVault, seedDistinctVault } from './helpers/draft-id-collision-vault.mjs'
import { cleanup, commit, initVault, writeDoc } from './helpers/tmp-git-vault.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const VALIDATE = path.resolve(HERE, '..', 'validate.mjs')

const validateModule = await import(new URL('../validate.mjs', import.meta.url).href).catch(
  (error) => ({ __loadError: error instanceof Error ? error.message : String(error) }),
)

/** 규범 C10 — 각 케이스가 seam 존재를 먼저 단언한다. */
function expectSeamPresent() {
  expect(validateModule.__loadError, 'scripts/validate.mjs 로드').toBeUndefined()
  expect(typeof validateModule.buildContent, 'buildContent export').toBe('function')
  expect(typeof validateModule.parseArgs, 'parseArgs export').toBe('function')
  expect(existsSync(VALIDATE), 'scripts/validate.mjs 경로').toBe(true)
}

const ID_SHARED = '0192a000-0000-7000-8000-0000000000aa'
const ID_OTHER = '0192b000-0000-7000-8000-0000000000bb'
const ID_THIRD = '0192c000-0000-7000-8000-0000000000cc'
const PUBLIC_PATH = 'wiki/company/공개.md'
const DRAFT_PATH = 'wiki/dev/초안.md'
const COLLIDING_PATHS = [PUBLIC_PATH, DRAFT_PATH]
const EXCESS_MESSAGE = '문서 제외 2건이 허용치 0건을 초과했습니다'

const tmps = []
afterAll(() => cleanup(...tmps))

function trackVault(vault) {
  tmps.push(vault)
  return vault
}

function runCli(args) {
  return spawnSync(process.execPath, [VALIDATE, ...args], {
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

/** stdout·stderr 를 한 문자열로 — 사유가 어느 채널로 나가든 같은 못이 잡게 한다. */
const outputOf = (run) => `${run.stdout}${run.stderr}`

/** 실 vault 형태 — 공개 문서 0건 + draft 3건(전부 고유 id). prod 가시 문서가 0건이 된다. */
function seedAllDraftVault() {
  const vault = initVault()
  tmps.push(vault)
  writeDoc(vault, 'dev/초안하나', { id: ID_SHARED })
  writeDoc(vault, 'dev/초안둘', { id: ID_OTHER })
  writeDoc(vault, 'dev/초안셋', { id: ID_THIRD })
  commit(vault, 'chore: 고유 id draft 3건')
  return vault
}

describe('seam 선단언 (DC0-CLI · 🟢)', () => {
  it('DC0-CLI: `validate.mjs` 가 로드되고 `--help` 가 exit 0 이다 (🟢)', () => {
    // ★ CLI 층의 seam 은 **종료코드 앵커**다. 스크립트가 로드조차 못 하는 상태에서도 종료코드는
    //   0 이 아니므로, 이 못이 없으면 「실패해야 한다」는 단언이 파손으로도 만족된다.
    expectSeamPresent()

    expect(runCli(['--help']).status, '--help 종료코드').toBe(0)
  })
})

describe('prod 는 draft 의 공개 id 재사용에 실패한다 (DC4 · 🔴RED)', () => {
  it('DC4: 충돌 vault 의 `--env prod` 가 실패하고 사유·두 경로를 낸다 (🔴RED)', () => {
    expectSeamPresent()
    const vault = trackVault(seedCollisionVault())

    // 앵커(규범 B): **같은 vault** 를 dev 로 돌리면 오늘도 실패한다 — 픽스처가 충돌을 실제로
    //   만들었음을 먼저 증명한다. 이게 없으면 prod 단언은 "충돌이 애초에 없었다" 와 구분되지 않는다.
    expect(runCli(['--vault', vault, '--env', 'dev']).status, 'dev 종료코드 앵커').toBe(1)

    const prod = runCli(['--vault', vault, '--env', 'prod'])
    const output = outputOf(prod)

    expect(prod.status, 'prod 종료코드').not.toBe(0)
    expect(output, 'prod 출력의 사유 코드').toContain('DUPLICATE_ID')
    expect(
      COLLIDING_PATHS.map((filePath) => output.includes(filePath)),
      'prod 출력의 충돌 경로',
    ).toEqual([true, true])
  })
})

describe('dev CLI 동작은 불변이다 (DC5 · 🟢pin)', () => {
  it('DC5: 충돌 vault 의 `--env dev` 는 exit 1 · `DUPLICATE_ID` 2건이다 (🟢pin)', () => {
    expectSeamPresent()
    const dev = runCli(['--vault', trackVault(seedCollisionVault()), '--env', 'dev'])
    const output = outputOf(dev)

    expect(dev.status, 'dev 종료코드').toBe(1)
    // 규범 N: "2건" 을 세지 않고 출현 자체를 리터럴 배열로 못박는다.
    expect(output.match(/DUPLICATE_ID/gu) ?? [], 'DUPLICATE_ID 출현').toEqual([
      'DUPLICATE_ID',
      'DUPLICATE_ID',
    ])
    expect(
      COLLIDING_PATHS.map((filePath) => output.includes(filePath)),
      'dev 출력의 충돌 경로',
    ).toEqual([true, true])
    expect(output, 'dev 제외 게이트 문구').toContain(EXCESS_MESSAGE)
  })
})

describe('충돌이 없으면 종전대로 통과한다 (DC6·DC7 · 🟢앵커)', () => {
  it('DC6: id 만 다른 대조군은 prod·dev 모두 exit 0 이다 (🟢앵커 · 오탐 배제)', () => {
    // 이 못이 없으면 「prod 에서 draft 가 있으면 무조건 실패」라는 과잉 차단 구현도 DC4 를 통과한다.
    expectSeamPresent()
    const vault = trackVault(seedDistinctVault())

    expect(runCli(['--vault', vault, '--env', 'prod']).status, 'prod 종료코드').toBe(0)
    expect(runCli(['--vault', vault, '--env', 'dev']).status, 'dev 종료코드').toBe(0)
  })

  it('DC7: 공개 0건 + 고유 id draft 3건이면 prod 가 계속 빌드된다 (🟢앵커)', () => {
    // 실 vault 가 정확히 이 형태다(전 문서가 draft · id 전부 고유 → prod 가시 문서 0건). 충돌 검출을
    //   "draft 를 prod 판정에 넣는다" 로 넓게 구현하면 여기서 red 가 난다.
    expectSeamPresent()
    const vault = seedAllDraftVault()

    const prod = runCli(['--vault', vault, '--env', 'prod'])
    expect(prod.status, 'prod 종료코드').toBe(0)
    // 앵커: prod 가시 문서가 실제로 0건인 상태를 만들었다 — 그래야 이 못이 무엇을 지키는지 보인다.
    expect(prod.stdout, 'prod 가시 문서 수').toContain('docs=0')

    // 짝: 같은 vault 의 dev 는 3건을 본다 — draft 가 사라진 것이 아니라 숨겨진 것이다.
    const dev = runCli(['--vault', vault, '--env', 'dev'])
    expect(dev.status, 'dev 종료코드').toBe(0)
    expect(dev.stdout, 'dev 가시 문서 수').toContain('docs=3')
  })
})
