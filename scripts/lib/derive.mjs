import { getFileCommitDates } from './git.mjs'
import {
  extractBlockIds,
  extractFootnoteDefs,
  extractHeadings,
  extractHeadingsWithLines,
  slugifyHeading,
} from './parse.mjs'
import { escapeHtml, renderMarkdownToHtml } from './render.mjs'

/** excerpt 최대 길이(평문 기준). 초과하면 말줄임표 없이 자른다. */
const EXCERPT_MAX = 160

export function checkAnchorExists(pathToDoc, targetPath, anchorRaw) {
  if (!anchorRaw) return true
  const targetDoc = pathToDoc.get(targetPath)
  if (!targetDoc) return false
  if (anchorRaw.startsWith('^')) return targetDoc.blockIds.has(anchorRaw.slice(1))
  return targetDoc.headingsWithLines.some((heading) => heading.anchor === slugifyHeading(anchorRaw))
}

/**
 * 파싱된 문서 → summary 파생물 + 본문 레코드.
 *
 * - `docs`   : summary 레코드. active = 10키 / **disable = 4키 스텁**(id·breadcrumb·title·status)
 * - `bodies` : 본문 레코드(active 만) — `buildBody` 입력
 * - `tree`   : `[{ path, docs: id[], children }]` — 루트 래퍼 없음. active 만
 * - `tags`   : `Record<tag, docId[]>` — active 만
 * - `pathToDoc` : **disable 포함**(위키링크 데드링크 방지)
 */
export function derive(parsedDocs, runGit, { wikiPrefix = 'vault/wiki/' } = {}) {
  const enriched = parsedDocs.map((parsed) => {
    const relFilePath = `${wikiPrefix}${parsed.relPath}.md`
    const dates = getFileCommitDates(runGit, relFilePath)
    if (!dates.hash) throw new Error(`생성 커밋을 찾을 수 없습니다: ${relFilePath}`)
    return {
      ...parsed,
      created: dates.created,
      id: dates.hash.slice(0, 12),
      updated: dates.updated,
    }
  })

  // 불변식 8 의 최후 방어선 — 한 커밋이 문서 2개를 만들면(cwiki 1파일 규칙 위반) 둘이 같은
  // 생성 해시를 갖는다 → 참조가 **틀린 문서**를 가리킨다(비는 게 아니라 틀린다).
  const pathSeen = new Map()
  const idSeen = new Map()
  for (const doc of enriched) {
    if (pathSeen.has(doc.relPath)) throw new Error(`중복 path 발견: ${doc.relPath}`)
    const twin = idSeen.get(doc.id)
    if (twin) throw new Error(`중복 id 발견: ${doc.id} (${twin.relPath}, ${doc.relPath})`)
    pathSeen.set(doc.relPath, doc)
    idSeen.set(doc.id, doc)
  }

  const pathToDoc = new Map()
  for (const doc of enriched) {
    pathToDoc.set(doc.relPath, {
      ...doc,
      blockIds: extractBlockIds(doc.body, doc.filePath || doc.relPath),
      headingsWithLines: extractHeadingsWithLines(doc.body),
    })
  }
  const resolveTargetPath = makeTargetResolver(pathToDoc)

  const bodies = []
  const docs = []
  const tags = new Map()

  for (const doc of enriched) {
    if (doc.frontmatter.status === 'disable') {
      // 스텁 4키 — 다른 문서가 [[폐업기업]] 으로 링크할 때 그 링크를 살려두기 위함.
      docs.push({
        breadcrumb: doc.breadcrumb,
        id: doc.id,
        status: 'disable',
        title: doc.frontmatter.title,
      })
      continue
    }

    const resolver = makeWikilinkResolver(pathToDoc, resolveTargetPath, doc.relPath)
    for (const tag of doc.frontmatter.tags || []) {
      if (!tags.has(tag)) tags.set(tag, [])
      tags.get(tag).push(doc.id)
    }

    docs.push({
      aliases: doc.frontmatter.aliases || [],
      breadcrumb: doc.breadcrumb,
      created: doc.created,
      excerpt: deriveExcerpt(doc.body),
      id: doc.id,
      status: doc.frontmatter.status,
      tags: doc.frontmatter.tags || [],
      title: doc.frontmatter.title,
      type: doc.frontmatter.type,
      updated: doc.updated,
    })

    bodies.push({
      breadcrumb: doc.breadcrumb,
      headings: extractHeadings(doc.body),
      html: renderMarkdownToHtml(doc.body, resolver),
      meta: doc.frontmatter.meta || {},
      sources: Object.entries(extractFootnoteDefs(doc.body)).map(([label, text]) => ({
        label,
        text,
      })),
      status: doc.frontmatter.status,
    })
  }

  return {
    bodies,
    docs,
    pathToDoc,
    resolveTargetPath,
    tags: Object.fromEntries([...tags.entries()].toSorted(([a], [b]) => a.localeCompare(b, 'ko'))),
    tree: buildTree(docs.filter((doc) => doc.status !== 'disable')),
  }
}

