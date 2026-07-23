import { findAndReplace } from 'mdast-util-find-and-replace'

/**
 * `[[target#anchor|display]]` 위키링크 문법(모든 절 선택적)을 mdast link 노드로 치환하는
 * 자체 remark 플러그인. `mdast-util-find-and-replace` 가 inlineCode/code/기존 link 컨텍스트를
 * 자동 회피하므로 코드스팬 내 `[[..]]` 는 리터럴로 보존된다.
 *
 * 링크 대상 해석은 주입된 `resolve(target, anchor) => { path, exists }` 가 담당하고(계약 SSOT
 * 는 derive.mjs), 플러그인은 그 결과로 `<a>` 출력 계약(class·href·data-*·label)을 조립한다.
 * 실제 속성 이스케이프는 rehype-stringify 가 수행한다(수동 escape 불요).
 */
const WIKILINK_RE = /\[\[([^\]#|]+)?(?:#([^\]|]+))?(?:\|([^\]]+))?\]\]/g

function hrefOf(path, anchor) {
  const base = `#/wiki/${encodeURIComponent(path)}`
  return anchor ? `${base}@${encodeURIComponent(anchor)}` : base
}

export function remarkWikiLink(resolve) {
  return (tree) => {
    findAndReplace(tree, [
      [
        WIKILINK_RE,
        (_full, targetRaw, anchorRaw, displayRaw) => {
          const target = (targetRaw || '').trim()
          const anchor = (anchorRaw || '').trim() || undefined
          const display = (displayRaw || '').trim() || undefined
          const { path, exists } = resolve(target, anchor)

          // label 우선순위: display ?? targetRaw ?? #anchor ?? path
          const label =
            display ?? (target || undefined) ?? (anchor ? `#${anchor}` : undefined) ?? path

          const hProperties = {
            className: exists ? ['wiki-link'] : ['wiki-link', 'wiki-link-dead'],
            dataPath: path,
          }
          if (anchor) hProperties.dataAnchor = anchor

          return {
            children: [{ type: 'text', value: label }],
            data: { hProperties },
            type: 'link',
            url: hrefOf(path, anchor),
          }
        },
      ],
    ])
    return tree
  }
}
