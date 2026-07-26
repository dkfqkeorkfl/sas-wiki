// @vitest-environment node
//
// P3 · Task 9 — F-2 이중 빌더 등가 실증 (`walkFeeds` stats vs `buildFeedItems` stats) — tdd §3.10 (EQ1~EQ4)
//
// ⚠️ **수명 명시 — 이 파일은 일회성 게이트다.** `buildFeedItems` 제거 직전까지만 존재한다. 제거 후에는
//   비교 대상이 사라져 **구조적으로 공허**해진다. Task 9 의 마지막 커밋에서 **파일째 삭제**하고, 삭제
//   사실과 최종 실측치(+15 git spawn · +2.7초)를 커밋 본문에 남긴다(무음 제거 금지 · tdd §10.3-4).
//
// RED 사유(EQ1~EQ3 · **미구현**): `walkFeeds` 는 지금 **stats 를 하나도 만들지 않는다**(items +
//   non-enumerable `nextCursor` 뿐 · plan:73 실측). 그래서 `.stats` 접근이 undefined 이고 5필드 비교가
//   red 다. EQ4 는 통과/실패가 아니라 **측정**이다(tdd §8.2 표에 기록).
//
// 이 파일이 확정하는 seam (tdd §3.0 이 비워 둔 자리 — 이 스펙이 채운다):
//   walkFeeds(vault, opts).stats → { prunedDocRefs, prunedFeeds, unpublishedFeedCommits,
//                                    unresolvedPaths, warnings }
//   `nextCursor` 와 같은 방식(반환 배열의 **non-enumerable 속성**)으로 얹는 것을 권한다 — 그러면
//   `feeds()` 의 JSON 직렬화가 바이트 단위로 불변이다(EQ4 가 그것을 잰다).
//
// **정답 규칙(사전 명문화 · rustc migrate 의 하위호환 기준선 논리)**: 두 빌더의 5필드가 **완전 일치**
//   해야 한다. 불일치하면 **`walkFeeds` 가 틀린 것**으로 본다 — 서빙 경로가 사실의 기준이 아니라,
//   검증기가 지금까지 통과시켜온 값이 기준선이다.
//
// 구 빌더 쪽 관측은 `parseVault(...).stats` 로 한다 — 그것이 `buildFeedItems` 의 stats 를 **그대로**
//   실어 나르는 실제 생산 경로다(`parse-vault.mjs:105`). 컨텍스트를 테스트가 손으로 재조립하면
//   "테스트가 만든 입력끼리의 등가" 가 되어 실 배선의 어긋남을 놓친다.
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterAll, describe, expect, it } from 'vitest'

import { checkFeedResolution } from '../invariants.mjs'
import { parseVault } from '../parse-vault.mjs'
import { walkFeeds } from '../git-walk.mjs'
import { cleanup } from '../../__tests__/helpers/tmp-git-vault.mjs'
import { seedPollutedVault, seedStrayVault } from '../../__tests__/helpers/polluted-vault.mjs'
import { seedSurvivalVault } from '../../__tests__/helpers/survival-vault.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SCHEMA_DIR = path.resolve(HERE, '..', '..', 'schema')

/** 승계 대상 5필드 — 그 이상도 이하도 아니다(측정이 정한 절단선 · plan D-G). */
const STATS_KEYS = [
  'prunedDocRefs',
  'prunedFeeds',
  'unpublishedFeedCommits',
  'unresolvedPaths',
  'warnings',
]

const pick5 = (stats) =>
  Object.fromEntries(STATS_KEYS.map((key) => [key, stats === undefined ? undefined : stats[key]]))

const tmps = []
afterAll(() => cleanup(...tmps))

function track(vault) {
  tmps.push(vault)
  return vault
}

/** `walkFeeds` 의 stats — RED 시점에는 존재하지 않는다. 명시 실패로 바꿔 원인을 드러낸다. */
function walkStatsOf(vault, env) {
  const items = walkFeeds(vault, { count: 50, env })
  if (items.stats === undefined) {
    throw new Error(
      `[RED] walkFeeds 가 아직 stats 를 생산하지 않는다 (P3 Task 9 미구현 · env=${env})`,
    )
  }
  return { items, stats: items.stats }
}

