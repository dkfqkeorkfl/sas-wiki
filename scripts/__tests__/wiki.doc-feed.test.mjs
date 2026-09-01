// @vitest-environment node
//
// news-convention-migration · Phase 2(doc-history-assembly) · **T2** — `wiki.mjs` 이력 merge (W1~W5)
//   계약: `wiki()` 가 문서 응답을 만들 때 그 문서의 이력을 **내부에서 1회 조달**해
//   `feed: { items, nextCursor }` 로 merge 한다. 조달은 `feeds()` 호출(라이브 git 워크)이며,
//   🔴 발행 아티팩트(`cache/feeds.<env>.json`)를 직접 읽지 않는다 — 그러면 기존 두 조달
//   경로 어느 쪽도 아닌 세 번째 경로가 생기고, 「캐시 없으면 이력 없음」이 되살아난다.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// RED 사유 (지금 왜 실패하는가)
// ─────────────────────────────────────────────────────────────────────────────────────────────
// 오늘 `wiki()`(`wiki.mjs:37-60`)는 summary 아티팩트를 읽어 `projectSingleDoc` **7키**를 그대로
//   돌려준다 — `feeds()` 를 부르지 않고 git 도 타지 않는다(`wiki.mjs:2-5` 가 그 비용 계약을 선언한다).
//   그래서 응답에 `feed` 키가 **아예 없다** ⇒ W1·W2 는 `feed` 부재로, W4 는 「조달 실패가 애초에
//   일어나지 않는다」로 red 다. W3·W5 는 🟢 회귀 가드라 **오늘도 green 이 정상**이고, 각각 케이스 안의
//   **양성 대조**(active 문서의 `feed.items.length > 0`)가 red 를 진다.
//
// GREEN 이 구현할 계약(tdd §5 T2 · plan Task 2):
//   1. `wiki(vault, env, ref, summaryPath, ignorePath)` — 4인자에 **억제 경로 하나만** 는다.
//      이력은 경로 인자가 아니라 `./feeds.mjs` 의 `feeds()` **내부 호출 1회**로 조달한다:
//      `await feeds(vault, env, { doc: <문서 id>, ignore: <억제 목록 경로> })`.
//      🔴 `count` 를 넘기지 않는다(미지정 = 상한 없음 = 그 문서 이력 **전량** · D-P2-4).
//      🔴 아티팩트(`cache/feeds.<env>.json`) 직독 금지 — 2차 정정이 철회한 설계다.
//   2. summary 아티팩트에서 `ref` → 문서 id 를 푼다(`makeDocIndex` 는 id 를 의도적으로 버린다).
//   3. `feed: { items, nextCursor }` 를 **순서 보존**으로 더한다(정렬·재필터 금지 — 조달 층).
//   4. 🔴 **부착 지점은 `projectSingleDoc` 의 반환 블록**이고, **조달은 `wiki.mjs`** 에 둔다.
//      `single-doc.mjs` 에서 `feeds.mjs` 를 import 하면 `feeds.mjs:26` 의 `lib/git-walk.mjs` 가
//      정적 폐쇄로 유입돼 **WK8**(`wiki.single-doc.test.mjs:250-251`)이 red 가 된다 —
//      그건 가드를 고칠 신호가 아니라 **조달을 잘못된 층에 두었다는 신호**다. 결과는
//      `projectSingleDoc({ index, readFile, ref, render, feed })` **인자**로 넘긴다.
//   5. 🔴 disable 스텁에는 `feed` 를 싣지 않는다(`single-doc.mjs:71` 이 먼저 return 하므로 공짜).
//      없는 경로는 여전히 `null`(부모가 404 로 선처리한다).
//   6. 🔴 조달 실패(git 사용 불가·워크 실패)는 **뭉개지 말고 그대로 throw** 시킨다(W4).
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// 승계한 작성 관례 (tdd §2-5)
// ─────────────────────────────────────────────────────────────────────────────────────────────
// 규범 A — summary 경로·문서 id·키 집합은 **리터럴 조립**이다(프로덕션 상수를 import 하지 않는다).
// 규범 C10 — `resolves`/`rejects` 앞에 `toBeInstanceOf(Promise)` seam 가드.
// 규범 D — 헬퍼에 `expect` 를 두지 않는다.
// 🔴 공허 방지(tdd §8 #5~#9) — W2·W3 의 **음성 단언은 단독으로 쓰지 않는다**. 같은 케이스 안에서
//   「이력이 있는 문서는 `>0`」을 함께 물지 않으면 **Task 를 통째로 빼먹어도 green** 이다.
//
// 🔴 픽스처 전제: 이력은 아티팩트가 아니라 **git 라이브 워크**로 온다 ⇒ vault 는 `initVault()`
//   (= `git init -q`) + `commit()` 로 세우고, 이력은 `feedCommit()` 으로 심는다. `prebuildArtifacts`
//   는 **summary 아티팩트**(= `ref` → 문서 id 해석)를 위해 계속 필요하다(반환값의 `feedsArtifactPath`
//   는 이 phase 에서 소비처가 없다).
import { rmSync } from 'node:fs'
import path from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'

