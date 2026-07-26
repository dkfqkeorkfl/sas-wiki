// @vitest-environment node
//
// P2 RED-4 · scripts/wiki/lib/derive.mjs (summary 파생 · excerpt · tree · tags) — tdd §6.4
//
// RED 사유(재작성): 현행 derive 는 구 계약이다 —
//   docs 에 `md`·`html`·`backlinks`·`links`·`footnotes`·`path` 를 싣고(신 계약은 10키),
//   disable 스텁이 `{id,path,title,status}`(신 계약은 breadcrumb), tree 는 루트 래퍼 + `name` 키,
//   tags 는 `{docs:[], feed:[]}`(신 계약은 `Record<tag, docId[]>`), `excerpt` 가 아예 없다.
//
// 계약(GREEN 이 구현할 seam):
//   deriveForTest(parsedDocs, runGit) → { bodies, docs, pathToDoc, resolveTargetPath, tags, tree }
//     docs   : active = 10키 / disable = **4키 스텁**(id·breadcrumb·title·status)
//     bodies : buildBody 입력 — { breadcrumb, status, html, headings, meta, sources } (active 만)
//     tree   : [{ path, docs: id[], children }] — **루트 래퍼 없음**(최상위가 배열)
//     tags   : Record<tag, docId[]> — active 만
//     pathToDoc: **disable 포함**(위키링크 데드링크 방지)
//   breadcrumb 은 **문서 슬러그를 포함**한다(Task 3 의미 반전) — path = breadcrumb.join('/')
import { describe, expect, it } from 'vitest'

import { derive } from '../derive.mjs'

const deriveForTest = (parsedDocs, runGit) => derive(parsedDocs, runGit, { wikiPrefix: 'wiki/' })

// git 생성 해시 — created/updated 파생용(이제 id 출처가 아니다).
const SAMSUNG_SHA = 'aaaaaaaaaaaa000000000000000000000000aaaa'
const HBM_SHA = 'bbbbbbbbbbbb111111111111111111111111bbbb'
const SUB_SHA = 'cccccccccccc222222222222222222222222cccc'
const DIS_SHA = 'dddddddddddd333333333333333333333333dddd'

// frontmatter 에 저작된 UUIDv7 doc id — 이제 derive 가 이 값을 그대로 싣는다(git 해시 아님).
const SAMSUNG_ID = '0192a000-0000-7000-8000-0000000000aa'
const HBM_ID = '0192b000-0000-7000-8000-0000000000bb'
const SUB_ID = '0192c000-0000-7000-8000-0000000000cc'
const DIS_ID = '0192d000-0000-7000-8000-0000000000dd'
const DEFAULT_ID = '0192e000-0000-7000-8000-0000000000ee'

/** `git log --follow --name-status --format=%H%x09%aI` 의 실제 출력(최신순). */
function aLog(sha, { created = '2026-01-01T00:00:00Z', file, updated = '2026-01-09T00:00:00Z' }) {
  return [`${sha}\t${updated}`, '', `M\t${file}`, `${sha}\t${created}`, '', `A\t${file}`].join('\n')
}

function aParsedDoc(patch) {
  const relPath = patch.relPath ?? 'concept/x'
  return {
    body: '## 정의\n\n본문 문단.\n',
    bodyLineOffset: 6,
    breadcrumb: relPath.split('/'), // 신 계약: 문서 슬러그 포함
    filePath: `/tmp/wiki/${relPath}.md`,
    frontmatter: { id: DEFAULT_ID, status: 'active', tags: [], title: relPath.split('/').at(-1), type: 'concept' }, // prettier-ignore
    relPath,
    ...patch,
  }
}

/** 파일별(마지막 arg) 로그를 돌려주는 stub 러너. 경로는 부분일치로 찾는다(vault 접두사 주입에 무관). */
function makeRunner(logByRelPath) {
  return (args) => {
    const file = String(args.at(-1))
    for (const [rel, log] of Object.entries(logByRelPath)) {
      if (file.includes(`${rel}.md`)) return log
    }
    return ''
  }
}

