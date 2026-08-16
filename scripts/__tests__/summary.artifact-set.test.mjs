// @vitest-environment node
//
// P5 · Task 2·5 — 발행 아티팩트와 항상 생성 계약 (D-C·D-D·D-G) — tdd §3.2 (FA5~FA12)
//
// 무엇이 바뀌는가: 빌드 체인이 `cache/summary.<env>.json` · `cache/feeds.<env>.json`(내부 · 억제
//   **전** 전량) · `logs/summary.report.<env>.{json,txt}` 를 낸다. 발행 주체는 summary · feeds ·
//   validate 로 갈렸고, 쓰기 순서는 체인의 `&&` 가 만든다.
//
// RED 사유(전부 **미구현**):
//   · 공통 — `scripts/lib/generator.mjs` 가 없다(**OQ-P5-1 = A** 확정: `runSummaryGenerator` 를 CLI
//     밖으로 옮기고 **재export 는 두지 않는다**). 이 파일은 새 거처를 seam 으로 삼는다 — 옛 거처를
//     물면 GREEN 이 끝나도 이 파일만 옛 결합을 살려두게 된다.
//   · FA5·FA11·FA12 — feeds 아티팩트가 발행되지 않는다.
//   · FA6 — 쓰기 순서 계약 자체가 없다(**OQ-P5-5 = exit 1** 확정 — 산출물 실패다).
//   · FA10 — `SCHEMA_VERSION` 이 2 이고 리포트만 1 이다.
//
// 관측 층(tdd §7.5): 생성기 반환 객체, 프로세스 exit code, 발행된 파일 중 케이스별 소유 축만 본다.
//   stdout payload 계약은 기존 `summary.cli-exit.test.mjs` 가 문다.
//
// 규범 A: 경로 조각·버전·억제 엔트리는 **리터럴**이다. 정확 경로 형태의 고정은 **PL9**
//   한 곳이 맡고, 여기서는 그 경로를 좌표로 쓴다(둘이 같은 것을 두 번 물지 않는다).
// 규범 B: 부재·불변 단언 앞에 앵커를 둔다 — 실행 전 파일이 없었다 · 막지 않으면 둘 다 갱신된다 ·
//   위조 전에는 스킵했다 · 값이 epoch 기본값이 아니다.
// 규범 F: 실 vault 를 건드리지 않는다 — 억제 엔트리는 tmp git vault 에서만 만든다.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterAll, describe, expect, it } from 'vitest'

import { cleanup, commit, feedCommit, initVault, writeDoc } from './helpers/tmp-git-vault.mjs'
import { runPackageScript } from './helpers/artifact-keys.mjs'

// 신설 모듈 부재가 파일 전체를 죽이는 collection error 가 되지 않도록 지연 import 로 붙든다(tdd §7.3).
//   `rtk` 는 collection error 를 PASS 로 오보고하므로 부재는 **케이스별 명시 실패**여야 한다.
const generatorModule = await import(new URL('../lib/generator.mjs', import.meta.url).href).catch(
  (error) => ({ __loadError: error instanceof Error ? error.message : String(error) }),
)
const payloadsModule = await import(new URL('../lib/payloads.mjs', import.meta.url).href)
const feedsModule = await import(new URL('../feeds.mjs', import.meta.url).href)

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SCRIPTS_DIR = path.resolve(HERE, '..')
const SUMMARY_CLI = path.join(SCRIPTS_DIR, 'summary.mjs')
const FEEDS_CLI = path.join(SCRIPTS_DIR, 'feeds.mjs')
const VALIDATE_CLI = path.join(SCRIPTS_DIR, 'validate.mjs')

/** 산출물 3종의 경로 — **리터럴 조립**이다(규범 A). 정확 형태의 계약은 PL9 가 한 번만 고정한다. */
const summaryFile = (vault, env) => path.join(vault, 'cache', `summary.${env}.json`)
const feedsFile = (vault, env) => path.join(vault, 'cache', `feeds.${env}.json`)
const reportFile = (vault, env) => path.join(vault, 'logs', `summary.report.${env}.json`)

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