import { prebuildArtifacts } from './helpers/prebuild-artifacts.mjs'
import { cleanup, commit, feedCommit, initVault, writeDoc } from './helpers/tmp-git-vault.mjs'

const { wiki } = await import(new URL('../wiki.mjs', import.meta.url).href)
const { feeds } = await import(new URL('../feeds.mjs', import.meta.url).href)

/** summary 아티팩트 경로 — **리터럴 조립**(규범 A · `wiki.test.mjs:25` 와 같은 형태). */
const summaryFile = (vault, env) => path.join(vault, 'cache', `summary.${env}.json`)

/**
 * ★ 호출 인자는 **4개 그대로**다(tdd §5-A(3) — 피드 아티팩트 경로 인자는 존재하지 않는다).
 * GREEN 이 더하는 5번째 `ignorePath` 는 **선택적**이고 이 tmp vault 에는 `ignore-feeds.json` 이
 * 없어 억제 0 이 정상 기대값이다. 규범 D: 헬퍼에 `expect` 를 두지 않는다.
 */
const askWiki = (vault, env, ref) => wiki(vault, env, ref, summaryFile(vault, env))

const ID_A = '0192e100-0000-7000-8000-0000000000a1'
const ID_EMPTY = '0192e100-0000-7000-8000-0000000000e1'
const ID_DISABLE = '0192e100-0000-7000-8000-0000000000d1'

const REL_A = 'company/테스트기업에이'
const REL_EMPTY = 'concept/이력없는문서'
const REL_DISABLE = 'concept/온디바이스-에이아이'

/** 🔴 W1 의 기대값은 이 배열에서 **유도**한다 — 건수를 리터럴로 박지 않는다(tdd §5 T2). */
const A_FEED_SUBJECTS = ['에이 소식 1', '에이 소식 2', '에이 소식 3']
const DISABLE_FEED_SUBJECTS = ['비활성 문서 소식 1']

const tmps = []
afterAll(() => cleanup(...tmps))

function putDoc(vault, rel, { body, id, status = 'active', title }) {
  writeDoc(vault, rel, { body: `## 정의\n\n${body}\n`, id, status, title })
}

/**
 * 세계관 — active 2(이력 3건 / 이력 0건) + disable 1(이력 1건).
 *
 * 규범 D: 판정하지 않고 **시딩이 만든 사실만** 돌려준다(피드 id 는 최신순 = 워크 순서).
 */
