// @vitest-environment node
//
// P3 · Task 1 — 문서 단위 판정 단일화 (`scripts/lib/doc-gate.mjs` 신설) — tdd §3.1 (DG1~DG14)
//
// RED 사유(전 케이스 공통 · **미구현**): `scripts/lib/doc-gate.mjs` 가 **부재**하고 `judgeDocs`
//   export 도 없다. 정적 named import 로 적으면 ESM 링크가 파일을 통째로 죽여 collection error 가
//   되고(= 테스트 0건), rtk 래퍼는 그것을 PASS 로 오보고한다(tdd §2.4). 그래서 모듈 해석을 **런타임으로
//   미루고**(dynamic import + catch) 케이스마다 명시적으로 실패시킨다 → DG1~DG14 가 **각각** red 가
//   되고 어느 축이 미구현인지 즉시 보인다(`feed-survival.test.mjs:33-49` 관례 재사용).
//
// 이 파일이 확정하는 seam (tdd §3.0 — GREEN 은 이 형태로 구현한다):
//   judgeDocs(parsedDocs, { deletedIdEvents?, runGit?, strayPaths?, wikiPrefix, wikiSchema })
//     → { excluded: { id: string|null, message: string, path: string, reasonCode: string }[],
//         visible: object[] }
//     · excluded 는 **path 오름차순 정렬**(결정성) · 문서당 사유 **1개**(우선순위 7단계)
//     · excluded[].path 는 **리포 상대 posix**(`wiki/<relPath>.md`) — `strayPaths` 와 같은 좌표계라야
//       둘을 한 배열에 담아 정렬할 수 있다.
//     · `runGit` 미주입 → **얕은 티어만**(ID_TAMPERED·DELETED_ID_REUSE 미실행 · git spawn 0)
//
// 사유 우선순위(OQ-P3-3 확정 · 싸고 근본적인 것 먼저):
//   NO_FRONTMATTER > MISSING_TYPE > SCHEMA_VIOLATION > DUPLICATE_PATH > DUPLICATE_ID
//     > ID_TAMPERED > DELETED_ID_REUSE
//   중복 판정은 **1-pass** — 이미 다른 사유로 제외된 문서도 중복 계산에 **포함**한다(fail-closed·순서 무관).
//
// 자기참조 공허성 금지(tdd §2.3 규범 A): docId·경로·사유 문자열은 **전부 리터럴**이다 —
//   `REASON_CODES`·`WIKI_PREFIX` 를 import 해 입력이나 기대값을 만들지 않는다. 상수와 리터럴의
//   드리프트는 트립와이어 스펙(PL3)이 3자 대조로 따로 잡는다.
//
// 비용(tdd §7.3): 순수 함수 + 리터럴 입력. git·fs 접근은 스키마 1회 로드뿐 → 9p spawn 비용 0.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

// RED 시점에 이 모듈은 존재하지 않는다 → 로드 에러를 붙들었다가 케이스별로 되던진다.
const loaded = await import(new URL('../doc-gate.mjs', import.meta.url).href).catch((error) => ({
  __loadError: error instanceof Error ? error.message : String(error),
}))

/** 아직 없는 seam 을 **케이스별** 명시 실패로 바꾼다(파일 통째 collection error 회피 · tdd §2.4). */
function judge(parsedDocs, ctx) {
  if (loaded.__loadError !== undefined) {
    throw new Error(
      `[RED] scripts/lib/doc-gate.mjs 가 아직 없다 (P3 Task 1 미구현): ${loaded.__loadError}`,
    )
  }
  if (typeof loaded.judgeDocs !== 'function') {
    throw new Error('[RED] doc-gate.mjs 에 judgeDocs export 가 아직 없다 (P3 Task 1 미구현)')
  }
  return loaded.judgeDocs(parsedDocs, ctx)
}

const HERE = path.dirname(fileURLToPath(import.meta.url))
/** 생산 JSON Schema — 판정 **재료**(ctx 의존성)이지 기대값의 출처가 아니다(규범 A 위반 아님). */
const WIKI_SCHEMA = JSON.parse(
  readFileSync(path.resolve(HERE, '..', '..', 'schema', 'wiki-doc.schema.json'), 'utf8'),
)

