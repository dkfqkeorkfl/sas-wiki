// @vitest-environment node
//
// P5 · Task 4 — `wiki` 를 **단일 문서 렌더**로 (D-F) — tdd §3.4 (WK1~WK10)
//
// 무엇이 바뀌는가: `wiki()` 가 vault 전량을 파싱·렌더하지 않는다. 아티팩트를 읽고 `docs[].breadcrumb`
//   로 **경로 집합 + basename 인덱스**를 만든 뒤(B9 — 값 불요, 키 집합만) 요청 문서 **1건만** 파싱·
//   렌더한다. `derive()`·`collectFeedItems()`·`getFileCommitDates()` 를 타지 않으므로 문서별 git 호출이
//   0 이 된다 — 그 비용·로드 축은 **TR2·TR5** 가 문다(구조와 기능을 한 케이스에 섞지 않는다 · §7.5).
//
// RED 사유:
//   · WK1·WK7·WK8 — **RED(미구현)**. `scripts/lib/single-doc.mjs` 자체가 없고 `wiki()` 는 동기다.
//   · WK9·WK10 — **RED(경로 부재)**. 오늘 `wiki()` 는 아티팩트를 아예 보지 않는다.
//   · WK2~WK6 — **응답 계약은 무변경**이다(B13 이 실 vault 바이트 동치를 착수 전에 증명했다).
//     그래서 이 다섯은 **오늘도 통과하는 것이 정상**이고, 전환 후에도 같은 값을 내야 한다는 pin 이다.
//     tdd §3.4 는 이들을 RED 로 적었으나 실측상 관측 가능한 계약이 같다 — "red 가 아니면 공허를
//     의심하라"(§5.1)의 답은 여기서 **공허가 아니라 계약 보존**이다. 조달 경로가 바뀌는 동안 이 다섯이
//     흔들리면 그것이 회귀다.
//
// 픽스처: active 3(그중 1건이 위키링크 표기 3종을 본문에 담는다) + disable 1 + **동명 basename 2건** +
//   유일 basename 1건. 🔴 이 픽스처가 원래 겨냥한 것은 **서버측 위키링크 해석**(WK5·WK6)이었는데
//   그 계약은 클라이언트로 이관됐다(아래 「위키링크 해석 계약이 서버를 떠났다」 문단). 픽스처는
//   남는다 — 이제 그 문자열들은 해석 대상이 아니라 **`md` 원문에 그대로 실려 나가는 본문**이다.
//
// 규범 A: 경로·id·마커·키 집합은 **리터럴**이다. 규범 B: 부재 단언마다 짝(이웃·정상 아티팩트)을 둔다.
// 규범 C10: `rejects` 앞에 seam 가드. 규범 F: 실 vault 를 건드리지 않는다.
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterAll, describe, expect, it } from 'vitest'

import { parseMarkdownFile } from '../lib/parse.mjs'
import { prebuildArtifacts } from './helpers/prebuild-artifacts.mjs'
import { cleanup, commit, initVault, writeDoc } from './helpers/tmp-git-vault.mjs'

const wikiModule = await import(new URL('../wiki.mjs', import.meta.url).href)
const singleDocModule = await import(new URL('../lib/single-doc.mjs', import.meta.url).href).catch(
  (error) => ({ __loadError: error instanceof Error ? error.message : String(error) }),
)
const graphModule = await import(new URL('./helpers/static-import-graph.mjs', import.meta.url).href)

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SCRIPTS_DIR = path.resolve(HERE, '..')
const SINGLE_DOC = path.join(SCRIPTS_DIR, 'lib', 'single-doc.mjs')
const DERIVE = path.join(SCRIPTS_DIR, 'lib', 'derive.mjs')
const GIT_WALK = path.join(SCRIPTS_DIR, 'lib', 'git-walk.mjs')
const RENDER = path.join(SCRIPTS_DIR, 'lib', 'render.mjs')
/** WK8′ 양성 대조 좌표 — 같은 파서가 **여기서는** 두 모듈을 실제로 검출해야 한다. */
const WIKI = path.join(SCRIPTS_DIR, 'wiki.mjs')
const PARSE = path.join(SCRIPTS_DIR, 'lib', 'parse.mjs')

/** summary 아티팩트 경로 — **리터럴 조립**(규범 A). 정확 형태의 계약은 PL9 가 한 번만 고정한다. */
const summaryFile = (vault, env) => path.join(vault, 'cache', `summary.${env}.json`)

