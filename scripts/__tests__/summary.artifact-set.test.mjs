// @vitest-environment node
//
// P5 · Task 2·5 — 발행 아티팩트 **3종화**와 3중 신선도 (D-C·D-D·D-G) — tdd §3.2 (FA5~FA12)
//
// 무엇이 바뀌는가: 재생성 1회가 **세 파일**을 낸다 — `cache/summary.<env>.json` ·
//   `cache/feeds.<env>.json`(내부 · 억제 **전** 전량) · `logs/summary.report.<env>.{json,txt}`.
//   셋은 같은 `parsed` 에서 co-derive 되고 같은 지문을 이고, 신선도 스킵은 **셋 다** 같은 지문일
//   때만 일어난다. 쓰기 순서(summary → feeds → 리포트)는 **계약**이다.
//
// RED 사유(전부 **미구현**):
//   · 공통 — `scripts/lib/generator.mjs` 가 없다(**OQ-P5-1 = A** 확정: `runSummaryGenerator` 를 CLI
//     밖으로 옮기고 **재export 는 두지 않는다**). 이 파일은 새 거처를 seam 으로 삼는다 — 옛 거처를
//     물면 GREEN 이 끝나도 이 파일만 옛 결합을 살려두게 된다.
//   · FA5·FA7·FA11·FA12 — feeds 아티팩트가 발행되지 않는다.
//   · FA6 — 쓰기 순서 계약 자체가 없다(**OQ-P5-5 = throw(exit 1)** 확정 — 산출물 실패다).
//   · FA8 — 리포트에 발행 봉투가 없다(**OQ-P5-3 = a**: top-level `env` 신설 + `inputs` 제거 ·
//     **OQ-P5-4 = a**: 공용 `SCHEMA_VERSION`). 오늘은 `inputs{env}` 중첩 + 자체 리터럴 1 이다.
//   · FA9 — 리포트 경로가 env 로 안 갈린다(F-29).
//   · FA10 — `SCHEMA_VERSION` 이 2 이고 리포트만 1 이다.
//
// 관측 층(tdd §7.5): 생성기 **반환 객체**와 **발행된 파일**만 본다. exit code·stdout 은
//   `summary.suppression-independence.test.mjs`(SU8)와 기존 `summary.cli-exit.test.mjs` 가 문다.
//
// 규범 A: 경로 조각·producer·버전·억제 엔트리는 **리터럴**이다. 정확 경로 형태의 고정은 **PL9**
//   한 곳이 맡고, 여기서는 그 경로를 좌표로 쓴다(둘이 같은 것을 두 번 물지 않는다).
// 규범 B: 부재·불변 단언 앞에 앵커를 둔다 — 실행 전 파일이 없었다 · 막지 않으면 둘 다 갱신된다 ·
//   위조 전에는 스킵했다 · 값이 epoch 기본값이 아니다.
// 규범 F: 실 vault 를 건드리지 않는다 — 억제 엔트리는 tmp git vault 에서만 만든다.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'

import { cleanup, commit, feedCommit, initVault, writeDoc } from './helpers/tmp-git-vault.mjs'

// 신설 모듈 부재가 파일 전체를 죽이는 collection error 가 되지 않도록 지연 import 로 붙든다(tdd §7.3).
//   `rtk` 는 collection error 를 PASS 로 오보고하므로 부재는 **케이스별 명시 실패**여야 한다.
const generatorModule = await import(new URL('../lib/generator.mjs', import.meta.url).href).catch(
  (error) => ({ __loadError: error instanceof Error ? error.message : String(error) }),
)
const payloadsModule = await import(new URL('../lib/payloads.mjs', import.meta.url).href)
const feedsModule = await import(new URL('../feeds.mjs', import.meta.url).href)

/** 산출물 3종의 경로 — **리터럴 조립**이다(규범 A). 정확 형태의 계약은 PL9 가 한 번만 고정한다. */
const summaryFile = (vault, env) => path.join(vault, 'cache', `summary.${env}.json`)
const feedsFile = (vault, env) => path.join(vault, 'cache', `feeds.${env}.json`)
const reportFile = (vault, env) => path.join(vault, 'logs', `summary.report.${env}.json`)
const reportTextFile = (vault, env) => path.join(vault, 'logs', `summary.report.${env}.txt`)

/** 발행 표지·버전 — 리터럴이다. */
const SUMMARY_PRODUCER = 'sas-wiki/summary'
const FEEDS_PRODUCER = 'sas-wiki/feeds'
const REPORT_PRODUCER = 'sas-wiki/report'
const SCHEMA_VERSION = 3