describe('F-2 등가 — RR-BASE 5필드 (EQ1 · 🔴RED 미구현)', () => {
  it.each(['dev', 'prod'])('EQ1(%s): 두 빌더의 5필드가 완전히 일치한다', (env) => {
    const vault = track(seedSurvivalVault())
    const legacy = parseVault(vault, env, SCHEMA_DIR)
    const walk = walkStatsOf(vault, env)

    // 앵커(규범 B): 두 빌더가 **각각 1건 이상**을 만들었다 — 빈 vault 에서 `{} == {}` 로 공허 통과하는
    //   것을 배제한다. RR-BASE 는 dev 3건 / prod 2건(실험 소식은 draft-excluded 로 드랍)이다.
    expect(legacy.wire.items.length).toBeGreaterThan(0)
    expect(walk.items.length).toBeGreaterThan(0)

    expect(pick5(walk.stats)).toEqual(pick5(legacy.stats))
  })
})

describe('F-2 등가 — 게이트 소비자 형태 보존 (EQ2 · 🔴RED 미구현)', () => {
  it('EQ2: `unresolvedPaths` 가 `{path, sha}` 형태로 동일하고 `checkFeedResolution` 이 같게 동작한다', () => {
    // ★ `unresolvedPaths` 는 **유일한 게이트 소비자**(`invariants.mjs:32`)를 갖는다. 형태가 바뀌면
    //   진단 메시지가 `undefined undefined` 로 깨지고, 그것은 스키마도 타입체커도 못 잡는다(.mjs).
    const { vault } = seedStrayVault()
    track(vault)
    const legacy = parseVault(vault, 'dev', SCHEMA_DIR)
    const walk = walkStatsOf(vault, 'dev')

    expect(walk.stats.unresolvedPaths).toEqual(legacy.stats.unresolvedPaths)
    for (const entry of [...walk.stats.unresolvedPaths, ...legacy.stats.unresolvedPaths]) {
      expect(Object.keys(entry).toSorted()).toEqual(['path', 'sha'])
    }
    // 게이트 동작 자체가 같아야 한다 — 배열만 같고 소비 결과가 갈리면 승계가 안 된 것이다.
    expect(outcomeOf(() => checkFeedResolution(walk.stats))).toEqual(
      outcomeOf(() => checkFeedResolution(legacy.stats)),
    )
  })
})

describe('F-2 등가 — 제외 모델 도입 후에도 (EQ3 · 🔴RED 미구현)', () => {
  it('EQ3: POLLUTED-BASE 에서도 5필드가 일치한다 (새 사유가 한쪽에만 반영되는 것을 배제)', () => {
    const { vault } = seedPollutedVault()
    track(vault)
    const legacy = parseVault(vault, 'dev', SCHEMA_DIR)
    const walk = walkStatsOf(vault, 'dev')

    expect(legacy.wire.items.length).toBeGreaterThan(0) // 앵커
    expect(walk.items.length).toBeGreaterThan(0)

    expect(pick5(walk.stats)).toEqual(pick5(legacy.stats))
  })
})

// EQ4(측정)는 프로세스 경계 비교(`feeds --env dev` 출력이 제거 전후로 바이트 동일)이므로 러너의
//   통과/실패가 아니라 tdd §8.2 표에 기록한다. 여기서 단언하지 않는 이유: "제거 전" 출력은 이 파일이
//   삭제되는 시점에만 존재하며, 그 값을 테스트에 박으면 그 순간 브리틀 상수가 된다.

/** throw 여부와 메시지를 값으로 만든다 — 두 게이트 소비 결과를 **비교 가능한 형태**로 바꾼다. */
function outcomeOf(run) {
  try {
    run()
    return { threw: false }
  } catch (error) {
    return { message: error instanceof Error ? error.message : String(error), threw: true }
  }
}