const ID_MAIN = '0192a000-0000-7000-8000-000000000a01'
const ID_NEIGHBOR = '0192a000-0000-7000-8000-000000000a02'
const ID_UNIQUE = '0192a000-0000-7000-8000-000000000a03'
const ID_DISABLE = '0192a000-0000-7000-8000-000000000a04'
const ID_HBM_A = '0192a000-0000-7000-8000-000000000a05'
const ID_HBM_B = '0192a000-0000-7000-8000-000000000a06'

const REL_MAIN = 'company/삼성전자'
const REL_NEIGHBOR = 'company/하이닉스'
const REL_UNIQUE = 'concept/유일문서'
const REL_DISABLE = 'concept/온디바이스-AI'
const REL_HBM_A = 'a/HBM'
const REL_HBM_B = 'b/HBM'

const MARKER_MAIN = '삼성본문마커'
const MARKER_NEIGHBOR = '하이닉스본문마커'
/** v3 P4 · LIVE-1 — 빌드 **후에** 본문에 심는 마커. 전후를 가르는 것은 벽시계가 아니라 쓰기 순서다(규범 E). */
const LIVE_MARKER = '빌드후추가마커'

/** vault 안 문서 루트 — **리터럴**이다(규범 A). `head-state.mjs` 의 `WIKI_PREFIX` 를 import 하면 자기참조다. */
const WIKI_ROOT = 'wiki'
/** `<vault>/wiki/<ref>.md` — `wiki.mjs:50` 과 같은 조립식이되 **리터럴**로 세운다(규범 A). */
const docFile = (vault, ref) => path.join(vault, WIKI_ROOT, `${ref}.md`)

/**
 * active 응답 계약 — **정확 5키**(리터럴). disable 스텁 4키와 뭉개지지 않는다.
 *
 * ★★ **「승계」가 아니라 「대체」다 — 이 문단을 지우면 다음 독자가 «방어가 약해졌다»고 읽는다.**
 *    (선례 형식: 부모 리포 `scripts/wiki-dev-server/__tests__/plugin.p5.contract.test.ts:452-462`)
 *
 *    옛 값은 **7키**였고 그것은 「wiki 응답에 **이력 필드가 없다**」(아카이브 결정 D-H②)의 물질화였다.
 *    news-convention-migration **Phase 2(doc-history-assembly)** 가 그 조건을 실현한다 — 문서 응답이
 *    그 문서의 발행 이력을 `feed: { items, nextCursor }` 로 동봉한다. 그래서 이 상수는 7 → 8 로
 *    **교체**되고, 이 파일의 4개 소비처(`:174`·`:193`·`:323`·`:342` — 좌표는 교체 전 기준)가
 *    같은 축을 그대로 물려받는다.
 *
 *    🔴 **`feed` 를 조건부로 넣지 마라**(D-P2-9). 「이력 0건이면 키를 생략」하면 이 12케이스가 7키를
 *    유지해 조용히 green 이 되고 응답 계약이 **둘로 갈린다**. 이 파일의 tmp vault 에는 `feed:` 커밋이
 *    없으므로 기대값은 `feed: { items: [], nextCursor: null }` — **비어 있지만 키는 있다**.
 *
 *    🔴 **PN-1(`:323` 기준)은 `projectSingleDoc` 을 `feed` 인자 없이 직접 부른다.** 그 호출도 5키를
 *    요구하므로 `feed` 파라미터는 **기본값 `{ items: [], nextCursor: null }`** 을 가져야 한다.
 *    그 기본값이 「`wiki.mjs` 가 실제 이력 전달을 빠뜨렸다」를 가리는 것은 아니다 — 그것은
 *    `wiki.doc-feed.test.mjs` 의 **W1**(심은 `feedCommit` 수와 일치)이 문다.
 *
 *    🔴 조달(`feeds()` 호출)은 **`wiki.mjs`** 에 두고 결과를 인자로 넘긴다. `single-doc.mjs` 에서
 *    `feeds.mjs` 를 import 하면 `feeds.mjs:26` 의 `lib/git-walk.mjs` 가 정적 폐쇄로 들어와 아래
 *    **WK8′** 이 red 가 된다 — 가드를 고칠 신호가 아니라 **층을 잘못 잡았다는 신호**다.
 *
 * ★★ **두 번째 대체 — 8 → 5 (md 컷오버 · AK″).** 위 문단이 기록한 「7 → 8」 다음 전환이다.
 *    **서버가 본문을 렌더해 `html` 로 내려주던 계약이 끝났다** — 서버는 마크다운 **원문**(`md`)만
 *    싣고, HTML·목차·각주 정의는 소비자(클라이언트 렌더러)가 그 원문에서 만든다. 그래서 네 키가
 *    한꺼번에 나가고 한 키가 들어온다:
 *      · `html`       → **소멸** — 렌더 주체가 서버가 아니다.
 *      · `headings`   → **소멸** — 목차는 렌더 트리에서 나온다(벌크 아티팩트에는 그대로 남는다).
 *      · `sources`    → **소멸** — 각주 정의 수집도 렌더 파이프라인이 소유한다.
 *      · `breadcrumb` → **소멸** — `path` 를 `/` 로 끊으면 나오는 파생값이라 봉투에 실을 이유가 없다.
 *      · `md`         → **신설** — 요청 시점 디스크의 본문 원문 그대로(머리말 제외).
 *
 *    🔴 **무엇을 지키던 가드가 무엇을 지키게 되었는가**: 옛 8키 pin 은 「서버가 렌더 산출물까지
 *    책임진다」의 물질화였다. 새 5키 pin 이 지키는 것은 **「서버는 조달만 하고 렌더하지 않는다」**
 *    이다 — 렌더 산물 키(`html`·`headings`·`sources`)가 하나라도 되살아나면 렌더 책임이 두 곳으로
 *    갈렸다는 뜻이고, **정렬 정확 일치**가 그것을 잡는다.
 *
 *    🔴 **`toHaveProperty`·`toContain` 으로 약화하지 마라.** 그 형태는 「`md` 를 **추가만** 하고 옛
 *    키를 안 지웠다」를 통과시킨다 — 이 상수의 존재 이유가 정확히 그 통과를 막는 것이다.
 */
