// @vitest-environment node
//
// P4 · Task 5 — `--env` 열거 검증을 4 CLI 로 통일 (D-I · R5) — tdd §3.5 (EV1~EV7)
//
// RED 사유:
//   · EV1·EV2·EV7 — **RED(flip)**. plan B7 실측: 열거 검증이 `validate.mjs`·`summary.mjs` 에만 있고
//     `feeds.mjs`·`wiki.mjs` 에는 **없다**. 그래서 `--env Dev` 오타가 **무경고로 prod** 가 된다 —
//     dev 예제 데이터를 보려던 사람이 조용히 상용 산출물을 받는다(반대 방향이면 누출이다).
//   · EV5 — **RED**. 세 CLI 의 문구가 아직 하나가 아니다.
//   · EV3·EV4 — **pair(지금도 green)**. 검증을 넣으면서 **정상값을 막는** 과잉 구현을 red 로 만든다.
//   · EV6 — **pin(지금도 green)**. `--env` **미지정**은 fail-closed(prod) 유지가 계약이다
//     (plan NOT Building: "`--env` 미지정 시 에러화" 는 하지 않는다). 열거 **오타**만 exit 2 다.
//
// 왜 "조용한 폴백" 이 표준이 아닌가(R5): 열거값 오타는 **즉시 비정상 종료 + 유효값 제시**가 표준이다
//   (Python `argparse choices` exit 2 · Rust `clap` `InvalidValue` + `[possible values: …]`).
//   현행은 fail-closed 가 아니라 **silent misconfiguration** 이다. `util.parseArgs` 는 `choices` 를
//   지원하지 않으므로(`type`·`short`·`multiple`·`default` 뿐) 파싱 뒤 수동 검증 5줄 — 의존성 추가 없음.
//
// 관측 층(tdd §7.5): 이 파일은 **프로세스 경계**만 본다 — exit code · stdout · stderr. 실 spawn 이다.
//   9p 경합 민감도가 높으므로 빠른 루프에서는 이 파일만 타깃으로 돌린다(tdd §7.4).
//
// 규범 A: 에러 **문구를 리터럴로 박지 않는다**. 대신 **3자 상호 비교**(EV5)로 "같은 문구" 를 문다 —
//   프로덕션 문자열을 테스트에 재기입하면 문구가 바뀔 때 아무도 모르고, 상수로 뽑아 import 하면
//   자기참조로 공허해진다(§10.3-2 가 REFACTOR 때의 같은 함정을 경고한다).
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prebuildArtifacts } from './helpers/prebuild-artifacts.mjs'
import { cleanup, commit, feedCommit, initVault, writeDoc } from './helpers/tmp-git-vault.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SCRIPT_DIR = path.resolve(HERE, '..')

const SUMMARY = path.join(SCRIPT_DIR, 'summary.mjs')
const FEEDS = path.join(SCRIPT_DIR, 'feeds.mjs')
const WIKI = path.join(SCRIPT_DIR, 'wiki.mjs')

const ID_A = '0192a000-0000-7000-8000-0000000000aa' // active — dev·prod 양쪽에서 보인다
const ID_DRAFT = '0192b000-0000-7000-8000-0000000000bb' // `dev/` 폴더 = draft — prod 에서 사라진다
const ACTIVE_REF = 'company/삼성전자'

/** 열거 오타 — 대소문자만 다르다. 사람이 실제로 치는 형태다. */
const TYPO_ENV = 'Dev'
/** 종료코드 — `argparse`/`clap` 관례(사용법 오류 = 2). 리터럴이다. */
const EXIT_ENUM_ERROR = 2

const tmps = []
afterAll(() => cleanup(...tmps))

/**
 * 절대 스크립트 경로로 실행한다(cwd 무관 재현).
 *
 * `GIT_CONFIG_*` 주입은 `cli-contract.test.mjs:56-62` 관례다 — vitest 가 `GIT_CONFIG_GLOBAL=/dev/null`
 * 로 전역 safe.directory 예외를 지우므로, 9p/컨테이너에서 소유자가 다르면 자식 git 이
 * dubious-ownership 로 죽는다. `SOURCE_DATE_EPOCH` 는 결정성 관례(기존 CLI 테스트 동일).
 */
