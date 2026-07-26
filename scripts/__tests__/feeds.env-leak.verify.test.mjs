// @vitest-environment node
//
// P2 · (전역) prod 누출 가드 + 레거시 토큰 가드 — tdd §3.11(LK1·LK2) · §3.10(LG1)
//
// **hidden — spec gaming 방지.** 이 파일은 GREEN 담당에게 노출하지 않고 **GREEN 자기신고 이후 메인
//   세션이 실행**한다(§3.0). 리포에 이미 `*.verify.test.mjs` = "가드의 가드" 관례가 있다
//   (`feeds.verify` · `fail-closed.verify` · `immutability.verify`). 다른 케이스를 전부 통과시키면서도
//   D9 오독으로 prod 를 열어버리는 구현을 여기서 잡는다.
//
// 왜 두 겹인가: **헤르메틱(LK1)은 *규칙*의 성질을, 실 vault(LK2)는 *예제 데이터*의 성질을 잡는다.**
//   둘 다 필요하다 — 규칙이 맞아도 예제가 새면 상용에 뉴스가 뜨고, 예제가 안 새도 규칙이 틀리면
//   미래 데이터가 샌다.
//
// RED 사유:
//   LK1 — 현행에서도 prod 0건이다(전량 draft → 전량 resolve 실패). **오분류하면 3건이 된다**(CX2·CX4).
//         즉 지금은 green 이고, 이 못의 값어치는 GREEN 이후·반증 단계에서 드러난다.
//   LK2 — RED(flip). 현행 dev 5 / prod 0 → P2 기대 dev **6** / prod **1(신원 고정)**.
//         오분류하면 prod 가 **6건**이 되어 예제 뉴스 5건이 상용으로 샌다(D-A 의 최후 방어선).
//   LG1 — RED. 신규 파일 8건 중 sas-wiki 소관 7건이 아직 갖춰지지 않았다면 파일 부재로 red.
//
// **개수만 세지 않는다**(§2.6 OQ-P2-1 확정 A): 신원 단언이라야 "1건이긴 한데 엉뚱한 1건" 을 잡는다.
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { ID_A, ID_B, ID_C, T1, T2, T3 } from './helpers/survival-vault.mjs'
import { cleanup, commit, feedCommit, initVault, writeDoc } from './helpers/tmp-git-vault.mjs'

const { walkFeeds } = await import(new URL('../lib/git-walk.mjs', import.meta.url).href)

const HERE = path.dirname(fileURLToPath(import.meta.url))
/** sas-wiki 리포 루트 — `scripts/__tests__` 의 두 단계 위. cwd 무관(import.meta.url 파생). */
const REPO_ROOT = path.resolve(HERE, '..', '..')

const titlesOf = (items) => items.map((item) => item.title)

/** 실 vault 의 draft 문서를 가리키는 `feed:` 커밋 5건 — prod 에 **하나도** 나와선 안 된다(§2.5 실측). */
const DRAFT_BACKED_TITLES = [
  '삼성전자 거래소 정보 정정',
  '온디바이스 AI, 스마트폰 탑재 확대',
  'HBM4 로드맵 갱신',
  'SK하이닉스·삼성전자, HBM 공급 계약 체결',
  '삼성전자, HBM3E 12단 양산 승인',
]

/** 실 vault 에서 **유일하게** prod 로 나가야 하는 피드 — 참조 문서가 draft 가 아니라 **삭제**됐다. */
const DELETED_BACKED_TITLE = '폐기예정 메모 관련 소식'

/** 이 phase 가 신설하는 테스트 파일(§3.0) 중 **sas-wiki 소관 7건**. 경로는 리터럴이다. */
const NEW_TEST_FILES = [
  'scripts/lib/__tests__/feed-survival.test.mjs',
  'scripts/lib/__tests__/git-walk.survival-reason.test.mjs',
  'scripts/lib/__tests__/invariants.feed-only.test.mjs',
  'scripts/__tests__/build.feed-survival.test.mjs',
  'scripts/__tests__/build.contract-shape.test.mjs',
  'scripts/__tests__/validate.deadlinks.test.mjs',
  'scripts/__tests__/feeds.env-leak.verify.test.mjs',
]