const ACTIVE_KEYS = ['feed', 'md', 'meta', 'path', 'status']
const DISABLE_STUB_KEYS = ['breadcrumb', 'id', 'status', 'title']

const tmps = []
afterAll(() => cleanup(...tmps))

function wikiFn() {
  if (typeof wikiModule.wiki !== 'function') {
    throw new Error('[RED] scripts/wiki.mjs 에 wiki export 가 없다')
  }
  return wikiModule.wiki
}

function singleDoc() {
  if (singleDocModule.__loadError !== undefined) {
    throw new Error(`[RED] scripts/lib/single-doc.mjs 가 아직 없다: ${singleDocModule.__loadError}`)
  }
  for (const name of ['makeDocIndex', 'projectSingleDoc']) {
    if (typeof singleDocModule[name] !== 'function') {
      throw new Error(`[RED] scripts/lib/single-doc.mjs 에 ${name} export 가 아직 없다`)
    }
  }
  return singleDocModule
}

/**
 * ★★ v3 P4 · §4.2 arm 갱신(D27) — `wiki()` 가 summary 경로를 **4번째 위치 인자**로 받는다.
 *
 * 이 파일의 케이스들이 무는 것은 **엔드포인트 반환 계약**(5키/4키/null·격리·링크 해석)이지 인자
 * 개수가 아니다. 그래서 주제는 그대로 두고 **호출 인자만** 갱신한다 — D15 로 `--count` 가 필수가
 * 됐을 때 `cli.env-enum.test.mjs:98-103` 이 남긴 처분과 같은 형태다.
 *
 * ★ 오늘도 green 이다: JS 는 여분 위치 인자를 무시하므로 판정이 변하지 않는다. 그래서 이 arm 은
 *   RED 커밋(C1)에 미리 실을 수 있다(tdd §5.2 — CLI arm 은 반대로 실을 수 없다).
 *
 * 규범 D: 헬퍼에 `expect` 를 두지 않는다 — 값만 돌려준다.
 */
const askWiki = (vault, env, ref) => wikiFn()(vault, env, ref, summaryFile(vault, env))

/**
 * 세계관 — active 5 + disable 1.
 *
 * `company/삼성전자` 본문이 위키링크 표기 3종을 담는다 — `[[유일문서]]`(basename 유일) ·
 * `[[HBM]]`(동명 2건) · `[[없는문서]]`(대상 부재). 🔴 **서버는 이 표기를 해석하지 않는다** —
 * 응답 `md` 에 원문 그대로 실려 나가고, 해석(live/dead 판정)은 클라이언트 렌더 파이프라인이
 * 소유한다. 세 표기를 남겨 두는 이유는 **원문이 가공 없이 전달되는지**의 재료이기 때문이다.
 */
