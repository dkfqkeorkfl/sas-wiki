// 3 페이로드 조립 — **wire 경계**다.
//
// 투영(projection)이 여기 있는 이유: 파생 단계의 레코드에 본문(html·md)이 섞여 들어와도 부팅
// 페이로드(summary)에는 계약 키만 실린다. 투영이 없으면 "부팅에서 본문을 뺀다"는 이 phase 의
// 목적이 조용히 무너진다(스키마가 잡아주긴 하지만, 그건 사후 검출이다).

/**
 * 계약 버전(정수) — **3 페이로드 공용**이다.
 *
 * 페이로드별로 쪼개면 소비자의 세대 동등성 검사가 영원히 false 가 되어 부팅 게이트가 통째로 막힌다
 * (화면이 죽는데 테스트는 전부 green 인 상태가 만들어진다). 그래서 하나를 올린다.
 *
 * 1 → 2: summary 아티팩트 봉투에 발행 헤더(`producer`·`env`)가 들어왔다. 옛 파일은 "미지 버전" 이
 * 아니라 **구 버전**이므로 독자가 stale 로 떨어뜨려 재생성한다 — 마이그레이션은 없다(파생 데이터다).
 */
export const SCHEMA_VERSION = 2

/**
 * 발행 아티팩트의 발행자 표지 — 이 값이 없으면 그 경로의 **아무 JSON 이나** 아티팩트가 된다.
 *
 * 상수가 `artifact.mjs` 가 아니라 여기 있는 이유: `producer` 는 경로가 아니라 **페이로드 정체성**이고,
 * 한 곳에 둬야 `artifact → payloads` 단방향이 유지되어 순환이 생기지 않는다.
 */
export const ARTIFACT_PRODUCER = 'sas-wiki/summary'

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

/** `wiki_body.json` — 봉투에 **`generatedAt` 이 없다**(schema/body.schema.json). 키는 active 문서의 path. */
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
 * `wiki_summary.json` — 화면 뼈대이자 **유일한 발행 아티팩트**.
 *
 * `generatedAt` 은 **주입**받는다 — 여기서 시계를 직접 읽으면 재빌드가 흔들린다(결정성 seam).
 *
 * 발행 헤더(`producer`·`env`)를 **여기서** 붙이는 이유: 생성기 쪽에서만 붙이면 이 함수는 7키를
 * 내는데 실제로 서빙되는 파일은 9키가 되어 **형태가 둘**이 된다. 그러면 이 함수를 계약 기준으로
 * 쓰는 소비자 테스트가 실제 계약과 다른 모양을 단언하게 된다. 파일 = stdout = 응답이 같은 9키다.
 *
 * `buildFeeds`·`buildBody` 는 스탬프하지 **않는다** — 발행 아티팩트는 summary 하나뿐이고, 스탬프는
 * "이 파일이 무엇이며 어느 env 의 것인가" 를 말하는 발행 계약이지 페이로드 장식이 아니다.
 * **이 비대칭은 의도다.**
 */
export function buildSummary({
  docs,
  env,
  generatedAt,
  inputsFingerprint,
  sourceCommit,
  tags,
  tree,
}) {
  return {
    docs: docs.map((doc) =>
      pick(doc, doc.status === 'disable' ? DISABLE_STUB_KEYS : ACTIVE_DOC_KEYS),
    ),
    env,
    generatedAt,
    inputsFingerprint,
    producer: ARTIFACT_PRODUCER,
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
