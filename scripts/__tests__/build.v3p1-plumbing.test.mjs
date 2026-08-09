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
import { existsSync, readFileSync, statSync } from 'node:fs'
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
const CHAIN_ORDER = ['validate', 'summary', 'feeds']
/** 리네임 이후에도 남아야 하는 기존 엔트리 — 소비자가 `<wikiRoot>/scripts/<name>.mjs` 를 spawn 한다. */
const EXISTING_SCRIPTS = ['validate', 'summary', 'feeds', 'wiki', 'test']

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
const gitSafeEnv = () => ({
  ...process.env,
  GIT_CONFIG_COUNT: '1',
  GIT_CONFIG_KEY_0: 'safe.directory',
  GIT_CONFIG_VALUE_0: '*',
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

  it('RN3: **디렉토리로 스코프한** 옛 지정자 4종의 히트가 0이다', () => {
    // ★ 스코프가 계약이다. 스코프 없이 `'../validate.mjs'` 를 금지하면 `scripts/__tests__/` 19파일이
    //   가리키는 **게이트 스크립트**(`scripts/validate.mjs`)까지 잡혀 영원히 충족 불가능해진다
    //   (tdd §3.1 RN3 정정). 아래 좌표는 그 정정본이다.
    // ★ 지정자 리터럴은 모듈 상단 `OLD_MODULE` 이 조각으로 만든다 — `scripts/**` 스코프가 **이 파일
    //   자신**을 포함하므로 리터럴로 적으면 스캐너가 자기 자신을 물고, 그 red 의 "수리" 가 자기
    //   제외가 된다(규범 H). RN2 의 import 경로도 같은 조각을 쓴다.
    const old = OLD_MODULE
    const { files } = listTracked(REPO_ROOT)
    const scoped = (prefix) => files.filter((rel) => rel.startsWith(prefix))

    // 앵커 ①: 게이트 스크립트를 가리키는 **정당한** 참조는 살아 있어야 한다(19파일 · 실측).
    const gateRefs = scanTracked({
      files: scoped('scripts/__tests__/'),
      pattern: new RegExp(`'\\.\\./${old}'`, 'u'),
      repoRoot: REPO_ROOT,
    })
    expect(new Set(gateRefs.hits.map((hit) => hit.path)).size).toBeGreaterThanOrEqual(19)

    // 앵커 ②: 새 이름이 **프로덕션 4파일**에 정확히 배선됐고, 리포 전체로는 19파일 이상이 쓴다.
    //   ☞ 총합을 정확 일치로 못박지 않는 이유: 테스트 파일이 늘 때마다 이 숫자가 흔들리고, 그러면
    //     "숫자를 맞추려고" 가드를 고치게 된다. **계약이 사는 곳은 프로덕션 배선**이다(4 = 게이트
    //     스크립트 1 + `lib/` 3 · 실측). C2 시점 총합은 22 다(신규 스펙 3파일 포함).
    const renamed = scanTracked({
      files: scoped('scripts/'),
      pattern: /schema-validator\.mjs/u,
      repoRoot: REPO_ROOT,
    })
    const renamedFiles = [...new Set(renamed.hits.map((hit) => hit.path))]
    const production = renamedFiles.filter((rel) => !rel.includes('__tests__'))

    expect(production.toSorted()).toEqual([
      'scripts/lib/doc-gate.mjs',
      'scripts/lib/head-state.mjs',
      'scripts/lib/ignore.mjs',
      'scripts/validate.mjs',
    ])
    expect(renamedFiles.length).toBeGreaterThanOrEqual(19)

    const offenders = [
      ...scanTracked({ files: scoped('scripts/lib/'), pattern: new RegExp(`'\\./${old}'`, 'u'), repoRoot: REPO_ROOT }).hits, // prettier-ignore
      ...scanTracked({ files: scoped('scripts/lib/__tests__/'), pattern: new RegExp(`'\\.\\./${old}'`, 'u'), repoRoot: REPO_ROOT }).hits, // prettier-ignore
      ...scanTracked({ files: scoped('scripts/'), pattern: new RegExp(`'\\.\\.?/lib/${old}'`, 'u'), repoRoot: REPO_ROOT }).hits, // prettier-ignore
    ].map((hit) => `${hit.path}:${hit.line}`)

    expect(offenders, '옛 모듈 지정자가 남아 있다').toEqual([])
  })

  it('RN4: 게이트 스크립트 `scripts/validate.mjs` 는 **여전히 존재한다**', () => {
    // ★ 리네임의 목적이 그쪽과의 이름 충돌 해소다. 이 앵커가 없으면 "둘 다 지웠다" 가 통과한다.
    expect(existsSync(path.join(SCRIPTS_DIR, 'validate.mjs'))).toBe(true)
    expect(existsSync(path.join(SCRIPTS_DIR, 'lib', 'schema-validator.mjs'))).toBe(true)
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

  it('BD2: 두 체인이 `validate → summary → feeds` 순서이고 `&&` 로 이어진다', () => {
    // ★ 순서가 계약이다(D3) — 검증을 생성 뒤에 두면 「서빙 데이터 = 검증 통과」 보장이 깨진다.
    //   `;` 는 앞 스텝의 실패를 삼키므로 금지다. 다만 **텍스트만으로는 exit 삼킴을 못 잡는다** —
    //   그 축은 BD3 가 실패 주입으로 문다.
    const scripts = readPackageScripts()

    for (const name of ['build', 'build-dev']) {
      const raw = scripts[name]
      expect(typeof raw, name).toBe('string')

      const steps = raw.split('&&').map((step) => step.trim())
      const ordered = steps
        .map((step) => step.match(/scripts\/([\w.-]+)\.mjs/u)?.[1])
        .filter(Boolean)

      expect(ordered.slice(0, CHAIN_ORDER.length), name).toEqual(CHAIN_ORDER)
      expect(raw, `${name} 은 && 로 잇는다`).toContain('&&')
      expect(raw, `${name} 이 ';' 로 스텝을 잇는다 — 실패가 삼켜진다`).not.toMatch(/;\s*node\s/u)
    }
  })
})

describe('빌드 체인 실행 (BD3~BD5 · 🔴RED 미구현)', () => {
  it('BD3: 검증 실패는 exit≠0 이고 **캐시를 갱신하지 않는다**', { timeout: 900_000 }, () => {
    // ★ D3 의 **유일한 결정적 관측점**이다. "validate 가 맨 앞이므로 순서로 보장된다" 는 주장이고,
    //   `&&` 가 실제로 그 보장을 만드는지는 **실패를 주입해야만** 안다.
    // ★ GREEN 계약: 체인의 `--out` 는 `--vault` 에서 **파생**되어야 한다.
    //   고정 상대경로를 쓰면 tmp 재조준이 무의미해지고 실 리포 `cache/` 를 오염시킨다(규범 F).
    const clean = seedCleanVault()
    const polluted = seedPollutedVault()
    tmps.push(clean.vault, polluted.vault)

    // 앵커 ①: 정상 vault 에서는 exit 0 이고 캐시가 **실제로 갱신된다**.
    const ok = runPackageScript('build-dev', { vault: clean.vault })
    expect(ok.exitCode, `${ok.stderr}${ok.stdout}`).toBe(0)
    expect(existsSync(summaryArtifact(clean.vault, 'dev'))).toBe(true)

    // 오염 vault 에 **직전 세대 캐시**를 만들어 둔다 — 그것이 "갱신되지 않았다" 의 관측 대상이다.
    //   체인이 아니라 생성기 CLI 를 직접 부른다(체인은 여기서 실패하는 것이 관측 대상이므로).
    const artifact = summaryArtifact(polluted.vault, 'dev')
    const seedRun = spawnSync(
      process.execPath,
      [path.join(SCRIPTS_DIR, 'summary.mjs'), '--vault', polluted.vault, '--env', 'dev', '--out', artifact], // prettier-ignore
      { encoding: 'utf8', env: gitSafeEnv(), maxBuffer: 64 * 1024 * 1024 },
    )
    expect(existsSync(artifact), `선행 캐시 생성 실패: ${seedRun.stderr}`).toBe(true)
    const before = statSync(artifact).mtimeMs

    const failed = runPackageScript('build-dev', { vault: polluted.vault })

    // 앵커 ②: 실패 실행 **전후 캐시 mtime 이 동일**하다(비-0 만 보고 넘어가면 반쪽 갱신을 놓친다).
    expect(failed.exitCode, `${failed.stderr}${failed.stdout}`).not.toBe(0)
    expect(statSync(artifact).mtimeMs).toBe(before)
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