/**
 * 레거시 컨벤션 접두사 토큰. **이 상수 이름이 유일한 우회로**다 — 아래 스캔이 원시 토큰을 직접 적은
 * 줄만 잡도록, 가드 자신의 술어는 이 이름을 경유한다(자기참조로 스스로를 offender 로 세지 않는다).
 */
const LEGACY_PREFIX_RE = /uwiki|cwiki/

/** 주석(줄·블록)을 걷어낸 코드만 남긴다 — LG1 은 **테스트 입력**의 레거시 토큰을 문다. */
const codeOnly = (source) =>
  source.replaceAll(/\/\*[\s\S]*?\*\//g, '').replaceAll(/(^|[^:])\/\/.*$/gm, '$1')

describe('prod 누출 가드 — 헤르메틱 (LK1)', () => {
  it('LK1: 전량 draft vault 는 dev 에서 3건이고 prod 에서 0건이다', () => {
    // 오분류(pathIndex 를 draft 제외로 두는 회귀 = CX2, 또는 draft-excluded 분기 삭제 = CX4)면
    //   prod 가 **3건**이 된다 — D9 오독의 최소 재현이다.
    const vault = initVault()
    try {
      writeDoc(vault, 'dev/실험1', { id: ID_A, wikiRoot: 'wiki' })
      writeDoc(vault, 'dev/실험2', { id: ID_B, wikiRoot: 'wiki' })
      writeDoc(vault, 'dev/실험3', { id: ID_C, wikiRoot: 'wiki' })
      commit(vault, 'chore: 초기 draft 문서 3건')
      writeDoc(vault, 'dev/실험1', { body: '## 정의\n\n갱신1.\n', id: ID_A, wikiRoot: 'wiki' })
      feedCommit(vault, { date: T1, subject: '실험1 소식' })
      writeDoc(vault, 'dev/실험2', { body: '## 정의\n\n갱신2.\n', id: ID_B, wikiRoot: 'wiki' })
      feedCommit(vault, { date: T2, subject: '실험2 소식' })
      writeDoc(vault, 'dev/실험3', { body: '## 정의\n\n갱신3.\n', id: ID_C, wikiRoot: 'wiki' })
      feedCommit(vault, { date: T3, subject: '실험3 소식' })

      // ★ 위험 실재 앵커(규범 B): dev 대조군이 **먼저**다 — 3건이 실제로 만들어졌음을 증명하지 않으면
      //   "prod 0건" 은 "픽스처가 비어 있었다" 와 구분되지 않는다(P1 FP4 형).
      expect(titlesOf(walkFeeds(vault, { count: 50, env: 'dev' })).toSorted()).toEqual(
        ['실험1 소식', '실험2 소식', '실험3 소식'].toSorted(),
      )

      expect(walkFeeds(vault, { count: 50, env: 'prod' })).toEqual([])
    } finally {
      cleanup(vault)
    }
  })
})

/**
 * 실 vault(= 이 리포 자신)를 읽을 때만 필요한 git 환경 보정.
 *
 * `vitest.config.js` 가 `GIT_CONFIG_GLOBAL=/dev/null` 을 걸어 개발자 `~/.gitconfig` 누출을 막는다
 * (헤르메틱 픽스처에는 옳다). 그런데 이 리포는 컨테이너와 호스트가 소유자 uid 가 다른 공유 마운트라,
 * 전역 config 를 끊으면 `safe.directory` 예외까지 함께 사라져 `git rev-list` 가
 * *"detected dubious ownership"* 로 죽는다 — **테스트가 겨냥한 실패가 아니다.**
 * git 이 정식 지원하는 env 기반 config(`GIT_CONFIG_COUNT`/`_KEY_n`/`_VALUE_n`)로 그 한 줄만 되살린다
 * (identity 는 여전히 주입되지 않으므로 헤르메틱 규약은 깨지지 않는다).
 */
function withSafeDirectory(run) {
  const saved = {
    count: process.env.GIT_CONFIG_COUNT,
    key: process.env.GIT_CONFIG_KEY_0,
    value: process.env.GIT_CONFIG_VALUE_0,
  }
  process.env.GIT_CONFIG_COUNT = '1'
  process.env.GIT_CONFIG_KEY_0 = 'safe.directory'
  process.env.GIT_CONFIG_VALUE_0 = REPO_ROOT
  try {
    return run()
  } finally {
    restoreEnv('GIT_CONFIG_COUNT', saved.count)
    restoreEnv('GIT_CONFIG_KEY_0', saved.key)
    restoreEnv('GIT_CONFIG_VALUE_0', saved.value)
  }
}

function restoreEnv(name, value) {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}

describe('prod 누출 가드 — 실 vault 신원 고정 (LK2 🔴RED(flip) · OQ-P2-1 = A)', () => {
  it('LK2: dev 6건 · prod 는 **정확히 1건**이고 그 1건이 삭제 유래이며 draft 유래 5건은 전부 부재다', () => {
    const { dev, prod } = withSafeDirectory(() => ({
      dev: walkFeeds(REPO_ROOT, { count: 50, env: 'dev' }),
      prod: walkFeeds(REPO_ROOT, { count: 50, env: 'prod' }),
    }))

    // ★ 앵커: dev 6건이 먼저다(픽스처=실 vault 가 비지 않았다). 그 다음에 prod 의 신원을 고정한다.
    expect(dev).toHaveLength(6)
    expect(titlesOf(dev)).toContain(DELETED_BACKED_TITLE)
    for (const title of DRAFT_BACKED_TITLES) expect(titlesOf(dev)).toContain(title)

    // 개수 → **신원**으로 승격. 오분류면 6건이 되고 예제 뉴스 5건이 상용으로 샌다.
    expect(titlesOf(prod)).toEqual([DELETED_BACKED_TITLE])
    expect(prod[0].docs).toEqual([]) // D9 — 삭제는 연결만 끊는다(문서는 draft 였던 적이 없다)
    for (const title of DRAFT_BACKED_TITLES) expect(titlesOf(prod)).not.toContain(title)
  })
})

describe('레거시 토큰 가드 — 신규 파일 한정 (LG1 🔴RED)', () => {
  it('LG1: P2 신규 테스트 7파일이 전부 존재하고 각각 최소 1건의 it 를 갖는다(앵커)', () => {
    // 부재 단언(아래 케이스) 앞에 **파일이 실재하고 비어 있지 않다**를 먼저 세운다 — 빈 파일이나
    //   없는 파일에서는 "토큰 0건" 이 자동으로 참이 되어 가드가 공허해진다.
    for (const rel of NEW_TEST_FILES) {
      const full = path.join(REPO_ROOT, rel)
      expect(existsSync(full), rel).toBe(true)
      expect(readFileSync(full, 'utf8').split(/\bit(?:\.each)?\(/).length - 1, rel).toBeGreaterThanOrEqual(1) // prettier-ignore
    }
  })

  it('LG1: 신규 파일은 레거시 접두사를 **입력**으로 쓰지 않는다(부재를 단언하는 자리만 허용)', () => {
    // 범위를 신규 파일로 **명시적으로 좁힌다** — 기존 27파일의 소거는 P6 grep 스윕 소관이고,
    //   여기서 넓히면 §4 원장 밖 변경이 대량 발생한다(§9).
    // 비컨벤션 접두사가 필요한 픽스처는 `chore:` 등 임의값을 쓴다. 예외는 딱 하나 —
    //   "그 토큰이 진단 메시지에 없어야 한다" 를 단언하는 줄(FO8)은 토큰을 적을 수밖에 없다.
    for (const rel of NEW_TEST_FILES) {
      const code = codeOnly(readFileSync(path.join(REPO_ROOT, rel), 'utf8'))
      const offenders = code
        .split('\n')
        .filter((line) => LEGACY_PREFIX_RE.test(line))
        .filter((line) => !/not\.(toMatch|toContain)|LEGACY_PREFIX_RE/.test(line))

      expect(offenders, rel).toEqual([])
    }
  })
})