function seedWorld() {
  const vault = initVault()
  tmps.push(vault)
  writeDoc(vault, REL_MAIN, {
    body: `## 정의\n\n${MARKER_MAIN} 본문이다.\n\n[[유일문서]] · [[HBM]] · [[없는문서]]\n`,
    id: ID_MAIN,
    title: '삼성전자',
    type: 'company',
  })
  writeDoc(vault, REL_NEIGHBOR, {
    body: `## 정의\n\n${MARKER_NEIGHBOR} 본문이다.\n`,
    id: ID_NEIGHBOR,
    title: '하이닉스',
    type: 'company',
  })
  writeDoc(vault, REL_UNIQUE, { body: '## 정의\n\n유일 basename 문서다.\n', id: ID_UNIQUE, title: '유일문서' }) // prettier-ignore
  writeDoc(vault, REL_DISABLE, { id: ID_DISABLE, status: 'disable', title: '온디바이스 AI' })
  writeDoc(vault, REL_HBM_A, { body: '## 정의\n\nA 쪽 HBM 문서다.\n', id: ID_HBM_A, title: 'HBM' })
  writeDoc(vault, REL_HBM_B, { body: '## 정의\n\nB 쪽 HBM 문서다.\n', id: ID_HBM_B, title: 'HBM' })
  commit(vault, 'chore: active 5 + disable 1 생성')
  return vault
}

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'))

describe('wiki 는 async 이고 순수부는 lib/single-doc.mjs 다 (WK1 · 🔴RED 모듈·async 부재)', () => {
  it('WK1: `wiki()` 가 Promise 를 돌려주고 `single-doc.mjs` 의 두 export 가 함수다', async () => {
    const vault = seedWorld()
    await prebuildArtifacts(vault, 'dev')

    const returned = askWiki(vault, 'dev', REL_MAIN)
    expect(returned).toBeInstanceOf(Promise)
    await expect(returned).resolves.toBeDefined()

    const mod = singleDoc()
    expect(typeof mod.makeDocIndex).toBe('function')
    expect(typeof mod.projectSingleDoc).toBe('function')
  })
})

describe('요청 문서 1건만 (WK2·WK3·WK4 · 🟢계약 보존 pin)', () => {
  // ★ WK2′ 축 교체 — 관측 대상이 `doc.html`(렌더 산출)에서 `doc.md`(본문 원문)로 옮겨간다.
  //   **단언 구조는 그대로다**: 「자기 마커는 있고 이웃 마커는 없다 + 이웃을 조회하면 이웃 마커가
  //   나온다」는 격리 대조가 이 케이스의 본질이고, 그 본질은 렌더 여부와 무관하다. 무는 것이
  //   「렌더가 이 문서만 렌더했다」에서 **「투영이 이 문서 파일만 읽었다」**로 바뀌었을 뿐이다.
  it('WK2′: active 문서 → **정확 5키** · 자기 마커 있고 이웃 마커 없다', async () => {
    const vault = seedWorld()
    await prebuildArtifacts(vault, 'dev')

    const doc = await askWiki(vault, 'dev', REL_MAIN)

    expect(Object.keys(doc).toSorted()).toEqual(ACTIVE_KEYS)
    expect(doc.path).toBe(REL_MAIN)
    expect(typeof doc.md).toBe('string')
    expect(doc.md).toContain(MARKER_MAIN)
    expect(doc.md).not.toContain(MARKER_NEIGHBOR)

    // 앵커: 이웃을 조회하면 **그 마커가 나온다**(마커가 애초에 없어서 통과하는 것을 배제).
    expect((await askWiki(vault, 'dev', REL_NEIGHBOR)).md).toContain(MARKER_NEIGHBOR)
  })

  it('WK3: disable 문서 → 아티팩트 **스텁 4키 그대로**', async () => {
    // 링크 생존 계약이다 — 다른 문서가 `[[폐업기업]]` 으로 걸어도 데드가 되지 않는다.
    const vault = seedWorld()
    await prebuildArtifacts(vault, 'dev')

    const stub = await askWiki(vault, 'dev', REL_DISABLE)

    expect(Object.keys(stub).toSorted()).toEqual(DISABLE_STUB_KEYS)
    expect(stub.status).toBe('disable')
    // 앵커: active 는 5키다(둘이 같은 모양으로 뭉개지지 않는다 · 축 교체는 ACTIVE_KEYS 문단 참조).
    expect(Object.keys(await askWiki(vault, 'dev', REL_MAIN)).toSorted()).toEqual(ACTIVE_KEYS)
  })

  it('WK4: 없는 path → `null`(빈 객체가 아니다)', async () => {
    // 소비자 404 선처리(`plugin.ts:245` — `wikiEnvelope.parse(null)` 은 throw 라 순서가 계약이다)가
    //   이 값에 결속돼 있다.
    const vault = seedWorld()
    await prebuildArtifacts(vault, 'dev')

    expect(await askWiki(vault, 'dev', '없는/경로')).toBeNull()
  })
})

