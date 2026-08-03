// @vitest-environment node
//
// ⚠️ **hidden — RED 커밋에서 제외됨.** 이 파일은 GREEN 담당에게 **노출하지 않는다**. 메인 세션이 RED
//   커밋에서 빼두었다가 GREEN 자기신고 이후 복원해 실행한다(P2 에서 같은 전략이 작동했다).
//   리포에 이미 `*.verify.test.mjs` = "가드의 가드" 관례가 있다(`feeds.verify` · `fail-closed.verify` ·
//   `immutability.verify` · `feeds.env-leak.verify`). 다른 케이스를 전부 통과시키면서도 OQ-P3-1 을
//   **A 로 오독해 prod 를 여는** 구현을 여기서 잡는다.
//
// P3 · (전역) 제외 누출 가드 — tdd §3.12 (LX1~LX3)
//
// 왜 두 겹인가: **헤르메틱(LX1)은 *규칙*의 성질을, 실 vault(LX2·LX3)는 *예제 데이터*의 성질을 잡는다.**
//   둘 다 필요하다 — 규칙이 맞아도 예제가 새면 상용에 뉴스가 뜨고, 예제가 안 새도 규칙이 틀리면
//   미래 데이터가 샌다. 그리고 **현 vault 는 제외 0건**이라 LX2·LX3 는 OQ-P3-1 오독을 **탐지하지
//   못한다**(tdd §6 CX6) — LX1 이 유일한 탐지기다.
//
// 라벨(RED/green 지도 · 저작 시점 실측):
//   LX1 — **지금도 green** 이다(전량 draft → prod 0건). 값어치는 GREEN 이후·반증(CX6·CX9)에서 드러난다.
//         OQ-P3-1 을 A(전 문서 판정)로 구현하면 스키마 위반 draft 문서가 `allHeadIds` 에서 빠지고
//         그 피드 사유가 `draft-excluded`(prod 미노출) → **`invalid-excluded`(env 무관 생존)** 로
//         뒤집혀 prod 가 **1건**이 된다 = 예제 뉴스가 상용으로 새는 상태.
//   LX2·LX3 — pin. P2 가 세운 누출 방어선(dev 6 · prod 1)을 이 phase 가 흔들지 않는지 본다.
//
// 개수만 세지 않는다: **신원**을 본다(P2 OQ-P2-1 확정 형태). "1건이긴 한데 엉뚱한 1건" 을 잡으려면
//   title 을 봐야 한다.
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterAll, describe, expect, it } from 'vitest'

import { walkFeeds } from './helpers/walk-feeds.mjs'
import { cleanup, commit, feedCommit, initVault, writeDoc } from './helpers/tmp-git-vault.mjs'
import { BAD_ID, ID_A, ID_B, T1, T2, T3 } from './helpers/polluted-vault.mjs'

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

const tmps = []
afterAll(() => cleanup(...tmps))

describe('제외 누출 가드 — 헤르메틱 (LX1)', () => {
  it('LX1: 전량 draft vault 에서 1건이 스키마 위반이어도 dev 3건 · **prod 0건**이다', () => {
    // ★ OQ-P3-1 의 최소 재현. 세 문서가 전부 `wiki/dev/`(draft)이고 그중 하나는 id 가 UUIDv7 이 아니다.
    //   B(확정) = prod 는 draft 를 **판정하지 않는다** → 깨진 문서도 `allHeadIds` 에 남아
    //   `draft-excluded` 유지 → prod 0건.
    //   A(오독) = prod 도 전 문서를 판정한다 → 깨진 문서가 `invalidIds` 로 가고 사유가
    //   `invalid-excluded`(env 무관 생존)로 바뀐다 → prod **1건** = 즉시 red.
    const vault = initVault()
    tmps.push(vault)

    writeDoc(vault, 'dev/실험1', { id: ID_A, wikiRoot: 'wiki' })
    writeDoc(vault, 'dev/실험2', { id: ID_B, wikiRoot: 'wiki' })
    writeDoc(vault, 'dev/실험3', { id: BAD_ID, wikiRoot: 'wiki' }) // ← 스키마 위반 draft
    commit(vault, 'chore: 초기 draft 문서 3건')

    writeDoc(vault, 'dev/실험1', { body: '## 정의\n\n갱신1.\n', id: ID_A, wikiRoot: 'wiki' })
    feedCommit(vault, { date: T1, subject: '실험1 소식' })
    writeDoc(vault, 'dev/실험2', { body: '## 정의\n\n갱신2.\n', id: ID_B, wikiRoot: 'wiki' })
    feedCommit(vault, { date: T2, subject: '실험2 소식' })
    writeDoc(vault, 'dev/실험3', { body: '## 정의\n\n갱신3.\n', id: BAD_ID, wikiRoot: 'wiki' })
    feedCommit(vault, { date: T3, subject: '실험3 소식' })

    // ★ 위험 실재 앵커(규범 B): dev 대조군이 **먼저**다 — 3건이 실제로 만들어졌음을 증명하지 않으면
    //   "prod 0건" 은 "픽스처가 비어 있었다" 와 구분되지 않는다.
    expect(titlesOf(walkFeeds(vault, { count: 50, env: 'dev' })).toSorted()).toEqual(
      ['실험1 소식', '실험2 소식', '실험3 소식'].toSorted(),
    )

    expect(titlesOf(walkFeeds(vault, { count: 50, env: 'prod' }))).toEqual([])
  })
})