async function generateFeeds(options) {
  if (generatorModule.__loadError !== undefined) {
    throw new Error(
      `[RED] scripts/lib/generator.mjs 가 아직 없다 (runFeedsGenerator 미구현): ${generatorModule.__loadError}`,
    )
  }
  if (typeof generatorModule.runFeedsGenerator !== 'function') {
    throw new Error('[RED] scripts/lib/generator.mjs 에 runFeedsGenerator export 가 아직 없다')
  }
  const env = options.env ?? 'prod'
  const artifactPath = options.artifactPath ?? feedsFile(options.vault, env)
  return await generatorModule.runFeedsGenerator({ ...options, artifactPath, env })
}

/**
 * 서브프로세스 상한 — `spawnSync` 는 완전히 동기라 vitest 의 it()-레벨 타임아웃(비동기 타이머)으로는
 * 끊을 수 없다. 자식이 행(hang)하면 워커 전체가 무한정 멈추므로 `timeout` 옵션이 유일한 안전장치다.
 * 이 리포의 기존 자식 spawn 상한(`helpers/runtime-load.mjs`·`helpers/cursor-vault.mjs` 의
 * `timeoutMs = 120_000`)과 같은 값을 재사용한다(새 매직넘버를 만들지 않는다).
 */
const CLI_SPAWN_TIMEOUT_MS = 120_000

/** @param {string} vault 이 spawn 이 실제로 향하는 vault — `safe.directory` 좁힘 대상. */
function runCli(script, args, vault) {
  const result = spawnSync(process.execPath, [script, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'safe.directory',
      // ★ '*'(전 경로 허용)가 아니라 이 호출이 실제로 겨냥하는 vault 다 — 세 호출부
      //   (publishSummary·publishFeeds·publishReport) 모두 tmp vault 다. tmp vault 는 mkdtemp 로
      //   실행 유저 소유라 dubious-ownership 조건에 애초에 안 걸리므로 이 값이 정확해도 무해하다.
      GIT_CONFIG_VALUE_0: vault,
      SOURCE_DATE_EPOCH: '1700000000',
    },
    maxBuffer: 64 * 1024 * 1024,
    timeout: CLI_SPAWN_TIMEOUT_MS,
  })

  // `timeout` 만 넣고 결과를 안 보면 여전히 조용하다 — 타임아웃으로 죽은 자식은 `status: null` 이
  //   되어 그 뒤 `expect(result.status).toBe(0)` 류에 기대는 수밖에 없다. `error`/`signal` 은
  //   spawnSync 가 비정상 종료(spawn 실패·타임아웃·시그널)일 때만 채워지므로 여기서 즉시 크게 실패시킨다.
  if (result.error || result.signal) {
    throw new Error(
      `runCli 자식 프로세스 비정상 종료: script=${script} error=${result.error?.message ?? 'none'} signal=${result.signal ?? 'none'}`,
    )
  }
  return result
}

const publishSummary = (vault, env = 'dev') =>
  runCli(SUMMARY_CLI, ['--vault', vault, '--env', env, '--out', summaryFile(vault, env)], vault)
const publishFeeds = (vault, env = 'dev') =>
  runCli(
    FEEDS_CLI,
    ['--vault', vault, '--env', env, '--count', '200', '--out', feedsFile(vault, env)],
    vault,
  )
