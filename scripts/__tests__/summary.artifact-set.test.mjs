// @vitest-environment node
//
// P5 · Task 2·5 — 발행 아티팩트와 항상 생성 계약 (D-C·D-D·D-G) — tdd §3.2 (FA5~FA12)
//
// 무엇이 바뀌는가: 생성 1회가 `cache/summary.<env>.json` · `cache/feeds.<env>.json`(내부 · 억제
//   **전** 전량) · `logs/summary.report.<env>.{json,txt}` 를 낸다. 쓰기 순서(summary → feeds →
//   리포트)는 **계약**이다.
//
// RED 사유(전부 **미구현**):
//   · 공통 — `scripts/lib/generator.mjs` 가 없다(**OQ-P5-1 = A** 확정: `runSummaryGenerator` 를 CLI
//     밖으로 옮기고 **재export 는 두지 않는다**). 이 파일은 새 거처를 seam 으로 삼는다 — 옛 거처를
//     물면 GREEN 이 끝나도 이 파일만 옛 결합을 살려두게 된다.
//   · FA5·FA11·FA12 — feeds 아티팩트가 발행되지 않는다.
//   · FA6 — 쓰기 순서 계약 자체가 없다(**OQ-P5-5 = throw(exit 1)** 확정 — 산출물 실패다).
//   · FA10 — `SCHEMA_VERSION` 이 2 이고 리포트만 1 이다.
//
// 관측 층(tdd §7.5): 생성기 **반환 객체**와 **발행된 파일**만 본다. exit code·stdout 은
//   `summary.suppression-independence.test.mjs`(SU8)와 기존 `summary.cli-exit.test.mjs` 가 문다.
//
// 규범 A: 경로 조각·버전·억제 엔트리는 **리터럴**이다. 정확 경로 형태의 고정은 **PL9**
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

/** 🔴 v3 P1 · D29(§4.3 ②) — 계약 번호 리셋. 리터럴 복제는 **복제로 유지**한다(규범 A). */
const SCHEMA_VERSION = 1

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
  const env = options.env ?? 'prod'
  const artifactPath = options.artifactPath ?? summaryFile(options.vault, env)
  return await generatorModule.runSummaryGenerator({ ...options, artifactPath, env })
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

/** 문서 변경을 만든다. */
function touchDoc(vault, marker) {
  writeDoc(vault, REL_B, { body: `## 정의\n\n${marker}\n`, id: ID_B, title: '온디바이스 AI' })
}

/**
 * 세대를 **실제로 굴린다** — 문서를 고치고 **커밋한다**. 새 HEAD 를 돌려준다.
 *
 * 🔴 v3 P1(§4.10 「재작성」 · FA6): 결정적 세대 좌표는 `sourceCommit`(= HEAD)뿐이고 **HEAD 는
 *   커밋 없이는 움직이지 않는다**. 게다가 feeds 아티팩트는 문서 본문에 의존하지 않아(items = feed
 *   커밋) 미커밋 저장으로는 **바이트도 안 바뀐다** — 즉 "둘 다 새 세대로 갔다" 를 관측할 수단이
 *   통째로 없어진다.
 *   미커밋 저장의 라이브 반영은 D43 이 명시 수용한 손실이므로(§4.10 「승계처 없음」 3형제) 세대를
 *   커밋으로 굴리는 것이 착륙 후 계약과 같은 방향이다.
 */
function rollGeneration(vault, marker) {
  touchDoc(vault, marker)
  return commit(vault, `chore: ${marker}`)
}

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'))

describe('발행 3종 — 세 파일이 같은 세대다 (FA5 · 🔴RED feeds 아티팩트 미발행)', () => {
  it('FA5: 재생성 1회가 세 파일을 내고 셋의 `sourceCommit` 이 서로 같다', async () => {
    const { vault } = seedVault()

    // 앵커: 실행 **전에는 셋 다 없다**(앞 케이스가 남긴 파일로 통과하는 것을 배제).
    expect(existsSync(summaryFile(vault, 'dev'))).toBe(false)
    expect(existsSync(feedsFile(vault, 'dev'))).toBe(false)
    expect(existsSync(reportFile(vault, 'dev'))).toBe(false)

    const result = await generate({ env: 'dev', vault })

    // 🔴 v3 P1(§4.1 「죽는 앵커」 · 규범 L 상 앵커 교체는 flip = RED 커밋 소관): 예전에는
    //   상태 필드로 "실제로 썼다" 를 보았다. Task 5 가 그 필드를 없애면 자연스러운 수리가 줄 삭제다 — 그러면
    //   "1회차가 실제로 일을 했다" 는 앵커가 통째로 사라져 아래 세대 단언이 공허해진다.
    //   SG4 형태로 승계한다: **세 파일이 실제로 났고 payload 가 비어 있지 않다**(필드가 아니라
    //   산출물로 재생성을 관측한다 — 착륙 후에도 성립한다).
    expect(existsSync(summaryFile(vault, 'dev'))).toBe(true)
    expect(existsSync(feedsFile(vault, 'dev'))).toBe(true)
    expect(existsSync(reportFile(vault, 'dev'))).toBe(true)
    expect(result.payload.docs.length).toBeGreaterThan(0)

    // 🔴 v3 P1(§4.10 「조용한 통과」 최상단 · §4.1 「가장 위험한 변이」의 이 phase 대표 실례):
    //   상관 축을 **`sourceCommit`** 으로 고정한다. 없어진 축으로 두면 착륙 후 값 3개가 전부
    //   `undefined` 가 되어 `new Set([undefined, undefined, undefined]).size === 1` 도
    //   `undefined === undefined` 도 **둘 다 참**이다 — **red 조차 뜨지 않고 세대 정합 계약이
    //   소리 없이 죽는다.** 축만 바꾸는 것으로는 부족하다(아래 값 존재 앵커가 짝이다).
    const generations = [
      readJson(summaryFile(vault, 'dev')).sourceCommit,
      readJson(feedsFile(vault, 'dev')).sourceCommit,
      readJson(reportFile(vault, 'dev')).sourceCommit,
    ]

    // ★ **값 존재 앵커**(SG1·SG2 와 동형) — 같은 공허의 **직접 해독제**다. `undefined` 는 40자리 hex
    //   패턴을 만족할 수 없으므로, 어느 발행물이 축을 잃는 순간 `Set{...}.size === 1` 에 **도달하기
    //   전에** 이 세 줄이 먼저 red 가 된다. 이 앵커 없이 축만 교체하면 같은 함정이 그대로 재발한다.
    for (const value of generations) expect(value).toMatch(/^[0-9a-f]{40}$/u)
    expect(result.sourceCommit).toMatch(/^[0-9a-f]{40}$/u)

    // ★ 조인 키가 **구조적으로 어긋날 수 없다**(B12)는 계약의 생산자 측 증명이다.
    expect(new Set(generations).size).toBe(1)
    expect(generations[0]).toBe(result.sourceCommit)
  })
})

