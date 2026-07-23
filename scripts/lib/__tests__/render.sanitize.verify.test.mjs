// @vitest-environment node
//
// P1 단위(hidden verify) · Task 3 (plan/tdd §Task 3) · 급소③ sanitize allowlist 짝 단언
//
// RED 사유: unified 파이프라인(remark-rehype allowDangerousHtml:false → rehype-sanitize)
//   미교체 + sanitize-schema.mjs 부재.
//   ① 위험 제거: 표준 링크 javascript: href 제거(현 렌더러는 [t](u) 미지원 → 텍스트로 새어나와
//      `javascript:` 가 산출에 남는다 → RED).
//   ② 필요 속성 보존(짝): 위키링크 class·data-path·data-anchor 가 sanitize **후에도** 잔존
//      (현 손수 렌더러는 신 규약 resolver 로 링크 자체를 못 만든다 → RED).
//   ①②를 한 파일에서 함께 단언해 "위험만 제거하고 필요 속성까지 날리는" over-narrow allowlist 를 잡는다
//   (allowlist 를 과도하게 좁히면 ②에서 fail, 위험 제거만 맞추면 통과하는 게이밍 차단).
import { describe, expect, it } from 'vitest'

import { renderMarkdownToHtml } from '../render.mjs'

const KNOWN = new Set(['HBM'])
const resolve = (target, _anchor) => ({ exists: KNOWN.has(target), path: target })

describe('sanitize — 위험 제거 (급소③)', () => {
  it('표준 링크의 javascript: href 를 제거한다', () => {
    const html = renderMarkdownToHtml('[클릭](javascript:alert(1))', resolve)

    expect(html).not.toContain('javascript:')
  })

  it('raw <script> 를 산출하지 않는다 (방어심화 — allowDangerousHtml:false + sanitize)', () => {
    const html = renderMarkdownToHtml('<script>alert(1)</script>', resolve)

    expect(html).not.toContain('<script')
  })
})

describe('sanitize — 필요 속성 보존 (급소③, over-narrow allowlist 방지)', () => {
  it('위키링크 class·data-path·data-anchor 가 sanitize 후에도 잔존한다', () => {
    const html = renderMarkdownToHtml('[[HBM#공급망]]', resolve)

    expect(html).toContain('class="wiki-link"')
    expect(html).toContain('data-path="HBM"')
    expect(html).toContain('data-anchor="공급망"')
  })

  it('heading id 가 sanitize 후에도 잔존한다', () => {
    const html = renderMarkdownToHtml('## 공급망', resolve)

    expect(html).toContain('id="공급망"')
  })
})
