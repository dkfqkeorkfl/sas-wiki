import { existsSync } from 'node:fs'

import path from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'

import { inspectVault } from '../document-integrity.mjs'

import { cleanup } from '../../test-utils/tmp-git-vault.mjs'

import {
  seedCleanVault,
  seedConventionViolationVault,
  seedPollutedVault,
  TWIN_A_PATH,
  TWIN_B_PATH,
} from '../../test-utils/polluted-vault.mjs'

const tmps = []

afterAll(() => cleanup(...tmps))

const polluted = seedPollutedVault()

tmps.push(polluted.vault)

/** throw 여부·메시지를 값으로 만든다 — "무엇 때문에 죽었는가" 를 단언 가능한 형태로 바꾼다. */
function outcomeOf(run) {
  try {
    run()
    return { threw: false }
  } catch (error) {
    return { message: error instanceof Error ? error.message : String(error), threw: true }
  }
}

describe('validate — 대조군', () => {
  it('VD1: 정상 vault 는 throw 하지 않고 `stats.excluded` 가 비어 있다', () => {
    const { vault } = seedCleanVault()
    tmps.push(vault)

    let result
    expect(() => {
      result = inspectVault({ env: 'dev', vault })
    }).not.toThrow()

    expect(result.summary.docs).toHaveLength(3) // 앵커: 픽스처가 비지 않았다
    expect(result.stats.excluded).toEqual([])
  })
})

describe('validate — 제외를 게이트로 소비한다', () => {
  it('VD2: 오염 vault 는 throw 하고 메시지가 두 문서 경로와 사유를 담는다', () => {
    // 메시지가 **무엇이 왜** 를 담는가. "스키마 위반 2건" 류는 대량 실패 시 추적이 불가능하다
    //   (`invariants.mjs` 헤더의 메시지 계약과 같은 규칙).
    const outcome = outcomeOf(() => inspectVault({ env: 'dev', vault: polluted.vault }))

    expect(outcome.threw).toBe(true)
    expect(outcome.message).toContain(TWIN_A_PATH)
    expect(outcome.message).toContain(TWIN_B_PATH)
    expect(outcome.message).toContain('DUPLICATE_ID')
  })

  it('허용치를 전달해도 실제 문서 집행의 제외 허용치는 0이다', () => {
    expect(() => inspectVault({ env: 'dev', maxExcluded: 2, vault: polluted.vault })).toThrow(
      /허용치 0건/,
    )
  })
})

describe('validate — 게이트 순서 보존', () => {
  it('VD6: 컨벤션 위반과 제외 문서가 동시에 있으면 **컨벤션 위반**이 먼저 보고된다', () => {
    // ★ plan Task 7 GOTCHA. 순서(컨벤션 → 문서 → 데드링크 → 피드해석)가 진단 품질을 결정한다 —
    //   커밋 규약을 어겨 문서 id 가 소실된 상황에서 "스키마 위반" 만 보여주면 원인이 가려진다.
    //   `inspectVault` 의 게이트 나열을 배열 루프로 리팩터할 때(§10.3-3) 이 못이 순서를 지킨다.
    const { brokenPath, vault } = seedConventionViolationVault()
    tmps.push(vault)

    // 앵커: 같은 vault 에 **제외 대상이 분명히 실재한다**(스키마 위반 문서 파일). 그렇지 않으면
    //   "컨벤션 위반이 먼저다" 는 경쟁자가 없는 무주공산에서 공허하게 통과한다.
    expect(existsSync(path.join(vault, brokenPath))).toBe(true)

    const outcome = outcomeOf(() => inspectVault({ env: 'dev', vault }))

    expect(outcome.threw).toBe(true)
    // ★ `/커밋/` 같은 단어 하나로 만족되는 alternation 은 일반 git 에러("커밋 정보를 가져올 수 없습니다" 류)로도
    //   통과한다 — 컨벤션 게이트가 먼저 울렸다는 **고유** 신호를 요구한다(`invariants.mjs` 의 실제 머리말).
    expect(outcome.message).toContain('컨벤션 위반')
    expect(outcome.message).not.toContain('SCHEMA_VIOLATION')
  })
})
