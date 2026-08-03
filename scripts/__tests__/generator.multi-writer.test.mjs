// @vitest-environment node
//
// P5 — multi-writer 가정을 **문서가 아니라 테스트로** (D-K · R3 반례 1) — tdd §3.7 (MW1~MW3)
//
// 무엇을 무는가: `plugin.ts:442-448` 이 산문으로 적은 가정 —_"같은 산출물에 쓰는 writer 가 둘 이상인
//   상황은 지금 성립하지 않는다"_ — 의 하중이 이 phase 에서 커진다. 생성기는 summary·feeds
//   아티팩트를 함께 내고, `feeds`·`wiki` 는 이미 발행된 아티팩트를 읽기 때문이다. 락파일은 도입하지 않는다(plan NOT
//   Building) — 대신 그 가정을 **관측 가능한 계약**으로 바꾼다.
//
// RED 사유(전부 **미구현**): feeds 아티팩트가 발행되지 않으므로 "두 산출물이 같은 세대" 라는 단언이
//   성립할 수 없다. 소비자 arm(MW2)도 feeds 를 영원히 `missing` 으로만 본다.
//
// 경계(tdd §7.2 · §8-9): 하드 게이트는 **컨테이너 로컬 fs**(`os.tmpdir()`)에서만 건다 — 그것이 우리
//   코드의 성질이다. 9p(`/workspace`) 결과는 통과/실패가 아니라 **측정**이며 §8 표에 기록한다.
//   `initVault()` 가 이미 `os.tmpdir()` 를 쓴다(로컬 fs 보장).
//
// ★ 타임아웃을 **명시**한다. 자식 하나가 콜드 재생성이면 수 초~수십 초이고 라운드마다 2~3개를 겹쳐
//   돌린다 — 느슨하게 푸는 것이 아니라 **실제 상한을 정직하게 적는 것**이다(AT6 선례).
import path from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'

import { cleanup, commit, feedCommit, initVault, writeDoc } from './helpers/tmp-git-vault.mjs'
import { runGeneratorOnce, runGeneratorRace } from './helpers/generator-race.mjs'

const ID_A = '0192a000-0000-7000-8000-0000000000aa'
const REL_A = 'company/삼성전자'
const REL_B = 'concept/온디바이스-AI'
const ID_B = '0192b000-0000-7000-8000-0000000000bb'
const FEED_TS = '2026-05-01T00:00:00Z'

/** 생성기 자식 2종 = summary/feeds 를 각자 `--out` 으로 발행한다(Task 7 이후 3스텝 체인과 동일한 분리). */
const SUMMARY_GENERATOR = {
  args: ['--env', 'dev', '--out', 'cache/summary.dev.json'],
  script: 'summary.mjs',
}
const FEEDS_GENERATOR = {
  // ★ v3 P2 · D15(§4.5-③) — `--count` 는 CLI 층 필수다. `--out` 모드도 예외가 아니라서, 안 실으면
  //   이 파일의 Arrange 가 exit 2 로 죽고 경쟁 자체가 관측되지 않는다.
  args: ['--env', 'dev', '--count', '200', '--out', 'cache/feeds.dev.json'],
  script: 'feeds.mjs',
}
const GENERATORS = [SUMMARY_GENERATOR, FEEDS_GENERATOR]

const tmps = []
afterAll(() => cleanup(...tmps))

function seedVault() {
  const vault = initVault()
  tmps.push(vault)
  writeDoc(vault, REL_A, { body: '## 정의\n\n초판.\n', id: ID_A, title: '삼성전자', type: 'company' }) // prettier-ignore
  writeDoc(vault, REL_B, { body: '## 정의\n\n온디바이스 초판.\n', id: ID_B, title: '온디바이스 AI' }) // prettier-ignore
  commit(vault, 'chore: 문서 2건 생성')
  writeDoc(vault, REL_A, { body: '## 정의\n\n갱신.\n', id: ID_A, title: '삼성전자', type: 'company' }) // prettier-ignore
  feedCommit(vault, { date: FEED_TS, subject: '삼성 소식' })
  return vault
}

const parseStdout = (producer) => {
  try {
    return JSON.parse(producer.stdout)
  } catch {
    return null
  }
}

describe('동시 생성기 — 찢어진 세트 0건 (MW1 · 🔴RED feeds 아티팩트 부재)', () => {
  it(
    'MW1: 자식 2개를 동시에 띄워도 두 아티팩트의 `sourceCommit` 이 서로 같다',
    { timeout: 300_000 },
    async () => {
      const vault = seedVault()

      const race = await runGeneratorRace({
        children: [...GENERATORS, ...GENERATORS],
        env: 'dev',
        vault,
      })

      // 앵커 ①: 네 자식 다 정상 종료했다(둘 다 죽어서 "아무도 안 썼다" 가 0건으로 통과하는 것을 배제).
      expect(race.producers.map((producer) => producer.exitCode)).toEqual([0, 0, 0, 0])
      // 앵커 ②: 두 파일이 **전부 존재한다**(파싱 성공 = null 이 아니다).
      expect(race.artifacts.map((artifact) => artifact.parsed === null)).toEqual([false, false])

      const sourceCommits = race.artifacts.map((artifact) => artifact.sourceCommit)
      for (const value of sourceCommits) expect(value).toMatch(/^[0-9a-f]{40}$/u)
      expect(new Set(sourceCommits).size).toBe(1)
    },
  )
})

