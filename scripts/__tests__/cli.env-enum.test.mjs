// @vitest-environment node
//
// `--env` 열거 검증을 feeds·summary CLI 에서 동일하게 유지한다 (EV1·EV3·EV5~EV7).
//
// RED 사유:
//   · EV1·EV7 — 열거 검증이 없으면 `feeds.mjs --env Dev` 오타가 **무경고로 prod** 가 된다 —
//     dev 예제 데이터를 보려던 사람이 조용히 상용 산출물을 받는다(반대 방향이면 누출이다).
//   · EV5 — feeds·summary 두 CLI 의 오류 문구가 같은지 확인한다.
//   · EV3 — 검증을 넣으면서 **정상값을 막는** 과잉 구현을 red 로 만든다.
//   · EV6 — **pin(지금도 green)**. `--env` **미지정**은 fail-closed(prod) 유지가 계약이다
//     (`--env` 미지정까지 에러로 바꾸지 않는다). 열거 **오타**만 exit 2 다.
//
// 왜 "조용한 폴백" 이 표준이 아닌가(R5): 열거값 오타는 **즉시 비정상 종료 + 유효값 제시**가 표준이다
//   (Python `argparse choices` exit 2 · Rust `clap` `InvalidValue` + `[possible values: …]`).
//   현행은 fail-closed 가 아니라 **silent misconfiguration** 이다. `util.parseArgs` 는 `choices` 를
//   지원하지 않으므로(`type`·`short`·`multiple`·`default` 뿐) 파싱 뒤 수동 검증 5줄 — 의존성 추가 없음.
//
// 관측 층(tdd §7.5): 이 파일은 **프로세스 경계**만 본다 — exit code · stdout · stderr. 실 spawn 이다.
//   9p 경합 민감도가 높으므로 빠른 루프에서는 이 파일만 타깃으로 돌린다(tdd §7.4).
//
// 규범 A: 에러 **문구를 리터럴로 박지 않는다**. 대신 **2자 상호 비교**(EV5)로 "같은 문구" 를 문다 —
//   프로덕션 문자열을 테스트에 재기입하면 문구가 바뀔 때 아무도 모르고, 상수로 뽑아 import 하면
//   자기참조로 공허해진다(§10.3-2 가 REFACTOR 때의 같은 함정을 경고한다).
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterAll, describe, expect, it } from 'vitest'

import { cleanup, commit, feedCommit, initVault, writeDoc } from './helpers/tmp-git-vault.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SCRIPT_DIR = path.resolve(HERE, '..')

const SUMMARY = path.join(SCRIPT_DIR, 'summary.mjs')
const FEEDS = path.join(SCRIPT_DIR, 'feeds.mjs')

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
 * `GIT_CONFIG_*` 주입은 `cli-contract.test.mjs:52-89` 관례다 — vitest 가 `GIT_CONFIG_GLOBAL=/dev/null`
 * 로 전역 safe.directory 예외를 지우므로, 9p/컨테이너에서 소유자가 다르면 자식 git 이
 * dubious-ownership 로 죽는다. `SOURCE_DATE_EPOCH` 는 결정성 관례(기존 CLI 테스트 동일).
 *
 * ★ `vault` 는 기본값(`VAULT`)이 있는 세 번째 인자다 — 이 파일의 모든 호출부가 실제로 겨냥하는
 * 대상이 `VAULT`(이 파일 하나뿐인 tmp vault) 이기 때문이다. `safe.directory` 값을 `'*'`(전 경로
 * 허용) 대신 이 인자로 좁힌다 — git 은 값을 실재 경로로 정규화하므로 존재하지 않는 경로는 신뢰하지
 * 않는다(git-config(1)).
 */
function runCli(script, args, vault = VAULT) {
  const result = spawnSync(process.execPath, [script, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'safe.directory',
      GIT_CONFIG_VALUE_0: vault,
      SOURCE_DATE_EPOCH: '1700000000',
    },
    // 이 파일의 여러 케이스가 같은 CLI 를 여러 번 돌린다(EV5·EV6). `spawnSync` 는 동기 호출이라
    //   vitest 의 it()-레벨 타임아웃(비동기 타이머)으로는 자식의 hang 을 끊을 수 없다 — `timeout`
    //   옵션 자체가 유일한 안전장치다. EV6 의 케이스 상한(120초, :202 참조)과 같은 값을 재사용한다.
    timeout: 120_000,
  })

  // 옵션만 넣고 결과를 안 보면 여전히 조용하다 — 타임아웃/spawn 실패로 죽은 자식은 `error`·`signal`
  //   이 채워진다(정상적인 비0 종료와 뚜렷이 구별된다). 여기서 즉시 크게 실패시킨다.
  if (result.error || result.signal) {
    throw new Error(
      `runCli 자식 프로세스 비정상 종료: script=${script} error=${result.error?.message ?? 'none'} signal=${result.signal ?? 'none'}`,
    )
  }
  return result
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