const WORLD = [
  aParsedDoc({
    body: '## 개요\n\n삼성전자는 **메모리**와 [[HBM#시장 구조|고대역폭]] 반도체를 다룬다[^1].\n\n## 사업 부문\n\nDS 와 DX 로 나뉜다.\n\n[^1]: 사업보고서\n',
    frontmatter: {
      aliases: ['Samsung'],
      id: SAMSUNG_ID,
      meta: { ticker: '005930' },
      status: 'active',
      tags: ['반도체'],
      title: '삼성전자',
      type: 'company',
    },
    relPath: 'company/삼성전자',
  }),
  aParsedDoc({
    body: '## 정의\n\nHBM 은 적층 메모리다.\n',
    frontmatter: { id: HBM_ID, status: 'active', tags: ['메모리'], title: 'HBM', type: 'concept' },
    relPath: 'tech/HBM',
  }),
  aParsedDoc({
    body: '## 개요\n\n자회사 문서.\n',
    frontmatter: { id: SUB_ID, status: 'active', tags: ['반도체'], title: '세메스', type: 'company' }, // prettier-ignore
    relPath: 'company/자회사/세메스',
  }),
  aParsedDoc({
    body: '## 메모\n\n폐기 예정.\n',
    frontmatter: {
      id: DIS_ID,
      status: 'disable',
      tags: ['임시'],
      title: '폐문서',
      type: 'concept',
    },
    relPath: 'legacy/폐문서',
  }),
]

const WORLD_RUNNER = makeRunner({
  'company/삼성전자': aLog(SAMSUNG_SHA, { file: 'wiki/company/삼성전자.md' }),
  'company/자회사/세메스': aLog(SUB_SHA, { file: 'wiki/company/자회사/세메스.md' }),
  'legacy/폐문서': aLog(DIS_SHA, { file: 'wiki/legacy/폐문서.md' }),
  'tech/HBM': aLog(HBM_SHA, { file: 'wiki/tech/HBM.md' }),
})

function docOf(docs, relPath) {
  return docs.find((doc) => doc.breadcrumb.join('/') === relPath)
}

/** 본문 하나짜리 문서를 파생해 excerpt 만 뽑는다. */
function excerptOf(body) {
  const { docs } = deriveForTest(
    [aParsedDoc({ body, relPath: 'tech/HBM' })],
    makeRunner({ 'tech/HBM': aLog(HBM_SHA, { file: 'wiki/tech/HBM.md' }) }),
  )
  return docs[0].excerpt
}

describe('derive — summary docs 필드 집합', () => {
  it('active doc 은 정확히 10키다(md·html·backlinks·links·footnotes·path 부재)', () => {
    const { docs } = deriveForTest(WORLD, WORLD_RUNNER)

    expect(Object.keys(docOf(docs, 'company/삼성전자')).toSorted()).toEqual([
      'aliases',
      'breadcrumb',
      'created',
      'excerpt',
      'id',
      'status',
      'tags',
      'title',
      'type',
      'updated',
    ])
  })

  it('disable 은 4키 스텁이다(path 문자열 필드 없음 — breadcrumb 만)', () => {
    const { docs } = deriveForTest(WORLD, WORLD_RUNNER)

    expect(Object.keys(docOf(docs, 'legacy/폐문서')).toSorted()).toEqual([
      'breadcrumb',
      'id',
      'status',
      'title',
    ])
  })

  it('id 는 frontmatter UUIDv7 이고 created/updated 는 git 에서 파생된다', () => {
    const { docs } = deriveForTest(WORLD, WORLD_RUNNER)
    const samsung = docOf(docs, 'company/삼성전자')

    expect(samsung.id).toBe(SAMSUNG_ID)
    expect(samsung.created).toBe('2026-01-01T00:00:00Z')
    expect(samsung.updated).toBe('2026-01-09T00:00:00Z')
  })

  it('bodies 는 active 문서의 본문 레코드다(buildBody 입력 · disable 부재)', () => {
    const { bodies } = deriveForTest(WORLD, WORLD_RUNNER)
    const samsung = bodies.find((body) => body.breadcrumb.join('/') === 'company/삼성전자')

    expect(Object.keys(samsung).toSorted()).toEqual([
      'breadcrumb',
      'headings',
      'html',
      'meta',
      'sources',
      'status',
    ])
    expect(samsung.meta).toEqual({ ticker: '005930' }) // 인포박스는 body 소관(§0.2 C3)
    expect(samsung.headings.map((heading) => heading.anchor)).toEqual(['개요', '사업-부문'])
    expect(bodies.some((body) => body.breadcrumb.join('/') === 'legacy/폐문서')).toBe(false)
  })
})

describe('derive — tree (루트 래퍼 없음 · path 누적 경로 · 문서는 id)', () => {
  it('최상위가 배열이고 노드는 { path, docs: id[], children } 이다', () => {
    const { tree } = deriveForTest(WORLD, WORLD_RUNNER)
    const company = tree.find((node) => node.path === 'company')

    expect(Object.keys(company).toSorted()).toEqual(['children', 'docs', 'path'])
    expect(company.docs).toEqual([SAMSUNG_ID]) // 문자열 id 배열
    expect(company.children[0].path).toBe('company/자회사') // 누적 경로
    expect(company.children[0].docs).toEqual([SUB_ID])
  })

  it('disable 만 있는 폴더는 노드 자체가 생기지 않는다', () => {
    // 2번째 케이스: disable 을 걸러내되 **빈 노드를 남기면** 사이드바에 빈 행이 생긴다.
    const { tree } = deriveForTest(WORLD, WORLD_RUNNER)

    expect(tree.map((node) => node.path).toSorted()).toEqual(['company', 'tech'])
  })
})

