// @vitest-environment node
//
// v3 P4 · Task 4 — **인덱스 게이트가 지는 성질을 고정한다** — tdd §3.3 · §11 (GATE-A/B/C/D)
//
// ★★ **이 파일 전체가 RED 가 아니다. 프로덕션 델타는 0 이다.**
//   `single-doc.mjs:71` 의 `if (!index.paths.has(ref)) return null` **한 줄**이 오늘 여섯 가지 방어를
//   겸하는데(컨테인먼트 · 정규형 강제 · 온디스크 이름 동일성 · 실패 형태 404 · prod draft ·
//   불량 문서) **그 성질을 무는 테스트가 하나도 없다**. 누가 그 줄을 지우면 조용히 전부 열린다
//   (plan 실측: 위키 밖 문서가 200 · 원문으로 나온다). 이 파일은 그 제거를 **red 로 만든다**.
//
// ★ 여기에 **경로 검증 코드를 요구하는 케이스는 한 건도 없다**(D44 미발동 · 「안전선을 발명하지
//   마라」). 이 파일이 묻는 것은 「프로덕션이 새 검사를 갖췄는가」가 아니라 **「검사가 없는 채로도
//   404 라는 사실」**이다. 정규화 코드를 넣으면 오히려 GATE-A5 가 red 가 된다 — 그것이 목적이다.
//
// ★★ 비공허성(plan Risks 「Task 4 가 공허해짐」): 「404 다」만 쓰면 **인덱스가 비어 있어도 통과**한다.
//   그래서 모든 부재 단언은 케이스 안에 둘 중 하나를 갖는다 —
//     ⓐ **인덱스 주입 앵커** — 같은 vault·같은 `readFile` 로 그 경로를 읽으면 **원문이 나온다**
//        (= 게이트만이 유일한 방벽이다),
//     ⓑ **양성 대조**(규범 U) — 같은 vault·같은 빌드에서 정상 문서가 **정확 7키**다.
//
// 픽스처 제약(tdd §2.4):
//   ① 실 vault 무접촉(특히 `git tag`) — 전 케이스 tmp vault
//   ④ ★ **2단 tmp** — `../../OUTSIDE` 는 `<vault>/wiki/../../OUTSIDE.md` = **vault 의 부모**다.
//      `initVault()` 는 부모가 `/tmp` 라 거기에 쓰면 공유 네임스페이스를 오염시킨다.
//      ⇒ `outer = mkdtempSync(...)` → `vault = <outer>/vault` → `git(vault, ['init','-q'])`
//      (`git` 은 `tmp-git-vault.mjs` 가 **이미 export 한다** — 헬퍼 변경 0)
//   ⑤ 결함 주입(`draft` 플래그 · `type` 없는 문서 · vault 밖 문서)은 **스펙 본문에서만**
//   ⑥ 심링크는 **빌드 후**에 만든다 — 빌드 전이면 `git add -A` 가 심링크 blob 을 커밋해 HEAD 문서
//      목록 층의 취급이 변수가 된다(워커 `parse.mjs:89-92` 는 Dirent 라 안 담지만 git 층은 미검증)
//   ⑦ `prebuildArtifacts` 는 tmp vault 전용
//
// 규범 A: 게이트 입력·경로 조각·키 집합은 전부 **리터럴**이다. 규범 N: 개수 단언 단독 금지 —
//   입력별 결과를 리터럴로 열거한다. 규범 U: 「두 경로가 같은 형태를 낸다」는 같은 vault·같은 요청으로.
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { parseMarkdownFile } from '../lib/parse.mjs'
import { makeDocIndex, projectSingleDoc } from '../lib/single-doc.mjs'
import { wiki } from '../wiki.mjs'
import { prebuildArtifacts } from './helpers/prebuild-artifacts.mjs'
import { cleanup, commit, git, writeDoc } from './helpers/tmp-git-vault.mjs'

