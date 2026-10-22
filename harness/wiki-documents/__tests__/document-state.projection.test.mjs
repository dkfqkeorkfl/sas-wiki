// 문서 검사 정책의 정상·위반 회귀. 실제 wiki 대신 격리 fixture를 사용한다.

import { fileURLToPath } from 'node:url'

import { afterAll, describe, expect, it } from 'vitest'

import { FEED_REF_REASONS } from '../../../scripts/lib/feed-survival.mjs'

import { checkFeedResolution } from '../document-invariants.mjs'

import { parseVault } from '../../../scripts/lib/parse-vault.mjs'
import { collectHeadDocuments } from '../../../scripts/lib/head-state.mjs'
import { makeGitRunner, memoizeGitRunner } from '../../../scripts/lib/git.mjs'
import { auditHeadDocState } from '../document-state.mjs'

import { cleanup } from '../../test-utils/tmp-git-vault.mjs'

import {
  CONTROL_FEED_TITLE,
  CONTROL_REL,
  CONTROL_TAG,
  ID_A,
  ID_DUP,
  seedCleanVault,
  seedPollutedVault,
  seedStrayVault,
  STRAY_PATH,
  TWIN_A_PATH,
  TWIN_A_REL,
  TWIN_B_PATH,
  TWIN_B_REL,
  TWIN_FEED_TITLE,
  TWIN_TAG,
} from '../../test-utils/polluted-vault.mjs'

const SCHEMA_DIR = fileURLToPath(new URL('../../../scripts/schema/', import.meta.url))

const tmps = []

afterAll(() => cleanup(...tmps))

// POLLUTED-BASE 는 이 파일의 7 케이스가 공유한다(시딩 = git 커밋 5회). env 별로 **한 번만** 파싱하고
//   결과(또는 throw)를 값으로 붙들어 케이스마다 되던진다 — 9p spawn 비용을 줄이면서 각 케이스의
//   실패 원인은 그대로 보인다(tdd §2.4 · §7.3).
const polluted = seedPollutedVault()

tmps.push(polluted.vault)

const parsedCache = new Map()

function parseOnce(vault, env) {
  const key = `${vault}\0${env}`
  if (!parsedCache.has(key)) {
    try {
      const runGit = memoizeGitRunner(makeGitRunner(vault))
      const headState = auditHeadDocState(collectHeadDocuments(vault), env, {
        runGit,
        schemaDir: SCHEMA_DIR,
      })
      parsedCache.set(key, { value: parseVault(vault, env, { runGit, headState }) })
    } catch (error) {
      parsedCache.set(key, { error })
    }
  }
  return parsedCache.get(key)
}

function mustParse(vault, env) {
  const outcome = parseOnce(vault, env)
  if (outcome.error !== undefined) {
    throw new Error(
      `[RED] parseVault 가 아직 throw 한다 — 판정이 doc-gate 로 옮겨지지 않았다 (P3 Task 1~3 미구현): ${outcome.error.message}`,
    )
  }
  return outcome.value
}

const idsOf = (docs) => docs.map((doc) => doc.id)

const titlesOf = (items) => items.map((item) => item.title)

const bodyPathsOf = (bodies) => bodies.map((record) => record.breadcrumb.join('/'))

/** tree 를 평탄화해 등장하는 모든 문서 id 를 모은다(폴더 깊이에 무관하게 "유령 노드" 를 잡는다). */
function treeIds(nodes) {
  const out = []
  for (const node of nodes) {
    out.push(...node.docs, ...treeIds(node.children))
  }
  return out
}

describe('제외 전파 — 파싱이 죽지 않고 사유를 값으로 낸다 )', () => {
  it('PG1: POLLUTED-BASE 파싱이 throw 하지 않고 `stats.excluded` 가 DUPLICATE_ID 2건이다', () => {
    const { stats, wire } = mustParse(polluted.vault, 'dev')

    // 앵커(규범 B): 픽스처가 통째로 빈 게 아니다 — 대조군이 실제로 파싱됐다.
    expect(idsOf(wire.docs)).toContain(ID_A)

    expect(stats.excluded).toHaveLength(2)
    expect(stats.excluded.map((entry) => entry.reasonCode)).toEqual([
      'DUPLICATE_ID',
      'DUPLICATE_ID',
    ])
    expect(stats.excluded.map((entry) => entry.path).toSorted()).toEqual([TWIN_A_PATH, TWIN_B_PATH])
  })
})

