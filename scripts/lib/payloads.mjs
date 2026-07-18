// 3 페이로드 조립 — **wire 경계**다.
//
// 투영(projection)이 여기 있는 이유: 파생 단계의 레코드에 본문(html·md)이 섞여 들어와도 부팅
// 페이로드(summary)에는 계약 키만 실린다. 투영이 없으면 "부팅에서 본문을 뺀다"는 이 phase 의
// 목적이 조용히 무너진다(스키마가 잡아주긴 하지만, 그건 사후 검출이다).

/** 계약 버전(정수, 페이로드별 독립). 파괴적 교체에만 +1 — 필드 추가로는 올리지 않는다. */
const SCHEMA_VERSION = 1

/** summary active doc — 10키. */
const ACTIVE_DOC_KEYS = [
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
]

/** body.docs[path] — 4키. `md`·`links`·`footnotes`·`excerpt` 는 계약에 없다. */
const BODY_DOC_KEYS = ['headings', 'html', 'meta', 'sources']

/** disable 스텁 — 4키. 링크를 살려두는 최소 정보만. */
const DISABLE_STUB_KEYS = ['breadcrumb', 'id', 'status', 'title']

/** `wiki_body.json` — 봉투에 **`generatedAt` 이 없다**(data-contract §4). 키는 active 문서의 path. */
export function buildBody({ docs, sourceCommit }) {
  const projected = {}
  for (const record of docs) {
    if (record.status === 'disable') continue
    projected[record.breadcrumb.join('/')] = pick(record, BODY_DOC_KEYS)
  }
  return { docs: projected, schemaVersion: SCHEMA_VERSION, sourceCommit }
}

/** `wiki_feeds.json` — **전량**을 담는다(자르는 것은 API 다. 파일을 자르면 필터가 조용히 틀어진다). */
export function buildFeeds({ generatedAt, items, sourceCommit }) {
  return { generatedAt, items, schemaVersion: SCHEMA_VERSION, sourceCommit }
}

/**
 * `wiki_summary.json` — 화면 뼈대.
 *
 * `generatedAt` 은 **주입**받는다 — 여기서 시계를 직접 읽으면 재빌드가 흔들린다(결정성 seam).
 */
export function buildSummary({ docs, generatedAt, sourceCommit, tags, tree }) {
  return {
    docs: docs.map((doc) =>
      pick(doc, doc.status === 'disable' ? DISABLE_STUB_KEYS : ACTIVE_DOC_KEYS),
    ),
    generatedAt,
    schemaVersion: SCHEMA_VERSION,
    sourceCommit,
    tags,
    tree,
  }
}

/** 계약 키만 남긴다. 키 순서는 상수 배열이 정한다 → JSON 직렬화가 결정적이다. */
function pick(source, keys) {
  const out = {}
  for (const key of keys) {
    if (source[key] !== undefined) out[key] = source[key]
  }
  return out
}