// ────────────────────────────────────────────────────────────────────────────
// SG — 「한 세대」의 새 정의 (v3 P1 Task 4 · tdd §3.12 · **가장 위험한 변이 #1**)
//
// 문제: MW1·MW3 의 옛 상관 축 집합 비교는 그 축이 사라지면 값이
//   전부 `null` 이 되어 **`Set{null}.size === 1` 로 공허 통과**한다 — 두 케이스가 **조용히 죽는데
//   green** 이다. 이 절이 축을 교체하고, **값 존재 앵커(SG2)** 가 같은 함정의 재발을 막는다.
//
// ★ `sourceCommit` 을 쓰는 것이 **v3 D1 위반이 아닌 이유**: plan 결정 ① 이 기각한 것은 그 값을
//   *신선도 판정 축으로 승격*하는 것이다(`readArtifact` 의 판정 경로에 넣는 것). 여기 용도는
//   **동시 쓰기가 세대를 찢지 않았는지 관측**하는 것뿐이고, 판정 경로에는 넣지 않는다. 이 주석을
//   지우면 다음 독자가 "결정 ① 을 어겼다" 고 읽는다.
//
// ☞ 옛 축 제거는 **GREEN 원자 커밋의 몫**이다.
// ────────────────────────────────────────────────────────────────────────────

describe('한 세대의 새 정의 — 축 교체 (SG1~SG4)', () => {
  it(
    'SG1~SG4: 세 산출물의 `sourceCommit`·`generatedAt` 이 세대를 찢지 않는다',
    { timeout: 300_000 },
    async () => {
      const vault = seedVault()

      const race = await runGeneratorRace({
        children: [...GENERATORS, ...GENERATORS],
        env: 'dev',
        vault,
      })

      // ── SG4: MW1 의 앵커 3종을 그대로 물려받는다(①②는 무변경 · ③은 계약 반전) ──────────────
      // 앵커 ①: 네 자식 다 정상 종료했다(둘 다 죽어서 "아무도 안 썼다" 가 통과하는 것을 배제).
      expect(race.producers.map((producer) => producer.exitCode)).toEqual([0, 0, 0, 0])
      // 앵커 ②: 두 파일이 **전부 존재한다**(파싱 성공 = null 이 아니다).
      expect(race.artifacts.map((artifact) => artifact.parsed === null)).toEqual([false, false])

      const sourceCommits = race.artifacts.map((artifact) => artifact.sourceCommit)
      const generatedAts = race.artifacts.map((artifact) => artifact.generatedAt)

      // ── SG2: ★ **값 존재 앵커** — `Set{null}` 함정의 직접 해독제다 ────────────────────────────
      //   축을 바꿔도 값 존재를 먼저 못박지 않으면 같은 함정이 그대로 재발한다.
      for (const value of sourceCommits) expect(value).toMatch(/^[0-9a-f]{40}$/u)
      for (const value of generatedAts) {
        expect(typeof value).toBe('string')
        expect(value.length).toBeGreaterThan(0)
      }

      // ── SG1: 세 산출물이 같은 커밋에서 나왔다 ────────────────────────────────────────────────
      expect(new Set(sourceCommits).size).toBe(1)

      // ── SG3: 두 번째 축 — 한 축이 죽어도 다른 축이 문다 ──────────────────────────────────────
      // ★ 리포트는 이 축에서 **제외한다**: `validate.mjs` 의 `buildReport` 가 `generatedAt` 을
      //   `new Date().toISOString()`(**벽시계**)로 찍는다 — summary·feeds 아티팩트의
      //   `parse-vault` 파생값(`max(doc.updated)`, 결정적)과 좌표계가 다르다. 셋을 한 집합으로 묶으면
      //   이 케이스는 **영원히 red** 이거나 조용히 완화된다(tdd §2.5 ④ 가 이 차이를 놓쳤다 — 보고 대상).
      const artifactGeneratedAts = race.artifacts
        .filter((artifact) => artifact.kind !== 'report')
        .map((artifact) => artifact.generatedAt)
      expect(artifactGeneratedAts).toHaveLength(2) // 앵커: 두 발행물이 실제로 관측됐다
      expect(new Set(artifactGeneratedAts).size).toBe(1)
    },
  )
})

