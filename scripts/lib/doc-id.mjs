// 문서 id 의 형식·위치·유효성 판단과 중복 검사. 서빙 경로까지 import 하는 모듈이라 외부 패키지를
// 쓰지 않는다 — 새 id 발급은 `new-doc-id.mjs` 에 있다.

/**
 * 문서 id 형식(UUIDv7, 소문자) — 코드 쪽 단일 출처.
 *
 * `scripts/schema/*.schema.json` 의 doc-id `pattern` 은 JSON 이라 이 상수를 import 할 수 없어 같은
 * 문자열을 따로 적는다. 두 곳이 어긋나지 않도록 `schema.docid-format.test.mjs` 가 문자열 일치를
 * 강제한다.
 */
export const DOC_ID_PATTERN =
  '^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'

const DOC_ID_RE = new RegExp(DOC_ID_PATTERN, 'u')

/**
 * frontmatter 최상위 `id` 줄. 캡처 그룹 1 이 콜론 뒤 원시 값이다.
 *
 * `parseFrontmatterYaml` 이 키로 읽는 줄과 같은 줄을 잡는다. 그 파서는 최상위 키를 들여쓰기 0 으로
 * 강제하고 키·값을 `String#trim` 으로 다듬는데, JS 의 `\s` 가 바로 trim 이 지우는 공백·줄 구분자
 * 집합이다. 그래서 콜론 앞의 NBSP·전각 공백이나 값 끝의 U+2028 도 같은 `id` 로 읽는다.
 */
export const DOC_ID_FIELD = /^id\s*:([\s\S]*)$/u

/** 값이 문서 id 형식인가. 형식만 본다 — 다른 문서와의 중복 여부는 판단하지 않는다. */
export function isDocId(value) {
  return typeof value === 'string' && DOC_ID_RE.test(value)
}

/**
 * 문서 id 의 유효성 판단 — [전, 후] 두 값으로 네 가지 중 하나를 낸다.
 *
 * - 후 = 지금 id, 전 = id 줄이 마지막으로 바뀌기 바로 전 값(`readFrontmatterFieldChange`).
 * - 전이 유효한 id 가 아니면(없음·빈 값·형식 불량) 지금 값이 처음 등록된 id 다.
 *
 * | 판단 | 조건 |
 * |---|---|
 * | `ok` | 후가 UUIDv7 이고, 전이 유효하지 않거나 후와 같다 |
 * | `unregistered` | 후가 비었거나 UUIDv7 이 아니고, 전도 유효하지 않다 |
 * | `damaged` | 후가 비었거나 UUIDv7 이 아닌데, 전은 유효했다 |
 * | `changed` | 전·후 모두 UUIDv7 인데 다르다 |
 *
 * @param {[unknown, unknown]} change [전, 후]
 * @returns {'ok' | 'unregistered' | 'damaged' | 'changed'}
 */
export function judgeDocId([before, after]) {
  const registered = isDocId(before)
  if (!isDocId(after)) return registered ? 'damaged' : 'unregistered'
  return registered && before !== after ? 'changed' : 'ok'
}

/**
 * 두 번 이상 쓰인 id 와 그 항목들. 문자열 id 만 센다 — 형식은 보지 않는다(형식은 `isDocId`).
 *
 * @template T
 * @param {T[]} items
 * @param {(item: T) => unknown} getId
 * @returns {Map<string, T[]>} id → 항목(입력 순서). 처음 나온 순서대로 담는다
 */
export function findDuplicateIds(items, getId) {
  const itemsById = new Map()
  for (const item of items) {
    const id = getId(item)
    if (typeof id !== 'string') continue
    if (!itemsById.has(id)) itemsById.set(id, [])
    itemsById.get(id).push(item)
  }
  return new Map([...itemsById].filter(([, group]) => group.length > 1))
}