async function seedWorld() {
  const vault = initVault()
  tmps.push(vault)
  putDoc(vault, REL_A, { body: '에이 초판.', id: ID_A, title: '테스트기업에이' })
  putDoc(vault, REL_EMPTY, { body: '이력이 없는 문서다.', id: ID_EMPTY, title: '이력없는문서' })
  putDoc(vault, REL_DISABLE, { body: '비활성 문서다.', id: ID_DISABLE, status: 'disable', title: '온디바이스 에이아이' }) // prettier-ignore
  commit(vault, 'chore: active 2 + disable 1 생성')

  const oldestFirst = []
  for (const subject of A_FEED_SUBJECTS) {
    putDoc(vault, REL_A, { body: `에이 갱신 — ${subject}.`, id: ID_A, title: '테스트기업에이' })
    oldestFirst.push(feedCommit(vault, { subject }).slice(0, 12))
  }
  const disableOldestFirst = []
  for (const subject of DISABLE_FEED_SUBJECTS) {
    putDoc(vault, REL_DISABLE, { body: `비활성 갱신 — ${subject}.`, id: ID_DISABLE, status: 'disable', title: '온디바이스 에이아이' }) // prettier-ignore
    disableOldestFirst.push(feedCommit(vault, { subject }).slice(0, 12))
  }
  await prebuildArtifacts(vault, 'dev')

  return {
    aFeedIds: [...oldestFirst].reverse(),
    disableFeedIds: [...disableOldestFirst].reverse(),
    vault,
  }
}

describe('wiki 응답이 그 문서의 이력을 싣는다 (W1 · 🔴RED `feed` 부재)', () => {
  it('W1: 이력 3건 문서 → `feed.items` 가 **심은 `feedCommit` 수**와 같고 워크 순서 그대로다', async () => {
    const { aFeedIds, vault } = await seedWorld()

    const doc = await askWiki(vault, 'dev', REL_A)

    // 앵커: 문서 자체는 오늘도 나온다 — 「문서가 없어서 실패」와 「`feed` 가 없어서 실패」를 가른다.
    expect(doc).not.toBeNull()
    expect(doc.path).toBe(REL_A)

    // 🔴 「3건」을 리터럴로 박지 않는다 — 시딩이 심은 커밋 수에서 **유도**한다(E-b 와 같은 이유).
    expect(doc.feed.items).toHaveLength(A_FEED_SUBJECTS.length)
    // 규범 N — 개수 단독 금지: id 배열 정확 일치(최신순 = 워크 순서 · 조달 층은 정렬하지 않는다).
    expect(doc.feed.items.map((item) => item.id)).toEqual(aFeedIds)
    // 그 항목들이 **이 문서를 가리킨다**(엉뚱한 문서 이력을 실은 구현 배제).
    expect(doc.feed.items.every((item) => item.docs.some((ref) => ref.id === ID_A))).toBe(true)
    // `count` 미지정 = 전량이므로 커서는 없다(§1-2 — 자리는 두되 값은 `null`).
    expect(doc.feed.nextCursor).toBeNull()
  })
})

describe('이력이 없어도 키는 있다 (W2 · 🔴RED · 🔴양성 대조 필수)', () => {
  it('W2: 이력 0건 문서 → `feed.items` 는 `[]` **이지만 키는 존재** · 같은 vault 대조군은 `>0`', async () => {
    const { vault } = await seedWorld()

    const empty = await askWiki(vault, 'dev', REL_EMPTY)

    // 🔴 단독 음성 금지(tdd §8 #6) — 이 줄이 없으면 **Task 를 통째로 빼먹어도** `[]` 는 성립한다.
    //   같은 vault·같은 호출 형태의 양성 대조를 케이스 안에 둔다.
    expect((await askWiki(vault, 'dev', REL_A)).feed.items.length).toBeGreaterThan(0)

    // D-P2-9 — `feed` 는 **항상** 실린다(이력 0건이면 빈 배열 · 키를 빼지 않는다).
    expect(Object.hasOwn(empty, 'feed')).toBe(true)
    expect(empty.feed.items).toEqual([])
    expect(empty.feed.nextCursor).toBeNull()
  })
})