const ID_SKH = '0192c000-0000-7000-8000-0000000000c1'
const ID_TSMC = '0192c000-0000-7000-8000-0000000000c2'
const ID_UNIQUE = '0192c000-0000-7000-8000-0000000000c3'
const ID_DISABLE = '0192c000-0000-7000-8000-0000000000c4'
const ID_DEV_DRAFT = '0192c000-0000-7000-8000-0000000000c5'
const ID_FLAG_DRAFT = '0192c000-0000-7000-8000-0000000000c6'
const ID_INDEX = '0192c000-0000-7000-8000-0000000000c7'
const ID_OUTSIDE = '0192c000-0000-7000-8000-0000000000c8'
const ID_BROKEN = '0192c000-0000-7000-8000-0000000000c9'

/** 정규형 ref — 인덱스가 담는 유일한 형태다(`makeDocIndex` 가 `breadcrumb.join('/')` 로만 채운다). */
const REL_SKH = 'company/SK하이닉스'
const REL_TSMC = 'company/TSMC'
const REL_UNIQUE = 'concept/유일문서'
const REL_DEV_DRAFT = 'dev/실험문서'
const REL_FLAG_DRAFT = 'concept/비공개'
const REL_BROKEN = 'concept/불량문서'
const REL_INDEX = 'moc/색인'

/** vault **밖** 문서 — 게이트가 없으면 200 으로 새는 그 파일이다. */
const OUTSIDE_MARKER = '밖의문서마커'
/** 심링크 2형태 — `wiki/leak.md` → `../../OUTSIDE.md` · `wiki/esc` → `../..`(디렉토리) */
const REF_LEAK = 'leak'
const REF_ESC_OUTSIDE = 'esc/OUTSIDE'

/** active 응답 계약 — **정확 7키**(리터럴). disable 스텁 4키와 뭉개지지 않는다. */
const ACTIVE_KEYS = ['breadcrumb', 'headings', 'html', 'meta', 'path', 'sources', 'status']

/** 위키링크 `<a>` 계약(wikilink-plugin.mjs) — `exists:false` 인 대상만 이 class 를 얹는다. 리터럴이다. */
const DEAD_CLASS = 'wiki-link-dead'

/** vault 안 문서 루트 — **리터럴**이다(규범 A). `head-state.mjs` 의 `WIKI_PREFIX` 를 import 하지 않는다. */
const WIKI_ROOT = 'wiki'
/** `<vault>/wiki/<ref>.md` — `wiki.mjs:50` 과 같은 조립식이되 **리터럴**로 세운다. */
const docFile = (vault, ref) => path.join(vault, WIKI_ROOT, `${ref}.md`)
/** summary 아티팩트 경로 — **리터럴 조립**(규범 A). 정확 형태의 계약은 PL9 가 한 번만 고정한다. */
const summaryFile = (vault, env) => path.join(vault, 'cache', `summary.${env}.json`)

const tmps = []
afterAll(() => cleanup(...tmps))

let OUTER
let VAULT

/**
 * ★★ v3 P4 · §4.2 arm(D27) — `wiki()` 가 summary 경로를 **4번째 위치 인자**로 받는다.
 * 오늘도 green 이다(JS 는 여분 위치 인자를 무시한다). 규범 D: 헬퍼에 `expect` 를 두지 않는다.
 */
const askWiki = (env, ref) => wiki(VAULT, env, ref, summaryFile(VAULT, env))

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'))
/** 아티팩트가 실제로 담고 있는 정규형 경로 집합 — 「제외가 일어났다」의 관측 좌표다. */
const artifactPaths = (env) =>
  readJson(summaryFile(VAULT, env)).docs.map((doc) => doc.breadcrumb.join('/'))
const anchorOf = (html, label) =>
  html.split('<a ').find((chunk) => chunk.includes(`>${label}<`)) ?? ''