function runCli(script, args) {
  return spawnSync(process.execPath, [script, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'safe.directory',
      GIT_CONFIG_VALUE_0: '*',
      SOURCE_DATE_EPOCH: '1700000000',
    },
  })
}

/** active 1 + draft 1 + 각각을 가리키는 `feed:` 1건 — **dev 와 prod 의 산출이 실제로 다르다**. */
function makeVault() {
  const vault = initVault()
  tmps.push(vault)
  writeDoc(vault, ACTIVE_REF, { id: ID_A, title: '삼성전자', type: 'company' })
  writeDoc(vault, 'dev/실험문서', { id: ID_DRAFT, title: '실험 문서' })
  commit(vault, 'chore: 초기 문서 2건')

  writeDoc(vault, 'dev/실험문서', { body: '## 정의\n\n실험 갱신.\n', id: ID_DRAFT, title: '실험 문서' }) // prettier-ignore
  feedCommit(vault, { subject: '실험 소식' })

  writeDoc(vault, ACTIVE_REF, { body: '## 정의\n\n삼성 갱신.\n', id: ID_A, title: '삼성전자', type: 'company' }) // prettier-ignore
  feedCommit(vault, { subject: '삼성 소식' })
  return vault
}

const VAULT = makeVault()

beforeAll(async () => {
  await prebuildArtifacts(VAULT, 'dev')
  await prebuildArtifacts(VAULT, 'prod')
})

describe('열거 오타는 즉시 비정상 종료한다 (EV1·EV2·EV7 · 🔴RED(flip) 오늘 무경고 prod)', () => {
  it('EV1: `feeds.mjs --env Dev` → exit 2 · stderr 가 **유효값을 제시**한다', () => {
    const result = runCli(FEEDS, ['--vault', VAULT, '--env', TYPO_ENV])

    expect(result.status).toBe(EXIT_ENUM_ERROR)
    // 문구를 리터럴로 박지 않고 **유효값 제시**라는 성질만 문다(clap `[possible values: …]` 형태).
    expect(result.stderr).toContain('dev')
    expect(result.stderr).toContain('prod')
  })

  it('EV2: `wiki.mjs --env Dev` → exit 2 (두 CLI 를 **각각** 문다)', () => {
    // 하나만 고치는 구현을 배제한다 — CX17 이 정확히 그 변이(`feeds` 만 되돌림)를 넣어 EV1 만 red 가
    //   되는지 확인한다.
    const result = runCli(WIKI, ['--vault', VAULT, '--env', TYPO_ENV])

    expect(result.status).toBe(EXIT_ENUM_ERROR)
    expect(result.stderr).toContain('dev')
    expect(result.stderr).toContain('prod')
  })

  it('EV7: `feeds.mjs --env ""`(빈 문자열) → exit 2 (경계값)', () => {
    // `if (!value)` 류가 빈 값을 "미지정" 으로 흡수하면 `--env=` 오타가 조용히 prod 가 된다 —
    //   EV6(진짜 미지정)과 **다른 입력**임을 못박는다.
    const result = runCli(FEEDS, ['--vault', VAULT, '--env', ''])

    expect(result.status).toBe(EXIT_ENUM_ERROR)
  })
})

describe('세 CLI 의 문구가 하나다 (EV5 · 🔴RED)', () => {
  it('EV5: `feeds`·`wiki`·`summary` 의 `--env Dev` stderr 가 **같은 문구**다', () => {
    // ★ 규범 A: 문구를 리터럴로 박지 않고 **3자 상호 비교**로 문다. 나중에 REFACTOR 가 셋을 공용
    //   헬퍼로 묶더라도(§10.3-2) 이 케이스는 **실제 stderr** 를 비교하므로 공허해지지 않는다 —
    //   반대로 문구를 상수로 뽑아 import 하면 그 순간 자기참조가 된다.
    const summary = runCli(SUMMARY, ['--vault', VAULT, '--env', TYPO_ENV])
    const feeds = runCli(FEEDS, ['--vault', VAULT, '--env', TYPO_ENV])
    const wiki = runCli(WIKI, ['--vault', VAULT, '--env', TYPO_ENV])

    // 앵커: 기준이 되는 `summary` 의 문구가 **비어 있지 않고** 오타값을 되비춘다 — 셋 다 빈 stderr 라
    //   서로 "같은" 것이 되는 공허 통과를 배제한다.
    expect(summary.stderr.trim().length).toBeGreaterThan(0)
    expect(summary.stderr).toContain(TYPO_ENV)

    expect(feeds.stderr.trim()).toBe(summary.stderr.trim())
    expect(wiki.stderr.trim()).toBe(summary.stderr.trim())
  })
})