// 유효 UUIDv7 리터럴 — wiki-doc.schema.json 의 pattern 을 만족한다.
const ID_A = '0192a000-0000-7000-8000-0000000000aa'
const ID_B = '0192b000-0000-7000-8000-0000000000bb'
const ID_C = '0192c000-0000-7000-8000-0000000000cc'
const ID_DUP = '0192d000-0000-7000-8000-0000000000dd'
const ID_TAMPER = '0192e000-0000-7000-8000-0000000000ee'
/** 생성 시점 blob 에 박혀 있던(= 지금과 다른) id — 사후 변조의 증거. */
const ID_AT_CREATION = '0192f000-0000-7000-8000-0000000000ff'
const BAD_ID = 'not-a-valid-uuid'

/** 위키 루트 접두사 **리터럴** — `WIKI_PREFIX` 를 import 하지 않는다(규범 A). */
const WIKI_PREFIX = 'wiki/'

/** `parseMarkdownFile` + `derivePathAndBreadcrumb` 결과의 최소 형태(리터럴 조립). */
function doc(relPath, frontmatter) {
  return {
    body: '## 정의\n\n본문 문단이다.\n',
    breadcrumb: relPath.split('/'),
    filePath: `/hermetic/vault/wiki/${relPath}.md`,
    frontmatter,
    relPath,
  }
}

/** 유효 frontmatter — 각 케이스는 **한 축만** 오염시킨다(무엇이 틀렸는지가 스펙에 보인다). */
function fm(id, extra = {}) {
  return { id, status: 'active', title: '문서', type: 'concept', ...extra }
}

const ctx = (extra = {}) => ({ wikiPrefix: WIKI_PREFIX, wikiSchema: WIKI_SCHEMA, ...extra })

const pathsOf = (entries) => entries.map((entry) => entry.path)
const reasonsOf = (entries) => entries.map((entry) => entry.reasonCode)
const relPathsOf = (docs) => docs.map((entry) => entry.relPath)

/**
 * 깊은 티어 stub — `git` CLI 흉내. **테스트 로컬 리터럴**이며 프로덕션 상수를 쓰지 않는다.
 *
 * `readIdAtCreation` 은 ① `log --follow --name-status` 로 생성 커밋을 찾고 ② `show <sha>:<경로>` 로
 * 그 시점 blob 을 읽는다. 그래서 두 질의에 각각 답한다. `--diff-filter=D`(삭제 이력)는 빈 답을 준다
 * — 이 케이스가 겨냥한 축은 ID_TAMPERED 하나다.
 */
function tamperingRunGit(idAtCreation = ID_AT_CREATION) {
  return (args) => {
    if (args.includes('--diff-filter=D')) return ''
    if (args.includes('--follow')) {
      return '4b825dc642cb6eb9a060e54bf8d69288fbee4904\t2026-01-01T00:00:00+00:00\nA\twiki/company/변조.md\n' // prettier-ignore
    }
    if (args.includes('show')) {
      return `---\ntitle: 변조\ntype: concept\nstatus: active\nid: "${idAtCreation}"\n---\n\n## 정의\n\n본문 문단이다.\n` // prettier-ignore
    }
    return ''
  }
}

// ────────────────────────────────────────────────────────────────────────────
// DG1~DG5 — 오염 1종씩 (대조군 문서는 매번 살아남는다)
// ────────────────────────────────────────────────────────────────────────────

