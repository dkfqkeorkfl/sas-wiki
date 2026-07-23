// @vitest-environment node
//
// P1 통합(hidden verify) · Task 4 (plan/tdd §Task 4) · 렌더 seam 교체 회귀 0 (합성 vault)
//
// derive() 산출 bodies[].html 이 렌더 교체 후에도 위키링크 계약·heading id 를 보존하고,
//   추출 파생물(headings=TOC · sources=footnote defs · excerpt)이 회귀 0 임을 합성 vault 로 고정한다.
//   또한 footnote 렌더 드롭(§2)이 seam 을 통과하되 sources 추출은 존치함을 이중 단언한다.
//
// RED 사유: 현 render.mjs 는 footnote inline 을 <sup> 로 낸다 → bodies[].html 이 <sup> 를 포함
//   → 드롭 단언 실패(seam 미교체). 나머지(위키링크 계약·heading id·headings/sources/excerpt)는
//   교체 전후 보존되어야 하는 회귀 앵커다(현재 green — 약화 금지).
//
// 정본 문서수에 결합하지 않는다 — 합성 parsedDocs + 스텁 git 러너(격리, 실 git 무의존).
import { describe, expect, it } from 'vitest'

import { derive } from '../derive.mjs'

const NOTE_SHA = '1111111111110000000000000000000000001111'
const HBM_SHA = '2222222222221111111111111111111111112222'
const NOTE_ID = '0192a000-0000-7000-8000-0000000000aa'
const HBM_ID = '0192b000-0000-7000-8000-0000000000bb'

/** `git log --follow --name-status --format=%H%x09%aI` 의 실제 출력(최신순). */
function aLog(sha, file) {
  return [
    `${sha}\t2026-01-09T00:00:00Z`,
    '',
    `M\t${file}`,
    `${sha}\t2026-01-01T00:00:00Z`,
    '',
    `A\t${file}`,
  ].join('\n')
}

/** 파일별(마지막 arg) 로그를 돌려주는 스텁 러너 — 경로 부분일치(vault 접두사 주입 무관). */
function makeRunner(logByRel) {
  return (args) => {
    const file = String(args.at(-1))
    for (const [rel, log] of Object.entries(logByRel)) {
      if (file.includes(`${rel}.md`)) return log
    }
    return ''
  }
}

function aParsedDoc(patch) {
  const relPath = patch.relPath
  return {
    body: '## 정의\n\n본문.\n',
    breadcrumb: relPath.split('/'),
    filePath: `/tmp/vault/wiki/${relPath}.md`,
    frontmatter: { id: patch.id, status: 'active', tags: [], title: relPath, type: 'concept' },
    relPath,
    ...patch,
  }
}

// 합성 vault: note 가 존재 위키링크 [[HBM]] 과 footnote [^1](정의 있음)을 담는다.
const WORLD = [
  aParsedDoc({
    body: '## 개요\n\nHBM 참고: [[HBM]] 문서.\n\n각주 표기[^1] 는 렌더에서 드롭된다.\n\n[^1]: 사업보고서\n',
    id: NOTE_ID,
    relPath: 'note',
  }),
  aParsedDoc({ body: '## 정의\n\nHBM 은 적층 메모리다.\n', id: HBM_ID, relPath: 'HBM' }),
]

const RUNNER = makeRunner({
  HBM: aLog(HBM_SHA, 'vault/wiki/HBM.md'),
  note: aLog(NOTE_SHA, 'vault/wiki/note.md'),
})

function bodyOf(rel) {
  const { bodies } = derive(WORLD, RUNNER)
  return bodies.find((body) => body.breadcrumb.join('/') === rel)
}

describe('derive render seam — bodies[].html 계약 보존 (회귀 앵커)', () => {
  it('존재 위키링크가 wiki-link class·data-path 를 보존한다 (실 resolver 경유)', () => {
    const html = bodyOf('note').html

    expect(html).toContain('class="wiki-link"')
    expect(html).toContain('data-path="HBM"')
  })

  it('bodies[].html heading id 가 headings(TOC) 앵커와 일치한다 (lockstep, 실 seam)', () => {
    const body = bodyOf('note')

    for (const { anchor } of body.headings) {
      expect(body.html).toContain(`id="${anchor}"`)
    }
  })

  it('headings(TOC)·excerpt 파생물이 렌더 교체와 무관하게 유지된다 (회귀 0)', () => {
    const { bodies, docs } = derive(WORLD, RUNNER)
    const body = bodies.find((b) => b.breadcrumb.join('/') === 'note')
    const doc = docs.find((d) => d.breadcrumb.join('/') === 'note')

    expect(body.headings.map((heading) => heading.anchor)).toEqual(['개요'])
    expect(doc.excerpt).toContain('HBM 참고')
  })
})

describe('derive render seam — footnote 렌더 드롭 + 추출 존치 (§2 이중 단언)', () => {
  it('footnote 는 렌더에서 드롭되고(<sup> 없음) sources 추출은 존치한다', () => {
    const body = bodyOf('note')

    expect(body.html).not.toContain('<sup') // 렌더 드롭(RED — 현 렌더러는 <sup> 생성)
    expect(body.sources).toContainEqual({ label: '1', text: '사업보고서' }) // 추출 존치(회귀 0)
  })
})
