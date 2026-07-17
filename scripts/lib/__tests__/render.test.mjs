// @vitest-environment node
//
// P1 3-A · scripts/wiki/lib/render.mjs (md→HTML 렌더러) — 계약 불변(포팅 회귀 고정)
//
// 삭제(기능 소멸 — P2): `escapeForEmbed` 3건.
//   `prototype.html` 산출이 사라지면서(`build.mjs:248-266` writeBundle 제거) 임베드 이스케이프의
//   **소비처가 0이 된다** → 함수 자체가 죽는다. 죽은 코드 + 죽은 테스트를 남기지 않는다.
//   "안 통과해서" 지우는 것이 아니라 **기능 제거에 수반된 삭제**다(tdd §3).
//   GREEN 이 `render.mjs` 에서 `escapeForEmbed` 를 제거해야 knip 이 green 이 된다.
import { describe, expect, it } from 'vitest'

import { renderMarkdownToHtml } from '../render.mjs'

const noWikilink = () => ''

describe('renderMarkdownToHtml', () => {
  it('heading 은 slug anchor id 로, 문단은 <p> 로 렌더한다', () => {
    const html = renderMarkdownToHtml('# Hello World\n\nsome text', noWikilink)

    expect(html).toContain('<h1 id="hello-world">Hello World</h1>')
    expect(html).toContain('<p>some text</p>')
  })

  it('본문 특수문자는 HTML 엔티티로 이스케이프한다', () => {
    // 2번째 케이스: 본문 렌더는 escapeHtml(&lt;/&amp;) 경로다 — excerpt(평문)와 구분된다.
    const html = renderMarkdownToHtml('a < b & c', noWikilink)

    expect(html).toContain('&lt;')
    expect(html).toContain('&amp;')
  })
})