describe('disable 스텁에는 이력을 싣지 않는다 (W3 · 🟢부재 단언 + 🔴양성 대조)', () => {
  it('W3: disable 문서 → `feed` **부재**(스텁 4키 그대로) · active 대조군은 `>0`', async () => {
    const { disableFeedIds, vault } = await seedWorld()

    // 앵커 ⓐ: 그 disable 문서는 **실제로 피드를 갖는다** — 「없어서 안 실린 것」과 구분한다
    //   (tdd §8 #7 · 실 vault 의 `dev/concept/온디바이스-AI` 가 이력 1건인 것과 같은 세계관).
    const all = await feeds(vault, 'dev', { count: 10 })
    expect(all.items.filter((item) => item.docs.some((ref) => ref.id === ID_DISABLE)).map((item) => item.id)).toEqual(disableFeedIds) // prettier-ignore

    // 앵커 ⓑ(🔴RED): 같은 vault 의 active 문서는 이력을 **싣는다** — 이 줄이 없으면 「아무 문서에도
    //   `feed` 를 안 싣는 구현」이 아래 부재 단언을 통과한다.
    expect((await askWiki(vault, 'dev', REL_A)).feed.items.length).toBeGreaterThan(0)

    const stub = await askWiki(vault, 'dev', REL_DISABLE)

    expect(stub.status).toBe('disable')
    expect(Object.hasOwn(stub, 'feed')).toBe(false)
  })
})

describe('이력 조달 실패는 조용한 빈 배열이 아니다 (W4 · 🔴RED · 엣지)', () => {
  it('W4: git 저장소를 쓸 수 없으면 **throw** 하고 문면이 그 사유를 말한다', async () => {
    const { vault } = await seedWorld()

    // 앵커(오늘도 green): 같은 vault·같은 요청이 **정상 상태에서는 resolve** 한다 → 아래 rejects 가
    //   「원래 죽는 요청」이 아님을 케이스 안에서 확정한다.
    const healthy = askWiki(vault, 'dev', REL_A)
    expect(healthy).toBeInstanceOf(Promise) // 규범 C10
    await expect(healthy).resolves.not.toBeNull()

    // summary 아티팩트는 **그대로 둔 채** git 만 쓸 수 없게 만든다 — 그래야 실패 사유가
    //   「아티팩트 부재」가 아니라 **「이력 조달」**임이 갈린다(tdd §8 #8: 아티팩트 reason 4종은
    //   이 케이스의 사유가 아니다).
    rmSync(path.join(vault, '.git'), { force: true, recursive: true })

    const returned = askWiki(vault, 'dev', REL_A)
    expect(returned).toBeInstanceOf(Promise) // 규범 C10
    // 🔴 사유가 문면에 있다 — `try/catch` 로 삼켜 `items: []` 로 접으면 여기가 red 다.
    await expect(returned).rejects.toThrow(/git/iu)

    // 🔴 사유 뒤바뀜 방지: summary 아티팩트 읽기 실패로 죽은 것이 **아니다**(규범 P).
    const error = await returned.catch((caught) => caught)
    expect(error.message).not.toMatch(/아티팩트/u)
  })
})

describe('없는 경로는 여전히 `null` 이다 (W5 · 🟢회귀 가드 — 오늘도 green)', () => {
  it('W5: 인덱스에 없는 ref → `null`(빈 객체·throw 아님) · 정규 문서는 객체다', async () => {
    // 부모가 404 로 선처리하는 계약(`plugin.ts` 의 `wikiEnvelope.parse(null)` 은 throw)이 이 값에
    //   결속돼 있다 — 이력 merge 가 그 형태를 바꾸면 안 된다.
    const { vault } = await seedWorld()

    // 앵커(규범 U): 같은 vault·같은 빌드에서 정규 문서는 객체다(인덱스가 비어서 통과하는 것 배제).
    expect(await askWiki(vault, 'dev', REL_A)).not.toBeNull()

    expect(await askWiki(vault, 'dev', '없는/경로')).toBeNull()
  })
})