describe('경합 중 소비자 관측 (MW2 · 🔴RED feeds 가 영원히 missing)', () => {
  it('MW2: `malformed` 0건 (초기 missing 은 허용)', { timeout: 420_000 }, async () => {
    // AT6(단일 파일 원자성)의 **3파일 확장**이다. 소비자는 프로덕션 독자(`readArtifact`)를 그대로
    //   쓴다 — 재구현하면 "우리가 만든 독자로는 멀쩡하더라" 가 되어 아무것도 증명하지 못한다.
    const vault = seedVault()
    let round = 0

    const race = await runGeneratorRace({
      children: [...GENERATORS, ...GENERATORS],
      env: 'dev',
      // 라운드마다 문서를 바꿔 **세대를 실제로 굴린다** — 세대가 안 움직이면 "2세대 이상" 이 성립하지 않는다.
      //
      // 🔴 v3 P1(§4.10 MW2-b · flip): 하네스의 세대 좌표가 `sourceCommit` 으로 바뀌었다.
      //   그 값은 HEAD 라 **커밋 없이는 움직이지 않는다** — 그래서 라운드가 저장에서 **커밋**으로
      //   강화된다. 미커밋 저장의 라이브 반영은 D43 이 명시 수용한 손실이므로, 착륙 후에도 관측
      //   가능한 세대 굴림은 커밋뿐이다. 비공허성 앵커는 **그대로 유지**된다.
      onRound: () => {
        round += 1
        writeDoc(vault, REL_B, {
          body: `## 정의\n\n라운드 ${round} 갱신.\n`,
          id: ID_B,
          title: '온디바이스 AI',
        })
        commit(vault, `chore: 라운드 ${round} 갱신`)
      },
      rounds: 2,
      vault,
      withConsumer: true,
    })

    // 앵커 ①: 소비자가 **실제로 읽었다**(0회 읽고 0건 실패로 통과하는 것을 배제).
    expect(race.consumer).not.toBeNull()
    expect(race.consumer.reads).toBeGreaterThan(0)
    expect(race.consumer.counts['load-error'] ?? 0).toBe(0)
    // 앵커 ②: **2세대 이상** 관측 — 생산·소비 구간이 실제로 겹쳤다.
    expect(race.consumer.generationsSeen).toBeGreaterThanOrEqual(2)
    // 앵커 ③: **두 아티팩트가 각각 실제로 관측됐다**(한 번이라도 `missing` 이 아닌 판정을 받았다).
    //   이것이 없으면 발행되지 않는 파일이 영원히 `missing` 으로만 세어져 본 단언이 공허해진다.
    const observed = ['summary', 'feeds'].map((kind) =>
      Object.entries(race.consumer.byKind?.[kind] ?? {}).some(
        ([reason, count]) => reason !== 'missing' && count > 0,
      ),
    )
    expect(observed).toEqual([true, true])

    expect(race.consumer.counts.malformed ?? 0).toBe(0)
  })
})

describe('세 엔드포인트 동시 트리거 (MW3 · 🔴RED feeds 아티팩트 부재)', () => {
  it(
    'MW3: summary/feeds 생성과 `feeds`·`wiki` 조회를 동시에 띄워도 두 아티팩트가 정합하다',
    { timeout: 300_000 },
    async () => {
      // ★ D-K 의 실제 하중이다 — summary 는 생성하고, serving 스크립트는 사전 발행물을 읽는다.
      const vault = seedVault()
      const arrangedSummary = runGeneratorOnce({
        args: SUMMARY_GENERATOR.args,
        script: SUMMARY_GENERATOR.script,
        vault,
      })
      const arrangedFeeds = runGeneratorOnce({
        args: FEEDS_GENERATOR.args,
        script: FEEDS_GENERATOR.script,
        vault,
      })
      expect([arrangedSummary.exitCode, arrangedFeeds.exitCode]).toEqual([0, 0])

      const race = await runGeneratorRace({
        children: [
          SUMMARY_GENERATOR,
          FEEDS_GENERATOR,
          { args: ['--env', 'dev', '--count', '5'], script: 'feeds.mjs' },
          { args: ['--env', 'dev', '--path', REL_A], script: 'wiki.mjs' },
        ],
        env: 'dev',
        vault,
      })

      // 앵커: 네 자식 다 exit 0 이고 조회 자식 stdout 은 **파싱 가능한 JSON**(200 상당)이다.
      expect(race.producers.map((producer) => producer.exitCode)).toEqual([0, 0, 0, 0])
      expect(race.producers.slice(2).map((producer) => parseStdout(producer) === null)).toEqual([
        false,
        false,
      ])

      const sourceCommits = race.artifacts.map((artifact) => artifact.sourceCommit)
      for (const value of sourceCommits) expect(value).toMatch(/^[0-9a-f]{40}$/u)
      expect(new Set(sourceCommits).size).toBe(1)
    },
  )
})