describe('쓰기 순서 계약 — summary 먼저, feeds 나중 (FA6 · 🔴RED 순서·계약 부재)', () => {
  it('FA6: feeds 자리를 막으면 실패하되 **summary 는 이미 새 세대**다', async () => {
    // ★ mtime·벽시계를 쓰지 않는 순서 관측이다(규범 E). 순서가 반대였다면 아래 ②가 "구 세대" 로
    //   관측된다 — 즉 이 단언 하나가 순서를 양방향으로 못박는다.
    //
    // 🔴 v3 P1(§4.10 「재작성」 · 메인 세션 판정 4): 관측 축이 옛 상관 토큰이었고 그 축은
    //   착륙 후 사라진다. **그러나 계약은 살아 있다** — 쓰기 순서(summary → feeds)는 `publishSet`
    //   (`generator.mjs:213-219`)이 **유지하는 현행 계약**이라 승계처 없는 손실이 아니다. 그래서
    //   케이스를 지우지 않고 축만 **`sourceCommit`** 으로 옮긴다(§4.10 이 지정한 셋 중 결정적인 것).
    const { vault } = seedVault()
    const generationOf = (locate) => readJson(locate(vault, 'dev')).sourceCommit

    await generate({ env: 'dev', vault })

    // 앵커 ⓪: 1회차가 **실제로 세 파일을 냈고** 축에 값이 있다(빈 값끼리 비교해 통과하는 것을 배제).
    expect(existsSync(summaryFile(vault, 'dev'))).toBe(true)
    expect(existsSync(feedsFile(vault, 'dev'))).toBe(true)
    const firstSummary = generationOf(summaryFile)
    const firstFeeds = generationOf(feedsFile)
    expect(firstSummary).toMatch(/^[0-9a-f]{40}$/u)
    expect(firstFeeds).toMatch(/^[0-9a-f]{40}$/u)

    // 앵커 ①: **막지 않으면 둘 다** 새 세대로 간다(막았을 때의 관측이 우연이 아니다).
    const controlHead = rollGeneration(vault, '대조 갱신 A')
    await generate({ env: 'dev', vault })
    expect(controlHead).not.toBe(firstSummary)
    expect(generationOf(summaryFile)).toBe(controlHead)
    expect(generationOf(feedsFile)).toBe(controlHead)

    // feeds 자리를 **디렉토리로** 막는다 — rename 이 EISDIR 로 죽는 자리는 여기 하나뿐이다.
    rmSync(feedsFile(vault, 'dev'), { force: true })
    mkdirSync(feedsFile(vault, 'dev'), { recursive: true })
    const blockedHead = rollGeneration(vault, '차단 갱신 B')
    expect(blockedHead).not.toBe(controlHead) // 앵커: 세대가 실제로 굴렀다

    // ① 산출물 실패다(OQ-P5-5 = throw). 리포트만 예외로 흡수한다 — feeds 는 **서빙 데이터**다.
    await expect(generate({ env: 'dev', vault })).rejects.toThrow()

    // ② 그런데도 summary 는 **이미 새 세대**다 → summary 가 feeds 보다 먼저 쓰였다.
    expect(generationOf(summaryFile)).toBe(blockedHead)

    // ③ 막은 것을 치우면 다시 만든다(찢어진 세트를 스킵으로 접지 않는다).
    rmSync(feedsFile(vault, 'dev'), { force: true, recursive: true })
    await generate({ env: 'dev', vault })
    expect(existsSync(feedsFile(vault, 'dev'))).toBe(true)
    expect(generationOf(feedsFile)).toBe(blockedHead)
    expect(generationOf(feedsFile)).toBe(generationOf(summaryFile))
  })
})

describe('버전은 하나다 — 5 산출물 공용 (FA10 · 🔴RED(flip) v3 P1 · D29 리셋)', () => {
  it('FA10: `SCHEMA_VERSION === 1` 이고 다섯 산출물의 버전이 서로 같다', async () => {
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
  })
})