/**
 * 그 라벨을 가진 위키링크 `<a>` 의 **`data-path` 값**. 앵커가 없으면 `null` 이다.
 *
 * ★★ 이 헬퍼가 존재하는 이유 = **공허성 차단**(메인 반증 프로브 실측 · 2026-08-04):
 *   `anchorOf` 는 못 찾으면 `''` 를 돌려주고, 빈 문자열은 `.not.toContain(...)` 을 **항상**
 *   만족한다. 그래서 단언이 전부 부정형인 케이스는 **관측자를 죽여도(= `anchorOf` 를 `() => ''`
 *   로 바꿔도) 통과**한다 — 이 파일의 `GATE-D2` 가 실제로 그 상태였다.
 *   `data-path` **값 일치**는 앵커 부재 시 `null` 이라 즉시 red 이고, 동시에 **해석 결과 자체**를
 *   문다 ⇒ 관측자 실재와 양성 판정을 한 단언으로 함께 진다.
 *
 * ★ 실측 직렬화(`renderMarkdownToHtml` 직접 호출 · rehype-sanitize 통과 후):
 *     live  `<a href="…" class="wiki-link" data-path="concept/비공개">비공개</a>`
 *     dead  `<a href="…" class="wiki-link wiki-link-dead" data-path="비공개">비공개</a>`
 *   ⇒ **basename 형태에서 `data-path` 가 두 갈래를 직접 가른다**: 살아 있으면 `resolveTarget` 의
 *   해석 결과(`concept/비공개`)가, dead 면 `single-doc.mjs:52` 가 싣는 `targetRaw`(`비공개`)가 실린다.
 *   (정확 경로 형태 `[[concept/비공개]]` 는 양쪽 다 `concept/비공개` 라 값으로는 안 갈린다 —
 *    그 갈래는 `DEAD_CLASS` 축이 가르고, 이 값 단언은 **앵커 실재**를 보증한다.)
 *
 * 규범 D: `expect` 없이 값만 돌려준다.
 */
const dataPathOf = (html, label) => anchorOf(html, label).match(/data-path="([^"]*)"/)?.[1] ?? null

/**
 * **인덱스 주입 앵커** — 아티팩트 `docs` 에 그 경로를 하나 얹은 뒤 같은 `readFile` 로 투영한다.
 *
 * 게이트를 통과시켰을 때 **그 파일이 실제로 읽히고 원문이 나온다**는 것을 보인다 ⇒ 본 단언의
 * `null` 이 「파일이 없어서」가 아니라 **「게이트가 막아서」**임이 케이스 안에서 확정된다.
 * 규범 D: `expect` 없이 값만 돌려준다.
 */
const projectWithInjected = (env, ref, breadcrumb) =>
  projectSingleDoc({
    index: makeDocIndex([
      ...readJson(summaryFile(VAULT, env)).docs,
      { breadcrumb, status: 'active' },
    ]),
    readFile: (docRef) => parseMarkdownFile(docFile(VAULT, docRef)),
    ref,
  })

/** frontmatter 를 **스펙 본문에서 직접** 조립한다(§2.4-⑤ — 헬퍼는 정상 원자만 만든다). */
function writeRawDoc(file, lines, body) {
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, ['---', ...lines, '---', '', body].join('\n'))
}