describe('열거 오타는 즉시 비정상 종료한다 (EV1·EV7)', () => {
  // EV2의 wiki arm은 wiki CLI가 `--env` 개념을 잃어 대상 자체가 사라졌다. 새 wiki 계약에서 정상
  // `--file`과 소멸한 `--env`의 거부는 `wiki.file-arg.test.mjs` C-1·C-4가 이어받는다.
  it('EV1: `feeds.mjs --env Dev` → exit 2 · stderr 가 **유효값을 제시**한다', () => {
    // ★★ v3 P2 · §4.2 arm 갱신(규범 P). D15 로 `--count` 가 필수가 되면 **`--count` 누락도 exit 2** 라
    //   두 사유가 **같은 코드**를 낸다 → arm 에 `--count=5` 를 넣지 않으면 이 케이스가 **엉뚱한 사유로
    //   green** 이 된다("env 오타를 잡았다" 가 아니라 "count 가 없어서 죽었다"). 이 케이스가 무는 것은
    //   **env 열거**이지 인자 개수가 아니다.
    // ⓑ 기존 stderr 어휘 단언(`dev`·`prod`)은 **유지한다** — 그것이 사유 축이다.
    // ⓒ 「둘 다 무효」(`--env Dev --count=0`)는 **CQ6**(`cursor.cli-contract.test.mjs`)이 별도로 문다.
    const result = runCli(FEEDS, ['--vault', VAULT, '--env', TYPO_ENV, '--count=5'])

    expect(result.status).toBe(EXIT_ENUM_ERROR)
    // 문구를 리터럴로 박지 않고 **유효값 제시**라는 성질만 문다(clap `[possible values: …]` 형태).
    expect(result.stderr).toContain('dev')
    expect(result.stderr).toContain('prod')
  })

  it('EV7: `feeds.mjs --env ""`(빈 문자열) → exit 2 (경계값)', () => {
    // `if (!value)` 류가 빈 값을 "미지정" 으로 흡수하면 `--env=` 오타가 조용히 prod 가 된다 —
    //   EV6(진짜 미지정)과 **다른 입력**임을 못박는다.
    // ★★ v3 P2 · §4.2 arm 갱신(규범 P) — EV1 과 같은 사유다. 이 케이스는 **exit code 만** 문으므로
    //   `--count` 를 안 실으면 D15 착륙 뒤 사유가 뒤바뀌어도 아무도 모른다(EV1 은 stderr 축이 있지만
    //   여기는 없다 — 그래서 arm 갱신이 더 중요하다).
    const result = runCli(FEEDS, ['--vault', VAULT, '--env', '', '--count=5'])

    expect(result.status).toBe(EXIT_ENUM_ERROR)
  })
})

// EV5는 세 CLI 동일성에서 두 CLI 동일성으로 약해졌다. wiki가 `--env` 개념을 잃어 비교할 세 번째
//   오류 채널이 없어졌기 때문이다. 남은 feeds·summary의 실제 stderr 비교는 그대로 유지한다.
describe('두 CLI 의 문구가 하나다 (EV5)', () => {
  it('EV5: `feeds`·`summary` 의 `--env Dev` stderr 가 **같은 문구**다', () => {
    // 문구를 리터럴로 박지 않고 실제 stderr를 비교해 공용 계약의 드리프트를 잡는다.
    const summary = runCli(SUMMARY, ['--vault', VAULT, '--env', TYPO_ENV])
    const feeds = runCli(FEEDS, ['--vault', VAULT, '--env', TYPO_ENV])

    // stderr 문구만 비교하고 exit status 를 안 보면, 문구는 그대로 낸 채 "성공"(exit 0)으로 조용히
    //   빠지는 회귀가 안 잡힌다 — 두 CLI 모두 **거부**(exit 2)했다는 것 자체를 먼저 못박는다.
    expect(summary.status).toBe(EXIT_ENUM_ERROR)
    expect(feeds.status).toBe(EXIT_ENUM_ERROR)

    // 앵커: 기준이 되는 `summary` 의 문구가 **비어 있지 않고** 오타값을 되비춘다 — 둘 다 빈 stderr 라
    //   서로 "같은" 것이 되는 공허 통과를 배제한다.
    expect(summary.stderr.trim().length).toBeGreaterThan(0)
    expect(summary.stderr).toContain(TYPO_ENV)

    expect(feeds.stderr.trim()).toBe(summary.stderr.trim())
  })
})

