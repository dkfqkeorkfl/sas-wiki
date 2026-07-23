// @vitest-environment node
//
// P1 단위(hidden verify) · Task 3 (plan/tdd §Task 3) · 급소② 슬러그 lockstep 교차 단언
//
// 성격: 불변식 가드다. 렌더(html)와 추출(extractHeadings)이 **같은 slugifyHeading/withDedupSuffix**
//   를 쓰므로 heading id 와 앵커가 일치해야 한다. 이 verify 는 GREEN 이 heading id 를 앵커와
//   **별개로 하드코딩**(우연 일치)하는 스펙-게이밍을 잡는다 — 반드시 같은 SSOT 를 흘려야 통과한다.
//
//   현 렌더러도 slugifyHeading 을 재사용하므로 이 테스트는 **현재 green** 이다(회귀 앵커 성격).
//   교체 후에도 green 을 유지해야 한다(약화·우회 금지). RED 신호가 아니라 lockstep 불변식 잠금이다.
import { describe, expect, it } from 'vitest'

import { extractHeadings } from '../parse.mjs'
import { renderMarkdownToHtml } from '../render.mjs'

const noWikilink = () => ({ exists: false, path: '' })

describe('slug lockstep — 렌더 heading id === extractHeadings 앵커 (급소②)', () => {
  // 한글 + 중복 heading → 실 slugify·dedup 강제(하드코딩 우연 일치 차단).
  const body = [
    '## 공급망',
    '',
    '문단 1.',
    '',
    '## 공급망',
    '',
    '문단 2.',
    '',
    '## 삼성전자 HBM',
    '',
    '끝.',
  ].join('\n')

  it('dedup 포맷을 핀한다: 중복 heading 은 -2 부터 (문서별 카운터)', () => {
    expect(extractHeadings(body).map((heading) => heading.anchor)).toEqual([
      '공급망',
      '공급망-2',
      '삼성전자-hbm',
    ])
  })

  it('각 heading 의 렌더 id 가 대응 extractHeadings 앵커와 일치한다 (교차 단언)', () => {
    const html = renderMarkdownToHtml(body, noWikilink)

    for (const { anchor } of extractHeadings(body)) {
      expect(html).toContain(`id="${anchor}"`)
    }
  })
})