describe('derive — tags (Record<tag, docId[]>)', () => {
  it('active 문서만 역색인하고 feed 배열은 없다', () => {
    const { tags } = deriveForTest(WORLD, WORLD_RUNNER)

    expect(tags['반도체'].toSorted()).toEqual([SAMSUNG_ID, SUB_ID].toSorted())
    expect(tags['메모리']).toEqual([HBM_ID])
    expect('임시' in tags).toBe(false) // disable 문서의 태그는 키가 생기지 않는다
  })

  it('__proto__·constructor 태그도 실제 키로 직렬화한다(JSON payload 계약)', () => {
    const relPath = 'tech/prototype-safe'
    const { tags } = deriveForTest(
      [
        aParsedDoc({
          frontmatter: {
            id: HBM_ID,
            status: 'active',
            tags: ['__proto__', 'constructor'],
            title: '프로토타입 안전 문서',
            type: 'concept',
          },
          relPath,
        }),
      ],
      makeRunner({ [relPath]: aLog(HBM_SHA, { file: `wiki/${relPath}.md` }) }),
    )

    // eslint-disable-next-line unicorn/prefer-structured-clone -- JSON 직렬화 경계에서 배송되는 키를 검증한다.
    const payloadTags = JSON.parse(JSON.stringify(tags))

    expect(payloadTags.__proto__).toEqual([HBM_ID])
    expect(payloadTags.constructor).toEqual([HBM_ID])
  })
})

describe('derive — excerpt (본문 첫 문단 평문 160자)', () => {
  it('heading 을 건너뛰고 첫 문단을 취한다', () => {
    expect(excerptOf('## 정의\n\nHBM 은 적층 메모리다.\n\n## 로드맵\n\nHBM4 로 이어진다.\n')).toBe(
      'HBM 은 적층 메모리다.',
    )
  })

  it('마크다운 마커·위키링크·각주 마커를 스트립한다(불릿 블록)', () => {
    expect(excerptOf('## 기업\n\n- [[삼성전자]]\n- [[SK하이닉스]]\n- [[TSMC]]\n')).toBe(
      '삼성전자 SK하이닉스 TSMC',
    )
    expect(
      excerptOf('## 개요\n\n**메모리**와 [[HBM#시장 구조|고대역폭]] 반도체를 다룬다[^1].\n'),
    ).toBe('메모리와 고대역폭 반도체를 다룬다.')
  })

  it('160자를 초과하면 앞에서 160자로 자른다(말줄임표 없음)', () => {
    const excerpt = excerptOf(`## 정의\n\n${'가'.repeat(200)}\n`)

    expect(excerpt).toHaveLength(160)
    expect(excerpt).toBe('가'.repeat(160))
  })

  it('HTML 이 아니다(`<`·`&` 를 이스케이프하지 않는다)', () => {
    // 2번째 케이스: html 에서 잘라오는 구현이면 `&lt;` 가 새어나온다.
    // excerpt 는 텍스트 노드로 렌더된다(dangerouslySetInnerHTML 제거가 목적의 절반).
    expect(excerptOf('## 정의\n\nA < B & C 관계다.\n')).toBe('A < B & C 관계다.')
  })
})

describe('derive — 무결성 가드', () => {
  it('disable 문서도 pathToDoc 에는 남는다(위키링크 데드링크 방지)', () => {
    const { pathToDoc } = deriveForTest(WORLD, WORLD_RUNNER)

    expect(pathToDoc.has('legacy/폐문서')).toBe(true)
  })

  it('중복 id(한 커밋이 문서 2개 생성)는 throw 한다 — 불변식 8 의 최후 방어선', () => {
    const twins = [
      aParsedDoc({ relPath: 'concept/쌍둥이-A' }),
      aParsedDoc({ relPath: 'concept/쌍둥이-B' }),
    ]
    const sameSha = makeRunner({
      'concept/쌍둥이-A': aLog(SAMSUNG_SHA, { file: 'wiki/concept/쌍둥이-A.md' }),
      'concept/쌍둥이-B': aLog(SAMSUNG_SHA, { file: 'wiki/concept/쌍둥이-B.md' }),
    })

    expect(() => deriveForTest(twins, sameSha)).toThrow(/쌍둥이-A|쌍둥이-B|중복/)
  })

  it('미커밋 문서(빈 로그)는 명시적으로 실패한다', () => {
    expect(() => deriveForTest([aParsedDoc({ relPath: 'concept/new' })], () => '')).toThrow()
  })
})