// ★★ **「위키링크 해석 계약이 서버를 떠났다」 — 「삭제」가 아니라 「층 이동」이다.
//    이 문단을 지우면 다음 독자가 «방어가 그냥 없어졌다» 고 읽는다.**
//
//    이 자리에 **WK5·WK6** 두 케이스가 있었다. 무는 것은 「서버가 위키링크를 해석해 응답 `html`
//    안에 `<a class="wiki-link">`(해석됨) / `<a class="wiki-link wiki-link-dead">`(해석 실패)를
//    심는다」는 계약이었다:
//      · **WK5** — 같은 문서 안에서 **존재 대상은 살고 부재 대상은 dead** 다(둘을 한 케이스에서 대조).
//      · **WK6** — **동명 basename** `[[HBM]]` 은 모호하므로 dead, **유일 basename** 은 해석된다.
//        (동명 basename 은 실 vault 에 0건이라 이 파일의 `a/HBM`·`b/HBM` 픽스처가 없으면 공허했다.)
//
//    🔴 **왜 사라지는가**: 응답이 렌더된 `html` 이 아니라 마크다운 **원문 `md`** 가 되면서
//    **서버는 위키링크를 해석하지 않는다** — 해석기(`makeResolver`·`resolveTarget`)와 렌더 파이프라인이
//    `single-doc.mjs` 에서 함께 사라진다. 관측할 `<a>` 가 서버 응답에 아예 없으므로 이 계약은
//    **약해진 것이 아니라 층이 바뀐 것**이다 — 해석은 이제 클라이언트 렌더 파이프라인이 소유한다.
//
//    **어디로 갔는가(착륙 좌표)**: 부모 리포
//    `src/pages/news/wiki/markdown/WikiMarkdown.pipeline.contract.test.tsx`
//      · **B6**(「동명 basename 은 dead · 유일 basename 과 정확 경로는 live 로 해석된다」) —
//        동명 2건 + 유일 1건 + 정확 경로를 한 입력에 담아 세 갈래를 한 케이스에서 문다. WK5·WK6 의
//        직접 승계자다(모호 → dead · 유일 → live · 정확 경로 → live).
//      · **B3·B4·B5** — `wiki-link` class · `wiki-link-dead` · `data-path` · `data-anchor` 출력 계약.
//
//    🔴 **경계 — 같이 지우면 안 되는 것**: 이 파일에 남은 케이스들은 위키링크 해석을 지지 않는다 —
//    **투영 계약**(키 집합·본문 격리·`null`·disable 스텁·아티팩트 백스톱·라이브 본문)과 **구조**(정적
//    폐쇄)를 진다. 그 둘은 서버에 그대로 남는 계약이라 이 이관과 무관하다.

describe('해석 인덱스는 아티팩트에서 유도된다 (WK7 · 🔴RED 모듈 부재)', () => {
  it('WK7: 아티팩트 `docs[].breadcrumb` 집합 === 인덱스 경로 집합 (**disable 포함**)', async () => {
    // B9 의 동치 실측을 계약으로 고정한다. 해석기는 값이 아니라 **키 집합**만 쓴다.
    const vault = seedWorld()
    await prebuildArtifacts(vault, 'dev')

    const artifactDocs = readJson(summaryFile(vault, 'dev')).docs
    const index = singleDoc().makeDocIndex(artifactDocs)
    const indexPaths = [...index.paths].toSorted()
    const artifactPaths = artifactDocs.map((doc) => doc.breadcrumb.join('/')).toSorted()

    // 앵커: disable 문서 경로가 **그 집합에 있다**(active 만 넣는 구현 배제 — 링크가 죽는다).
    expect(artifactPaths).toContain(REL_DISABLE)
    expect(indexPaths).toEqual(artifactPaths)
  })
})

