// 단일 문서 투영 — `wiki.mjs` 전용 순수부(D-F). 어떤 모듈도 물지 않고, 아티팩트에서 유도한 경로
//   집합과 disable 스텁을 이용해 요청 시점의 마크다운 원문을 응답 모양으로 투영한다.
//   위키링크 해석과 렌더는 원문을 받는 소비자(클라이언트)가 담당한다.

/**
 * 아티팩트 `docs[]` → 경로 집합 + disable 스텁 맵.
 *
 * 본문은 담지 않는다. active 문서의 본문은 요청 시점에 디스크에서 읽고, disable 문서는 아티팩트
 * 스텁을 그대로 돌려준다.
 *
 * @param {{ breadcrumb: string[], status: string }[]} artifactDocs
 * @returns {{ paths: Set<string>, stubByPath: Map<string, object> }}
 */
export function makeDocIndex(artifactDocs) {
  const paths = new Set()
  const stubByPath = new Map()

  for (const doc of artifactDocs) {
    const relPath = doc.breadcrumb.join('/')
    paths.add(relPath)
    if (doc.status === 'disable') stubByPath.set(relPath, doc)
  }

  return { paths, stubByPath }
}

/**
 * 요청 문서 1건 투영.
 *
 * - ref 가 인덱스에 없다 → `null`
 * - disable 스텁이다 → 아티팩트 스텁을 **그대로** 돌려준다(링크 생존 계약)
 * - active 다 → `readFile(ref)` 로 그 문서 1건만 파싱하고 마크다운 원문을 투영한다
 * - active 인데 `readFile` 이 `null` 이다(머리말 파손) → `null`. 없는 문서와 **같은 실패 형태**다
 *
 * @param {{ feed?: { items: object[], nextCursor: string|null }, index: object,
 *           readFile: (ref: string) => { body: string, frontmatter: object } | null,
 *           ref: string }} input
 * @returns {object | null}
 */
export function projectSingleDoc({
  feed = { items: [], nextCursor: null },
  index,
  readFile,
  ref,
}) {
  const stub = index.stubByPath.get(ref)
  if (stub) return stub
  if (!index.paths.has(ref)) return null

  const parsed = readFile(ref)
  // 인덱스에는 있으나 디스크에서 파싱이 안 되는 문서 — 빌드 이후 머리말이 사라진 경우다
  //   (`parse.mjs:169` 가 머리말 없는 파일에 `null` 을 낸다). 이것은 **게이트 추가가 아니라 크래시
  //   제거**다: 여기서 접지 않으면 `parsed.body` 가 TypeError 로 던져 CLI exit 1 → 라우트 **500** 이
  //   된다. 없는 문서와 **같은 실패 형태**(`null` → 404)로 접는 것이 등가 복원이다.
  if (parsed === null) return null
  const body = parsed.body

  return {
    feed,
    md: body,
    meta: parsed.frontmatter.meta || {},
    path: ref,
    status: parsed.frontmatter.status,
  }
}