beforeAll(async () => {
  // ④ 2단 tmp — `<outer>/vault` 가 vault 이고 `<outer>` 가 「vault 의 부모」다.
  OUTER = mkdtempSync(path.join(tmpdir(), 'wiki-gate-'))
  tmps.push(OUTER)
  VAULT = path.join(OUTER, 'vault')
  mkdirSync(VAULT, { recursive: true })
  git(VAULT, ['init', '-q'])

  writeDoc(VAULT, REL_SKH, { body: '## 정의\n\n한글 경로 문서다.\n', id: ID_SKH, title: 'SK하이닉스', type: 'company' }) // prettier-ignore
  writeDoc(VAULT, REL_TSMC, { body: '## 정의\n\n대소문자 대조 문서다.\n', id: ID_TSMC, title: 'TSMC', type: 'company' }) // prettier-ignore
  writeDoc(VAULT, REL_UNIQUE, { body: '## 정의\n\n유일 basename 문서다.\n', id: ID_UNIQUE, title: '유일문서' }) // prettier-ignore
  writeDoc(VAULT, 'concept/온디바이스-AI', { id: ID_DISABLE, status: 'disable', title: '온디바이스 AI' }) // prettier-ignore
  writeDoc(VAULT, REL_DEV_DRAFT, { body: '## 정의\n\n`dev/` 폴더 백스톱 문서다.\n', id: ID_DEV_DRAFT, title: '실험 문서' }) // prettier-ignore

  // ★ §11 픽스처 델타 — draft **두 형태**를 각각 세운다. 기존 픽스처는 `dev/` 폴더 1건뿐이라
  //   PRD fail-closed 검증 (a)(_"frontmatter 플래그 경로와 `dev/` 폴더 경로 **둘 다**"_)의 절반만
  //   이행한다. `writeDoc` 은 `draft` 를 모르므로 여기서 직접 쓴다(§2.4-⑤).
  writeRawDoc(
    docFile(VAULT, REL_FLAG_DRAFT),
    ['title: 비공개', 'type: concept', 'status: active', `id: "${ID_FLAG_DRAFT}"`, 'draft: true'],
    '## 정의\n\nfrontmatter 플래그 draft 문서다. 폴더는 정상이다.\n',
  )

  // ★ GATE-C1 — `type` 이 없어 `judgeDocs` 가 `MISSING_TYPE` 으로 제외하는 문서.
  writeRawDoc(
    docFile(VAULT, REL_BROKEN),
    ['title: 불량문서', 'status: active', `id: "${ID_BROKEN}"`],
    '## 정의\n\ntype 필드가 없는 문서다.\n',
  )

  // ★ §11 GATE-D — draft 문서를 가리키는 **공개** 문서. 두 링크 형태를 **각각** 담는다:
  //   ① 정확 경로(`index.paths.has(targetRaw)` 갈래) ② basename(`basenames` 유일 해석 갈래).
  //   `[[유일문서]]` 는 **양쪽 env 에서 항상 살아 있는** 대조항이다.
  writeDoc(VAULT, REL_INDEX, {
    body: `## 색인\n\n[[${REL_FLAG_DRAFT}]] · [[비공개]] · [[유일문서]]\n`,
    id: ID_INDEX,
    title: '색인',
    type: 'moc',
  })

  // vault **밖** 문서 — `<outer>/OUTSIDE.md`. 유효 frontmatter 를 갖는다(= 게이트가 없으면
  //   `parseMarkdownFile` 이 성공해 **200 + 원문**이 된다. frontmatter 가 없으면 500 이라 사유가 다르다).
  writeRawDoc(
    path.join(OUTER, 'OUTSIDE.md'),
    ['title: OUTSIDE', 'type: concept', 'status: active', `id: "${ID_OUTSIDE}"`],
    `## 정의\n\n${OUTSIDE_MARKER} — vault 밖 문서다.\n`,
  )

  commit(VAULT, 'chore: 게이트 픽스처 8건')
  await prebuildArtifacts(VAULT, 'dev')
  await prebuildArtifacts(VAULT, 'prod')

  // ⑥ 심링크는 **빌드 후**에 만든다.
  symlinkSync(path.join('..', '..', 'OUTSIDE.md'), docFile(VAULT, REF_LEAK))
  symlinkSync(path.join('..', '..'), path.join(VAULT, WIKI_ROOT, 'esc'))
}, 300_000)

describe('GATE-A 경로 봉쇄 — vault 밖 문서 (GATE-A1 · 🟢앵커(오늘도 green · RED 아님))', () => {
  it('GATE-A1: `../../OUTSIDE` 는 `null` 이고, 인덱스에 얹으면 **원문이 나온다**', async () => {
    // ★ 인덱스 주입 앵커: 게이트를 통과시키면 그 파일이 **실제로 읽히고 렌더된다** ⇒ 아래 `null` 은
    //   「파일이 없어서」가 아니라 **「게이트가 막아서」**다. 이 행이 없으면 케이스가 공허하다.
    const injected = projectWithInjected('dev', '../../OUTSIDE', ['..', '..', 'OUTSIDE'])
    expect(injected.html).toContain(OUTSIDE_MARKER)

    expect(await askWiki('dev', '../../OUTSIDE')).toBeNull()
  })
})

