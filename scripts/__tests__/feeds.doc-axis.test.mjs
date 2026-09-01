// @vitest-environment node
//
// news-convention-migration · Phase 2(doc-history-assembly) · **T1** — `feeds.mjs` 문서 축 (D1~D8)
//   계약: `feeds()` 에 **문서 축**을 신설한다 — 「그 문서를 가리키는 발행 피드만」을 낸다.
//   🔴 필터는 윈도잉(`count`) **이전**에 적용한다 — 「N건을 가져와 그중 이 문서 것만」이 아니라
//   「이 문서 것 중 N건」이어야 나중에 `count` 를 붙였을 때 페이징이 성립한다.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// RED 사유 (지금 왜 실패하는가)
// ─────────────────────────────────────────────────────────────────────────────────────────────
// 오늘 `feeds(vault, env, window)` 의 `window` 는 `{after, count, ignore}` **셋뿐**이다
//   (`feeds.mjs:65-70` JSDoc · `:94-100` 이 그 셋만 `walkCursorPage` 로 넘긴다). `doc` 을 넘겨도
//   **조용히 무시**되므로 이 파일의 문서 축 케이스는 전부 「거르지 않은 전량」을 받아 red 다.
//   CLI 축(D8)은 `parseCliArgs`(`feeds.mjs:147-160`)의 options 에 `doc` 이 없어 `parseArgs` 가
//   `Unknown option '--doc'` 로 던지고 `fail()` 이 **exit 2** 를 낸다 — 종료코드는 우연히 같지만
//   **사유가 다르다**(D8-b 가 그 뒤바뀜을 문다 · 규범 P).
//
// GREEN 이 구현할 계약(tdd §5 T1):
//   · `feeds(vault, env, { after?, count?, doc?, ignore? })` — `doc` 이 있으면 그 문서 id 를
//     `items[].docs[].id` 로 가리키는 항목만 남긴다.
//   · 🔴 **윈도잉(`count`) 이전에** 거른다 — 「N건 중 이 문서 것」이 아니라 「이 문서 것 중 N건」
//     (실제 주입 지점은 `lib/feed-cursor.mjs` 의 배치 루프 · D6 이 그 순서를 문다).
//   · 🔴 **정렬하지 않는다**(조달 층) · 🔴 **억제를 재적용하지 않는다**(`applyIgnoreFeeds` 단일 지점
//     이 이미 걸러 자동 승계된다 · D5).
//   · CLI 에 `--doc <docId>` 를 더하되 **`--count` 필수 계약은 그대로**다(D8).
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// 승계한 작성 관례 (tdd §2-5)
// ─────────────────────────────────────────────────────────────────────────────────────────────
// 규범 A — 문서 id·경로 조각·종료코드는 **리터럴**이다(프로덕션 상수를 import 하지 않는다).
// 규범 D — 헬퍼에 `expect` 를 두지 않는다(시딩 원자는 사실만 돌려준다).
// 규범 N — 결과는 개수 단독이 아니라 **id 배열 정확 일치**로 문다.
// 규범 O — 인자 계약 위반 = exit 2 / 런타임 실패 = exit 1.
// 🔴 공허 방지(tdd §8) — 모든 문서 축 케이스의 시드에는 **매칭되지 않는 항목이 반드시 1건 이상**
//   있고, 각 케이스 안에 같은 vault 로 얻은 **양성 대조**를 둔다. 그 둘이 없으면 「필터가 없어도
//   우연히 맞는 세계관」이 되어 이 파일 전체가 장식이 된다.
//
// ★ `prebuildArtifacts` 를 부르지 않는다 — `feeds()` 는 v3 P2 이후 아티팩트를 읽지 않고 git 을
//   라이브 워크한다(`feeds.mjs:2-11`). 필요한 전제는 「vault 가 커밋 1건 이상을 가진 git 저장소」뿐이다
//   (`feeds.count-env-guard.test.mjs` 가 같은 형태다).
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'

import { runFeedsCli } from './helpers/cursor-vault.mjs'
import { cleanup, commit, feedCommit, initVault, writeDoc } from './helpers/tmp-git-vault.mjs'

