// 3 페이로드 조립 — **wire 경계**다.
//
// 투영(projection)이 여기 있는 이유: 파생 단계의 레코드에 본문(html·md)이 섞여 들어와도 부팅
// 페이로드(summary)에는 계약 키만 실린다. 투영이 없으면 "부팅에서 본문을 뺀다"는 이 phase 의
// 목적이 조용히 무너진다(스키마가 잡아주긴 하지만, 그건 사후 검출이다).

/**
 * 계약 버전(정수) — **발행물 3종(summary·feeds·report) + wire 3 페이로드(summary·feeds·body) 전체를
 * 덮는 공용 상수**다.
 *
 * 페이로드별로 쪼개면 소비자의 세대 동등성 검사가 영원히 false 가 되어 부팅 게이트가 통째로 막힌다
 * (화면이 죽는데 테스트는 전부 green 인 상태가 만들어진다). 그래서 하나를 올린다.
 *
 * 1 → 2: summary 아티팩트 봉투에 발행 헤더(`producer`·`env`)가 들어왔다.
 * 2 → 3(P5): wire `feeds.schema.json` 이 `inputsFingerprint` 를 required 로 얻었고(D-G), 내부
 * `cache/feeds.<env>.json` 아티팩트와 리포트도 이 상수를 공유하는 발행물로 편입됐다(D-C·D-D).
 * 옛 파일은 "미지 버전" 이 아니라 **구 버전**이므로 독자가 stale 로 떨어뜨려 재생성한다 —
 * 마이그레이션은 없다(파생 데이터다).
 */
export const SCHEMA_VERSION = 3

/**
 * 발행 아티팩트의 발행자 표지 — 이 값이 없으면 그 경로의 **아무 JSON 이나** 아티팩트가 된다.
 *
 * 상수가 `artifact.mjs` 가 아니라 여기 있는 이유: `producer` 는 경로가 아니라 **페이로드 정체성**이고,
 * 한 곳에 둬야 `artifact → payloads` 단방향이 유지되어 순환이 생기지 않는다.
 */
export const ARTIFACT_PRODUCER = 'sas-wiki/summary'

/**
 * 내부 feeds 아티팩트(`cache/feeds.<env>.json`)의 발행자 표지 — `ARTIFACT_PRODUCER`(summary)와
 * **다른 문자열**이어야 두 발행물이 서로를 자기 것으로 오인하지 않는다(D-C).
 */
export const FEEDS_ARTIFACT_PRODUCER = 'sas-wiki/feeds'

/**
 * 리포트(`logs/summary.report.<env>.json`)의 발행자 표지 — 리포트는 wire 가 아니라 관측 채널이지만
 * `readArtifact` 를 태우려면(F-27) 다른 발행물과 같은 신원 계약(`producer`·`schemaVersion`·`env`·
 * `inputsFingerprint`)을 져야 한다(D-D).
 */
export const REPORT_PRODUCER = 'sas-wiki/report'

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

/**
 * `wiki_feeds.json`(wire) — **서빙 시점에 이미 걸러진** 항목만 담는다(자르는 것은 API 다. 파일을
 * 자르면 필터가 조용히 틀어진다).
 *
 * `inputsFingerprint` 는 D-G(생산자가 자기 출력을 스탬프한다)의 소비자 측 절반이다 — **발행
 * 스탬프가 아니라 상관(correlation) 토큰**이다: summary 응답과 같은 세대인지 소비자가 대조하는
 * 값이지, "이 파일이 무엇인가"를 말하는 `producer`류 표지가 아니다. 그 구분 때문에 `buildFeeds`
 * 는 `producer`를 싣지 않는다(그 비대칭은 `buildSummary` 헤더 주석과 동형이지만 반대 방향이다).
 */
export function buildFeeds({ generatedAt, inputsFingerprint, items, sourceCommit }) {
  return { generatedAt, inputsFingerprint, items, schemaVersion: SCHEMA_VERSION, sourceCommit }
}

/**
 * 내부 발행 아티팩트 `cache/feeds.<env>.json` — **억제 전 전량**을 담는다. `buildFeeds`(wire)와는
 * **다른 함수**다(FA3b) — 합치면 억제 전 항목이 wire 로 새어 나간다(R2 가 기각한 부정 정보 적재로
 * 되돌아간다). 이 파일은 raw 로 서빙되지 않는다(CS8·HV5 가 가드).
 *
 * ★ 왜 wire 가 아니라 별도 파일인가(R4-3): vault 가 public 이라 "기밀 결속"은 근거가 아니다. 진짜
 * 이유는 ① wire `feeds.schema.json` 이 정확히 5키 `additionalProperties:false` 이고 ② 이 파일은
 * 억제 전 항목을 담으므로 raw 서빙되면 억제가 통째로 무효가 된다는 것이다.
 */
export function buildFeedsArtifact({ env, generatedAt, inputsFingerprint, items, sourceCommit }) {
  return {
    env,
    generatedAt,
    inputsFingerprint,
    items,
    producer: FEEDS_ARTIFACT_PRODUCER,
    schemaVersion: SCHEMA_VERSION,
    sourceCommit,
  }
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
 * `buildFeeds`(wire)·`buildBody` 는 `producer`·`env` 를 스탬프하지 **않는다** — 이 둘은 발행
 * 아티팩트가 아니라 서빙 응답/파생 페이로드다. 스탬프는 "이 파일이 무엇이며 어느 env 의 것인가"
 * 를 말하는 **발행** 계약이지 페이로드 장식이 아니다. P5 부터 발행 아티팩트가 summary 하나가
 * 아니라 **둘**(summary·`buildFeedsArtifact`)이 됐지만, 그 스탬프는 각자의 **내부** 아티팩트
 * 조립 함수가 진다 — wire 페이로드(`buildFeeds`·`buildBody`)의 비대칭은 그대로다.
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