describe('GATE-A 경로 봉쇄 — 심링크 2형태 (GATE-A2 · 🟢앵커(오늘도 green · RED 아님))', () => {
  it('GATE-A2: `leak` · `esc/OUTSIDE` 가 각각 `null` 이다(심링크는 실제로 풀린다)', async () => {
    // 앵커 ⓐ: 심링크가 **실제로 vault 밖을 가리킨다** — 디스크에서 읽으면 밖의 원문이 나온다.
    //   (심링크가 깨져 있으면 아래 `null` 은 아무것도 증명하지 않는다.)
    expect(readFileSync(docFile(VAULT, REF_LEAK), 'utf8')).toContain(OUTSIDE_MARKER)
    expect(readFileSync(docFile(VAULT, REF_ESC_OUTSIDE), 'utf8')).toContain(OUTSIDE_MARKER)

    // 앵커 ⓑ: 인덱스 주입 — 게이트를 통과시키면 심링크 너머 원문이 렌더된다.
    expect(projectWithInjected('dev', REF_LEAK, ['leak']).html).toContain(OUTSIDE_MARKER)

    expect(await askWiki('dev', REF_LEAK)).toBeNull()
    expect(await askWiki('dev', REF_ESC_OUTSIDE)).toBeNull()
  })
})

describe('GATE-A 정규형 강제 — 별칭 4형태 (GATE-A3 · 🟢앵커(오늘도 green · RED 아님))', () => {
  it('GATE-A3: 같은 파일로 풀리는 별칭 4형태가 **전부 `null`** 이고 정규형만 7키다', async () => {
    // ★ 게이트가 **정규형까지 보장한다**: `makeDocIndex` 가 `paths` 를 `breadcrumb.join('/')` 로만
    //   채우므로 인덱스는 정규형만 담는다 ⇒ 통과 = 정규형 보장. 별칭이 열리면 같은 문서가 여러
    //   주소를 갖고 `breadcrumb` 이 오염된다(`ref.split('/')` 가 응답의 breadcrumb 이다).
    const aliases = [
      '/company/SK하이닉스',
      'company/./SK하이닉스',
      'company/../company/SK하이닉스',
      '../wiki/company/SK하이닉스',
    ]

    // 앵커: 4형태가 **디스크에서 같은 파일로 풀린다** — 즉 "그런 파일이 없어서 null" 이 아니다.
    expect(aliases.map((alias) => existsSync(docFile(VAULT, alias)))).toEqual([
      true,
      true,
      true,
      true,
    ])
    // 앵커(규범 U): 같은 vault·같은 빌드에서 **정규형**은 정확 7키다.
    expect(Object.keys(await askWiki('dev', REL_SKH)).toSorted()).toEqual(ACTIVE_KEYS)

    for (const alias of aliases) {
      expect(await askWiki('dev', alias), alias).toBeNull()
    }
  })
})

describe('GATE-A 온디스크 이름 동일성 — 대소문자 (GATE-A4 · 🟢앵커(오늘도 green · RED 아님))', () => {
  it('GATE-A4: `company/tsmc` · `COMPANY/TSMC` 가 `null` 이고 정규형만 7키다', async () => {
    // ★ 주석 계약(tdd §3.3 · 필수): 이 케이스는 **파일시스템의 대소문자 민감도를 주장하지 않는다** —
    //   `/tmp` 는 민감이고 9p 는 비민감이다. 무는 것은 **인덱스 정확 일치**다. 9p 에서
    //   `COMPANY/TSMC.md` 가 `company/TSMC.md` 를 여는 것(실측)과 `isDraft({relPath:'DEV/SECRET'})`
    //   → PUBLIC(실측)이 합성되면 draft 백스톱 우회가 되는데, 그 도달을 막는 것이 이 성질이다.
    expect(Object.keys(await askWiki('dev', REL_TSMC)).toSorted()).toEqual(ACTIVE_KEYS)

    expect(await askWiki('dev', 'company/tsmc')).toBeNull()
    expect(await askWiki('dev', 'COMPANY/TSMC')).toBeNull()
  })
})

