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
// 픽스처(tdd §3.4): active 3(그중 1건이 위키링크 3종을 담는다) + disable 1 + **동명 basename 2건** +
//   유일 basename 1건. 동명 basename 은 **실 vault 에 0건**(B9)이라 픽스처가 없으면 WK6 이 공허하다.
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

/** active 응답 계약 — **정확 7키**(리터럴). disable 스텁 4키와 뭉개지지 않는다. */
const ACTIVE_KEYS = ['breadcrumb', 'headings', 'html', 'meta', 'path', 'sources', 'status']
const DISABLE_STUB_KEYS = ['breadcrumb', 'id', 'status', 'title']

/** 위키링크 `<a>` 계약(wikilink-plugin.mjs) — 데드 링크만 이 class 를 얹는다. 리터럴이다. */
const DEAD_CLASS = 'wiki-link-dead'

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
 * 이 파일의 케이스들이 무는 것은 **엔드포인트 반환 계약**(7키/4키/null·격리·링크 해석)이지 인자
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
 * `company/삼성전자` 본문이 위키링크 3종을 담는다:
 *   `[[유일문서]]`  → basename 유일 → **해석된다**
 *   `[[HBM]]`      → 동명 2건 → **모호 → dead**
 *   `[[없는문서]]`  → 대상 부재 → dead
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
const anchorOf = (html, label) =>
  html.split('<a ').find((chunk) => chunk.includes(`>${label}<`)) ?? ''

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
  it('WK2: active 문서 → **정확 7키** · 자기 마커 있고 이웃 마커 없다', async () => {
    const vault = seedWorld()
    await prebuildArtifacts(vault, 'dev')

    const doc = await askWiki(vault, 'dev', REL_MAIN)

    expect(Object.keys(doc).toSorted()).toEqual(ACTIVE_KEYS)
    expect(doc.path).toBe(REL_MAIN)
    expect(doc.html).toContain(MARKER_MAIN)
    expect(doc.html).not.toContain(MARKER_NEIGHBOR)

    // 앵커: 이웃을 조회하면 **그 마커가 나온다**(마커가 애초에 없어서 통과하는 것을 배제).
    expect((await askWiki(vault, 'dev', REL_NEIGHBOR)).html).toContain(MARKER_NEIGHBOR)
  })

  it('WK3: disable 문서 → 아티팩트 **스텁 4키 그대로**', async () => {
    // 링크 생존 계약이다 — 다른 문서가 `[[폐업기업]]` 으로 걸어도 데드가 되지 않는다.
    const vault = seedWorld()
    await prebuildArtifacts(vault, 'dev')

    const stub = await askWiki(vault, 'dev', REL_DISABLE)

    expect(Object.keys(stub).toSorted()).toEqual(DISABLE_STUB_KEYS)
    expect(stub.status).toBe('disable')
    // 앵커: active 는 7키다(둘이 같은 모양으로 뭉개지지 않는다).
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

describe('위키링크 해석 동치 (WK5·WK6 · 🟢계약 보존 pin · CX-O)', () => {
  it('WK5: 같은 문서 안에서 존재 대상은 살고 부재 대상은 dead 로 렌더된다', async () => {
    // 앵커가 케이스 안에 있다 — 한쪽만 두면 "전부 dead"·"전부 alive" 구현이 통과한다.
    const vault = seedWorld()
    await prebuildArtifacts(vault, 'dev')
    const html = (await askWiki(vault, 'dev', REL_MAIN)).html

    // `anchorOf` 는 라벨을 못 찾으면 빈 문자열을 돌려주고, 빈 문자열은 어떤 class 도 `toContain`
    //   하지 않는다 — 그래서 대상 링크 자체가 사라져도(예: 렌더가 깨져 `<a>` 를 아예 안 낸다) 아래
    //   `not.toContain` 만으로는 green 이 유지된다. 앵커로 `<a>` 자체가 실재함을 먼저 확인한다.
    const uniqueAnchor = anchorOf(html, '유일문서')
    expect(uniqueAnchor, '앵커: 유일문서 링크의 <a> 자체가 없다(공허 통과 방지)').not.toBe('')
    expect(uniqueAnchor).not.toContain(DEAD_CLASS)
    expect(anchorOf(html, '없는문서')).toContain(DEAD_CLASS)
  })

  it('WK6: **동명 basename** `[[HBM]]` 은 dead · 유일 basename 은 해석된다', async () => {
    // plan Task 4 GOTCHA · B9 — 실 vault 에 동명 basename 이 0건이라 **픽스처가 없으면 공허**하다.
    const vault = seedWorld()
    await prebuildArtifacts(vault, 'dev')
    const html = (await askWiki(vault, 'dev', REL_MAIN)).html

    expect(anchorOf(html, 'HBM')).toContain(DEAD_CLASS)
    expect(anchorOf(html, '유일문서')).not.toContain(DEAD_CLASS)
  })
})

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

describe('단건 투영은 전 문서 파생을 타지 않는다 (WK8 · 🔴RED 모듈 부재)', () => {
  it('WK8: `single-doc.mjs` 정적 폐쇄에 `derive.mjs`·`git-walk.mjs` 가 **없다**', () => {
    // 런타임 짝은 TR5 다(정적 그래프만으로는 동적 import 를 못 본다 — 규범 G).
    const closure = graphModule.staticImportClosure(SINGLE_DOC)

    // 앵커: 폐쇄가 진입점 하나로 끝나지 않는다(파일이 없어서 "도달 안 함" 이 된 것을 구분한다).
    expect(closure.files, `[RED] ${SINGLE_DOC} 가 아직 없거나 아무것도 물지 않는다`).toContain(
      RENDER,
    )
    expect(closure.files).not.toContain(DERIVE)
    expect(closure.files).not.toContain(GIT_WALK)
  })
})

describe('아티팩트 읽기 백스톱 (WK9 · 🔴RED 경로 부재)', () => {
  it('WK9: 사전 빌드된 아티팩트는 읽고, 부재 아티팩트는 **reject** 한다', async () => {
    const vault = seedWorld()
    await prebuildArtifacts(vault, 'dev')

    // 앵커: 정상 히트는 resolve 하고 본문이 있다.
    expect((await askWiki(vault, 'dev', REL_MAIN)).html).toContain(MARKER_MAIN)

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

    // 앵커(케이스 내): **같은 index·같은 ref** 에 실제 파서를 주면 정확 7키가 나온다 →
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
    // 앵커 ⓑ(규범 U): **같은 vault·같은 빌드**의 정상 문서는 정확 7키 → "인덱스가 비었다" 를 배제.
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

describe('본문은 요청 시점 디스크다 (LIVE-1 · 🟢앵커(오늘도 green · RED 아님) · D25)', () => {
  it('LIVE-1: 빌드 후 **본문만** 고치면 재빌드 없이 같은 요청에 반영된다', async () => {
    // ★ 규범 E: 전후를 가르는 것은 벽시계가 아니라 **쓰기 순서**다 — 같은 케이스 안에서 before 를
    //   먼저 수집하고, 그 다음에 쓴다. 재빌드·커밋은 하지 않는다(인덱스는 스냅샷 그대로다).
    const vault = seedWorld()
    await prebuildArtifacts(vault, 'dev')

    const before = await askWiki(vault, 'dev', REL_MAIN)
    // 앵커: 렌더가 실제로 돌고 있다(빈 html 로 "마커 없음" 이 참이 되는 것을 배제).
    expect(before.html).toContain(MARKER_MAIN)
    expect(before.html).not.toContain(LIVE_MARKER)

    writeDoc(vault, REL_MAIN, {
      body: `## 정의\n\n${MARKER_MAIN} 본문이다.\n\n${LIVE_MARKER}\n`,
      id: ID_MAIN,
      title: '삼성전자',
      type: 'company',
    })

    expect((await askWiki(vault, 'dev', REL_MAIN)).html).toContain(LIVE_MARKER)
  })
})
