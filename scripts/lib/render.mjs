import { slugifyHeading, withDedupSuffix } from './parse.mjs'

export function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

export function renderMarkdownToHtml(body, resolveWikilink = escapeHtml) {
  const htmlParts = []
  const lines = body.split(/\r?\n/)
  const usedSlugCounts = new Map()
  let inList = false

  function closeList() {
    if (!inList) return
    htmlParts.push('</ul>')
    inList = false
  }

  for (const line of lines) {
    if (line.trim() === '') {
      closeList()
      continue
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/)
    if (headingMatch) {
      closeList()
      const level = headingMatch[1].length
      const text = headingMatch[2].trim()
      const anchor = withDedupSuffix(slugifyHeading(text), usedSlugCounts)
      htmlParts.push(
        `<h${level} id="${escapeHtml(anchor)}">${renderInline(text, resolveWikilink)}</h${level}>`,
      )
      continue
    }

    if (/^\[\^([^\]]+)\]:\s*/.test(line)) continue

    if (line.trim().startsWith('> ')) {
      closeList()
      htmlParts.push(
        `<blockquote>${renderInline(line.trim().slice(2), resolveWikilink)}</blockquote>`,
      )
      continue
    }

    if (/^[-*]\s+/.test(line.trim())) {
      if (!inList) {
        htmlParts.push('<ul>')
        inList = true
      }
      const itemText = line.trim().replace(/^[-*]\s+/, '')
      const blockIdMatch = itemText.match(/\^([a-zA-Z0-9-]+)\s*$/)
      const cleanText = blockIdMatch ? itemText.slice(0, blockIdMatch.index).trim() : itemText
      const idAttr = blockIdMatch ? ` id="${escapeHtml(blockIdMatch[1])}"` : ''
      htmlParts.push(`<li${idAttr}>${renderInline(cleanText, resolveWikilink)}</li>`)
      continue
    }

    closeList()
    const soloBlockId = line.trim().match(/^\^([a-zA-Z0-9-]+)$/)
    if (soloBlockId) {
      htmlParts.push(`<span id="${escapeHtml(soloBlockId[1])}"></span>`)
      continue
    }
    htmlParts.push(`<p>${renderInline(line.trim(), resolveWikilink)}</p>`)
  }

  closeList()
  return htmlParts.join('\n')
}

function renderInline(text, resolveWikilink = escapeHtml) {
  let out = ''
  const tokenRe = /(\[\[[^\]]+\]\]|\[\^[^\]]+\]|\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g
  let lastIndex = 0
  let match
  tokenRe.lastIndex = 0
  while ((match = tokenRe.exec(text)) !== null) {
    out += escapeHtml(text.slice(lastIndex, match.index))
    const tok = match[0]
    if (tok.startsWith('[[')) out += resolveWikilink(tok)
    else if (tok.startsWith('[^')) {
      const label = tok.slice(2, -1)
      out += `<sup class="footnote-ref" data-footnote="${escapeHtml(label)}">[${escapeHtml(label)}]</sup>`
    } else if (tok.startsWith('**')) out += `<strong>${escapeHtml(tok.slice(2, -2))}</strong>`
    else if (tok.startsWith('`')) out += `<code>${escapeHtml(tok.slice(1, -1))}</code>`
    else if (tok.startsWith('*')) out += `<em>${escapeHtml(tok.slice(1, -1))}</em>`
    lastIndex = match.index + tok.length
  }
  out += escapeHtml(text.slice(lastIndex))
  return out
}