describe('정상값을 막지 않는다 (EV3·EV4 · 🟢pair)', () => {
  it.each(['dev', 'prod'])('EV3: `feeds.mjs --env %s` → exit 0 · 파싱 가능한 JSON', (env) => {
    // ★ 과잉 차단 배제. EV1·EV2 만 있으면 "무조건 exit 2" 인 구현도 통과한다.
    const result = runCli(FEEDS, ['--vault', VAULT, '--env', env])

    expect(result.status).toBe(0)
    expect(Array.isArray(JSON.parse(result.stdout).items)).toBe(true)
  })

  it.each(['dev', 'prod'])('EV4: `wiki.mjs --env %s` → exit 0 · 파싱 가능한 JSON', (env) => {
    const result = runCli(WIKI, ['--vault', VAULT, '--env', env, '--path', ACTIVE_REF])

    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout).path).toBe(ACTIVE_REF)
  })
})

describe('미지정은 여전히 fail-closed(prod) 다 (EV6 · 🟢pin)', () => {
  // timeout: OQ-P1-2 (c) 적용 — 실측 **47,680ms · 45,041ms**(단독 실행 · 기본 30s 초과).
  //   원인은 Task 5(skip 소멸)로 실 repo 생성기가 요청마다 전량 계산하게 된 것이고, 이 케이스는
  //   그 CLI 를 **3벌** 돌린다. 전역 `testTimeout` 상향은 모든 케이스의 hang 감지를 둔하게 하므로
  //   금지다(plan 결정 ⑧) — 측정된 이 케이스에만 준다. 같은 파일의 나머지는 여유가 있다(EV5 15.5초).
  it(
    'EV6: 3 CLI 를 `--env` 없이 실행 → exit 0 이고 **prod 산출**이다',
    { timeout: 120_000 },
    () => {
      // ★ NOT Building 존중: 미지정의 에러화는 이 phase 의 범위가 **아니다**. 열거 오타만 exit 2 다.
      //   이 pin 이 없으면 GREEN 이 "검증을 넣었다" 며 미지정까지 막아도 아무도 모른다(과잉 구현).
      //
      // `--stdout` 은 부작용 없는 조회다(P3 OQ-P3-2) — 이 케이스가 tmp vault 에 캐시를 남기지 않는다.
      const bare = runCli(SUMMARY, ['--vault', VAULT, '--stdout'])
      const prod = runCli(SUMMARY, ['--vault', VAULT, '--stdout', '--env', 'prod'])
      const dev = runCli(SUMMARY, ['--vault', VAULT, '--stdout', '--env', 'dev'])

      expect([bare.status, prod.status, dev.status]).toEqual([0, 0, 0])
      expect(runCli(FEEDS, ['--vault', VAULT]).status).toBe(0)
      expect(runCli(WIKI, ['--vault', VAULT, '--path', ACTIVE_REF]).status).toBe(0)

      const idsOf = (result) => JSON.parse(result.stdout).docs.map((doc) => doc.id).toSorted() // prettier-ignore

      // 앵커: 이 vault 는 dev 와 prod 를 **실제로 구분한다**(draft 1건). 구분이 없으면 아래 단언이
      //   "무엇을 줘도 같다" 로 공허하게 통과한다.
      expect(idsOf(dev)).toContain(ID_DRAFT)
      expect(idsOf(prod)).not.toContain(ID_DRAFT)

      expect(idsOf(bare)).toEqual(idsOf(prod))
    },
  )
})