const { feeds } = await import(new URL('../feeds.mjs', import.meta.url).href)

/** 문서 frontmatter id — **리터럴**이다(규범 A). UUIDv7 형태는 `feeds.schema.json` docRef 계약. */
const ID_A = '0192d100-0000-7000-8000-0000000000a1'
const ID_B = '0192d100-0000-7000-8000-0000000000b1'
const ID_EMPTY = '0192d100-0000-7000-8000-0000000000e1'
/** vault 어디에도 없는 문서 id — 형태만 유효하다(D7). */
const ID_ABSENT = '0192d100-0000-7000-8000-0000000000ff'

const REL_A = 'company/문서에이'
const REL_B = 'company/문서비'
const REL_EMPTY = 'concept/이력없는문서'

/** 억제 목록 파일명 — **리터럴**이다(`lib/ignore.mjs` 의 상수를 import 하지 않는다 · 규범 A). */
const IGNORE_FILE = 'ignore-feeds.json'
const IGNORE_WHEN = '2026-09-01T00:00:00Z'

const tmps = []
afterAll(() => cleanup(...tmps))

/** 새 tmp git vault. 규범 D: 사실만 돌려준다. */
function newVault() {
  const vault = initVault()
  tmps.push(vault)
  return vault
}

/** 문서 1건을 디스크에 쓴다(커밋하지 않는다). */
function putDoc(vault, rel, id, body) {
  writeDoc(vault, rel, { body: `## 정의\n\n${body}\n`, id, title: rel.split('/').at(-1) })
}

/**
 * 그 문서 본문을 갱신한 뒤 `feed:` 커밋 1건 — **12-hex feedId** 를 돌려준다.
 *
 * `feedCommit` 이 `git add -A` 로 스테이징 전량을 담으므로, 직전에 쓴 문서가 그 커밋이 가리키는
 * 문서가 된다(`feed.mjs` 의 diff→docs 해석 계약 · `helpers/cursor-vault.mjs:62-78` 과 같은 형태).
 */
function pushDocFeed(vault, { body, id, rel, subject }) {
  putDoc(vault, rel, id, body)
  return feedCommit(vault, { subject }).slice(0, 12)
}

const idsOf = (page) => page.items.map((item) => item.id)

describe('문서 축 — 그 문서를 가리키는 항목만 남는다 (D1 · 🔴RED `doc` 옵션 부재)', () => {
  it('D1: 항목 3건 중 그 문서를 가리키는 2건만 · **입력(워크) 순서 보존**', async () => {
    const vault = newVault()
    putDoc(vault, REL_A, ID_A, '에이 초판.')
    putDoc(vault, REL_B, ID_B, '비 초판.')
    commit(vault, 'chore: 문서 2건 생성')
    // 🔴 시드에 **매칭되지 않는 항목(fB)이 반드시 있다**(tdd §8 #1) — 없으면 필터를 안 걸어도
    //   우연히 맞아 이 케이스가 장식이 된다.
    const fa1 = pushDocFeed(vault, { body: '에이 1차 갱신.', id: ID_A, rel: REL_A, subject: 'A 소식 1' }) // prettier-ignore
    const fb1 = pushDocFeed(vault, { body: '비 1차 갱신.', id: ID_B, rel: REL_B, subject: 'B 소식 1' }) // prettier-ignore
    const fa2 = pushDocFeed(vault, { body: '에이 2차 갱신.', id: ID_A, rel: REL_A, subject: 'A 소식 2' }) // prettier-ignore

    // 양성 대조(오늘도 green): 축 없이 부르면 **3건 전부** 최신순으로 온다 — 즉 fb1 은 실재하고
    //   「없어서 안 나온 것」이 아니다. 이 줄이 아래 단언의 비공허성을 케이스 안에서 확정한다.
    expect(idsOf(await feeds(vault, 'dev', { count: 10 }))).toEqual([fa2, fb1, fa1])

    const page = await feeds(vault, 'dev', { count: 10, doc: ID_A })

    // 규범 N — 개수 단독이 아니라 **정확 배열**. 순서는 워크 순서(최신 → 과거) 그대로다(정렬 금지).
    expect(idsOf(page)).toEqual([fa2, fa1])
  })
})