/**
 * 실 vault(= 이 리포 자신)를 읽을 때만 필요한 git 환경 보정.
 *
 * `vitest.config.js` 가 `GIT_CONFIG_GLOBAL=/dev/null` 을 걸어 개발자 `~/.gitconfig` 누출을 막는다
 * (헤르메틱 픽스처에는 옳다). 그런데 이 리포는 컨테이너와 호스트가 소유자 uid 가 다른 공유 마운트라,
 * 전역 config 를 끊으면 `safe.directory` 예외까지 사라져 `git rev-list` 가 *dubious ownership* 로
 * 죽는다 — **테스트가 겨냥한 실패가 아니다**. env 기반 config 로 그 한 줄만 되살린다.
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

/**
 * 실 vault 를 **전량 훑는** 케이스 전용 타임아웃 — **OQ-P1-2 (c)**. 사유·실측은 형제 파일
 * `feeds.env-leak.verify.test.mjs` 의 동명 상수 JSDoc 이 소유한다(같은 원인 · 같은 층).
 * §8-② 실측: LX2 **38.1s** · LX3 **39.7s** — 기본 `testTimeout: 30000` 초과.
 */
const REAL_VAULT_WALK_TIMEOUT = 120_000

describe('제외 누출 가드 — 실 vault 신원 고정 (LX2·LX3 · pin)', () => {
  it(
    'LX2: dev 6건 · prod **정확히 1건**이며 그 1건이 삭제 유래이고 docs 가 비어 있다',
    { timeout: REAL_VAULT_WALK_TIMEOUT },
    () => {
      const { dev, prod } = withSafeDirectory(() => ({
        dev: walkFeeds(REPO_ROOT, { count: 50, env: 'dev' }),
        prod: walkFeeds(REPO_ROOT, { count: 50, env: 'prod' }),
      }))

      // ★ 앵커: dev 6건이 먼저다(실 vault 가 비지 않았다). 그 다음에 prod 의 신원을 고정한다.
      expect(dev).toHaveLength(6)
      expect(titlesOf(dev)).toContain(DELETED_BACKED_TITLE)

      expect(titlesOf(prod)).toEqual([DELETED_BACKED_TITLE])
      expect(prod[0].docs).toEqual([]) // D9 — 삭제는 연결만 끊는다(그 문서는 draft 였던 적이 없다)
    },
  )

  it(
    'LX3: 실 vault prod 결과에 draft 유래 5건이 **전부 부재**하다',
    { timeout: REAL_VAULT_WALK_TIMEOUT },
    () => {
      // ★ 오분류(사유를 `invalid-excluded`·`deleted` 로 뭉갬)면 prod 가 **6건**이 되어 예제 뉴스 5건이
      //   상용으로 샌다. 앵커는 dev 6건이다 — 부재 단언 앞에 그 피드들이 실재함을 먼저 세운다.
      const { dev, prod } = withSafeDirectory(() => ({
        dev: walkFeeds(REPO_ROOT, { count: 50, env: 'dev' }),
        prod: walkFeeds(REPO_ROOT, { count: 50, env: 'prod' }),
      }))

      for (const title of DRAFT_BACKED_TITLES) expect(titlesOf(dev)).toContain(title)
      for (const title of DRAFT_BACKED_TITLES) expect(titlesOf(prod)).not.toContain(title)
    },
  )
})