const publishReport = (vault, env = 'dev') =>
  runCli(VALIDATE_CLI, ['--vault', vault, '--env', env, '--out', path.join(vault, 'logs')], vault)

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
  // ★ 타임아웃 상향 사유(OQ-P1-2 = c · 전역 상향 금지): Task 7 이 발행 주체를 셋으로 가르면서 이
  //   케이스의 Arrange 가 in-process 호출 1회에서 **CLI spawn 3회**가 됐다. spawn 마다 vault 를 다시
  //   파싱하므로 실측 15.3 s 로 기본 30 s 에 근접한다 — 9p 마운트 경합이 겹치면 넘는다.
  //   단언은 한 줄도 바뀌지 않았다(타임아웃은 계약이 아니다).
  it(
    'FA5: 빌드가 세 파일을 내고 셋의 `sourceCommit` 이 서로 같다',
    { timeout: 300_000 },
    async () => {
      const { vault } = seedVault()

      // ★ S1 — 이 블록이 CLI 를 summary→feeds→report 순으로 부르는 것 자체는 계약이 아니다. 그
      //   순서를 스스로 정하고 "지켜졌다" 를 스스로 증명하면, 실제 빌드 체인의 순서가 바뀌어도 이
      //   블록은 알아채지 못한다(자기충족적 검증) — 세 CLI 는 서로 독립된 프로세스라 호출 순서와
      //   무관하게 exit code·`sourceCommit` 이 같아지기 때문이다. 순서 계약의 소유자는
      //   `package.json` 의 빌드 체인(`build-dev`)이다(아래 `IW5` 와 같은 패턴 — 파일 로컬 재사용) —
      //   그 소유자가 정한 상대 순서(summary 가 feeds 보다 앞선다)를 여기서 직접 읽어 대조한다.
      const buildScripts = JSON.parse(
        readFileSync(path.join(SCRIPTS_DIR, '..', 'package.json'), 'utf8'),
      ).scripts
      const chainOrder = ['summary.mjs', 'feeds.mjs'].map((step) =>
        buildScripts['build-dev'].indexOf(step),
      )
      expect(chainOrder[0], 'build-dev 체인에 summary.mjs 가 없다').toBeGreaterThanOrEqual(0)
      expect(chainOrder[1], 'build-dev 체인에 feeds.mjs 가 없다').toBeGreaterThanOrEqual(0)
      expect(
        chainOrder[0],
        '체인 순서 회귀: build-dev 에서 summary.mjs 가 feeds.mjs 보다 뒤에 있다',
      ).toBeLessThan(chainOrder[1])

      // 앵커: 실행 **전에는 셋 다 없다**(앞 케이스가 남긴 파일로 통과하는 것을 배제).
      expect(existsSync(summaryFile(vault, 'dev'))).toBe(false)
      expect(existsSync(feedsFile(vault, 'dev'))).toBe(false)
      expect(existsSync(reportFile(vault, 'dev'))).toBe(false)

      const summaryRun = publishSummary(vault)
      const feedsRun = publishFeeds(vault)
      const reportRun = publishReport(vault)

      expect(summaryRun.status, summaryRun.stderr).toBe(0)
      expect(feedsRun.status, feedsRun.stderr).toBe(0)
      expect(reportRun.status, `${reportRun.stderr}${reportRun.stdout}`).toBe(0)

      // 🔴 v3 P1(§4.1 「죽는 앵커」 · 규범 L 상 앵커 교체는 flip = RED 커밋 소관): 발행 주체가
      //   summary · feeds · validate 셋으로 갈렸으므로, "한 생성기 실행이 셋을 썼다" 가 아니라
      //   **빌드가 세 파일을 실제로 냈다**를 관측한다.
      expect(existsSync(summaryFile(vault, 'dev'))).toBe(true)
      expect(existsSync(feedsFile(vault, 'dev'))).toBe(true)
      expect(existsSync(reportFile(vault, 'dev'))).toBe(true)
      expect(readJson(summaryFile(vault, 'dev')).docs.length).toBeGreaterThan(0)

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

      // ★ 조인 키가 **구조적으로 어긋날 수 없다**(B12)는 계약의 생산자 측 증명이다.
      expect(new Set(generations).size).toBe(1)
    },
  )
})

