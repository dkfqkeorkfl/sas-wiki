// @vitest-environment node
//
// P1 단위 · Task 4 (plan/tdd §Task 4) · 표준 마크다운 네이티브 + block-id/footnote 드롭 RED (visible)
//
// RED 사유: renderMarkdownToHtml 이 아직 unified 로 교체되지 않았다.
//   현 손수 렌더러는 (a) 중첩 리스트·표준 링크 [t](u) 를 지원하지 않고(→ 텍스트로 새어나옴),
//   (b) footnote [^x]·block-id ^id 를 비표준 HTML(<sup>·id 속성)로 낸다.
//   교체 후 계약: 중첩/표준링크는 정상 렌더 + footnote/block-id 는 리터럴로 드롭(tdd §2 확정,
//   vault 미사용·무테스트 → 침묵 드롭이 아니라 명시 단언된 드롭).
//
// 회귀 앵커(약화 금지): 강조/이탤릭/인라인코드·이스케이프는 교체 후에도 보존(현 렌더러도 지원).
import { describe, expect, it } from 'vitest'

import { renderMarkdownToHtml } from '../render.mjs'

// 위키링크 없는 본문이라 호출되지 않지만 신 규약 시그니처({path,exists})로 둔다.
const noWikilink = () => ({ exists: false, path: '' })

describe('renderMarkdownToHtml — 표준 마크다운 (unified 네이티브)', () => {
  it('중첩 리스트를 중첩 <ul> 로 렌더한다 (현 렌더러 평면화 → RED)', () => {
    const html = renderMarkdownToHtml('- a\n  - b', noWikilink)

    // 중첩이면 <ul> 이 2개 이상(바깥 + <li> 안쪽). 현 손수 렌더러는 평면 1개.
    expect((html.match(/<ul>/g) || []).length).toBeGreaterThanOrEqual(2)
  })

  it('표준 링크 [텍스트](https://ex.com) 를 <a href> 로 렌더한다 (현 렌더러 미지원 → RED)', () => {
    const html = renderMarkdownToHtml('[문서](https://ex.com)', noWikilink)

    expect(html).toContain('href="https://ex.com"')
    expect(html).toContain('>문서</a>')
  })

  it('강조/이탤릭/인라인코드를 렌더한다 (회귀 앵커 — 교체 후에도 보존)', () => {
    const html = renderMarkdownToHtml('**굵게** *기울임* `코드`', noWikilink)

    expect(html).toContain('<strong>굵게</strong>')
    expect(html).toContain('<em>기울임</em>')
    expect(html).toContain('<code>코드</code>')
  })

  it('본문 특수문자를 HTML 엔티티로 이스케이프한다 (회귀 앵커)', () => {
    const html = renderMarkdownToHtml('a < b & c', noWikilink)

    expect(html).toContain('&lt;')
    expect(html).toContain('&amp;')
  })
})

describe('renderMarkdownToHtml — block-id/footnote 드롭 (tdd §2: 렌더 제거, 추출 존치)', () => {
  it('inline footnote [^1] 는 <sup> 없이 리터럴로 남는다 (현 렌더러는 <sup> 생성 → RED)', () => {
    // 정의 라인 없이 inline 만 — 교체 후 commonmark 리터럴 `[^1]` 로 남는다.
    const html = renderMarkdownToHtml('본문 [^1] 끝', noWikilink)

    expect(html).not.toContain('<sup')
    expect(html).toContain('[^1]') // 리터럴 보존(라벨 [1] 로 치환하지 않는다)
  })

  it('block-id ^bid 는 id 속성 없이 리터럴로 남는다 (현 렌더러는 id="bid" 생성 → RED)', () => {
    const html = renderMarkdownToHtml('- 항목 ^bid', noWikilink)

    expect(html).not.toContain('id="bid"')
    expect(html).toContain('^bid') // 리터럴 보존(끝의 ^bid 를 제거하지 않는다)
  })
})

describe('renderMarkdownToHtml — 경계(빈/공백 본문)', () => {
  it('빈 본문은 빈 문자열을 낸다', () => {
    expect(renderMarkdownToHtml('', noWikilink)).toBe('')
  })

  it('공백만 있는 본문은 문단 태그를 만들지 않는다', () => {
    const html = renderMarkdownToHtml('   \n\n  ', noWikilink)

    expect(html).not.toContain('<p>')
  })
})