describe('GATE-A 유니코드 — 정규화를 넣지 않았다 (GATE-A5 · 🟢앵커(오늘도 green · RED 아님))', () => {
  it('GATE-A5: 한글 NFC 는 **7키**이고 같은 문자열의 NFD 는 **`null`** 이다', async () => {
    // ★ 주석 계약(tdd §3.3 · 필수): 이 케이스의 목적은 양성 대조가 **아니다**. 나중에 누가 유니코드
    //   정규화를 넣으면 죽는 것이 목적이다. 온디스크 이름도 인덱스도 NFC 다 — **NFD 정규화를 넣으면
    //   실문서가 죽고, NFC 정규화를 넣으면 오늘 막히는 NFD 입력이 열린다**. 두 방향을 한 케이스에서
    //   함께 문다(CX-6·CX-7 이 각각 이 두 절을 겨냥한다).
    const nfd = REL_SKH.normalize('NFD')
    // 앵커: 두 문자열이 **실제로 다르다**(같으면 아래 두 단언이 서로 모순이라 픽스처가 헛돈다).
    expect(nfd).not.toBe(REL_SKH)

    expect(Object.keys(await askWiki('dev', REL_SKH)).toSorted()).toEqual(ACTIVE_KEYS)
    expect(await askWiki('dev', nfd)).toBeNull()
  })
})

describe('GATE-A 실패 형태는 404 다 — 나머지 11종 (GATE-A6 · 🟢앵커(오늘도 green · RED 아님))', () => {
  // 규범 N: 개수 단언 단독 금지 — 입력별 결과를 **리터럴로 열거**한다.
  // ★ 오늘 게이트를 지우면 이 입력들은 404 가 아니라 **500** 이 되고, 그 stderr 가 절대 해석 경로를
  //   담아 **경로 존재 오라클**이 된다. 「전부 404」는 그 오라클이 닫혀 있다는 뜻이다.
  const CASES = [
    ['상위 탈출 · 리포 문서', '../../AGENTS'],
    ['상위 탈출 · dotfile', '../../.env'],
    ['절대 경로 · 시스템 파일', '/etc/passwd'],
    ['절대 경로 · vault 밖 문서', '/OUTSIDE'],
    ['빈 문자열', ''],
    ['현재 디렉토리', '.'],
    ['상위 디렉토리', '..'],
    ['후행 슬래시', 'company/SK하이닉스/'],
    ['널 바이트', 'company/\u0000SK'],
    ['wiki 접두사 중복', 'wiki/company/SK하이닉스'],
    ['URL 인코딩', 'company%2FSK하이닉스'],
  ]

  it.each(CASES)('GATE-A6: %s → `null`', async (_label, ref) => {
    expect(await askWiki('dev', ref)).toBeNull()
    // 앵커(규범 U): 같은 vault·같은 빌드에서 정규형은 정확 7키다 — 인덱스가 비어서 통과하는 것을 배제.
    expect(Object.keys(await askWiki('dev', REL_SKH)).toSorted()).toEqual(ACTIVE_KEYS)
  })
})

describe('GATE-B prod draft 차단 — `dev/` 폴더 백스톱 (GATE-B1·B2 · 🟢앵커(오늘도 green))', () => {
  it('GATE-B1: `dev/실험문서` 는 **prod 에서 `null`** 이다', async () => {
    // 앵커(규범 U): **같은 prod 아티팩트**에서 정상 문서는 7키다 — 실 vault 6문서가 전부 draft 라
    //   prod `docs=0` 이라는 함정(§2.4-②)의 tmp 판이다. prod 인덱스가 비면 이 케이스는 공허하다.
    expect(Object.keys(await askWiki('prod', REL_SKH)).toSorted()).toEqual(ACTIVE_KEYS)

    expect(await askWiki('prod', REL_DEV_DRAFT)).toBeNull()
  })

  it('GATE-B2: 같은 문서·같은 vault 인데 **dev 에서는 7키**다(env 만 다르다)', async () => {
    // 규범 U — B1 과 **같은 vault·같은 ref**, 다른 것은 env 하나뿐이다. 이 짝이 없으면 B1 은
    //   「그 문서가 애초에 빌드에 없다」로도 통과한다.
    expect(Object.keys(await askWiki('dev', REL_DEV_DRAFT)).toSorted()).toEqual(ACTIVE_KEYS)
  })
})

