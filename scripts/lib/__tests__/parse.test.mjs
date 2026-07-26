// @vitest-environment node
//
// P1 3-A · scripts/wiki/lib/parse.mjs (순수 파싱 함수) RED
// 대상: parseFrontmatterYaml · slugifyHeading
// RED 사유: scripts/wiki/lib/parse.mjs 미구현(모듈 부재) → import 실패.
// 무변경 포팅 회귀 고정: 알고리즘 개선이 아니라 docs/sas-wiki-package/scripts/build.mjs
//   의 순수 함수를 export 가능한 형태로 옮긴 뒤에도 동일 동작을 보장하는 계약.
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { derivePathAndBreadcrumb, parseFrontmatterYaml, slugifyHeading } from '../parse.mjs'

const WIKI_DIR = path.join('/repo', 'vault', 'wiki')

describe('parseFrontmatterYaml', () => {
  it('스칼라 + flow list + 1단계 중첩(meta) 을 객체로 파싱한다', () => {
    const yaml =
      "title: 삼성전자\ntype: company\nstatus: active\ntags: [반도체]\nmeta:\n  ticker: '005930'"

    const result = parseFrontmatterYaml(yaml, 'vault/wiki/company/samsung.md')

    expect(result).toEqual({
      meta: { ticker: '005930' },
      status: 'active',
      tags: ['반도체'],
      title: '삼성전자',
      type: 'company',
    })
  })

  it('빈 frontmatter 문자열은 빈 객체를 반환한다', () => {
    expect(parseFrontmatterYaml('', 'vault/wiki/x.md')).toEqual({})
  })

  it('meta 미기재 시 meta 키를 만들지 않는다(누락 보존)', () => {
    // 2번째 케이스: 하드코딩 리턴 방지 — 첫 케이스와 다른 키 집합을 요구.
    const result = parseFrontmatterYaml('title: 개념문서\ntype: concept\nstatus: active', 'x.md')

    expect(result).toEqual({ status: 'active', title: '개념문서', type: 'concept' })
    expect('meta' in result).toBe(false)
  })
})

// P2 RED-3 (tdd §6.3) — breadcrumb 의미 반전: **문서 슬러그를 포함**한다.
//   현행은 폴더만 낸다(`['company']`) → 신 계약은 `['company','삼성전자']`.
//   경로는 `breadcrumb.join('/')` 로 **유도**한다 — 계약에 문자열 path 필드는 없다(README · 계층).
describe('derivePathAndBreadcrumb (breadcrumb = 폴더들 + 문서 슬러그)', () => {
  it('중첩 문서의 breadcrumb 마지막 원소가 문서 슬러그다', () => {
    const derived = derivePathAndBreadcrumb(path.join(WIKI_DIR, 'company', '삼성전자.md'), WIKI_DIR)

    expect(derived).toEqual({ breadcrumb: ['company', '삼성전자'], path: 'company/삼성전자' })
  })

  it('루트 문서의 breadcrumb 은 ["<슬러그>"] 다(빈 배열이 아니다)', () => {
    // 2번째 케이스: 폴더만 담던 구 구현이면 여기서 `[]` 가 나온다 — 의미 반전의 핵심.
    const derived = derivePathAndBreadcrumb(path.join(WIKI_DIR, 'index.md'), WIKI_DIR)

    expect(derived.breadcrumb).toEqual(['index'])
    expect(derived.path).toBe('index')
  })

  it('breadcrumb.join("/") === path 다(불변식 5 의 전제)', () => {
    const derived = derivePathAndBreadcrumb(path.join(WIKI_DIR, 'a', 'b', 'c.md'), WIKI_DIR)

    expect(derived.breadcrumb).toEqual(['a', 'b', 'c'])
    expect(derived.breadcrumb.join('/')).toBe(derived.path)
  })
})

describe('slugifyHeading', () => {
  it('공백을 하이픈으로, 대문자를 소문자로 정규화한다(한글 보존)', () => {
    expect(slugifyHeading('삼성전자 HBM 공급')).toBe('삼성전자-hbm-공급')
  })

  it('특수문자를 제거하고 연속 하이픈을 접는다', () => {
    // 2번째 케이스: 특수문자 스트립·하이픈 접기 의도를 노출(하드코딩으로 통과 불가).
    expect(slugifyHeading('Q4 2025! Report?')).toBe('q4-2025-report')
  })
})