describe('문서 축 — `docs: []` 항목은 어떤 문서에도 매칭되지 않는다 (D2 · 🔴RED · 엣지)', () => {
  it('D2: 문서를 하나도 건드리지 않은 `feed:` 커밋은 문서 축 결과에서 빠진다', async () => {
    // 실 데이터 사례: `feeds.dev.json` 의 `8abda5740fe0` 이 `docs: []` 다(tdd §4-3 조인표).
    const vault = newVault()
    putDoc(vault, REL_A, ID_A, '에이 초판.')
    commit(vault, 'chore: 문서 1건 생성')
    const fa1 = pushDocFeed(vault, { body: '에이 1차 갱신.', id: ID_A, rel: REL_A, subject: 'A 소식 1' }) // prettier-ignore
    // 마크다운이 아닌 파일만 건드리는 `feed:` 커밋 → `anyMarkdown` 필터에 하나도 안 걸려 `docs: []`.
    mkdirSync(path.join(vault, 'assets'), { recursive: true })
    writeFileSync(path.join(vault, 'assets', 'note.txt'), '문서가 아닌 파일이다.\n', 'utf8')
    const fNoDoc = feedCommit(vault, { subject: '문서 없는 소식' }).slice(0, 12)

    const all = await feeds(vault, 'dev', { count: 10 })
    // 앵커 ⓐ(오늘도 green): 그 항목이 **실재**하고 ⓑ 그 `docs` 가 **정말 비어 있다**.
    //   두 줄이 없으면 아래 부재 단언은 「애초에 없어서 통과」와 구분되지 않는다.
    expect(idsOf(all)).toEqual([fNoDoc, fa1])
    expect(all.items.find((item) => item.id === fNoDoc).docs).toEqual([])

    expect(idsOf(await feeds(vault, 'dev', { count: 10, doc: ID_A }))).toEqual([fa1])
  })
})