describe('쓰기 순서 계약 — summary 먼저, feeds 나중 (FA6 · 🔴RED 순서·계약 부재)', () => {
  // ★ 타임아웃 상향 사유(OQ-P1-2 = c): 관측을 프로세스 경계로 올리면서 **CLI spawn 7회** + 세대 굴림
  //   2회가 됐다. 실측 **35.5 s 로 기본 30 s 를 초과**해 red 였다(메시지 없는 `STACK_TRACE_ERROR` —
  //   이 리포의 타임아웃 서명이다). 단언은 그대로다.
  it(
    'FA6: feeds 자리를 막으면 실패하되 **summary 는 이미 새 세대**다',
    { timeout: 300_000 },
    async () => {
      // ★ mtime·벽시계를 쓰지 않는 순서 관측이다(규범 E). 순서가 반대였다면 아래 ②가 "구 세대" 로
      //   관측된다 — 즉 이 단언 하나가 순서를 양방향으로 못박는다.
      //
      // 🔴 v3 P1(§4.10 「재작성」 · 메인 세션 판정 4): 관측 축이 옛 상관 토큰이었고 그 축은
      //   착륙 후 사라진다. **그러나 계약은 살아 있다** — 쓰기 순서(summary → feeds)는 이제 생성기
      //   내부 `publishSet` 이 아니라 체인의 `&&` 가 만든다. 그래서 관측을 프로세스 경계로 올리고,
      //   축은 **`sourceCommit`** 으로 옮긴다(§4.10 이 지정한 셋 중 결정적인 것).
      const { vault } = seedVault()
      const generationOf = (locate) => readJson(locate(vault, 'dev')).sourceCommit

      expect(publishSummary(vault).status).toBe(0)
      expect(publishFeeds(vault).status).toBe(0)

      // 앵커 ⓪: 1회차가 **실제로 세 파일을 냈고** 축에 값이 있다(빈 값끼리 비교해 통과하는 것을 배제).
      expect(existsSync(summaryFile(vault, 'dev'))).toBe(true)
      expect(existsSync(feedsFile(vault, 'dev'))).toBe(true)
      const firstSummary = generationOf(summaryFile)
      const firstFeeds = generationOf(feedsFile)
      expect(firstSummary).toMatch(/^[0-9a-f]{40}$/u)
      expect(firstFeeds).toMatch(/^[0-9a-f]{40}$/u)

      // 앵커 ①: **막지 않으면 둘 다** 새 세대로 간다(막았을 때의 관측이 우연이 아니다).
      const controlHead = rollGeneration(vault, '대조 갱신 A')
      expect(publishSummary(vault).status).toBe(0)
      expect(publishFeeds(vault).status).toBe(0)
      expect(controlHead).not.toBe(firstSummary)
      expect(generationOf(summaryFile)).toBe(controlHead)
      expect(generationOf(feedsFile)).toBe(controlHead)

      // feeds 자리를 **디렉토리로** 막는다 — rename 이 EISDIR 로 죽는 자리는 여기 하나뿐이다.
      rmSync(feedsFile(vault, 'dev'), { force: true })
      mkdirSync(feedsFile(vault, 'dev'), { recursive: true })
      const blockedHead = rollGeneration(vault, '차단 갱신 B')
      expect(blockedHead).not.toBe(controlHead) // 앵커: 세대가 실제로 굴렀다

      // ① 산출물 실패다(OQ-P5-5 = exit≠0). 리포트만 예외로 흡수한다 — feeds 는 **서빙 데이터**다.
      expect(publishSummary(vault).status).toBe(0)
      const blockedFeeds = publishFeeds(vault)
      expect(blockedFeeds.status, blockedFeeds.stderr).not.toBe(0)

      // ② 그런데도 summary 는 **이미 새 세대**다 → summary 가 feeds 보다 먼저 쓰였다.
      expect(generationOf(summaryFile)).toBe(blockedHead)

      // ③ 막은 것을 치우면 다시 만든다(찢어진 세트를 스킵으로 접지 않는다).
      rmSync(feedsFile(vault, 'dev'), { force: true, recursive: true })
      expect(publishFeeds(vault).status).toBe(0)
      expect(existsSync(feedsFile(vault, 'dev'))).toBe(true)
      expect(generationOf(feedsFile)).toBe(blockedHead)
      expect(generationOf(feedsFile)).toBe(generationOf(summaryFile))
    },
  )
})

describe('버전은 하나다 — 5 산출물 공용 (FA10 · 🔴RED(flip) v3 P1 · D29 리셋)', () => {
  // ★ 타임아웃 상향 사유(OQ-P1-2 = c): 위와 같다 — Arrange 가 spawn 2회가 되며 실측 12.9 s.
  it(
    'FA10: `SCHEMA_VERSION === 1` 이고 다섯 산출물의 버전이 서로 같다',
    { timeout: 300_000 },
    async () => {
      // ★ 분리 금지 pin 의 확장. 페이로드별로 쪼개면 소비자 `WikiDataProvider` 부팅 게이트가
      //   **영구 false** 가 된다(P2 확정 · 재론 금지). §4 원장 ⑭~⑱ 이 뒤집히는 리터럴을 지목한다.
      const { vault } = seedVault()
      await generate({ env: 'dev', vault })
      await generateFeeds({ env: 'dev', vault })
      expect(publishReport(vault).status).toBe(0)

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
    },
  )
})

