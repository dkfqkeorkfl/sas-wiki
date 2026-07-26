import fs from 'node:fs'
import path from 'node:path'

export function parseFrontmatterYaml(yamlText, filePath = '') {
  const lines = yamlText.split(/\r?\n/)
  const result = {}
  let i = 0

  while (i < lines.length) {
    const line = lines[i]
    if (line.trim() === '' || line.trim().startsWith('#')) {
      i += 1
      continue
    }
    const topIndent = indentOf(line)
    if (topIndent !== 0) {
      throw new Error(`frontmatter 최상위 들여쓰기 오류: ${filePath}`)
    }
    const colonIdx = line.indexOf(':')
    if (colonIdx === -1) {
      throw new Error(`frontmatter 키:값 형식 오류: ${filePath}`)
    }

    const key = line.slice(0, colonIdx).trim()
    const rest = line.slice(colonIdx + 1).trim()
    i += 1

    if (rest !== '') {
      result[key] = parseScalar(rest)
      continue
    }

    const blockLines = []
    while (i < lines.length) {
      const next = lines[i]
      if (next.trim() === '') {
        i += 1
        continue
      }
      if (indentOf(next) <= topIndent) break
      blockLines.push(next)
      i += 1
    }

    if (blockLines.length === 0) {
      result[key] = null
      continue
    }

    if (blockLines.every((l) => l.trim().startsWith('- '))) {
      result[key] = blockLines.map((l) => parseScalar(l.trim().slice(2)))
      continue
    }

    const nested = {}
    for (const nestedLine of blockLines) {
      const idx = nestedLine.indexOf(':')
      if (idx === -1) continue
      nested[nestedLine.slice(0, idx).trim()] = parseScalar(nestedLine.slice(idx + 1).trim())
    }
    result[key] = nested
  }

  return result
}

export function slugifyHeading(text) {
  return String(text)
    .trim()
    .toLowerCase()
    .replaceAll(/\s+/g, '-')
    .replaceAll(/[^\p{L}\p{N}-]/gu, '')
    .replaceAll(/-+/g, '-')
    .replaceAll(/^-|-$/g, '')
}

export function withDedupSuffix(baseSlug, usedCount) {
  const n = usedCount.get(baseSlug) || 0
  usedCount.set(baseSlug, n + 1)
  return n === 0 ? baseSlug : `${baseSlug}-${n + 1}`
}

const WIKILINK_RE = /\[\[([^\]|#]+)?(#([^\]|]+))?(\|([^\]]+))?\]\]/g

export function collectMarkdownFilesRecursive(dir) {
  if (!fs.existsSync(dir)) return []
  const out = []
  function walk(currentDir) {
    for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
      const full = path.join(currentDir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.isFile() && entry.name.endsWith('.md')) out.push(full)
    }
  }
  walk(dir)
  return out.toSorted((a, b) => a.localeCompare(b))
}

/**
 * 문서의 위치 — `breadcrumb` 는 **폴더들 + 문서 슬러그**다(README · 계층).
 *
 * 마지막 원소가 문서 슬러그이므로 `breadcrumb.join('/') === path` 가 성립한다(불변식 5 의 전제).
 * 계약에 문자열 `path` 필드는 없다 — 경로가 필요하면 이 유도식을 쓴다.
 * 폴더 크럼(표시용)은 `breadcrumb.slice(0, -1)` 이다.
 */
export function derivePathAndBreadcrumb(filePath, wikiDir) {
  const relWithExt = path.relative(wikiDir, filePath).split(path.sep).join('/')
  const rel = relWithExt.replace(/\.md$/, '')
  return { breadcrumb: rel.split('/'), path: rel }
}

export function extractBlockIds(body, filePath = '') {
  const ids = new Set()
  const re = /\^([a-zA-Z0-9-]+)\s*$/gm
  let match
  while ((match = re.exec(body)) !== null) {
    if (ids.has(match[1])) throw new Error(`중복 블록 id 발견: ${filePath}#${match[1]}`)
    ids.add(match[1])
  }
  return ids
}

export function extractFootnoteDefs(body) {
  const defs = {}
  const re = /^\[\^([^\]]+)\]:\s*(.+)$/gm
  let match
  while ((match = re.exec(body)) !== null) {
    defs[match[1]] = match[2].trim()
  }
  return defs
}

export function extractHeadings(body) {
  return extractHeadingsWithLines(body).map(({ anchor, level, text }) => ({ anchor, level, text }))
}

export function extractHeadingsWithLines(body) {
  const headings = []
  const usedSlugCounts = new Map()
  for (const [idx, line] of body.split(/\r?\n/).entries()) {
    const match = line.match(/^(#{1,6})\s+(.+)$/)
    if (!match) continue
    const level = match[1].length
    const text = match[2].trim()
    const anchor = withDedupSuffix(slugifyHeading(text), usedSlugCounts)
    headings.push({ anchor, level, line: idx + 1, text })
  }
  return headings
}

export function extractWikilinks(body) {
  const links = []
  let match
  WIKILINK_RE.lastIndex = 0
  while ((match = WIKILINK_RE.exec(body)) !== null) {
    links.push({
      anchorRaw: (match[3] || '').trim() || undefined,
      display: (match[5] || '').trim() || undefined,
      raw: match[0],
      targetRaw: (match[1] || '').trim(),
    })
  }
  return links
}

export function parseMarkdownFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8')
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!match) return null
  const [, yamlText, body] = match
  const strippedBody = body.replace(/^\s+/, '')
  const bodyStartIndex = raw.length - body.length
  const frontmatterLineCount = raw.slice(0, bodyStartIndex).split('\n').length - 1
  const strippedLeadingLineCount =
    body.slice(0, body.length - strippedBody.length).split('\n').length - 1
  return {
    body: strippedBody.replace(/\s+$/, '\n'),
    bodyLineOffset: frontmatterLineCount + strippedLeadingLineCount,
    filePath,
    frontmatter: parseFrontmatterYaml(yamlText, filePath),
    raw,
  }
}

function indentOf(line) {
  const match = line.match(/^(\s*)/)
  return match ? match[1].length : 0
}

function parseScalar(raw) {
  const v = raw.trim()
  if (v === '') return null
  if (v === 'null' || v === '~') return null
  if (v === 'true') return true
  if (v === 'false') return false
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1)
  }
  if (v.startsWith('[') && v.endsWith(']')) {
    const inner = v.slice(1, -1).trim()
    if (inner === '') return []
    return inner.split(',').map((s) => parseScalar(s.trim()))
  }
  if (v.startsWith('{') && v.endsWith('}')) {
    const inner = v.slice(1, -1).trim()
    if (inner === '') return {}
    const obj = {}
    for (const pair of inner.split(',')) {
      const idx = pair.indexOf(':')
      if (idx === -1) continue
      obj[pair.slice(0, idx).trim()] = parseScalar(pair.slice(idx + 1).trim())
    }
    return obj
  }
  if (/^-?\d+(\.\d+)?$/.test(v))
    return v.includes('.') ? Number.parseFloat(v) : Number.parseInt(v, 10)
  return v
}