describe('제외 전파 — 유령 노드 금지', () => {
  it('PG2: 제외 문서 2건이 docs·tree·tags·bodies **네 곳 모두**에서 부재한다', () => {
    // ★ PRD D3 "유령 노드 금지". 네 곳을 **각각** 단언한다 — `tree` 만 빼먹는 구현이 흔하다.
    //   각 단언은 **대조군 존재/제외 부재의 쌍**이다(대칭). 앵커 없이 부재만 보면 payload 가 통째로
    //   빈 픽스처에서 공허 통과한다(P1 FP4 형).
    const { wire } = mustParse(polluted.vault, 'dev')

    expect(idsOf(wire.docs)).toContain(ID_A)
    expect(idsOf(wire.docs)).not.toContain(ID_DUP)

    expect(treeIds(wire.tree)).toContain(ID_A)
    expect(treeIds(wire.tree)).not.toContain(ID_DUP)

    expect(wire.tags[CONTROL_TAG]).toContain(ID_A)
    expect(wire.tags[TWIN_TAG] ?? []).not.toContain(ID_DUP)

    expect(bodyPathsOf(wire.bodies)).toContain(CONTROL_REL)
    expect(bodyPathsOf(wire.bodies)).not.toContain(TWIN_A_REL)
    expect(bodyPathsOf(wire.bodies)).not.toContain(TWIN_B_REL)
  })
})

describe('제외 전파 — 피드는 살고 연결만 끊긴다', () => {
  it('PG3: 제외 문서를 가리킨 피드가 **생존**하고 그 `docs` 가 `[]` 다 (D-B)', () => {
    const { wire } = mustParse(polluted.vault, 'dev')

    // 앵커: 부재가 아니라 **존재**를 먼저 본다 — 이 케이스의 주장은 "살아 있다" 이다.
    expect(titlesOf(wire.items)).toContain(TWIN_FEED_TITLE)
    expect(titlesOf(wire.items)).toContain(CONTROL_FEED_TITLE)

    const twin = wire.items.find((item) => item.title === TWIN_FEED_TITLE)
    expect(twin.docs).toEqual([])
  })

  it('PG4: 그 참조가 `invalidExcludedRefs` 로 관측된다', () => {
    // ★ 오분류 탐지. `draft-excluded` 로 뭉개면 피드가 드랍돼 PG3 가 red 지만, `deleted` 로 뭉개면
    //   결론(생존·docs [])이 같아 **PG3·PG5 가 미발동**한다(tdd §6 CX7). 사유를 구분하는 관측 채널은
    //   이것뿐이다 — 없으면 "왜 비었는가" 를 영원히 알 수 없다.
    const { stats } = mustParse(polluted.vault, 'dev')

    expect(stats.invalidExcludedRefs).toHaveLength(1)
    expect(stats.invalidExcludedRefs[0]).toEqual({
      path: TWIN_A_PATH,
      sha: polluted.twinFeedSha,
    })
    expect(stats.unresolvedPaths).toEqual([]) // 사유를 unresolved 로 흘려보내지 않았다
  })

  it('PG5: `env:"prod"` 에서도 같은 피드 집합이 나온다 (제외는 env 무관)', () => {
    // D-B: `invalid-excluded` 의 생존 판정은 `deleted` 와 동일하다 — draft 와 달리 env 를 타지 않는다.
    const dev = mustParse(polluted.vault, 'dev')
    const prod = mustParse(polluted.vault, 'prod')

    expect(titlesOf(dev.wire.items).toSorted()).toEqual([CONTROL_FEED_TITLE, TWIN_FEED_TITLE].toSorted()) // prettier-ignore
    expect(titlesOf(prod.wire.items).toSorted()).toEqual(titlesOf(dev.wire.items).toSorted())
  })

  it('PG6: 제외 사유를 `unresolved` 로 뭉개지 않는다 — 피드 해석 게이트가 통과한다 (pair)', () => {
    // 사유를 unresolved 로 흘리면 게이트가 **다른 이유로** 죽어 "잘 돌아가는 것처럼" 보인다
    //   (validate 는 여전히 exit 1 이지만 메시지가 "해석되지 않은 참조" 로 잘못 나온다).
    const { stats } = mustParse(polluted.vault, 'dev')

    expect(stats.unresolvedPaths).toEqual([])
    expect(() => checkFeedResolution(stats)).not.toThrow()
  })
})