// ────────────────────────────────────────────────────────────────────────────────────────────
// v3 P2 · Task 7 — **FA11 축 교체**(§4.3). 삭제가 아니라 **대체**다.
//
// 옛 축(FA11): _"억제 id 가 **파일에는 있고** 응답에는 없다"_ — 아티팩트가 **억제 전** 전량이라는
//   전제 위에 섰다. **D20 이후 그 전제가 사라진다**: 빌드가 `--ignore` 를 붙여 아티팩트를 **억제 후**로
//   만들므로 FA11 의 앵커(_"파일에는 있다"_)가 공허해지고, 앵커만 지우면 남은 부재 단언이 **영구 자동
//   참**이 된다(M7 · P1 tdd `:693` 이 경고한 형태).
//
// ★ 「승계」가 아니라 「대체」다 — CS8·HV5·FA11 의 원래 방어는 _"내부 아티팩트를 raw 로 흘리면 억제가
//   통째로 무효"_ 였고, 아티팩트가 억제 후가 되면 **그 위험 자체가 소멸**한다(raw 서빙해도 억제는
//   유효). 새 축은 **다른 계약**(_"억제가 빌드에 적용된다"_)이며 옛 목적의 승계가 아니다.
//   이 문단이 없으면 다음 독자가 "방어가 약해졌다" 고 읽는다.
//
// 옛 축 FA11(_"억제 id 가 파일에는 있고 응답에는 없다"_)은 **C4 에서 삭제됐다** — 아티팩트가 억제
//   후가 되면 그 단언은 참일 수 없고, 앵커만 지우고 부재 단언을 남기면 영구 자동 참이 된다(M7).
//   승계처는 아래 IW1 이며 새 앵커는 **`--ignore` 없는 대조 arm** 이다.
// ────────────────────────────────────────────────────────────────────────────────────────────