const ID_A = '0192a000-0000-7000-8000-0000000000aa'
const ID_B = '0192b000-0000-7000-8000-0000000000bb'
const REL_A = 'company/삼성전자'
const REL_B = 'concept/온디바이스-AI'
const FEED_TS = '2026-05-01T00:00:00Z'
const FEED_TITLE = '삼성 소식'
const IGNORE_FILE = 'ignore-feeds.json'
const IGNORE_WHEN = '2026-07-28T00:00:00Z'
const EPOCH_ZERO = '1970-01-01T00:00:00.000Z'

const tmps = []
afterAll(() => cleanup(...tmps))

async function generate(options) {
  if (generatorModule.__loadError !== undefined) {
    throw new Error(
      `[RED] scripts/lib/generator.mjs 가 아직 없다 (OQ-P5-1=A · runSummaryGenerator 이동 미구현): ${generatorModule.__loadError}`,
    )
  }
  if (typeof generatorModule.runSummaryGenerator !== 'function') {
    throw new Error('[RED] scripts/lib/generator.mjs 에 runSummaryGenerator export 가 아직 없다')
  }
  return await generatorModule.runSummaryGenerator(options)
}

/** active 문서 2건 + 그중 하나를 가리키는 `feed:` 1건. feedId(12hex)를 함께 돌려준다. */
function seedVault() {
  const vault = initVault()
  tmps.push(vault)
  writeDoc(vault, REL_A, { body: '## 정의\n\n초판.\n', id: ID_A, title: '삼성전자', type: 'company' }) // prettier-ignore
  writeDoc(vault, REL_B, { body: '## 정의\n\n온디바이스 초판.\n', id: ID_B, title: '온디바이스 AI' }) // prettier-ignore
  commit(vault, 'chore: 문서 2건 생성')

  writeDoc(vault, REL_A, { body: '## 정의\n\n갱신.\n', id: ID_A, title: '삼성전자', type: 'company' }) // prettier-ignore
  const feedSha = feedCommit(vault, { date: FEED_TS, subject: FEED_TITLE })
  return { feedId: feedSha.slice(0, 12), vault }
}

/** 지문을 움직이는 **미커밋 저장**(문서 변경). HEAD 는 그대로다. */
function touchDoc(vault, marker) {
  writeDoc(vault, REL_B, { body: `## 정의\n\n${marker}\n`, id: ID_B, title: '온디바이스 AI' })
}

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'))

describe('발행 3종 — 세 파일이 같은 세대다 (FA5 · 🔴RED feeds 아티팩트 미발행)', () => {
  it('FA5: 재생성 1회가 세 파일을 내고 셋의 `inputsFingerprint` 가 서로 같다', async () => {
    const { vault } = seedVault()

    // 앵커: 실행 **전에는 셋 다 없다**(앞 케이스가 남긴 파일로 통과하는 것을 배제).
    expect(existsSync(summaryFile(vault, 'dev'))).toBe(false)
    expect(existsSync(feedsFile(vault, 'dev'))).toBe(false)
    expect(existsSync(reportFile(vault, 'dev'))).toBe(false)

    const result = await generate({ env: 'dev', vault })

    expect(result.regenerated).toBe(true)
    const fingerprints = [
      readJson(summaryFile(vault, 'dev')).inputsFingerprint,
      readJson(feedsFile(vault, 'dev')).inputsFingerprint,
      readJson(reportFile(vault, 'dev')).inputsFingerprint,
    ]
    // ★ 조인 키가 **구조적으로 어긋날 수 없다**(B12)는 계약의 생산자 측 증명이다.
    expect(new Set(fingerprints).size).toBe(1)
    expect(fingerprints[0]).toBe(result.inputsFingerprint)
  })
})

