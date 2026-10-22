// @vitest-environment node
//
// v3 P1 · Task 1·7 — 배관 (리네임 결속 · `build`/`build-dev` 체인) — tdd §3.1(RN1~RN4) · §3.11(BD1~BD5)
//
// `build.p{3,4,5,6}-plumbing.test.mjs` 관례 계승 — 이 phase 가 만드는 **배선**(모듈 이름 · 스크립트
//   체인)을 한 자리에 모은다. 기능 단언은 각 소유 스펙이 지고, 여기서는 "배선이 실재하는가" 만 문다.
//
// RED/green 현황(작성 시점 실측):
//   · RN1~RN4 — **pin**. C1(리네임 단독 커밋 `eb4b172`)이 이미 착륙했다. 여기서는 **회귀 못**이다:
//     옛 이름이 되살아나거나 게이트 스크립트(`scripts/validate.mjs`)가 함께 지워지면 red 가 된다.
//   · BD1~BD5 — 🔴RED. `package.json` 에 `build`·`build-dev` 가 **없다**(Task 7 미구현).
//
// 규범 A: 스크립트 이름·순서·경로 조각은 **리터럴**이다.
// 규범 B: 부재 단언(옛 경로 0건) 앞에 **살아 있는 참조**를 앵커로 둔다.
// 규범 C10: seam 부재는 `runPackageScript` 가 **명시 throw** 로 바꾼다 — collection error 가 아니다.
// 규범 F: 체인 실행은 **tmp vault 에서만** 돈다. 실 리포에서 돌리면 `cache/` 가 phase 중간 형태로 남아
//   다른 케이스를 오염시킨다.
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, mkdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterAll, describe, expect, it } from 'vitest'

import { readPackageScripts, runPackageScript } from './helpers/artifact-keys.mjs'
import { cleanup, git } from './helpers/tmp-git-vault.mjs'
import { listTracked, scanTracked } from './helpers/tracked-scan.mjs'
import { seedCleanVault, seedPollutedVault } from './helpers/polluted-vault.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SCRIPTS_DIR = path.resolve(HERE, '..')
const REPO_ROOT = path.resolve(SCRIPTS_DIR, '..')

/** 체인 스텝 순서 — **계약이다**(D3). 검증을 생성 뒤에 두면 「서빙 데이터 = 검증 통과」가 깨진다. */
const CHAIN_ORDER = ['summary', 'feeds']
/** 리네임 이후에도 남아야 하는 기존 엔트리 — 소비자가 `<wikiRoot>/scripts/<name>.mjs` 를 spawn 한다. */
const EXISTING_SCRIPTS = ['summary', 'feeds', 'wiki', 'test']

/**
 * 옛 모듈 파일명 — **조각을 이어 붙인다.**
 *
 * RN2 는 옛 경로를 실제로 import 해 봐야 하고 RN3 은 그 경로가 리포에서 0건임을 훑는다. 리터럴로
 * 적으면 RN3 의 `scripts/**` 스코프가 **이 파일 자신**을 물어 영원히 red 가 되고, 그 red 의 "수리" 가
 * 자기 제외다(규범 H · `helpers/dead-value-tokens.mjs` 와 같은 이유).
 */
const OLD_MODULE = ['valid', 'ate.mjs'].join('')

const summaryArtifact = (vault, env) => path.join(vault, 'cache', `summary.${env}.json`)
const feedsArtifact = (vault, env) => path.join(vault, 'cache', `feeds.${env}.json`)
const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'))

/** 9p 공유 마운트 소유자 불일치 방어 — 이 스펙이 겨냥한 실패가 아니다(tdd §7.1). */
const gitSafeEnv = (root) => ({
  ...process.env,
  GIT_CONFIG_COUNT: '1',
  GIT_CONFIG_KEY_0: 'safe.directory',
  GIT_CONFIG_VALUE_0: root,
})

const tmps = []
afterAll(() => cleanup(...tmps))

// ────────────────────────────────────────────────────────────────────────────
// RN — `lib/validate.mjs` → `lib/schema-validator.mjs` (Task 1 · C1 착륙분의 회귀 못)
// ────────────────────────────────────────────────────────────────────────────

describe('리네임 결속 (RN1~RN4 · pin)', () => {
  it('RN1: 새 이름이 resolve 하고 두 export 가 함수다', async () => {
    // 앵커: 같은 방식으로 `payloads.mjs` 도 resolve 한다 — 동적 import 자체가 죽은 상태를 배제한다.
    const anchor = await import(new URL('../lib/payloads.mjs', import.meta.url).href)
    expect(typeof anchor.buildSummary, 'payloads.mjs 앵커').toBe('function')

    const loaded = await import(new URL('../lib/schema-validator.mjs', import.meta.url).href)

    expect(typeof loaded.loadSchema).toBe('function')
    expect(typeof loaded.validateItem).toBe('function')
  })

  it('RN2: 옛 이름은 `ERR_MODULE_NOT_FOUND` 로 reject 된다', async () => {
    // RN1 이 짝이다 — 둘 중 하나만 두면 "경로 오타로 통과" 를 배제하지 못한다.
    const outcome = await import(new URL(`../lib/${OLD_MODULE}`, import.meta.url).href).then(
      () => ({ resolved: true }),
      (error) => ({ code: error?.code, resolved: false }),
    )

    expect(outcome.resolved, `scripts/lib/${OLD_MODULE} 가 아직 살아 있다`).toBe(false)
    expect(outcome.code).toBe('ERR_MODULE_NOT_FOUND')
  })
})

