// @vitest-environment node
//
// P3 · Task 7 — `validate` 를 같은 판정에 태운다 (`validate.mjs`) — tdd §3.9 (VD1~VD6)
//
// D-H 의 이행: 문서 단위 검증 코드는 **한 곳**(`doc-gate.mjs`)에만 있고, `validate` 와 생성기는
//   **같은 결과를 읽어 치명도만 다르게** 정한다. `validate` 는 1건이라도 있으면 죽고(`--max-excluded`
//   기본 0), 생성기는 문턱까지 견딘다. 그것이 PRD D3 "단일 검증 구현" 이다.
//
// RED 사유:
//   VD1 — `stats.excluded` 채널이 **아직 없다**(현행 stats 는 5필드뿐) → `[]` 단언이 red.
//         단, "정상 vault 는 throw 하지 않는다" 는 지금도 참인 **대조군 앵커**다.
//   VD2·VD3·VD4 — `--max-excluded` 옵션과 제외 사유 메시지가 없다. 현행은 중복 id 를 만나면
//         `parseVault`→`derive` 가 먼저 죽어 **사유 문자열이 아예 존재하지 않는다**.
//   VD5 — `--max-excluded` 미구현이라 CLI 종료코드 계약을 아직 만족하지 못한다.
//   VD6 — pin(현행도 통과). 게이트 **순서**를 흔들면 여기서만 red 다(격리가 좋다 · P2 DK8 관례).
//
// OQ-P3-4 확정: **`validate` 는 exit 1 을 유지**한다. exit 3 은 생성기 전용이다 — 3 으로 바꾸면
//   `validate.cli.test.mjs` 다수(`status === 1`)가 **§4 원장 밖에서** 깨진다.
//
// 관측 표면(tdd §7.4): `reportStats` 는 모듈 로컬이라 단위 테스트가 stdout 을 잡지 못한다 →
//   관측은 `buildContent()` 반환 `stats` 로 하고, CLI 표면은 VD5 가 spawn 으로 따로 문다.
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterAll, describe, expect, it } from 'vitest'

import { buildContent, parseArgs } from '../validate.mjs'
import { cleanup } from './helpers/tmp-git-vault.mjs'
import {
  seedCleanVault,
  seedConventionViolationVault,
  seedPollutedVault,
  TWIN_A_PATH,
  TWIN_B_PATH,
} from './helpers/polluted-vault.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const VALIDATE = path.resolve(HERE, '..', 'validate.mjs')

const tmps = []
afterAll(() => cleanup(...tmps))

const polluted = seedPollutedVault()
tmps.push(polluted.vault)

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

/** throw 여부·메시지를 값으로 만든다 — "무엇 때문에 죽었는가" 를 단언 가능한 형태로 바꾼다. */
function outcomeOf(run) {
  try {
    run()
    return { threw: false }
  } catch (error) {
    return { message: error instanceof Error ? error.message : String(error), threw: true }
  }
}

describe('validate — 대조군 (VD1)', () => {
  it('VD1: 정상 vault 는 throw 하지 않고 `stats.excluded` 가 비어 있다', () => {
    const { vault } = seedCleanVault()
    tmps.push(vault)

    let result
    expect(() => {
      result = buildContent({ env: 'dev', vault })
    }).not.toThrow()

    expect(result.summary.docs).toHaveLength(3) // 앵커: 픽스처가 비지 않았다
    expect(result.stats.excluded).toEqual([])
  })
})

describe('validate — 제외를 게이트로 소비한다 (VD2·VD3 · 🔴RED 미구현)', () => {
  it('VD2: 오염 vault 는 throw 하고 메시지가 두 문서 경로와 사유를 담는다', () => {
    // 메시지가 **무엇이 왜** 를 담는가. "스키마 위반 2건" 류는 대량 실패 시 추적이 불가능하다
    //   (`invariants.mjs` 헤더의 메시지 계약과 같은 규칙).
    const outcome = outcomeOf(() => buildContent({ env: 'dev', vault: polluted.vault }))

    expect(outcome.threw).toBe(true)
    expect(outcome.message).toContain(TWIN_A_PATH)
    expect(outcome.message).toContain(TWIN_B_PATH)
    expect(outcome.message).toContain('DUPLICATE_ID')
  })

  it('VD3: `maxExcluded: 2` 를 주면 **throw 하지 않는다** (문턱의 실재)', () => {
    // ★ 옵션이 사실상 2값(0 이냐 무한이냐)이 되는 것을 막는다. 문턱이 없으면 `ignore`/`warn` 같은
    //   완화 축이 뒷문으로 다시 생긴다.
    expect(() => buildContent({ env: 'dev', maxExcluded: 2, vault: polluted.vault })).not.toThrow()
  })
})

describe('validate — 인자 파싱 (VD4 · 🔴RED 미구현)', () => {
  it('VD4: `--max-excluded` 기본 0 · 정수 파싱 · 비정수는 fail-loud', () => {
    // 기본값 pin + enum/정수 fail-loud(`--env` 관례). 조용한 폴백(NaN → 0)은 문턱을 **없앤다**.
    expect(parseArgs(['--max-excluded', '2']).maxExcluded).toBe(2)
    expect(parseArgs([]).maxExcluded).toBe(0)
    expect(() => parseArgs(['--max-excluded', 'x'])).toThrow()
  })
})

describe('validate — 종료코드는 1 이다 (VD5 · 🔴RED 미구현)', () => {
  it('VD5: 오염 vault 를 CLI 로 돌리면 exit **1**(3 이 아니다)', () => {
    // OQ-P3-4 확정의 pin. 3 으로 만들면 `validate.cli.test.mjs` 의 다수 `status === 1` 단언이
    //   §4 원장 밖에서 대량으로 깨진다 — 그것은 계약 반전이 아니라 사고다.
    const result = runCli(['--vault', polluted.vault, '--env', 'dev'])

    expect(result.status).toBe(1)
    expect(`${result.stderr}${result.stdout}`).toContain(TWIN_A_PATH) // 앵커: 그 사유로 죽었다
  })
})

describe('validate — 게이트 순서 보존 (VD6 · pin)', () => {
  it('VD6: 컨벤션 위반과 제외 문서가 동시에 있으면 **컨벤션 위반**이 먼저 보고된다', () => {
    // ★ plan Task 7 GOTCHA. 순서(컨벤션 → 문서 → 데드링크 → 피드해석)가 진단 품질을 결정한다 —
    //   커밋 규약을 어겨 문서 id 가 소실된 상황에서 "스키마 위반" 만 보여주면 원인이 가려진다.
    //   `buildContent` 의 게이트 나열을 배열 루프로 리팩터할 때(§10.3-3) 이 못이 순서를 지킨다.
    const { brokenPath, vault } = seedConventionViolationVault()
    tmps.push(vault)

    // 앵커: 같은 vault 에 **제외 대상이 분명히 실재한다**(스키마 위반 문서 파일). 그렇지 않으면
    //   "컨벤션 위반이 먼저다" 는 경쟁자가 없는 무주공산에서 공허하게 통과한다.
    expect(existsSync(path.join(vault, brokenPath))).toBe(true)

    const outcome = outcomeOf(() => buildContent({ env: 'dev', vault }))

    expect(outcome.threw).toBe(true)
    expect(outcome.message).toMatch(/커밋|컨벤션|같은 커밋|추가.*삭제/)
    expect(outcome.message).not.toContain('SCHEMA_VIOLATION')
  })
})
