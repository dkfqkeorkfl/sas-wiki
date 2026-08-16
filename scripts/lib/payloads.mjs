// 3 페이로드 조립 — **wire 경계**다.
//
// 투영(projection)이 여기 있는 이유: 파생 단계의 레코드에 본문(html·md)이 섞여 들어와도 부팅
// 페이로드(summary)에는 계약 키만 실린다. 투영이 없으면 "부팅에서 본문을 뺀다"는 이 phase 의
// 목적이 조용히 무너진다(스키마가 잡아주긴 하지만, 그건 사후 검출이다).

/**
 * 계약 버전(정수) — 발행 아티팩트와 wire 페이로드 전체를 덮는 공용 상수다.
 *
 * v3 P1 은 내부 R&D 단계의 계약 재구성이며, 소비자는 gitlink 원자 착륙으로 업데이트를 강제할 수 있다.
 * `cache/`·`logs/` 산출물은 배포되지 않고 빌드 1회로 재생성되며, 옛 산출물은 `env` 부재나 버전 불일치로
 * 읽기 경로에서 거부된다. 실배포·외부 소비자가 생기면 버전 정책을 다시 연다(D30).
 */
export const SCHEMA_VERSION = 1

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
  // ★ `Object.create(null)` 방어 심층화(defense-in-depth) — `record.breadcrumb.join('/')` 가
  //   문자열 `"__proto__"` 를 낳으면 일반 `{}` 리터럴에서는 `projected["__proto__"] = value` 가
  //   own 프로퍼티가 아니라 **프로토타입 세터**를 타 `projected` 자신의 프로토타입을 바꾼다(재현됨).
  //   다운스트림 산출물 검증기는 `Object.hasOwn`/`Object.keys` 기반이라 이미 그 상태에 속지 않지만
  //   (own-key 만 본다), 오염 가능한 대입 지점 자체를 없애 그 안전망에만 기대지 않는다.
  //   `Object.create(null)` 은 `__proto__` 를 포함해 모든 키를 순수 own 데이터 프로퍼티로만 받는다.
  const projected = Object.create(null)
  for (const record of docs) {
    if (record.status === 'disable') continue
    projected[record.breadcrumb.join('/')] = pick(record, BODY_DOC_KEYS)
  }
  return { docs: projected, schemaVersion: SCHEMA_VERSION, sourceCommit }
}

/**
 * feeds 봉투 — **wire 응답과 `cache/feeds.<env>.json` 아티팩트가 같은 함수를 쓴다**(층 ②).
 *
 * ★ v3 P2 · U2 통합 — 예전에는 `buildFeedsArtifact`(내부 아티팩트)가 **별도 함수**였고 그 분리
 * 근거(FA3b)는 둘이었다:
 *   ① wire 는 `env` 를 싣지 않는다 → **소멸(D22)**. `SCHEMA_VERSION` 동결로 표지 대조의 구분력이
 *      "1 vs 1" 이 되면서 `env` 가 캐시 최소 검증의 **유일한 판별축**이 됐고, 그래서 wire 에도 남긴다.
 *   ② 아티팩트는 **억제 전 전량**을 담는다 → **소멸(D20)**. 억제 배선이 `--ignore` 한 곳으로 모이면서
 *      캐시 빌드도 억제를 적용한다 — 아티팩트가 억제 **후**가 되면 "raw 서빙하면 억제가 무효" 라는
 *      비대칭 자체가 사라진다.
 * 근거 둘이 모두 사라진 함수 분리는 「합치지 않은 이유」를 설명할 수 없다 → 하나로 합쳤다.
 * 스키마도 같은 이유로 `feeds-artifact.schema.json` 이 폐지되고 `feeds.schema.json` 으로 단일화됐다.
 *
 * ★ **`nextCursor` 는 여기 없다** — 호출부가 얹는다(층 ①·③ 은 6키, 이 층은 5키). 커서는 「무엇을
 * 담았는가」가 아니라 「어디서 이어받는가」라 봉투 조립이 아니라 **페이지 계산**의 산출이다.
 *
 * 담기는 항목은 **이미 걸러진** 것뿐이다(자르는 것은 호출부다 — 여기서 자르면 필터가 조용히 틀어진다).
 */
export function buildFeeds({ env, generatedAt, items, sourceCommit }) {
  return { env, generatedAt, items, schemaVersion: SCHEMA_VERSION, sourceCommit }
}

/**
 * `wiki_summary.json` — 화면 뼈대인 summary 발행 아티팩트.
 *
 * `generatedAt` 은 **주입**받는다 — 여기서 시계를 직접 읽으면 재빌드가 흔들린다(결정성 seam).
 *
 * 발행 환경(`env`)을 **여기서** 붙이는 이유: 생성기 쪽에서만 붙이면 이 함수는 6키를
 * 내는데 실제로 서빙되는 파일은 7키가 되어 **형태가 둘**이 된다. 그러면 이 함수를 계약 기준으로
 * 쓰는 소비자 테스트가 실제 계약과 다른 모양을 단언하게 된다. 파일 = stdout = 응답이 같은 7키다.
 *
 * `buildBody` 는 `env` 를 스탬프하지 **않는다** — 본문은 발행 아티팩트가 아니라 파생 페이로드다.
 * `buildFeeds` 는 v3 P2(D22)에서 `env` 를 얻었다 — 캐시 최소 검증의 유일한 판별축이기 때문이다.
 */
export function buildSummary({ docs, env, generatedAt, sourceCommit, tags, tree }) {
  return {
    docs: docs.map((doc) =>
      pick(doc, doc.status === 'disable' ? DISABLE_STUB_KEYS : ACTIVE_DOC_KEYS),
    ),
    env,
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