describe('문서 축 — 여러 문서를 가리키는 항목도 축마다 1건이다 (D3 · 🔴RED · 엣지)', () => {
  // ─────────────────────────────────────────────────────────────────────────────────────────
  // 🔴 tdd §4-1 의 D3 원문(「한 항목이 **같은 id** 를 두 번 → 1번만」)은 **이 저장소에서 시딩할 수
  //    없다.** 착수 시 실측으로 확인한 구조적 사유 3중:
  //      ① `judgeFeedSurvival`(`lib/feed-survival.mjs:5-13`)이 항목 단위로 doc id 를 **무조건 dedup**
  //         한다 ⇒ `items[].docs` 에 같은 id 가 두 번 실리는 출력이 존재할 수 없다.
  //      ② `resolveDocRef`(`lib/git-walk.mjs:224-247`)는 한 status 당 **최대 1건**의 ref 만 돌려준다
  //         (`refsForStatus` 가 3형태를 시도하되 첫 해석에서 return).
  //      ③ 그래서 남은 길은 「한 커밋이 같은 문서를 두 경로로 건드리기」(rename 미검출 D+A)인데,
  //         그것은 문서 게이트가 **`DELETED_ID_REUSE`** 로 배제한다(실측 문면: _"삭제된 문서의 id
  //         재사용: … wiki/company/문서에이.md -> wiki/concept/이사한문서에이.md"_) ⇒ 그 문서가
  //         headIds 에서 빠져 항목의 `docs` 가 오히려 **`[]`** 가 된다(중복은커녕 0건이다).
  //    ⇒ 원문 그대로 쓰면 **관측 불가능한 세계관을 시딩하는 공허한 케이스**가 된다. 그래서 같은
  //      의도(「문서 축은 항목을 참조 단위로 fan-out 하지 않는다 · 축은 항목을 소비하지 않는다」)를
  //      **실데이터에 실재하는 형태**로 옮긴다 — tdd §8 「중복/멱등」이 짝으로 적어 둔
  //      _"한 항목이 두 문서를 가리킴(실데이터 `eca3be1e87bd`)"_ 가 바로 그것이다.
  // ─────────────────────────────────────────────────────────────────────────────────────────
  it('D3: 두 문서를 가리키는 한 항목이 **두 축 각각에서 1번씩** 나온다(fan-out 아님)', async () => {
    const vault = newVault()
    putDoc(vault, REL_A, ID_A, '에이 초판.')
    putDoc(vault, REL_B, ID_B, '비 초판.')
    commit(vault, 'chore: 문서 2건 생성')
    // 🔴 매칭되지 않는 항목 1건 — 없으면 필터가 없어도 우연히 맞는다(tdd §8 #2 의 대조축).
    const fOnlyB = pushDocFeed(vault, { body: '비 1차 갱신.', id: ID_B, rel: REL_B, subject: 'B 소식 1' }) // prettier-ignore
    // 한 커밋이 두 문서를 함께 고친다 → 그 항목의 `docs` 는 2건이다.
    putDoc(vault, REL_A, ID_A, '에이 동시 갱신.')
    putDoc(vault, REL_B, ID_B, '비 동시 갱신.')
    const fBoth = feedCommit(vault, { subject: '두 문서 동시 소식' }).slice(0, 12)

    const all = await feeds(vault, 'dev', { count: 10 })
    // 앵커 ⓐ(오늘도 green): 그 항목이 **정말 두 문서를 가리킨다** — 「하나만 가리켜서 1건」이라는
    //   공허 통과를 배제한다. 순서는 diff status 순이라 집합으로 문다.
    const bothDocs = all.items.find((item) => item.id === fBoth).docs.map((ref) => ref.id).toSorted() // prettier-ignore
    expect(bothDocs).toEqual([ID_A, ID_B].toSorted())
    // 앵커 ⓑ: 대조군 항목은 B 만 가리킨다(두 항목이 같은 모양이 아니다).
    expect(all.items.find((item) => item.id === fOnlyB).docs).toEqual([{ id: ID_B }])

    // A 축에는 그 항목이 **정확히 1번** — 참조 단위 fan-out 이면 여기가 무너진다.
    expect(idsOf(await feeds(vault, 'dev', { count: 10, doc: ID_A }))).toEqual([fBoth])
    // B 축에도 **정확히 1번** 그대로 남는다(축이 항목을 소비하지 않는다).
    expect(idsOf(await feeds(vault, 'dev', { count: 10, doc: ID_B }))).toEqual([fBoth, fOnlyB])
  })
})

describe('문서 축 — 이력이 없는 문서는 빈 배열이다 (D4 · 🔴RED · 엣지)', () => {
  it('D4: 피드가 한 건도 가리키지 않는 문서 → `[]` (throw 아님) · 같은 vault 의 대조군은 `>0`', async () => {
    const vault = newVault()
    putDoc(vault, REL_A, ID_A, '에이 초판.')
    putDoc(vault, REL_EMPTY, ID_EMPTY, '이력이 없는 문서다.')
    commit(vault, 'chore: 문서 2건 생성')
    const fa1 = pushDocFeed(vault, { body: '에이 1차 갱신.', id: ID_A, rel: REL_A, subject: 'A 소식 1' }) // prettier-ignore

    // 🔴 단독 음성 금지(tdd §8) — 같은 vault·같은 호출 형태의 **양성 대조**를 케이스 안에 둔다.
    expect(idsOf(await feeds(vault, 'dev', { count: 10, doc: ID_A }))).toEqual([fa1])

    expect(idsOf(await feeds(vault, 'dev', { count: 10, doc: ID_EMPTY }))).toEqual([])
  })
})

