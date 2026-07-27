// @vitest-environment node
//
// P3 · REFACTOR — D-A 비용 티어의 **배선** 단언 (CT1)
//
// 왜 이 파일이 생겼나: §6 반증에서 `CX5b`(호출자가 티어를 무시하고 항상 `runGit` 을 넘긴다)가
//   **red 0** 이었다. 티어는 `doc-gate.test.mjs`(DG11·DG12)에서 **단위 수준으로만** 고정돼 있었고,
//   "서빙 경로가 실제로 얕은 티어로 불리는가" 를 무는 단언이 없었다. 그래서 라이브 요청이 문서당
//   git 을 파도록 배선이 바뀌어도 전 게이트가 green 이다 — D-A 가 이 phase 의 핵심 결정인데 그 결정이
//   무방비였다는 뜻이다.
//
// 무엇을 세는가: 깊은 티어에만 있는 git 호출(`collectDeletedDocEvents`)의 인자 조합
//   `log --diff-filter=D --find-renames` 를 센다. 얕은 경로가 쓰는 `collectEverDeletedDocPaths` 는
//   같은 `--diff-filter=D` 를 쓰되 `--find-renames` 가 **없어서** 둘이 구별된다.
//
// 규범 A(자기참조 공허성 금지): 인자 토큰은 **리터럴**이다. 프로덕션 상수를 import 해 만들지 않는다.
// 규범 B(위험 실재 앵커): "얕은 경로는 0건" 이라는 **부재 단언** 앞뒤로, 같은 vault·같은 함수가
//   깊은 경로에서는 **실제로 그 호출을 낸다**는 짝을 둔다. 짝이 없으면 "아무 git 도 안 부르는" 구현이
//   자동 통과한다.
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterAll, describe, expect, it } from 'vitest'

import { makeGitRunner } from '../lib/git.mjs'
import { parseVault } from '../lib/parse-vault.mjs'
import { cleanup } from './helpers/tmp-git-vault.mjs'
import { seedCleanVault } from './helpers/polluted-vault.mjs'

const SCHEMA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'schema')

const tmps = []
afterAll(() => cleanup(...tmps))

/** 실제 git 을 그대로 태우되 인자를 기록한다 — 가짜 응답으로 바꾸면 배선이 아니라 mock 을 재게 된다. */
function recordingRunner(vault) {
  const calls = []
  const real = makeGitRunner(vault)
  return {
    calls,
    run(args) {
      calls.push([...args])
      return real(args)
    },
  }
}

const deepTierCalls = (calls) =>
  calls.filter((args) => args.includes('--diff-filter=D') && args.includes('--find-renames'))

describe('비용 티어 배선 — 서빙은 문서당 git 을 팔지 않는다 (CT1 · pair)', () => {
  it('CT1: 서빙 파싱은 깊은 티어 git 0건 · 검증 파싱은 >0건 (같은 vault·같은 함수)', () => {
    const { vault } = seedCleanVault()
    tmps.push(vault)

    const serving = recordingRunner(vault)
    const servingParse = parseVault(vault, 'dev', SCHEMA_DIR, { runGit: serving.run })

    const validating = recordingRunner(vault)
    const validatingParse = parseVault(vault, 'dev', SCHEMA_DIR, {
      deepDocGate: true,
      runGit: validating.run,
    })

    // 앵커 ①: 두 파싱 다 **실제로 문서를 냈다**(빈 vault 에서 0 == 0 으로 공허 통과하는 것을 배제).
    expect(servingParse.gate.visibleDocs.length).toBeGreaterThan(0)
    expect(validatingParse.gate.visibleDocs).toHaveLength(servingParse.gate.visibleDocs.length)

    // 앵커 ②: 깊은 경로는 그 호출을 **실제로** 낸다 — 부재 단언의 위험 실재 증명.
    expect(deepTierCalls(validating.calls).length).toBeGreaterThan(0)

    expect(deepTierCalls(serving.calls)).toEqual([])
  })
})