describe('judgeDocs — 오염 1종씩 (DG1~DG5 · 🔴RED 미구현)', () => {
  it('DG1: 정상 문서 2건 → excluded 0 · visible 은 입력 순서를 보존한다 (대조군)', () => {
    // 이 대조군이 없으면 "전부 제외" 구현이 DG2~DG8 을 전부 통과한다.
    const docs = [doc('company/정상', fm(ID_A)), doc('concept/메모리', fm(ID_B))]

    const result = judge(docs, ctx())

    expect(result.excluded).toEqual([])
    expect(relPathsOf(result.visible)).toEqual(['company/정상', 'concept/메모리'])
  })

  it('DG2: `type` 키 부재 → MISSING_TYPE 1건 · 정상 문서는 visible 에 남는다', () => {
    // F4: 현행 `parse-vault.mjs:70` 의 throw 는 **이를 무는 테스트가 0건**이다. 값으로 옮기면서
    //   "하나 틀리면 전부 버림" 이 되지 않는지를 visible 잔존으로 함께 못박는다.
    const broken = { id: ID_B, status: 'active', title: '타입없음' }
    const docs = [doc('company/정상', fm(ID_A)), doc('concept/타입없음', broken)]

    const result = judge(docs, ctx())

    expect(result.excluded).toHaveLength(1)
    expect(result.excluded[0].reasonCode).toBe('MISSING_TYPE')
    expect(result.excluded[0].path).toBe('wiki/concept/타입없음.md')
    expect(relPathsOf(result.visible)).toEqual(['company/정상'])
  })

  it('DG3: id 가 UUIDv7 이 아니다 → SCHEMA_VIOLATION · message 에 `id` 가 담긴다', () => {
    const docs = [doc('company/정상', fm(ID_A)), doc('concept/깨진id', fm(BAD_ID))]

    const result = judge(docs, ctx())

    expect(result.excluded).toHaveLength(1)
    expect(result.excluded[0].reasonCode).toBe('SCHEMA_VIOLATION')
    // 사유만 맞고 "무엇이 틀렸는지" 를 안 알려주는 리포트를 배제한다.
    // ★ `toContain('id')` 로는 부족하다 — 영어 `invalid` 도, 경로 `깨진id.md` 도 부분문자열 `id` 를
    //   갖는다. **필드로서의** id(콜론 뒤 설명이 따라오는 형태)와 어긴 제약 이름을 함께 요구한다.
    expect(result.excluded[0].message).toMatch(/id:\s/u)
    expect(result.excluded[0].message).toContain('pattern')
    expect(relPathsOf(result.visible)).toEqual(['company/정상'])
  })

  it('DG4: 제거된 `created` 가 frontmatter 에 남았다 → SCHEMA_VIOLATION · message 에 `created`', () => {
    // `validate.mjs:310` 의 별도 검사가 제외 모델로 **함께** 옮겨졌는가(스키마는 이 키를 막지 않는다 —
    //   wiki-doc.schema.json 은 additionalProperties: true 다).
    const docs = [
      doc('company/정상', fm(ID_A)),
      doc('concept/날짜잔존', fm(ID_B, { created: '2026-01-01' })),
    ]

    const result = judge(docs, ctx())

    expect(result.excluded).toHaveLength(1)
    expect(result.excluded[0].reasonCode).toBe('SCHEMA_VIOLATION')
    expect(result.excluded[0].message).toContain('created')
  })

  it('DG5: strayPaths → NO_FRONTMATTER · id 는 **null** 이다', () => {
    // `checkStrayDocs` 흡수. `id: null` 을 못박아 "빈 문자열" 표현을 배제한다(리포트 소비자가
    //   falsy 검사로 뭉개지 않도록 표현을 하나로 고정한다).
    const docs = [doc('company/정상', fm(ID_A))]

    const result = judge(docs, ctx({ strayPaths: new Set(['wiki/concept/메모장.md']) }))

    expect(result.excluded).toHaveLength(1)
    expect(result.excluded[0]).toMatchObject({
      id: null,
      path: 'wiki/concept/메모장.md',
      reasonCode: 'NO_FRONTMATTER',
    })
    expect(relPathsOf(result.visible)).toEqual(['company/정상'])
  })
})

// ────────────────────────────────────────────────────────────────────────────
// DG6~DG10 — 중복은 쌍이다 · 결정성 · 사유 우선순위 · 1-pass
// ────────────────────────────────────────────────────────────────────────────