// ★★ **「승계」가 아니라 「대체」다 — 이 문단을 지우면 다음 독자가 «방어가 약해졌다»고 읽는다.**
//
//    옛 WK8 의 첫 단언은 `expect(closure.files).toContain(RENDER)` 였고, 그것은 **양성 앵커**였다:
//    _"폐쇄가 진입점 하나로 끝나지 않는다(파일이 없어서 «도달 안 함» 이 된 것을 구분한다)"_.
//    나머지 두 단언(`derive`·`git-walk` 부재)이 전부 부정형이라, 그 한 줄이 없으면 파서가 죽어도
//    가드가 통과하기 때문이다.
//
//    🔴 md 컷오버가 `single-doc.mjs` 의 `render.mjs`·`parse.mjs` import 를 **둘 다 끊는다**. 그래서
//    옛 앵커가 그대로 죽는다 — 여기서 `toContain(RENDER)` 을 `not.toContain(RENDER)` 로 **반전만**
//    하면 세 단언이 전부 부정형이 되어 **가드가 그날부터 아무것도 안 잡는다**. 이것은 이론이 아니다:
//    `helpers/static-import-graph.mjs` 의 폐쇄 계산은 **읽을 수 없는 파일을 조용히 건너뛴다**
//    (`continue`) — `single-doc.mjs` 를 통째로 지워도 폐쇄는 `[진입점]` 을 돌려주고 부정형 셋이
//    전부 통과한다.
//
//    처분은 둘이다.
//      ① **더 강한 형태로 승격** — 「`derive`·`git-walk` 가 없다」가 아니라 **「폐쇄가 정확히 자기
//         자신뿐이다」**. 투영이 순수해졌다는 것이 이 phase 의 구조 주장 그 자체이므로, 부재 목록을
//         나열하는 것보다 정확 일치가 그 주장을 직접 문다(어떤 모듈이 새로 들어와도 red 다).
//      ② 🔴 **양성 대조 신설** — 같은 실행·같은 파서가 `wiki.mjs` 폐쇄에서는 `single-doc.mjs` 와
//         `parse.mjs` 를 **실제로 검출한다**. 이 두 줄이 「파서가 살아 있다」를 진다. 그 좌표를 고른
//         근거: `wiki.mjs` 는 컷오버 후에도 두 모듈을 **직접** import 한다(투영은 `single-doc.mjs`
//         가, 머리말 파싱은 `parse.mjs` 가 소유한다) — 즉 앵커가 이 변경으로 함께 죽지 않는다.
//
//    지키던 것 → 지키게 된 것: 「전 문서 파생·커밋 워크를 타지 않는다」 → **「아무것도 물지 않는다
//    (= 투영이 순수 함수가 됐다)」**. 런타임 짝은 `serving.cost-profile.test.mjs` 의 TR5′ 다(정적
//    그래프만으로는 동적 import 를 못 본다).
describe('단건 투영은 아무것도 물지 않는다 (WK8′ · 🔴RED 오늘 render·parse 를 문다)', () => {
  it('WK8′: `single-doc.mjs` 정적 폐쇄가 **정확히 자기 자신뿐**이다 (+ `wiki.mjs` 양성 대조)', () => {
    const closure = graphModule.staticImportClosure(SINGLE_DOC)
    const wikiClosure = graphModule.staticImportClosure(WIKI)

    // 앵커(양성 대조): 같은 파서가 **검출을 실제로 한다**. 이 두 줄이 없으면 아래 단언들은
    //   「파일을 못 읽어 폐쇄가 비었다」와 구분되지 않는다.
    expect(wikiClosure.files, `[앵커 사망] ${WIKI} 폐쇄가 ${SINGLE_DOC} 를 검출하지 못한다`).toContain(SINGLE_DOC) // prettier-ignore
    expect(wikiClosure.files, `[앵커 사망] ${WIKI} 폐쇄가 ${PARSE} 를 검출하지 못한다`).toContain(PARSE) // prettier-ignore

    // 본 단언: 투영은 순수하다 — 자기 자신 말고는 아무것도 물지 않는다.
    expect(closure.files, `[RED] ${SINGLE_DOC} 가 아직 다른 모듈을 문다`).toEqual([SINGLE_DOC])

    // 명명된 계약은 남긴다(위 정확 일치에 포섭되지만, 「무엇을 특히 물면 안 되는가」는 세 좌표가
    //   이름으로 말해야 다음 독자가 층 오배치를 즉시 알아본다 — 특히 `git-walk` 는 이력 조달을
    //   `wiki.mjs` 가 아니라 이 층으로 내렸을 때 들어온다).
    expect(closure.files).not.toContain(RENDER)
    expect(closure.files).not.toContain(DERIVE)
    expect(closure.files).not.toContain(GIT_WALK)
  })
})

