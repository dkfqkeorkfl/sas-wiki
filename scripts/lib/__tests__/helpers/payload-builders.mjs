// 3 페이로드 Test Data Builder — payloads·invariants·schema 테스트 공용 (tdd §4).
//
// DAMP 경계: 이 파일은 **정상(green) 픽스처만** 만든다. `expect` 를 넣지 않는다.
//   위반은 스펙 본문에서 **딱 한 곳만** 망가뜨린다 → 무엇이 틀렸는지가 테스트 본문에 보인다.
//   (vitest include 패턴 `scripts/wiki/**/*.{test,spec}.{mjs,ts}` 에 안 걸린다 — 의도.)
//
// 세계관(aWorld): active 2 · disable 1 · 피드 2(하나는 disable 문서를 가리킨다).
//   이 조합은 **불변식 8종을 전부 통과**한다 — 정상적인 disable 운영이 빌드를 죽이면 계약이 틀린 것이다.

/** disable 문서 D — concept/온디바이스-AI (4키 스텁) */
export const DOC_D = { id: 'dddddddddddd', path: 'concept/온디바이스-AI' }

/** active 문서 A — company/삼성전자 */
export const DOC_A = { id: 'aaaaaaaaaaaa', path: 'company/삼성전자' }

/** active 문서 B — tech/HBM */
export const DOC_B = { id: 'bbbbbbbbbbbb', path: 'tech/HBM' }

export const GENERATED_AT = '2023-11-14T22:13:20.000Z'

/** 어디에도 없는 문서 id — 불변식 1·3·4 의 위반 주입용 */
export const GHOST_ID = 'ffffffffffff'

/** 3 페이로드 공통 sourceCommit(40 hex) — 불변식 7 의 기준값. */
export const SOURCE_COMMIT = '9e0a3a0c8072f436503c5065ca4b4b863cd434fb'

const DEFAULT_BODY_DOC = {
  headings: [{ anchor: 'hbm-사업', level: 2, text: 'HBM 사업' }],
  html: '<h2 id="hbm-사업">HBM 사업</h2>',
  meta: {},
  sources: [],
}

const DEFAULT_DOC = {
  aliases: [],
  breadcrumb: ['company', '삼성전자'],
  created: '2026-01-03T00:00:00Z',
  excerpt: '메모리·파운드리·완제품을 아우르는 종합 반도체 기업.',
  id: DOC_A.id,
  status: 'active',
  tags: ['반도체'],
  title: '삼성전자',
  type: 'company',
  updated: '2026-01-06T00:00:00Z',
}

const DEFAULT_FEED_ITEM = {
  body: '2026년 하반기 양산 목표를 제시했다.',
  // anchorText = 그 앵커를 가진 heading 의 **원문**(DEFAULT_BODY_DOC 의 'HBM 사업') — 슬러그가 아니다.
  docs: [{ anchor: 'hbm-사업', anchorText: 'HBM 사업', id: DOC_A.id }],
  id: 'f1f1f1f1f1f1',
  importance: 'breaking',
  keywords: ['실적'],
  title: '삼성전자 HBM4 양산 로드맵 공개',
  ts: '2026-01-06T00:00:00Z',
}

const DEFAULT_STUB = {
  breadcrumb: ['concept', '온디바이스-AI'],
  id: DOC_D.id,
  status: 'disable',
  title: '온디바이스 AI',
}

/** wiki_body.json 봉투 — generatedAt 이 **없다**(§5.3). */
export function aBody() {
  return builder(
    { docs: {}, schemaVersion: 1, sourceCommit: SOURCE_COMMIT },
    {
      withDoc: (value, docPath, bodyDoc) => ({
        ...value,
        docs: { ...value.docs, [docPath]: unwrap(bodyDoc) },
      }),
    },
  )
}

/** body.docs[path] 값 — { html, headings, meta, sources } 4키. */
export function aBodyDoc() {
  return builder(DEFAULT_BODY_DOC)
}

/** disable 스텁 — 4키(id·breadcrumb·title·status). */
export function aDisableStub() {
  return builder(DEFAULT_STUB)
}

/** active summary doc — 10키. */
export function aDoc() {
  return builder(DEFAULT_DOC)
}

/** FeedItem — 정확히 7키. `.refs([{id, anchor, anchorText}])` 로 문서 참조를 갈아끼운다. */
export function aFeedItem() {
  return builder(DEFAULT_FEED_ITEM, { refs: (value, docs) => ({ ...value, docs }) })
}

/** wiki_feeds.json 봉투. */
export function aFeeds() {
  return builder(
    { generatedAt: GENERATED_AT, items: [], schemaVersion: 1, sourceCommit: SOURCE_COMMIT },
    { withItem: (value, item) => ({ ...value, items: [...value.items, unwrap(item)] }) },
  )
}

/** wiki_summary.json 봉투. */
export function aSummary() {
  return builder(
    {
      docs: [],
      generatedAt: GENERATED_AT,
      schemaVersion: 1,
      sourceCommit: SOURCE_COMMIT,
      tags: {},
      tree: [],
    },
    {
      withDoc: (value, doc) => ({ ...value, docs: [...value.docs, unwrap(doc)] }),
      withTags: (value, tags) => ({ ...value, tags }),
      withTree: (value, tree) => ({ ...value, tree }),
    },
  )
}

/**
 * 불변식 8종을 **전부 통과**하는 정상 3 페이로드.
 *
 * 위반 픽스처는 이 결과를 받아 **한 곳만** 망가뜨린다(매 호출 새 객체 — 구조적 공유 없음).
 */
export function aWorld() {
  const summary = aSummary()
    .withDoc(aDoc())
    .withDoc(
      aDoc().with({
        breadcrumb: ['tech', 'HBM'],
        id: DOC_B.id,
        tags: ['메모리'],
        title: 'HBM',
        type: 'concept',
      }),
    )
    .withDoc(aDisableStub())
    .withTree([
      { children: [], docs: [DOC_A.id], path: 'company' },
      { children: [], docs: [DOC_B.id], path: 'tech' },
    ])
    .withTags({ 메모리: [DOC_B.id], 반도체: [DOC_A.id] })
    .build()

  const feeds = aFeeds()
    .withItem(aFeedItem())
    .withItem(
      // disable 문서를 가리키는 피드 — **정상**이다(불변식 1 이 disable 을 포함한다).
      // anchor 는 null 로 강등돼 있다(body·headings 가 없으므로 — 불변식 6). 라벨(anchorText)도 함께 null 이다.
      aFeedItem().with({
        docs: [{ anchor: null, anchorText: null, id: DOC_D.id }],
        id: 'f2f2f2f2f2f2',
        title: '온디바이스 AI, 스마트폰 탑재 확대',
        ts: '2026-01-05T00:00:00Z',
      }),
    )
    .build()

  const body = aBody()
    .withDoc(DOC_A.path, aBodyDoc())
    .withDoc(
      DOC_B.path,
      aBodyDoc().with({
        headings: [{ anchor: '공급망', level: 2, text: '공급망' }],
        html: '<h2 id="공급망">공급망</h2>',
      }),
    )
    .build()

  return { body, feeds, summary }
}

function builder(value, extras = {}) {
  const api = {
    build: () => structuredClone(value),
    with: (patch) => builder({ ...value, ...patch }, extras),
  }
  for (const [name, fn] of Object.entries(extras)) {
    api[name] = (...args) => builder(fn(value, ...args), extras)
  }
  return api
}

function unwrap(candidate) {
  return typeof candidate?.build === 'function' ? candidate.build() : structuredClone(candidate)
}