function buildBasenameIndex(pathToDoc) {
  const basenameIndex = new Map()
  for (const relPath of pathToDoc.keys()) {
    const base = relPath.split('/').pop()
    if (!basenameIndex.has(base)) basenameIndex.set(base, [])
    basenameIndex.get(base).push(relPath)
  }
  return basenameIndex
}

/** 폴더 트리 — 노드 키는 누적 경로(`company/반도체`), 문서는 **id 배열**. 최상위가 배열이다. */
function buildTree(activeDocs) {
  const root = { children: new Map(), docs: [], path: '' }
  let hasRootDocs = false

  for (const doc of activeDocs) {
    const folders = doc.breadcrumb.slice(0, -1) // 마지막은 문서 슬러그다
    if (folders.length === 0) {
      root.docs.push(doc.id)
      hasRootDocs = true
      continue
    }
    let node = root
    let acc = ''
    for (const part of folders) {
      acc = acc ? `${acc}/${part}` : part
      if (!node.children.has(part))
        node.children.set(part, { children: new Map(), docs: [], path: acc })
      node = node.children.get(part)
    }
    node.docs.push(doc.id)
  }

  function toArray(node) {
    return {
      children: [...node.children.values()]
        .map(toArray)
        .toSorted((a, b) => a.path.localeCompare(b.path, 'ko')),
      docs: node.docs,
      path: node.path,
    }
  }

  const top = [...root.children.values()]
    .map(toArray)
    .toSorted((a, b) => a.path.localeCompare(b.path, 'ko'))
  return hasRootDocs ? [{ children: [], docs: root.docs, path: '' }, ...top] : top
}

/**
 * 본문 첫 문단 → **평문** 160자.
 *
 * HTML 이 아니다(`<`·`&` 를 이스케이프하지 않는다) — 소비 측이 텍스트 노드로 렌더한다.
 * heading 라인은 건너뛴다(vault 문서는 `## 정의` 로 시작한다).
 */
function deriveExcerpt(body) {
  const block = []
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trim()
    const isBreak = line === '' || /^#{1,6}\s/.test(line) || /^\[\^[^\]]+\]:/.test(line)
    if (block.length === 0) {
      if (isBreak) continue
      block.push(line)
      continue
    }
    if (isBreak) break
    block.push(line)
  }
  return stripMarkdown(block.join('\n')).slice(0, EXCERPT_MAX)
}

function makeTargetResolver(pathToDoc) {
  const basenameIndex = buildBasenameIndex(pathToDoc)
  return (targetRaw) => {
    if (pathToDoc.has(targetRaw)) return { ambiguous: false, path: targetRaw }
    const candidates = basenameIndex.get(targetRaw) || []
    if (candidates.length === 1) return { ambiguous: false, path: candidates[0] }
    if (candidates.length > 1) return { ambiguous: true, candidates, path: null }
    return { ambiguous: false, path: null }
  }
}

function makeWikilinkResolver(pathToDoc, resolveTargetPath, selfPath) {
  return (tokenRaw) => {
    const match = tokenRaw.match(/\[\[([^\]|#]+)?(#([^\]|]+))?(\|([^\]]+))?\]\]/)
    if (!match) return escapeHtml(tokenRaw)
    const targetRaw = (match[1] || '').trim()
    const anchorRaw = (match[3] || '').trim() || undefined
    const display = (match[5] || '').trim()
    const resolved = targetRaw ? resolveTargetPath(targetRaw) : { ambiguous: false, path: selfPath }
    const targetPath = resolved.path || selfPath
    const label = display || targetRaw || (anchorRaw ? `#${anchorRaw}` : targetPath)
    const exists = pathToDoc.has(targetPath)
    const href = `#/wiki/${encodeURIComponent(targetPath)}${anchorRaw ? `@${encodeURIComponent(anchorRaw)}` : ''}`
    const cls = exists ? 'wiki-link' : 'wiki-link wiki-link-dead'
    return `<a class="${cls}" href="${href}" data-path="${escapeHtml(targetPath)}"${
      anchorRaw ? ` data-anchor="${escapeHtml(anchorRaw)}"` : ''
    }>${escapeHtml(label)}</a>`
  }
}

/** 마크다운 마커 제거 — 불릿 · 위키링크(표시 ?? 대상) · 각주 마커 · 강조 · 인라인 코드. */
function stripMarkdown(text) {
  return text
    .replaceAll(/^[-*]\s+/gm, '')
    .replaceAll(
      /\[\[([^\]|#]+)?(?:#([^\]|]+))?(?:\|([^\]]+))?\]\]/g,
      (_, target, anchor, display) => (display || target || anchor || '').trim(),
    )
    .replaceAll(/\[\^[^\]]+\]/g, '')
    .replaceAll(/\*\*([^*]+)\*\*/g, '$1')
    .replaceAll(/\*([^*]+)\*/g, '$1')
    .replaceAll(/`([^`]+)`/g, '$1')
    .replaceAll(/\s+/g, ' ')
    .trim()
}