describe('GATE-B prod draft 차단 — frontmatter 플래그 (GATE-B3·B4 · 🟢앵커(오늘도 green))', () => {
  it('GATE-B3: `draft: true` **플래그** 문서는 prod 에서 `null` 이다', async () => {
    // ★ PRD fail-closed 검증 (a) 축자: _"frontmatter 플래그 경로와 `dev/` 폴더 경로 **둘 다**"_.
    //   `isDraft` 는 OR 결합이라 두 신호가 **각각** 단독으로 차단해야 한다 — 폴더만 두면 플래그
    //   경로가 죽어도 아무도 모른다.
    expect(Object.keys(await askWiki('prod', REL_SKH)).toSorted()).toEqual(ACTIVE_KEYS)

    expect(await askWiki('prod', REL_FLAG_DRAFT)).toBeNull()
  })

  it('GATE-B4: 같은 플래그 문서가 **dev 에서는 7키**다(`head-state.mjs:65` dev 분기 대칭)', async () => {
    expect(Object.keys(await askWiki('dev', REL_FLAG_DRAFT)).toSorted()).toEqual(ACTIVE_KEYS)
  })
})

describe('GATE-C 불량 문서 차단 (GATE-C1 · 🟢앵커(오늘도 green · RED 아님))', () => {
  it('GATE-C1: `type` 없는 문서는 디스크에 있어도 prod·dev 양쪽에서 `null` 이다', async () => {
    // ★ 유일 검출기가 **아니다**(`serving.exclusion.test.mjs:64-68` SR2 가 dev env 에서 같은 성질을
    //   문다). 그럼에도 두는 이유: ⓐ SR2 는 dev 이고 여기는 **prod** 다, ⓑ `:71` 제거 프로브(CX-5)의
    //   red 집합을 한 파일에 모아 「세 성질이 한 줄에 걸려 있다」를 문서화된 형태로 남긴다.
    //   ⇒ REFACTOR 의 **Merge 후보이지 Delete 후보가 아니다**.

    // 앵커 ⓐ: 그 `.md` 는 **디스크에 실재한다**(파일명 오타로 404 인 것을 배제).
    expect(existsSync(docFile(VAULT, REL_BROKEN))).toBe(true)
    // 앵커 ⓑ: 같은 아티팩트에 정상 문서는 **있다** — 전멸이 아니라 그 한 건만 빠졌다.
    //   ★ 아래 `not.toContain` 은 부정형이라 `docs` 가 비면 **항상 참**이다. env 별로 양성 대조를
    //     **각각** 짝지어 그 공허 통과를 배제한다(dev 쪽만 짝이 없으면 dev 절이 공허해진다).
    expect(artifactPaths('prod')).toContain(REL_SKH)
    expect(artifactPaths('dev')).toContain(REL_SKH)
    // 앵커 ⓒ: 아티팩트 `docs` 집합에 **없다** — 제외가 실제로 일어났다(양쪽 env 에서).
    expect(artifactPaths('prod')).not.toContain(REL_BROKEN)
    expect(artifactPaths('dev')).not.toContain(REL_BROKEN)

    expect(await askWiki('prod', REL_BROKEN)).toBeNull()
    expect(await askWiki('dev', REL_BROKEN)).toBeNull()
  })
})