describe('정상값을 막지 않는다 (EV3 · 🟢pair)', () => {
  it.each(['dev', 'prod'])('EV3: `feeds.mjs --env %s` → exit 0 · 파싱 가능한 JSON', (env) => {
    // ★ 과잉 차단 배제. EV1만 있으면 "무조건 exit 2" 인 구현도 통과한다.
    // ★★ v3 P2 · §4.2 arm 갱신: EV3 의 **주제**(_"정상값을 막지 않는다"_ · pair)는 **살아 있다.**
    //   죽는 것은 _"`feeds.mjs --env dev` 만으로 exit 0"_ 이라는 **arm 의 전제**다 —
    //   **D15 로 `--count` 가 필수가 됐다. 이 케이스가 무는 것은 env 열거이지 인자 개수가 아니다.**
    const result = runCli(FEEDS, ['--vault', VAULT, '--env', env, '--count=5'])

    expect(result.status).toBe(0)
    expect(Array.isArray(JSON.parse(result.stdout).items)).toBe(true)
  })

  // EV4의 wiki 정상값 arm은 `--env` 자체가 사라졌고, 새 정상 호출은 `wiki.file-arg.test.mjs` C-1이 맡는다.
})

// EV6의 wiki arm은 wiki가 `--env` 개념을 잃어 대상 자체가 사라졌다. feeds·summary의 미지정=prod
// 축과 이 vault에서 dev/prod 결과가 실제로 갈린다는 앵커는 그대로 유지한다.
describe('미지정은 여전히 fail-closed(prod) 다 (EV6 · 🟢pin)', () => {
  // timeout: OQ-P1-2 (c) 적용 — 실측 **47,680ms · 45,041ms**(단독 실행 · 기본 30s 초과).
  //   원인은 Task 5(skip 소멸)로 실 repo 생성기가 요청마다 전량 계산하게 된 것이고, 이 케이스는
  //   그 CLI 를 **3벌** 돌린다. 전역 `testTimeout` 상향은 모든 케이스의 hang 감지를 둔하게 하므로
  //   금지다 — 측정된 이 케이스에만 준다. 같은 파일의 나머지는 여유가 있다(EV5 15.5초).
  it(
    'EV6: feeds·summary 를 `--env` 없이 실행 → exit 0 이고 **prod 산출**이다',
    { timeout: 120_000 },
    () => {
      // 미지정의 에러화는 이 계약의 범위가 **아니다**. 열거 오타만 exit 2 다.
      //   이 pin 이 없으면 GREEN 이 "검증을 넣었다" 며 미지정까지 막아도 아무도 모른다(과잉 구현).
      //
      // 기본 summary 실행이 부작용 없는 stdout 조회다 — 이 케이스가 tmp vault 에 캐시를 남기지 않는다.
      const bare = runCli(SUMMARY, ['--vault', VAULT])
      const prod = runCli(SUMMARY, ['--vault', VAULT, '--env', 'prod'])
      const dev = runCli(SUMMARY, ['--vault', VAULT, '--env', 'dev'])

      expect([bare.status, prod.status, dev.status]).toEqual([0, 0, 0])
      // ★★ v3 P2 · §4.2 arm 갱신 — **이 한 줄만** 바뀐다. EV6 의 주제(_"미지정은 여전히
      //   fail-closed(prod)"_)는 그대로다: `--env` 는 계속 안 준다. D15 로 필수가 된 `--count` 만 싣는다.
      //   ★ 위 `SUMMARY` 3벌은 **무변경**이다 — 거기에 `--count`·`--summary` 는 없는 인자다.
      //
      // ★ 결과를 버리지 않는다 — `feeds.mjs` 는 `summary.mjs`·`wiki.mjs` 와 달리 산출물을 새로
      //   계산할 뿐 미리 빌드된 아티팩트를 읽지 않는다(env-mismatch 같은 교차 검증이 없다). 그래서
      //   `--env` 미지정 기본값이 `prod` 에서 `dev` 로 회귀해도 exit code 는 여전히 0 이라 상태만
      //   보면 안 잡힌다 — 실제로 prod 뷰와 같은 내용을 냈는지 아래에서 비교한다.
      const bareFeeds = runCli(FEEDS, ['--vault', VAULT, '--count=5'])
      const prodFeeds = runCli(FEEDS, ['--vault', VAULT, '--env', 'prod', '--count=5'])
      expect(bareFeeds.status).toBe(0)
      expect(prodFeeds.status).toBe(0)
      const idsOf = (result) => JSON.parse(result.stdout).docs.map((doc) => doc.id).toSorted() // prettier-ignore

      // 앵커: 이 vault 는 dev 와 prod 를 **실제로 구분한다**(draft 1건). 구분이 없으면 아래 단언이
      //   "무엇을 줘도 같다" 로 공허하게 통과한다.
      expect(idsOf(dev)).toContain(ID_DRAFT)
      expect(idsOf(prod)).not.toContain(ID_DRAFT)

      expect(idsOf(bare)).toEqual(idsOf(prod))

      // 앵커: feeds 도 이 vault 에서 실제로 항목을 낸다 — "둘 다 빈 배열이라 같다" 는 공허 통과를 배제.
      const bareFeedItems = JSON.parse(bareFeeds.stdout).items
      expect(bareFeedItems.length).toBeGreaterThan(0)
      expect(JSON.stringify(bareFeedItems)).toBe(JSON.stringify(JSON.parse(prodFeeds.stdout).items))
    },
  )
})
