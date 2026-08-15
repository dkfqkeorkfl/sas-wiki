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

describe('티어 선택 불가 — 파싱은 **항상** 깊다 (CT1 · P5 D-I 로 극성 반전)', () => {
  // ★ P5(D-I)가 이 케이스의 전제를 없앴다. 예전 CT1 은 "서빙 파싱은 얕고 검증 파싱은 깊다" 를 물어
  //   비용 티어 **배선**을 지켰다. 그런데 그 스위치(`deepDocGate`)는 비용 스위치로 문서화돼 있었을 뿐
  //   실제로는 **제외집합을 바꾸는 의미 스위치**였고, 그래서 생성기가 제외한 문서를 `feeds`·`wiki` 가
  //   계속 서빙했다(P5 가 고친 결함 그 자체다). `feeds`·`wiki` 가 발행 아티팩트 소비자가 되면서
  //   얕은 호출자가 0이 됐고, 파라미터는 근절됐다.
  //
  //   **파일을 지우지 않고 극성을 뒤집는다**(tdd §10.1-3 "삭제 금지"): 지키는 대상이 "티어가 갈린다"
  //   에서 **"티어를 고를 수 없다"** 로 바뀌었다. 프로세스 관측(TR1·TR2)과 소스 스캔(TR6)이 각각
  //   CLI 층과 텍스트 층을 무는 것과 달리, 이 케이스는 **함수 층**에서 같은 보장을 문다 —
  //   호출자가 어떤 옵션을 줘도 얕은 판정을 얻을 수 없어야 한다.
  it('CT1: 어떤 옵션 조합으로도 얕은 판정을 얻을 수 없다 (깊은 티어 git 호출이 항상 난다)', () => {
    const { vault } = seedCleanVault()
    tmps.push(vault)

    // 옛 스위치 이름을 **일부러** 넘긴다 — 되살아나면 이 케이스가 red 가 된다(부활 트립와이어).
    const revived = recordingRunner(vault)
    const revivedParse = parseVault(vault, 'dev', SCHEMA_DIR, {
      deepDocGate: false,
      runGit: revived.run,
    })

    const plain = recordingRunner(vault)
    const plainParse = parseVault(vault, 'dev', SCHEMA_DIR, { runGit: plain.run })

    // 앵커 ①: 두 파싱 다 **실제로 문서를 냈다**(빈 vault 에서 0 == 0 으로 공허 통과하는 것을 배제).
    expect(plainParse.gate.visibleDocs.length).toBeGreaterThan(0)
    // 개수만 같으면 통과하는 비교는 **치환 공격**(개수는 동일·내용은 상이)에도 통과한다 —
    //   신원(frontmatter id) 집합으로 승격한다. 개수 리터럴은 박지 않는다(vault 히스토리 하드결합).
    const plainDocIds = new Set(plainParse.gate.visibleDocs.map((doc) => doc.frontmatter.id))
    const revivedDocIds = new Set(revivedParse.gate.visibleDocs.map((doc) => doc.frontmatter.id))
    // 앵커 ①-b: 신원 추출 자체가 살아 있다 — id 를 못 읽어 양쪽이 `{undefined}` 가 되면 위 개수
    //   앵커를 통과한 채로 집합 동등도 참이 되어(같은 공허가 형태만 바꿔 살아남는다) 승격이 무의미해진다.
    expect(plainDocIds.size, '앵커: 문서 신원이 실제로 추출됐다').toBeGreaterThan(0)
    expect(plainDocIds.has(undefined), '앵커: id 추출이 깨져 전부 undefined 가 아니다').toBe(false)
    expect(revivedDocIds).toEqual(plainDocIds)

    // 앵커 ②: 이 vault·이 함수가 깊은 티어 호출을 **실제로** 낸다(관측자가 죽어서 0인 것을 배제).
    expect(deepTierCalls(plain.calls).length).toBeGreaterThan(0)

    // 본 단언: 옛 스위치를 `false` 로 줘도 깊은 판정이 난다 — 티어는 호출자의 선택지가 아니다.
    expect(deepTierCalls(revived.calls).length).toBeGreaterThan(0)
  })
})