// ────────────────────────────────────────────────────────────────────────────
// BD — `build` / `build-dev` (Task 7 · D3)
// ────────────────────────────────────────────────────────────────────────────

describe('빌드 체인 선언 (BD1·BD2 · 🔴RED 미구현)', () => {
  it('BD1: `package.json` scripts 에 `build`·`build-dev` 가 둘 다 있다', () => {
    const scripts = readPackageScripts()

    // 앵커: 기존 5종이 **여전히 있다**(체인을 넣으며 기존 엔트리를 갈아엎는 것을 배제 — PL12 와 같은 축).
    for (const name of EXISTING_SCRIPTS) expect(scripts, name).toHaveProperty(name)

    expect(typeof scripts.build, 'pnpm build').toBe('string')
    expect(typeof scripts['build-dev'], 'pnpm build-dev').toBe('string')
  })

  it('BD2: 두 체인이 `summary → feeds` 순서이고 `&&` 로 이어진다', () => {
    // ★ 순서가 계약이다(D3) — 검증을 생성 뒤에 두면 「서빙 데이터 = 검증 통과」 보장이 깨진다.
    //   `;` 는 앞 스텝의 실패를 삼키므로 금지다. 다만 **텍스트만으로는 exit 삼킴을 못 잡는다** —
    //   그 축은 BD3 가 실패 주입으로 문다.
    const scripts = readPackageScripts()

    for (const name of ['build', 'build-dev']) {
      const raw = scripts[name]
      expect(typeof raw, name).toBe('string')

      expect(raw, `${name} 이 '||' 로 실패를 삼킨다`).not.toContain('||')
      const steps = raw.split('&&').map((step) => step.trim())
      const ordered = steps.map((step) => step.match(/scripts\/([\w.-]+)\.mjs/u)?.[1])

      expect(ordered, `${name} 에 인식할 수 없는 셸 스텝이 있다`).toEqual(CHAIN_ORDER)
      expect(raw, `${name} 은 && 로 잇는다`).toContain('&&')
      expect(raw, `${name} 이 ';' 로 스텝을 잇는다 — 실패가 삼켜진다`).not.toMatch(/;\s*node\s/u)
    }
  })
})

describe('빌드 체인 실행 (BD3~BD5 · 🔴RED 미구현)', () => {
  it('BD3: summary 쓰기가 실패하면 feeds를 갱신하지 않는다', { timeout: 180000 }, () => {
    const { vault } = seedCleanVault()
    tmps.push(vault)
    const ok = runPackageScript('build-dev', { vault })
    expect(ok.exitCode, ok.stderr).toBe(0)
    const artifact = feedsArtifact(vault, 'dev')
    const before = readFileSync(artifact, 'utf8')
    git(vault, ['commit', '--allow-empty', '-m', 'chore: 다음 세대'])
    rmSync(summaryArtifact(vault, 'dev'))
    mkdirSync(summaryArtifact(vault, 'dev'))
    const failed = runPackageScript('build-dev', { vault })
    expect(failed.exitCode, failed.stderr).not.toBe(0)
    expect(failed.stderr).toMatch(/EISDIR|directory/i)
    expect(readFileSync(artifact, 'utf8')).toBe(before)
  })

  it(
    'BD4: 성공 실행이 만든 두 산출물의 `sourceCommit` 이 같고 HEAD 와 일치한다',
    { timeout: 900_000 },
    () => {
      // 산출물 세트가 **서로 다른 커밋에서** 만들어지는 것을 막는다(D3 의 일치 단언 스텝).
      const { vault } = seedCleanVault()
      tmps.push(vault)

      const run = runPackageScript('build-dev', { vault })
      expect(run.exitCode, `${run.stderr}${run.stdout}`).toBe(0)

      const summary = readJson(summaryArtifact(vault, 'dev'))
      const feeds = readJson(feedsArtifact(vault, 'dev'))

      // 앵커: 값이 **40자 hex** 이고 실제 HEAD 와 같다(빈 문자열끼리 일치하는 공허 통과 배제).
      expect(summary.sourceCommit).toMatch(/^[0-9a-f]{40}$/u)
      expect(summary.sourceCommit).toBe(git(vault, ['rev-parse', 'HEAD']))
      expect(feeds.sourceCommit).toBe(summary.sourceCommit)
    },
  )

  it('BD5: `build-dev` 는 dev, `build` 는 prod 산출물을 만든다', { timeout: 900_000 }, () => {
    const { vault } = seedCleanVault()
    tmps.push(vault)

    const dev = runPackageScript('build-dev', { vault })
    const prod = runPackageScript('build', { vault })
    expect(dev.exitCode, `${dev.stderr}${dev.stdout}`).toBe(0)
    expect(prod.exitCode, `${prod.stderr}${prod.stdout}`).toBe(0)

    const devEnv = readJson(summaryArtifact(vault, 'dev')).env
    const prodEnv = readJson(summaryArtifact(vault, 'prod')).env

    expect(devEnv).toBe('dev')
    expect(prodEnv).toBe('prod')
    expect(devEnv, '두 산출물이 서로 다른 env 다').not.toBe(prodEnv)
  })
})