describe('문서 축 — 억제는 자동 승계된다 (D5 · 🔴RED · 엣지)', () => {
  it('D5: 억제된 항목은 문서 축 결과에도 없다(두 번째 필터를 만들지 않는다)', async () => {
    const vault = newVault()
    putDoc(vault, REL_A, ID_A, '에이 초판.')
    putDoc(vault, REL_B, ID_B, '비 초판.')
    commit(vault, 'chore: 문서 2건 생성')
    const fa1 = pushDocFeed(vault, { body: '에이 1차 갱신.', id: ID_A, rel: REL_A, subject: 'A 소식 1' }) // prettier-ignore
    const fa2 = pushDocFeed(vault, { body: '에이 2차 갱신.', id: ID_A, rel: REL_A, subject: 'A 소식 2' }) // prettier-ignore
    const fa3 = pushDocFeed(vault, { body: '에이 3차 갱신.', id: ID_A, rel: REL_A, subject: 'A 소식 3' }) // prettier-ignore
    const fb1 = pushDocFeed(vault, { body: '비 1차 갱신.', id: ID_B, rel: REL_B, subject: 'B 소식 1' }) // prettier-ignore
    const ignorePath = path.join(vault, IGNORE_FILE)
    writeFileSync(ignorePath, JSON.stringify([{ id: fa2, when: IGNORE_WHEN }]), 'utf8')

    // 양성 대조(오늘도 green): 축 없이 억제만 걸면 fa2 만 빠지고 나머지 3건이 최신순으로 온다 —
    //   즉 fa2 는 실재했고 사라진 이유가 **억제**임이 케이스 안에서 확정된다.
    expect(idsOf(await feeds(vault, 'dev', { count: 10, ignore: ignorePath }))).toEqual([fb1, fa3, fa1]) // prettier-ignore

    const page = await feeds(vault, 'dev', { count: 10, doc: ID_A, ignore: ignorePath })

    expect(idsOf(page)).toEqual([fa3, fa1])
  })
})

describe('문서 축 — 「이 문서 것 중 N건」이다 (D6 · 🔴RED · 핵심)', () => {
  it('D6: `count` 는 **문서 축을 적용한 뒤** 잘린다(윈도잉 이전에 거른다)', async () => {
    // 🔴 tdd §8 #3 — `count` 를 그 문서 이력 건수보다 **작게** 잡아야 순서 차이가 관측된다.
    //   A 이력 3건 · count 2 다. 「N건 중 이 문서 것」이면 결과가 모자라거나 남의 항목이 섞인다.
    const vault = newVault()
    putDoc(vault, REL_A, ID_A, '에이 초판.')
    putDoc(vault, REL_B, ID_B, '비 초판.')
    commit(vault, 'chore: 문서 2건 생성')
    const fa1 = pushDocFeed(vault, { body: '에이 1차 갱신.', id: ID_A, rel: REL_A, subject: 'A 소식 1' }) // prettier-ignore
    const fb1 = pushDocFeed(vault, { body: '비 1차 갱신.', id: ID_B, rel: REL_B, subject: 'B 소식 1' }) // prettier-ignore
    const fa2 = pushDocFeed(vault, { body: '에이 2차 갱신.', id: ID_A, rel: REL_A, subject: 'A 소식 2' }) // prettier-ignore
    const fb2 = pushDocFeed(vault, { body: '비 2차 갱신.', id: ID_B, rel: REL_B, subject: 'B 소식 2' }) // prettier-ignore
    const fa3 = pushDocFeed(vault, { body: '에이 3차 갱신.', id: ID_A, rel: REL_A, subject: 'A 소식 3' }) // prettier-ignore

    // 양성 대조(오늘도 green): 축 없는 `count: 2` 는 **[fa3, fb2]** 다 — 두 순서가 실제로 다르다는
    //   사실을 케이스 안에서 보인다(같은 답이면 D6 은 순서를 가르지 못한다).
    expect(idsOf(await feeds(vault, 'dev', { count: 2 }))).toEqual([fa3, fb2])
    // 앵커: fa1·fb1 이 실재한다(윈도우 밖에 있을 뿐 vault 에 없는 것이 아니다).
    expect(idsOf(await feeds(vault, 'dev', { count: 10 }))).toEqual([fa3, fb2, fa2, fb1, fa1])

    expect(idsOf(await feeds(vault, 'dev', { count: 2, doc: ID_A }))).toEqual([fa3, fa2])
  })
})