describe('아티팩트 읽기 백스톱 (WK9′ · 🔴RED 축 교체)', () => {
  // ★ WK9′ 축 교체 — 앵커의 관측 좌표만 `html` → `md` 로 옮긴다. 이 케이스가 무는 것은
  //   「아티팩트 부재는 fail-loud 다」이고, 앵커는 「정상 히트는 본문을 실제로 싣는다」이다.
  //   본문이 렌더 산출이 아니라 원문이 되었을 뿐 두 역할 모두 그대로다.
  it('WK9′: 사전 빌드된 아티팩트는 읽고, 부재 아티팩트는 **reject** 한다', async () => {
    const vault = seedWorld()
    await prebuildArtifacts(vault, 'dev')

    // 앵커: 정상 히트는 resolve 하고 본문이 있다.
    expect((await askWiki(vault, 'dev', REL_MAIN)).md).toContain(MARKER_MAIN)

    // 아티팩트 부재는 fail-loud 다. 조회 경로가 생성기를 되살려 통과하면 안 된다.
    rmSync(summaryFile(vault, 'dev'), { force: true })
    const returned = askWiki(vault, 'dev', REL_MAIN)
    expect(returned).toBeInstanceOf(Promise) // 규범 C10
    await expect(returned).rejects.toThrow()
  })
})

describe('빈 아티팩트 가드 (WK10 · 🔴RED 경로 부재)', () => {
  it('WK10: `docs: []` 인 **fresh** 아티팩트에서는 `null`, 정상 아티팩트에서는 문서를 준다', async () => {
    // ★ plan 비공허성 요구 ①. **프로덕션 가드로 만들지 않는다** — 실 vault `prod` 는 `docs=0` 이
    //   정상이므로 "빈 아티팩트 = 이상" 은 거짓 명제다. 앵커 의무는 **테스트가** 진다.
    const vault = seedWorld()
    await prebuildArtifacts(vault, 'dev')

    const file = summaryFile(vault, 'dev')
    const healthy = readFileSync(file, 'utf8')

    // 앵커: 같은 vault·같은 path 가 정상 아티팩트에서는 **문서를 돌려준다**.
    expect(await askWiki(vault, 'dev', REL_MAIN)).not.toBeNull()

    // 봉투는 그대로 두고 `docs` 만 비운다 → 독자에게는 **신선한** 아티팩트다.
    writeFileSync(file, JSON.stringify({ ...JSON.parse(healthy), docs: [], tags: {}, tree: [] }))

    expect(await askWiki(vault, 'dev', REL_MAIN)).toBeNull()
  })
})

// ──────────────────────────────────────────────────────────────────────────────
// v3 P4 · wiki-live — 파싱 `null` 크래시 제거(PN) + 3층 순서·라이브 본문 회귀 앵커(STUB·LIVE)
//
// ★ 이것은 **게이트 추가가 아니라 크래시 제거**다(D46 미발동). 새 검사를 넣는 것이 아니라
//   `parse.mjs:169` 가 이미 내는 `null` 을 `projectSingleDoc` 이 **받아 주는** 것이다.
// ──────────────────────────────────────────────────────────────────────────────

describe('머리말 없는 파일은 크래시가 아니라 부재다 (PN-1 · 🔴RED 오늘 TypeError)', () => {
  it('PN-1: `projectSingleDoc` 은 `readFile` 이 `null` 이면 `null` 을 돌려준다', async () => {
    // 순수층이다 — 프로세스도 파일 삭제도 없다. 오늘 `single-doc.mjs:74` 가 `parsed.body` 에서
    //   `TypeError: Cannot read properties of null` 로 던진다. GREEN 은 `:73` 뒤 **1줄**이다.
    const vault = seedWorld()
    await prebuildArtifacts(vault, 'dev')
    const mod = singleDoc()
    const index = mod.makeDocIndex(readJson(summaryFile(vault, 'dev')).docs)

    // 앵커(케이스 내): **같은 index·같은 ref** 에 실제 파서를 주면 정확 5키가 나온다 →
    //   "그 ref 가 애초에 인덱스에 없어서 null" 이라는 공허 통과를 배제한다.
    const parsedReal = mod.projectSingleDoc({
      index,
      readFile: (docRef) => parseMarkdownFile(docFile(vault, docRef)),
      ref: REL_MAIN,
    })
    expect(Object.keys(parsedReal).toSorted()).toEqual(ACTIVE_KEYS)

    expect(mod.projectSingleDoc({ index, readFile: () => null, ref: REL_MAIN })).toBeNull()
  })
})

