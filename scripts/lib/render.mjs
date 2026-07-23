import rehypeSanitize from 'rehype-sanitize'
import rehypeStringify from 'rehype-stringify'
import remarkParse from 'remark-parse'
import remarkRehype from 'remark-rehype'
import { unified } from 'unified'

import { sanitizeSchema } from './sanitize-schema.mjs'
import { rehypeSlugSas } from './slug-plugin.mjs'
import { remarkWikiLink } from './wikilink-plugin.mjs'

/**
 * 본문 마크다운 → 위생 처리된 HTML 문자열. 표준 unified(remark/rehype) 파이프라인이다:
 *
 *   remark-parse → remarkWikiLink(resolve) → remark-rehype(raw HTML 미영속)
 *   → rehypeSlugSas(heading id) → rehype-sanitize(allowlist) → rehype-stringify
 *
 * `resolve(target, anchor) => { path, exists }` 는 위키링크 대상 해석기(derive.mjs 주입)다.
 * footnote-ref(`[^x]`)·block-id(`^id`) 는 렌더하지 않는다(commonmark 리터럴로 남김) — 추출
 * 경로(extractFootnoteDefs·extractBlockIds)는 별도로 존치한다(tdd §2 확정).
 */
export function renderMarkdownToHtml(body, resolve) {
  const file = unified()
    .use(remarkParse)
    .use(remarkWikiLink, resolve)
    .use(remarkRehype, { allowDangerousHtml: false })
    .use(rehypeSlugSas)
    .use(rehypeSanitize, sanitizeSchema)
    .use(rehypeStringify, { characterReferences: { useNamedReferences: true } })
    .processSync(body)
  return String(file)
}