describe('문서 축 — 없는 문서 id 는 빈 배열이다 (D7 · 🔴RED · 엣지)', () => {
  it('D7: vault 에 없는 문서 id → `[]` (throw 아님) · 같은 vault 의 실재 id 는 `>0`', async () => {
    const vault = newVault()
    putDoc(vault, REL_A, ID_A, '에이 초판.')
    commit(vault, 'chore: 문서 1건 생성')
    const fa1 = pushDocFeed(vault, { body: '에이 1차 갱신.', id: ID_A, rel: REL_A, subject: 'A 소식 1' }) // prettier-ignore

    // 🔴 양성 대조 — 없으면 「전부 빈 배열을 내는 구현」이 통과한다.
    expect(idsOf(await feeds(vault, 'dev', { count: 10, doc: ID_A }))).toEqual([fa1])

    const returned = feeds(vault, 'dev', { count: 10, doc: ID_ABSENT })
    expect(returned).toBeInstanceOf(Promise) // 규범 C10 — `resolves` 앞 seam 가드
    await expect(returned).resolves.toBeDefined()
    expect(idsOf(await returned)).toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
// D8 — CLI 층. `--doc` 이 `--count` **필수** 계약을 깨지 않는가(D15·D16) + 실제로 전달되는가.
// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('CLI — `--doc` 이 `--count` 필수 계약을 깨지 않는다 (D8)', () => {
  /** `--count` 없이 `--doc` 만 준 실행 — 규범 D: 판정하지 않고 raw spawn 결과만 돌려준다. */
  function runDocOnly() {
    const vault = newVault()
    putDoc(vault, REL_A, ID_A, '에이 초판.')
    commit(vault, 'chore: 문서 1건 생성')
    return runFeedsCli(vault, { extraArgs: ['--doc', ID_A] })
  }

  it('D8-a: `--count` 미지정 → **exit 2** · stdout 침묵 (🟢회귀 가드 — 오늘도 green)', () => {
    const result = runDocOnly()

    expect(result.status, `stderr=${result.stderr}`).toBe(2)
    expect(result.stdout).toBe('')
  })

  it('D8-b: 그 exit 2 의 **사유가 `--count` 계약**이다 (🔴RED — 오늘은 unknown option 이다)', () => {
    // 🔴 규범 P — 종료코드는 인자 위반 전부가 공유하므로 **사유는 stderr 어휘가 가른다**
    //   (`feeds.mjs:171-174`). 오늘 stderr 는 `Unknown option '--doc'` 라 D8-a 만으로는 「같은 코드,
    //   다른 사유」의 조용한 뒤바뀜을 잡지 못한다 — 이 줄이 그 공허를 메운다.
    const result = runDocOnly()

    expect(result.stderr).toMatch(/--count/u)
  })

  it('D8-c: `--doc` + `--count` → exit 0 이고 그 문서 것만 나온다 (🔴RED — CLI 배선)', () => {
    // 🔴 D1~D7 은 **모듈 직접 호출**이라 `main()` 이 `values.doc` 를 `feeds()` 로 넘기는 배선을
    //   보지 못한다. 옵션만 선언하고 전달을 빠뜨려도 D1~D8-b 는 전부 green 이다 — 부모 층 S4 는
    //   다른 저장소 소관이므로 이 저장소 안에 CLI 배선을 무는 단언이 하나는 있어야 한다.
    const vault = newVault()
    putDoc(vault, REL_A, ID_A, '에이 초판.')
    putDoc(vault, REL_B, ID_B, '비 초판.')
    commit(vault, 'chore: 문서 2건 생성')
    const fa1 = pushDocFeed(vault, { body: '에이 1차 갱신.', id: ID_A, rel: REL_A, subject: 'A 소식 1' }) // prettier-ignore
    const fb1 = pushDocFeed(vault, { body: '비 1차 갱신.', id: ID_B, rel: REL_B, subject: 'B 소식 1' }) // prettier-ignore

    // 양성 대조(오늘도 green): `--doc` 없는 같은 CLI 호출은 **2건**을 낸다.
    const all = runFeedsCli(vault, { count: 10 })
    expect(all.status, all.stderr).toBe(0)
    expect(JSON.parse(all.stdout).items.map((item) => item.id)).toEqual([fb1, fa1])

    const scoped = runFeedsCli(vault, { count: 10, extraArgs: ['--doc', ID_A] })

    expect(scoped.status, `stderr=${scoped.stderr}`).toBe(0)
    expect(JSON.parse(scoped.stdout).items.map((item) => item.id)).toEqual([fa1])
  })
})