describe('빌드 후 머리말이 사라져도 500 이 아니다 (PN-2 · 🔴RED 오늘 rejects)', () => {
  it('PN-2: 인덱스에 있으나 머리말이 없는 문서를 요청하면 `null` 로 **resolve** 한다', async () => {
    const vault = seedWorld()
    await prebuildArtifacts(vault, 'dev')

    // ★ Arrange 자기모순 점검: **재빌드·커밋 금지**가 이 케이스의 전제다. 재빌드하면 그 문서가
    //   인덱스에서 빠져 「게이트가 막았다」(= GATE 축)를 시험하게 되어 주제가 바뀐다.
    const broken = docFile(vault, REL_NEIGHBOR)
    writeFileSync(broken, '머리말이 통째로 없다. 그냥 본문이다.\n')

    // 앵커 ⓐ: 그 파일은 **디스크에 실재한다** → "없어서 null" 을 배제.
    expect(existsSync(broken)).toBe(true)
    // 앵커 ⓑ(규범 U): **같은 vault·같은 빌드**의 정상 문서는 정확 5키 → "인덱스가 비었다" 를 배제.
    expect(Object.keys(await askWiki(vault, 'dev', REL_MAIN)).toSorted()).toEqual(ACTIVE_KEYS)

    const returned = askWiki(vault, 'dev', REL_NEIGHBOR)
    expect(returned).toBeInstanceOf(Promise) // 규범 C10
    await expect(returned).resolves.toBeNull()
  })
})

describe('disable 스텁은 파일을 읽지 않는다 (STUB-1 · 🟢앵커(오늘도 green · RED 아님))', () => {
  it('STUB-1: 원본 `.md` 를 지워도 disable 은 **스텁 4키**이고 active 는 rejects 다', async () => {
    // 무는 것은 키 개수가 아니라 **3층 순서**다: `single-doc.mjs:69-70`(스텁)이 `:71`(게이트)·`:73`(읽기)
    //   보다 **앞**이다. 파일을 지우지 않으면 순서를 뒤집어도 통과하므로 그 케이스는 공허하다
    //   (WK3 의 중복이 아닌 이유가 여기다).
    // ★ Task 2(파싱 null 접기) 착륙 후에도 green 이어야 한다 — `null` 접기는 **ENOENT 를 접지 않는다**.
    const vault = seedWorld()
    await prebuildArtifacts(vault, 'dev')

    rmSync(docFile(vault, REL_DISABLE))
    rmSync(docFile(vault, REL_NEIGHBOR))

    expect(Object.keys(await askWiki(vault, 'dev', REL_DISABLE)).toSorted()).toEqual(
      DISABLE_STUB_KEYS,
    )

    // 앵커(케이스 내): **같은 처리를 active 문서**에 하면 rejects(ENOENT) — 읽기가 실제로 일어난다.
    const returned = askWiki(vault, 'dev', REL_NEIGHBOR)
    expect(returned).toBeInstanceOf(Promise) // 규범 C10
    await expect(returned).rejects.toThrow()
  })
})

describe('본문은 요청 시점 디스크다 (LIVE-1′ · 🔴RED 축 교체 · D25)', () => {
  it('LIVE-1′: 빌드 후 **본문만** 고치면 재빌드 없이 같은 요청에 반영된다', async () => {
    // ★ 규범 E: 전후를 가르는 것은 벽시계가 아니라 **쓰기 순서**다 — 같은 케이스 안에서 before 를
    //   먼저 수집하고, 그 다음에 쓴다. 재빌드·커밋은 하지 않는다(인덱스는 스냅샷 그대로다).
    //
    // ★ 축 교체 사유 — **앵커의 근거 문장이 바뀐다.** 옛 앵커는 「렌더가 실제로 돌고 있다」였다:
    //   서버가 md 를 HTML 로 렌더했으므로, 빈 `html` 이면 아래 `not.toContain` 이 공허하게 참이
    //   되는 것을 그 한 줄이 막았다. 컷오버 후 서버는 렌더하지 않으므로 그 근거는 성립하지 않는다.
    //   **새 근거는 「요청마다 디스크를 다시 읽는다」**이다 — 투영이 아티팩트 스냅샷의 본문을
    //   재활용하면 수정이 반영되지 않아 마지막 단언이 red 가 되고, 반대로 `md` 가 빈 문자열이면
    //   첫 앵커가 red 가 된다. 두 방향이 같은 케이스 안에서 함께 걸린다.
    const vault = seedWorld()
    await prebuildArtifacts(vault, 'dev')

    const before = await askWiki(vault, 'dev', REL_MAIN)
    // 앵커: 투영이 본문을 실제로 싣고 있다(빈 md 로 "마커 없음" 이 참이 되는 것을 배제).
    expect(before.md).toContain(MARKER_MAIN)
    expect(before.md).not.toContain(LIVE_MARKER)

    writeDoc(vault, REL_MAIN, {
      body: `## 정의\n\n${MARKER_MAIN} 본문이다.\n\n${LIVE_MARKER}\n`,
      id: ID_MAIN,
      title: '삼성전자',
      type: 'company',
    })

    expect((await askWiki(vault, 'dev', REL_MAIN)).md).toContain(LIVE_MARKER)
  })
})
