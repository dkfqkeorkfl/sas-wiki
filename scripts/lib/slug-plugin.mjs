import { toString } from 'hast-util-to-string'
import { visit } from 'unist-util-visit'

import { slugifyHeading, withDedupSuffix } from './parse.mjs'

/**
 * rehype 단계에서 heading(h1~h6)에 `id` 를 부여한다. slug SSOT 는 `parse.mjs` 의
 * `slugifyHeading`/`withDedupSuffix` 를 **재사용**한다 — `extractHeadings`(TOC 앵커)와 같은
 * 함수를 쓰므로 렌더 heading id 와 TOC 앵커가 lockstep 으로 일치한다(github-slugger 미도입).
 *
 * dedup 카운터(`used`)는 문서마다 새로 초기화한다 — 누수 시 문서 간 앵커가 오염된다.
 */
export function rehypeSlugSas() {
  return (tree) => {
    const used = new Map()
    visit(tree, 'element', (node) => {
      if (/^h[1-6]$/.test(node.tagName)) {
        node.properties = node.properties || {}
        node.properties.id = withDedupSuffix(slugifyHeading(toString(node)), used)
      }
    })
    return tree
  }
}
