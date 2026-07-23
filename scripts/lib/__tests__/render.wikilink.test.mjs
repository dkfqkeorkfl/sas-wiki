// @vitest-environment node
//
// P1 단위 · Task 2 (plan/tdd §Task 2) · 급소① 위키링크 <a> 계약 RED (visible)
//
// RED 사유: renderMarkdownToHtml 이 아직 unified 파이프라인 + 자체 위키링크 플러그인으로
//   교체되지 않았다(seam 미교체 · wikilink-plugin.mjs 부재). 현 손수 렌더러는 resolver 를
//   구 규약(토큰 문자열 → HTML 문자열)으로 호출하므로, {path, exists} 를 돌려주는 신 규약 더블을
//   주입하면 <a class="wiki-link"…> 가 아니라 [object Object] 를 낸다 → 계약 단언 실패.
//
// 계약(GREEN 이 재현할 seam) — renderMarkdownToHtml(body, resolve):
//   resolve(target, anchor) → { path, exists }   (실 derive resolver 의 축약 더블)
//   <a class="wiki-link[ wiki-link-dead]" href="#/wiki/{enc(path)}[@{enc(anchor)}]"
//      data-path="{path}"[ data-anchor="{anchor}"]>{label}</a>
//   label 우선순위: display ?? targetRaw ?? #anchor ?? path
//   코드스팬 `[[x]]` 는 링크화되지 않는다(리터럴 보존).
//
// 속성 순서에 결합하지 않도록 조각 단위(toContain)로 단언한다 — rehype-stringify 속성 순서 무관.
import { describe, expect, it } from 'vitest'

import { renderMarkdownToHtml } from '../render.mjs'

// 실 derive resolver 의 축약 더블 — {path, exists} 만 돌려준다(class/href/label 조립은 렌더 몫).
// KNOWN 에 있으면 존재(exists=true), 없으면 데드. path 는 계약 단언을 읽기 쉽게 target 과 동일하게 둔다.
const KNOWN = new Set(['HBM', '삼성전자'])
const resolve = (target, _anchor) => {
  if (target === '') return { exists: true, path: 'self' } // 대상 생략([[#anchor]])
  return { exists: KNOWN.has(target), path: target }
}

describe('renderMarkdownToHtml — 위키링크 <a> 계약 (급소①)', () => {
  it('bare [[HBM]](존재) → wiki-link · href · data-path · label, data-anchor 부재', () => {
    const html = renderMarkdownToHtml('[[HBM]]', resolve)

    expect(html).toContain('class="wiki-link"')
    expect(html).not.toContain('wiki-link-dead')
    expect(html).toContain('href="#/wiki/HBM"')
    expect(html).toContain('data-path="HBM"')
    expect(html).toContain('>HBM</a>')
    expect(html).not.toContain('data-anchor')
  })

  it('[[삼성전자|삼성]](별칭) → label 은 별칭, 대상 기준 data-path', () => {
    const html = renderMarkdownToHtml('[[삼성전자|삼성]]', resolve)

    expect(html).toContain('class="wiki-link"')
    expect(html).toContain('data-path="삼성전자"')
    expect(html).toContain('>삼성</a>') // display 우선 (target 아님)
  })

  it('[[HBM#공급망]](앵커) → href@enc(anchor) · data-anchor 원문 · label 은 대상', () => {
    const html = renderMarkdownToHtml('[[HBM#공급망]]', resolve)

    // 앵커는 href 에서 encodeURIComponent 로 인코딩되지만 data-anchor 는 원문이다(계약 구분).
    expect(html).toContain(`href="#/wiki/HBM@${encodeURIComponent('공급망')}"`)
    expect(html).toContain('data-anchor="공급망"')
    expect(html).toContain('>HBM</a>') // display 없음 → targetRaw 우선
  })

  it('[[HBM#공급망|공급망 절]](앵커+별칭) → label 은 별칭 · data-anchor 원문', () => {
    const html = renderMarkdownToHtml('[[HBM#공급망|공급망 절]]', resolve)

    expect(html).toContain('data-anchor="공급망"')
    expect(html).toContain('>공급망 절</a>')
  })

  it('[[없는문서]](데드) → wiki-link wiki-link-dead (class 반전 = 하드코딩 방지)', () => {
    // 2번째 케이스: 존재 케이스와 class 를 반전시켜 "항상 wiki-link" 하드코딩을 잡는다.
    const html = renderMarkdownToHtml('[[없는문서]]', resolve)

    expect(html).toContain('class="wiki-link wiki-link-dead"')
    expect(html).toContain('data-path="없는문서"')
    expect(html).toContain('>없는문서</a>')
  })

  it('[[#섹션]](대상 생략, 앵커만) → label 은 #섹션 (우선순위 #anchor) · data-anchor', () => {
    const html = renderMarkdownToHtml('[[#섹션]]', resolve)

    expect(html).toContain('data-anchor="섹션"')
    expect(html).toContain('>#섹션</a>') // targetRaw 없음 → `#anchor`
  })

  it('코드스팬 `[[HBM]]` 는 링크화되지 않고 리터럴로 보존한다', () => {
    // find-and-replace 가 inlineCode 를 건너뛴다 — 회귀 앵커(현 렌더러도 코드스팬은 링크화 안 함).
    const html = renderMarkdownToHtml('`[[HBM]]`', resolve)

    expect(html).toContain('<code>[[HBM]]</code>')
    expect(html).not.toContain('wiki-link')
  })
})