describe('빌드가 억제를 적용한다 (IW1 · FA11 축 교체 · 🔴RED `--ignore` 미배선)', () => {
  it(
    'IW1: `build-dev` 산출 파일에 억제 id 가 **없다** — `--ignore` 를 빼면 나타난다',
    { timeout: 900_000 },
    () => {
      // prettier-ignore
      // ★★ 대조 arm 이 **새 앵커**다. 이것을 빼면 부재 단언이 영구 자동 참이 된다(CX10 이 메타로 증명한다).
      // ★ 체인을 재구현하지 않는다 — `runPackageScript` 가 `package.json` 문자열을 **읽어** vault 만
      //   tmp 로 재조준한다. 재구현하면 "우리가 만든 체인으로는 되더라" 가 되어 IW5 가 무의미해진다.
      const { feedId, vault } = seedVault()
      // ★ 억제되지 **않는** 피드를 하나 더 둔다. `seedVault()` 의 피드는 1건뿐이라 그것을 억제하면
      //   산출 파일이 통째로 비고, 그러면 아래 앵커(_"파일이 비어 있지 않다"_)가 성립할 수 없다 —
      //   빈 파일에서는 `not.toContain` 이 **영구 자동 참**이 되므로 그 앵커가 이 케이스의 계약이다.
      writeDoc(vault, REL_B, { body: '## 정의\n\n생존 피드용 갱신.\n', id: ID_B, title: '온디바이스 AI' }) // prettier-ignore
      const survivorId = feedCommit(vault, { date: FEED_TS, subject: '살아남는 소식' }).slice(0, 12)
      writeFileSync(
        path.join(vault, IGNORE_FILE),
        JSON.stringify([{ id: feedId, when: IGNORE_WHEN }]),
        'utf8',
      )

      // ── 대조 arm(앵커): `--ignore` **없이** 같은 vault 를 빌드하면 그 id 가 파일에 **나타난다** ──
      const control = publishFeeds(vault, 'dev')
      expect(control.status, control.stderr).toBe(0)
      const controlItems = readJson(feedsFile(vault, 'dev')).items
      expect(controlItems.length, '대조 arm 파일이 비었다').toBeGreaterThan(0)
      expect(controlItems.map((item) => item.id), '앵커: 억제 없이 빌드하면 그 id 가 있다').toContain(feedId) // prettier-ignore

      rmSync(feedsFile(vault, 'dev'), { force: true })

      // ── 본 arm: 빌드 체인(`build-dev`)이 `--ignore` 를 붙인다 ──────────────────────────────
      const build = runPackageScript('build-dev', { vault })
      expect(build.exitCode, `${build.command}\n${build.stderr}`).toBe(0)

      const items = readJson(feedsFile(vault, 'dev')).items
      // 앵커: 산출 파일이 비어 있지 않다(빈 파일로 `not.toContain` 이 통과하는 것을 배제).
      expect(
        items.map((item) => item.id),
        '빌드 산출 파일이 비었다',
      ).toContain(survivorId)
      expect(
        items.map((item) => item.id),
        '억제 id 가 빌드 산출물에 남았다',
      ).not.toContain(feedId)
    },
  )

  it('IW5: `package.json` 의 `build`·`build-dev` 가 `--ignore` 를 싣는다 (텍스트 겹)', () => {
    // ★ 행동 겹(IW1)과 **텍스트 겹**을 가른다 — CX9(인자를 받고도 무시하는 변이)에서 **이 케이스만**
    //   green 이고 행동 겹(IW1·IW2·IW6·IW7 + webfront IW3·IW4)은 전부 red 다(C6 실측). 둘을 합치면
    //   그 진단이 사라진다. 반대로 CX8(`build-dev` 에서 `--ignore` 만 제거)에서는 이 케이스와 IW1 이
    //   **함께** red 다 — 두 겹이 무는 층이 다르다는 것이 그 두 실측의 대조로 확정된다.
    const scripts = JSON.parse(readFileSync(path.join(SCRIPTS_DIR, '..', 'package.json'), 'utf8')).scripts // prettier-ignore

    for (const name of ['build', 'build-dev']) {
      // 앵커: 같은 문자열이 `--count 200`·`--out` 을 **여전히** 담고 순서가 validate → summary → feeds 다.
      expect(scripts[name], `${name} 앵커: --count 200`).toContain('--count 200')
      expect(scripts[name], `${name} 앵커: --out`).toContain('--out')
      const order = ['validate.mjs', 'summary.mjs', 'feeds.mjs'].map((step) => scripts[name].indexOf(step)) // prettier-ignore
      expect(order[0], `${name} 순서`).toBeLessThan(order[1])
      expect(order[1], `${name} 순서`).toBeLessThan(order[2])

      expect(scripts[name], `현행: ${scripts[name]}`).toContain('--ignore')
    }
  })
})

describe('두 아티팩트가 같은 커밋에서 나온다 (FA12 · 🔴RED 파일 부재)', () => {
  it('FA12: feeds 아티팩트의 `generatedAt`·`sourceCommit` 이 summary 와 같다', async () => {
    const { vault } = seedVault()
    await generate({ env: 'dev', vault })
    await generateFeeds({ env: 'dev', vault })

    const summary = readJson(summaryFile(vault, 'dev'))
    const feedsArtifact = readJson(feedsFile(vault, 'dev'))

    // summary 와 feeds 는 별도 파싱에서 나오지만 같은 HEAD 를 읽는다. `generatedAt` 은
    // max(doc.updated) 로 결정적이고, `sourceCommit` 은 HEAD 이므로 두 값은 여전히 일치해야 한다.
    // 앵커: 둘 다 **기본값이 아니다**(둘 다 비어서 같은 것을 배제).
    expect(summary.generatedAt).not.toBe(EPOCH_ZERO)
    expect(summary.sourceCommit).toMatch(/^[0-9a-f]{40}$/u)

    expect(feedsArtifact.generatedAt).toBe(summary.generatedAt)
    expect(feedsArtifact.sourceCommit).toBe(summary.sourceCommit)
  })
})