describe('GATE-D prod 에서 draft 로의 링크는 dead 다 (GATE-D1·D2 · 🟢앵커(오늘도 green))', () => {
  // ★ PRD fail-closed 검증 (b) 축자: _"prod 에서 draft 문서로의 링크가 dead 인지"_.
  //   게이트 유지로 **오늘 이미 성립**한다 — prod 인덱스에 draft 가 없어 `makeResolver`
  //   (`single-doc.mjs:47-55`)가 `{ exists: false, path: targetRaw }` 를 낸다. 회귀 앵커다.
  // ★ 단언은 **`exists === false`** 에 건다. 그 관측 좌표는 `wikilink-plugin.mjs:35` 가 얹는
  //   `wiki-link-dead` class 다. **`path` 값의 부재로 오해하지 마라** — `exists:false` 일 때
  //   `path` 는 `targetRaw` 를 그대로 되돌려주며, 그 문자열은 **링크를 담은 공개 문서가 이미
  //   저작한 것**이다(plan 「실재하는 라이브 창」의 수용 근거와 같은 사실).
  it('GATE-D1: prod — 정확 경로 형태와 basename 형태가 **각각** dead 다', async () => {
    // 앵커 ⓐ: prod 아티팩트에 그 draft 문서는 **없고** 링크를 담은 공개 문서는 **있다**
    //   (부정형 단독이면 `docs` 가 비어도 통과한다 — 같은 케이스에 양성 대조를 짝으로 둔다).
    expect(artifactPaths('prod')).toContain(REL_INDEX)
    expect(artifactPaths('prod')).not.toContain(REL_FLAG_DRAFT)

    const html = (await askWiki('prod', REL_INDEX)).html

    // 앵커 ⓑ: 같은 문서의 **살아 있는 링크**는 해석 결과 경로를 싣는다 — 「링크 해석이 아예 안
    //   된다」를 배제한다. ★ `.not.toContain(DEAD_CLASS)` 를 **단독으로 두지 않는다**: 앵커를
    //   못 찾으면 `anchorOf` 가 `''` 를 돌려줘 부정형이 항상 참이 되기 때문이다(공허성).
    expect(dataPathOf(html, '유일문서')).toBe(REL_UNIQUE)
    expect(anchorOf(html, '유일문서')).not.toContain(DEAD_CLASS)

    // `resolveTarget` 은 ① 정확 경로 ② basename 유일 해석의 **두 갈래**다. 한 형태만 고르면
    //   미래에 한 갈래만 바뀌어도 안 잡힌다 ⇒ 두 형태를 각각 문다.
    //   ★ basename 형태의 `data-path` 는 dead 일 때 **`targetRaw` 가 그대로** 실린다
    //     (`single-doc.mjs:52`) — 그 값 자체가 「해석에 실패했다」의 직접 증거다.
    expect(dataPathOf(html, REL_FLAG_DRAFT)).toBe(REL_FLAG_DRAFT)
    expect(anchorOf(html, REL_FLAG_DRAFT)).toContain(DEAD_CLASS)
    expect(dataPathOf(html, '비공개')).toBe('비공개')
    expect(anchorOf(html, '비공개')).toContain(DEAD_CLASS)
  })

  it('GATE-D2: dev — **같은 공개 문서**에서 두 형태가 모두 살아 있다', async () => {
    // ★ Arrange 자기모순 점검: dev 에서 살아 있으려면 **dev 아티팩트에 그 draft 문서가 실려 있어야**
    //   한다. `head-state.mjs:65` 가 dev 에서 draft 를 거르지 않으므로 성립한다 — 단 **dev 빌드를
    //   실제로 돌린 픽스처**여야 한다(prod 만 만들고 dev 를 기대하면 공허 참이다).
    expect(artifactPaths('dev')).toContain(REL_FLAG_DRAFT)

    const html = (await askWiki('dev', REL_INDEX)).html

    // ★★ 공허성 차단(메인 반증 프로브 실측): 이 케이스가 `.not.toContain(DEAD_CLASS)` 만 갖고
    //   있으면 **없는 라벨로도 통과**하고 **`anchorOf` 를 무력화해도 통과**한다 — 그러면 이 짝의
    //   존재 이유(「dev 에서 링크가 산다」)를 아무도 물지 않는다. 그래서 **해석 결과 경로**를
    //   양성으로 먼저 문다: basename 형태 `[[비공개]]` 는 살아 있을 때만 `concept/비공개` 로
    //   해석되고, dead 면 `targetRaw` 인 `비공개` 가 실려 이 단언이 red 가 된다.
    expect(dataPathOf(html, REL_FLAG_DRAFT)).toBe(REL_FLAG_DRAFT)
    expect(dataPathOf(html, '비공개')).toBe(REL_FLAG_DRAFT)
    expect(dataPathOf(html, '유일문서')).toBe(REL_UNIQUE)

    expect(anchorOf(html, REL_FLAG_DRAFT)).not.toContain(DEAD_CLASS)
    expect(anchorOf(html, '비공개')).not.toContain(DEAD_CLASS)
  })
})