describe('쓰기 순서 계약 — summary 먼저, feeds 나중 (FA6 · 🔴RED 순서·계약 부재)', () => {
  it('FA6: feeds 자리를 막으면 실패하되 **summary 는 이미 새 세대**다', async () => {
    // ★ mtime·벽시계를 쓰지 않는 순서 관측이다(규범 E). 순서가 반대였다면 아래 ②가 "구 지문" 으로
    //   관측된다 — 즉 이 단언 하나가 순서를 양방향으로 못박는다.
    const { vault } = seedVault()
    const first = await generate({ env: 'dev', vault })
    expect(first.regenerated).toBe(true)

    // 앵커 ①: **막지 않으면 둘 다** 새 지문으로 간다(막았을 때의 관측이 우연이 아니다).
    touchDoc(vault, '대조 갱신 A')
    const control = await generate({ env: 'dev', vault })
    expect(control.inputsFingerprint).not.toBe(first.inputsFingerprint)
    expect(readJson(summaryFile(vault, 'dev')).inputsFingerprint).toBe(control.inputsFingerprint)
    expect(readJson(feedsFile(vault, 'dev')).inputsFingerprint).toBe(control.inputsFingerprint)

    // feeds 자리를 **디렉토리로** 막는다 — rename 이 EISDIR 로 죽는 자리는 여기 하나뿐이다.
    rmSync(feedsFile(vault, 'dev'), { force: true })
    mkdirSync(feedsFile(vault, 'dev'), { recursive: true })
    touchDoc(vault, '차단 갱신 B')

    // ① 산출물 실패다(OQ-P5-5 = throw). 리포트만 예외로 흡수한다 — feeds 는 **서빙 데이터**다.
    await expect(generate({ env: 'dev', vault })).rejects.toThrow()

    // ② 그런데도 summary 는 **이미 새 지문**이다 → summary 가 feeds 보다 먼저 쓰였다.
    const summaryAfter = readJson(summaryFile(vault, 'dev')).inputsFingerprint
    expect(summaryAfter).not.toBe(control.inputsFingerprint)

    // ③ 막은 것을 치우면 다시 만든다(찢어진 세트를 스킵으로 접지 않는다).
    rmSync(feedsFile(vault, 'dev'), { force: true, recursive: true })
    const recovered = await generate({ env: 'dev', vault })
    expect(recovered.regenerated).toBe(true)
    expect(readJson(feedsFile(vault, 'dev')).inputsFingerprint).toBe(recovered.inputsFingerprint)
  })
})

describe('3중 신선도 — 셋 다 같은 지문일 때만 스킵 (FA7 · 🔴RED 조건이 2중)', () => {
  // **arm 을 3개 다 둔다** — 하나만 두면 "지운 그 파일만 보는" 구현이 통과한다.
  for (const [arm, locate] of [
    ['summary', summaryFile],
    ['feeds', feedsFile],
    ['report', reportFile],
  ]) {
    it(`FA7-${arm}: ${arm} 산출물을 지우면 재생성한다`, async () => {
      const { vault } = seedVault()
      await generate({ env: 'dev', vault })

      // 앵커: 셋 다 있으면 **스킵**한다(항상 재생성하는 생성기에서는 이 케이스가 무의미하다).
      const skipped = await generate({ env: 'dev', vault })
      expect(skipped.regenerated).toBe(false)

      rmSync(locate(vault, 'dev'), { force: true })

      expect((await generate({ env: 'dev', vault })).regenerated).toBe(true)
    })
  }
})

describe('리포트도 발행물이다 — readArtifact 를 탄다 (FA8 · 🔴RED 봉투 부재)', () => {
  it('FA8: 리포트에 `producer`·top-level `env`·`schemaVersion`·지문이 있고 위조하면 재생성한다', async () => {
    // F-27. "실패를 stale 로 접는" 규율이 세 곳에서 각자 살지 않는다 — 독자는 하나다.
    const { vault } = seedVault()
    const first = await generate({ env: 'dev', vault })

    const report = readJson(reportFile(vault, 'dev'))
    expect(report.producer).toBe(REPORT_PRODUCER)
    expect(report.env).toBe('dev') // OQ-P5-3 = a — `inputs{env}` 중첩이 아니라 top-level
    expect(report).not.toHaveProperty('inputs') // 「레거시는 남기지 않는다」
    expect(report.schemaVersion).toBe(SCHEMA_VERSION) // OQ-P5-4 = a — 공용 상수
    expect(report.inputsFingerprint).toBe(first.inputsFingerprint)

    // 앵커: 위조 **전에는** 스킵했다.
    expect((await generate({ env: 'dev', vault })).regenerated).toBe(false)

    writeFileSync(
      reportFile(vault, 'dev'),
      JSON.stringify({ ...report, producer: SUMMARY_PRODUCER }),
      'utf8',
    )

    expect((await generate({ env: 'dev', vault })).regenerated).toBe(true)
  })
})

describe('리포트 경로 env 분리 (FA9 · 🔴RED 단일 슬롯)', () => {
  it('FA9: dev·prod 리포트가 **공존**하고 prod 실행이 dev 리포트를 건드리지 않는다', async () => {
    // F-29. 오늘은 `logs/summary.report.json` 한 슬롯이라 dev·prod 교대 실행이 서로를 무효화한다.
    const { vault } = seedVault()

    await generate({ env: 'dev', vault })
    const devSnapshot = readFileSync(reportFile(vault, 'dev'), 'utf8')

    await generate({ env: 'prod', vault })

    // 앵커: 둘 다 **실제로 존재한다**(둘 다 없어서 통과하는 것을 배제 — P4 AR3 과 동형).
    expect(existsSync(reportFile(vault, 'dev'))).toBe(true)
    expect(existsSync(reportFile(vault, 'prod'))).toBe(true)
    expect(existsSync(reportTextFile(vault, 'dev'))).toBe(true)
    expect(existsSync(reportTextFile(vault, 'prod'))).toBe(true)
    expect(readFileSync(reportFile(vault, 'dev'), 'utf8')).toBe(devSnapshot)
    expect(readJson(reportFile(vault, 'prod')).env).toBe('prod')
  })
})

