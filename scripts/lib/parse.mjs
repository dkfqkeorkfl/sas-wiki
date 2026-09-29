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

/**
 * frontmatter 필드 한 개의 값 — `pattern` 에 맞는 **마지막** 줄의 값을 `parseFrontmatterYaml` 과
 * 같은 스칼라 규칙으로 해석한다(같은 키가 반복되면 뒤의 값이 이기는 것도 같다).
 *
 * frontmatter 가 `parseFrontmatterYaml` 로 해석될 때만 읽는다 — 검증기가 문서로 인정하지 않는
 * frontmatter 의 값은 그 문서의 값이 아니다(닫는 `---` 가 빠지면 블록 끝이 본문의 가로줄로 밀려 본문
 * 예시가 필드처럼 보인다). 해석이 안 되면 throw 하지 않고 `undefined` 를 준다 — 과거 blob 을 훑는
 * 호출부가 깨진 한 시점 때문에 멈추지 않게 하기 위해서다.
 * 한 줄짜리 스칼라 필드 전용이다 — 들여쓴 하위 블록은 보지 않는다.
 *
 * @param {string} markdown frontmatter 를 포함한 문서 전체 텍스트
 * @param {RegExp} pattern 필드 줄 하나에 맞고 캡처 그룹 1 이 콜론 뒤 원시 값인 비전역 정규식
 * @returns {unknown} 해석된 값. frontmatter 가 없거나 해석되지 않거나 필드 줄이 없으면 `undefined`
 */
export function extractFrontmatterField(markdown, pattern) {
  const target = findFieldLine(markdown, pattern)
  return target?.match ? parseScalar(target.match[1]) : undefined
}

/**
 * `extractFrontmatterField` 가 읽는 필드 줄의 번호(1 부터). git 처럼 `\n` 만 줄 끝으로 센다.
 *
 * @param {string} markdown
 * @param {RegExp} pattern `extractFrontmatterField` 와 같은 규약의 필드 줄 정규식
 * @returns {number | undefined} 필드 줄이 없거나 frontmatter 가 없거나 해석되지 않으면 `undefined`
 */
export function findFrontmatterFieldLine(markdown, pattern) {
  const target = findFieldLine(markdown, pattern)
  if (!target?.match) return undefined
  return markdown.slice(0, target.start).split('\n').length
}

/**
 * frontmatter 필드 한 줄을 `line` 으로 바꾼다. 필드 줄이 없으면 frontmatter 첫 줄로 넣는다.
 * 대상 줄 밖은 바이트 그대로 둔다.
 *
 * 필드가 반복되면 `extractFrontmatterField` 가 읽는 마지막 줄을 바꾼다 — 쓴 값이 곧 읽히는 값이다.
 *
 * @param {string} markdown
 * @param {RegExp} pattern `extractFrontmatterField` 와 같은 규약의 필드 줄 정규식
 * @param {string} line 넣을 줄(줄끝 제외)
 * @returns {string | null} 바뀐 문서. frontmatter 가 없거나 해석되지 않으면 `null`
 */
export function upsertFrontmatterField(markdown, pattern, line) {
  const target = findFieldLine(markdown, pattern)
  if (target === null) return null
  if (target.match) {
    return markdown.slice(0, target.start) + line + markdown.slice(target.end)
  }
  return (
    markdown.slice(0, target.blockStart) + line + target.eol + markdown.slice(target.blockStart)
  )
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
  // 프론트매터 뒤에 남는 **빈 줄만** 벗긴다 — `[ \t]*\r?\n` 한 덩이는 "공백/탭만 있다가 개행으로
  // 끝나는 한 줄"만 매치하므로, 들여쓰기로 시작하는 실제 본문 줄(예: 4-space 들여쓰기 코드블록)의
  // 앞쪽 공백은 건드리지 않는다. `\s` 하나로 뭉뚱그리면 개행과 들여쓰기 공백을 구분하지 못해 그
  // 들여쓰기까지 먹어치운다(재현: body 가 빈 줄 하나 뒤 들여쓰기 코드로 시작하면 그 들여쓰기가
  // 사라진다).
  const strippedBody = body.replace(/^(?:[ \t]*\r?\n)+/, '')
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

const FRONTMATTER_BLOCK_RE = /^---(\r?\n)([\s\S]*?)\r?\n---/u

/**
 * frontmatter 블록 안에서 `pattern` 에 맞는 마지막 줄의 위치.
 *
 * @returns {null | { blockStart: number, eol: string, match: RegExpExecArray | null,
 *   start: number, end: number }} 블록이 없거나 해석되지 않으면 null. 맞는 줄이 없으면 `match` 가
 *   null 이다.
 */
function findFieldLine(markdown, pattern) {
  const block = FRONTMATTER_BLOCK_RE.exec(markdown)
  if (!block) return null
  const [, eol, yamlText] = block
  try {
    parseFrontmatterYaml(yamlText)
  } catch {
    return null
  }
  const blockStart = '---'.length + eol.length
  let found = { blockStart, end: blockStart, eol, match: null, start: blockStart }
  let offset = blockStart
  for (const rawLine of yamlText.split('\n')) {
    const text = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine
    const match = pattern.exec(text)
    if (match) found = { blockStart, end: offset + text.length, eol, match, start: offset }
    offset += rawLine.length + 1
  }
  return found
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