describe('제외 전파 — 진단 좌표 보존', () => {
  it('PG7: stray 문서를 가리킨 피드의 `{path, sha}` 가 `invalidExcludedRefs` 에 남는다', () => {
    // ★ F5. 현행은 이 진단이 `unresolvedPaths` 에 실려 `validate.cli.test.mjs:299` 가 **sha 앞 12자**를
    //   단언한다. 제외 모델로 옮기면서 이 채널을 안 만들면 **sha 가 증발**해 "어느 커밋이 깨진 문서를
    //   참조하는가" 를 잃는다(R2 Spark 붕괴 조건: 관측 채널이 없으면 불량이 흔적 없이 사라진다).
    const stray = seedStrayVault()
    tmps.push(stray.vault)

    const { stats } = mustParse(stray.vault, 'dev')

    expect(stats.invalidExcludedRefs).toEqual([{ path: STRAY_PATH, sha: stray.strayFeedSha }])
    expect(stats.excluded.map((entry) => entry.reasonCode)).toEqual(['NO_FRONTMATTER'])
    expect(stats.excluded[0].path).toBe(STRAY_PATH)
  })
})

describe('제외 전파 — 과잉 제외 가드 (PG8 · 대조군 vault)', () => {
  it('PG8: 오염 0건 vault 에서는 `stats.excluded` 가 비고 items·prune 이 베이스라인 그대로다', () => {
    // ★ 제외 모델이 **정상 문서를 갉아먹지 않는다**. §8.1 실 vault 판정(항목 1·2)의 헤르메틱 대응물이다
    //   — 실 vault 수치가 흔들리면 "PG8 이 왜 통과했는가" 를 함께 조사하라(tdd §8.1 불일치 처리).
    const clean = seedCleanVault()
    tmps.push(clean.vault)

    const { stats, wire } = mustParse(clean.vault, 'dev')

    expect(idsOf(wire.docs)).toContain(ID_A) // 앵커: 픽스처가 비지 않았다
    expect(wire.docs).toHaveLength(3)
    expect(titlesOf(wire.items)).toEqual([CONTROL_FEED_TITLE])
    expect(stats.prunedDocRefs).toBe(0)
    expect(stats.prunedFeeds).toBe(0)
    expect(stats.unresolvedPaths).toEqual([])
    expect(stats.excluded).toEqual([])
    expect(stats.invalidExcludedRefs).toEqual([])
  })
})

describe('사유 상수 트립와이어', () => {
  it('PG9: `FEED_REF_REASONS` 가 리터럴 4값과 정렬 일치한다', () => {
    // 규범 A 는 "픽스처가 상수를 import 하지 말라" 이지 "상수를 검사하지 말라" 가 아니다. 그 대가로
    //   **여기 한 곳**에서만 코드와 리터럴을 맞댄다 — 코드가 사유를 늘렸는데 상수를 안 늘리면(또는
    //   반대면) 다른 스펙이 조용히 통과하기 전에 여기서 먼저 잡힌다.
    expect([...FEED_REF_REASONS].toSorted()).toEqual(
      ['deleted', 'draft-excluded', 'invalid-excluded', 'unresolved'].toSorted(),
    )
  })
})