describe('버전은 하나다 — 5 산출물 공용 (FA10 · 🔴RED flip: 오늘 2 · 리포트만 1)', () => {
  it('FA10: `SCHEMA_VERSION === 3` 이고 다섯 산출물의 버전이 서로 같다', async () => {
    // ★ 분리 금지 pin 의 확장. 페이로드별로 쪼개면 소비자 `WikiDataProvider` 부팅 게이트가
    //   **영구 false** 가 된다(P2 확정 · 재론 금지). §4 원장 ⑭~⑱ 이 뒤집히는 리터럴을 지목한다.
    const { vault } = seedVault()
    await generate({ env: 'dev', vault })

    if (typeof feedsModule.feeds !== 'function') {
      throw new Error('[RED] scripts/feeds.mjs 에 feeds export 가 없다')
    }
    const wireFeeds = await feedsModule.feeds(vault, 'dev', {})
    const wireBody = payloadsModule.buildBody({ docs: [], sourceCommit: '0'.repeat(40) })

    expect(payloadsModule.SCHEMA_VERSION).toBe(SCHEMA_VERSION)
    expect([
      readJson(summaryFile(vault, 'dev')).schemaVersion,
      readJson(feedsFile(vault, 'dev')).schemaVersion,
      readJson(reportFile(vault, 'dev')).schemaVersion,
      wireFeeds.schemaVersion,
      wireBody.schemaVersion,
    ]).toEqual([SCHEMA_VERSION, SCHEMA_VERSION, SCHEMA_VERSION, SCHEMA_VERSION, SCHEMA_VERSION])
  })
})

describe('feeds 아티팩트는 **억제 전 전량**이다 (FA11 · 🔴RED 파일 부재)', () => {
  it('FA11: 억제된 피드 id 가 **파일에는 있고** 응답에는 없다', async () => {
    // ★ D-C 의 심장이자 R-6 가드(CS8·HV5)의 전제다. 아티팩트를 억제 **후** 로 만들면(CX-N)
    //   FC4 는 우연히 green 인 채 이 행만 red 가 된다 — 그래서 이 짝이 필요하다.
    const { feedId, vault } = seedVault()
    writeFileSync(
      path.join(vault, IGNORE_FILE),
      JSON.stringify([{ id: feedId, when: IGNORE_WHEN }]),
      'utf8',
    )

    await generate({ env: 'dev', vault })

    const artifactItems = readJson(feedsFile(vault, 'dev')).items
    // 앵커 ①: 아티팩트가 비어 있지 않다(빈 파일로 `toContain` 이 실패하는 것과 구분된다).
    expect(artifactItems.length).toBeGreaterThan(0)
    expect(artifactItems.map((item) => item.id)).toContain(feedId)

    // 앵커 ②: **억제는 실제로 걸린다** — 같은 vault 의 응답에는 그 id 가 없다(서빙 시점 필터).
    const response = await feedsModule.feeds(vault, 'dev', {})
    expect(response.items.map((item) => item.id)).not.toContain(feedId)
  })
})

describe('co-derivation — 두 아티팩트가 같은 파싱에서 나온다 (FA12 · 🔴RED 파일 부재)', () => {
  it('FA12: feeds 아티팩트의 `generatedAt`·`sourceCommit` 이 summary 와 같다', async () => {
    const { vault } = seedVault()
    await generate({ env: 'dev', vault })

    const summary = readJson(summaryFile(vault, 'dev'))
    const feedsArtifact = readJson(feedsFile(vault, 'dev'))

    // 앵커: 둘 다 **기본값이 아니다**(둘 다 비어서 같은 것을 배제).
    expect(summary.generatedAt).not.toBe(EPOCH_ZERO)
    expect(summary.sourceCommit).toMatch(/^[0-9a-f]{40}$/u)

    expect(feedsArtifact.generatedAt).toBe(summary.generatedAt)
    expect(feedsArtifact.sourceCommit).toBe(summary.sourceCommit)
    expect(feedsArtifact.producer).toBe(FEEDS_PRODUCER)
    expect(summary.producer).toBe(SUMMARY_PRODUCER)
  })
})