/** DG6·DG7 이 공유하는 입력 — 같은 배열을 순서만 뒤집어 넣어 결정성을 대조한다. */
const TWIN_DOCS = [
  doc('company/정상', fm(ID_A)),
  doc('concept/쌍둥이-A', fm(ID_DUP)),
  doc('concept/쌍둥이-B', fm(ID_DUP)),
]

describe('judgeDocs — 중복·결정성·우선순위 (DG6~DG10 · 🔴RED 미구현)', () => {
  it('DG6: 같은 id 2건 → **둘 다** DUPLICATE_ID(정확히 2건) · 정상 문서만 visible', () => {
    // ★ PRD A.3 「둘 다 제외」. `toHaveLength(2)` 는 정확 일치(하한이 아니다) — 하나만 빼는 구현이 red.
    const result = judge(TWIN_DOCS, ctx())

    expect(result.excluded).toHaveLength(2)
    expect(reasonsOf(result.excluded)).toEqual(['DUPLICATE_ID', 'DUPLICATE_ID'])
    expect(pathsOf(result.excluded).toSorted()).toEqual([
      'wiki/concept/쌍둥이-A.md',
      'wiki/concept/쌍둥이-B.md',
    ])
    expect(relPathsOf(result.visible)).toEqual(['company/정상'])
  })

  it('DG7: 같은 배열을 **역순**으로 넣어도 결과가 동일하다 (결정성)', () => {
    // ★ "먼저 만난 쪽을 살린다" 구현이면 생존자가 파일 순회 순서에 좌우돼 **비결정적**이 된다.
    //   이 행이 그것을 잡는 유일한 탐지기다(같은 vault 를 두 번 돌려 리포트가 달라지면 diff 가 무의미).
    const forward = judge(TWIN_DOCS, ctx())
    const reversed = judge(TWIN_DOCS.toReversed(), ctx())

    expect(pathsOf(reversed.excluded).toSorted()).toEqual(pathsOf(forward.excluded).toSorted())
    expect(relPathsOf(reversed.visible).toSorted()).toEqual(relPathsOf(forward.visible).toSorted())
  })

  it('DG8: 같은 relPath 2건(id 는 다르다) → **둘 다** DUPLICATE_PATH', () => {
    // F3: 현행 `derive.mjs:51` 의 중복 path throw 는 **회귀 가드가 아예 없다**(grep 0건). 이번에 처음 문다.
    const docs = [doc('concept/충돌', fm(ID_A)), doc('concept/충돌', fm(ID_B))]

    const result = judge(docs, ctx())

    expect(result.excluded).toHaveLength(2)
    expect(reasonsOf(result.excluded)).toEqual(['DUPLICATE_PATH', 'DUPLICATE_PATH'])
    expect(result.visible).toEqual([])
  })

  it('DG9: `type` 부재 **이면서** id 도 무효 → 사유는 우선순위 상위인 MISSING_TYPE 하나다', () => {
    // OQ-P3-3. 사유가 임의로 갈리면 같은 vault 를 두 번 돌린 두 리포트가 달라진다.
    const docs = [doc('concept/이중오염', { id: BAD_ID, status: 'active', title: '이중오염' })]

    const result = judge(docs, ctx())

    expect(result.excluded).toHaveLength(1)
    expect(result.excluded[0].reasonCode).toBe('MISSING_TYPE')
  })

  it('DG10: 무효 id 문서 A + 같은 id 문자열의 문서 B → A=SCHEMA_VIOLATION · B=DUPLICATE_ID (1-pass)', () => {
    // OQ-P3-3 **1-pass** pin: 이미 제외된 A 도 중복 계산에 포함된다. fixpoint(제외분을 빼고 재판정)면
    //   B 가 살아남아 red 다 — 그리고 그 구현은 "결함 문서 덕분에 다른 문서가 통과" 하는 순서 의존이 된다.
    const docs = [doc('concept/무효A', fm(BAD_ID)), doc('concept/짝B', fm(BAD_ID))]

    const result = judge(docs, ctx())

    expect(result.excluded).toHaveLength(2)
    const byPath = Object.fromEntries(
      result.excluded.map((entry) => [entry.path, entry.reasonCode]),
    )
    expect(byPath['wiki/concept/무효A.md']).toBe('SCHEMA_VIOLATION')
    expect(byPath['wiki/concept/짝B.md']).toBe('DUPLICATE_ID')
    expect(result.visible).toEqual([])
  })
})

