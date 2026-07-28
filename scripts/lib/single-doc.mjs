// 단일 문서 투영 — `wiki.mjs` 전용 순수부(D-F). 아티팩트 `docs[].breadcrumb` 에서 유도한 **경로 집합 +
//   basename 인덱스**만으로 위키링크를 해석한다(B9 — `checkAnchorExists` 처럼 값이 필요한 것은
//   `validate.mjs` 전용 경로이고, 서빙은 존재 여부만 있으면 된다).
//
// ★ 이 파일은 `derive.mjs`·`git-walk.mjs` 를 **정적으로 물지 않는다**(WK8) — 전 문서 파생·커밋 워크를
//   타지 않는다는 구조 증명이다. `render.mjs` 는 **문다**(정상 — `wiki` 는 렌더가 실제로 필요하다).
import { extractFootnoteDefs, extractHeadings, parseMarkdownFile } from './parse.mjs'
import { renderMarkdownToHtml } from './render.mjs'

/**
 * 아티팩트 `docs[]` → 경로 집합 + basename 인덱스 + disable 스텁 맵.
 *
 * 값(본문·id 등)은 담지 않는다 — 위키링크 해석은 "그 경로가 존재하는가" 만 있으면 되고(B9), 값이
 * 필요한 검증(`checkAnchorExists`)은 이 경로를 타지 않는다.
 *
 * @param {{ breadcrumb: string[], status: string }[]} artifactDocs
 * @returns {{ basenames: Map<string, string[]>, paths: Set<string>, stubByPath: Map<string, object> }}
 */
export function makeDocIndex(artifactDocs) {
  const paths = new Set()
  const basenames = new Map()
  const stubByPath = new Map()

  for (const doc of artifactDocs) {
    const relPath = doc.breadcrumb.join('/')
    paths.add(relPath)
    const base = doc.breadcrumb.at(-1)
    if (!basenames.has(base)) basenames.set(base, [])
    basenames.get(base).push(relPath)
    if (doc.status === 'disable') stubByPath.set(relPath, doc)
  }

  return { basenames, paths, stubByPath }
}

/** 정확 경로 우선, 없으면 basename 유일할 때만 해석(동명 2건 이상은 모호 → null). */
function resolveTarget(index, targetRaw) {
  if (index.paths.has(targetRaw)) return targetRaw
  const candidates = index.basenames.get(targetRaw) ?? []
  return candidates.length === 1 ? candidates[0] : null
}

/**
 * 위키링크 해석기 — `derive.mjs` 의 `makeWikilinkResolver` 계약과 **동치**다: 대상 생략은 자기 문서로,
 * 미해결·동명충돌은 `exists:false`(데드 class)로 돌려준다.
 */
function makeResolver(index, selfPath) {
  return (target, _anchor) => {
    const targetRaw = (target || '').trim()
    if (targetRaw === '') return { exists: index.paths.has(selfPath), path: selfPath }
    const resolved = resolveTarget(index, targetRaw)
    if (!resolved) return { exists: false, path: targetRaw }
    return { exists: index.paths.has(resolved), path: resolved }
  }
}

/**
 * 요청 문서 1건 투영.
 *
 * - ref 가 인덱스에 없다 → `null`
 * - disable 스텁이다 → 아티팩트 스텁을 **그대로** 돌려준다(링크 생존 계약)
 * - active 다 → `readFile(ref)` 로 그 문서 1건만 파싱하고 렌더한다
 *
 * @param {{ index: object, readFile: (ref: string) => { body: string, frontmatter: object },
 *           ref: string, render?: (body: string, resolve: Function) => string }} input
 * @returns {object | null}
 */
export function projectSingleDoc({ index, readFile, ref, render = renderMarkdownToHtml }) {
  const stub = index.stubByPath.get(ref)
  if (stub) return stub
  if (!index.paths.has(ref)) return null

  const parsed = readFile(ref)
  const body = parsed.body
  const resolver = makeResolver(index, ref)

  return {
    breadcrumb: ref.split('/'),
    headings: extractHeadings(body),
    html: render(body, resolver),
    meta: parsed.frontmatter.meta || {},
    path: ref,
    sources: Object.entries(extractFootnoteDefs(body)).map(([label, text]) => ({ label, text })),
    status: parsed.frontmatter.status,
  }
}