// ────────────────────────────────────────────────────────────────────────────
// DG11~DG12 — 비용 티어(D-A): 깊은 검사는 runGit 을 준 호출에서만 돈다
// ────────────────────────────────────────────────────────────────────────────

/** DG11·DG12 가 공유하는 입력 — **runGit 주입 여부만** 다르다. */
const TAMPERED_DOCS = [doc('company/변조', fm(ID_TAMPER))]

describe('judgeDocs — 비용 티어 (DG11·DG12 · 🔴RED 미구현)', () => {
  it('DG11: runGit 주입 + 생성 시점 id 가 다르다 → ID_TAMPERED', () => {
    // `validate.mjs:315`(불변 게이트) 흡수. stub 은 **리터럴 반환값을 가진 테스트 로컬 함수**다.
    const result = judge(TAMPERED_DOCS, ctx({ runGit: tamperingRunGit() }))

    expect(result.excluded).toHaveLength(1)
    expect(result.excluded[0].reasonCode).toBe('ID_TAMPERED')
    expect(result.excluded[0].path).toBe('wiki/company/변조.md')
  })

  it('DG12: **runGit 미주입** + 같은 문서 → excluded 0건 (얕은 티어는 깊은 검사를 하지 않는다)', () => {
    // ★ D-A 비용 티어 pin. 서빙 경로(`feeds`·`wiki`)가 **문서당 git spawn 을 지불하지 않음**을 구조로
    //   증명한다. 이 행이 없으면 라이브 경로가 조용히 느려지고(문서 6건 × log+show) 아무도 모른다.
    const result = judge(TAMPERED_DOCS, ctx())

    expect(result.excluded).toEqual([])
    expect(relPathsOf(result.visible)).toEqual(['company/변조'])
  })
})

// ────────────────────────────────────────────────────────────────────────────
// DG13~DG14 — 경계값 · 리포트 순서 결정성
// ────────────────────────────────────────────────────────────────────────────

describe('judgeDocs — 경계·정렬 (DG13 🔴RED · DG14 pair)', () => {
  it('DG13: 빈 배열 + 빈 strayPaths → { excluded: [], visible: [] } · throw 없음', () => {
    expect(() => judge([], ctx({ strayPaths: new Set() }))).not.toThrow()
    expect(judge([], ctx({ strayPaths: new Set() }))).toEqual({ excluded: [], visible: [] })
  })

  it('DG14: 정상 1 + 오염 전종 → excluded 가 **path 오름차순**이다 (pair · 리포트 결정성)', () => {
    // 입력 순서를 **정렬 역순에 가깝게** 넣는다 — 입력 순서를 그대로 내보내는 구현이 우연히 정렬처럼
    //   보이는 것을 막는다(tdd §6 CX2 의 "미검증 가설" 대비).
    const docs = [
      doc('z-폴더/중복b', fm(ID_DUP)),
      doc('z-폴더/중복a', fm(ID_DUP)),
      doc('m-폴더/충돌', fm(ID_B)),
      doc('m-폴더/충돌', fm(ID_C)),
      doc('b-폴더/날짜잔존', fm(ID_A, { created: '2026-01-01' })),
      doc('a-폴더/타입없음', { id: ID_TAMPER, status: 'active', title: '타입없음' }),
      doc('정상문서', fm('0192a111-0000-7000-8000-0000000000a1')),
    ]

    const result = judge(docs, ctx({ strayPaths: new Set(['wiki/c-폴더/메모장.md']) }))

    const paths = pathsOf(result.excluded)
    expect(paths).toEqual(paths.toSorted())
    // 앵커: 정렬만 맞고 내용이 빈 결과를 배제한다 — 오염 7건이 실제로 걸렸고 정상 문서는 살아 있다.
    expect(paths).toHaveLength(7)
    expect(relPathsOf(result.visible)).toEqual(['정상문서'])
  })
})
