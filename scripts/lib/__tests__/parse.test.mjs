// @vitest-environment node
//
// P1 3-A · scripts/wiki/lib/parse.mjs (순수 파싱 함수)
// 대상: parseFrontmatterYaml · slugifyHeading
// RED 사유: scripts/wiki/lib/parse.mjs 미구현(모듈 부재) → import 실패.
// 무변경 포팅 회귀 고정: 알고리즘 개선이 아니라 docs/sas-wiki-package/scripts/build.mjs
//   의 순수 함수를 export 가능한 형태로 옮긴 뒤에도 동일 동작을 보장하는 계약.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  derivePathAndBreadcrumb,
  parseFrontmatterYaml,
  parseMarkdownFile,
  slugifyHeading,
} from '../parse.mjs'

const WIKI_DIR = path.join('/repo', 'wiki')

describe('parseFrontmatterYaml', () => {
  it('스칼라 + flow list + 1단계 중첩(meta) 을 객체로 파싱한다', () => {
    const yaml =
      "title: 삼성전자\ntype: company\nstatus: active\ntags: [반도체]\nmeta:\n  ticker: '005930'"

    const result = parseFrontmatterYaml(yaml, 'wiki/company/samsung.md')

    expect(result).toEqual({
      meta: { ticker: '005930' },
      status: 'active',
      tags: ['반도체'],
      title: '삼성전자',
      type: 'company',
    })
  })

  it('빈 frontmatter 문자열은 빈 객체를 반환한다', () => {
    expect(parseFrontmatterYaml('', 'wiki/x.md')).toEqual({})
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

// parseMarkdownFile — body 선행 공백 처리. 결함(재현됨): 프론트매터 뒤 남는 공백을 `\s+`(개행·탭·
//   스페이스 전부 포함) 하나로 뭉뚱그려 벗기면, "빈 줄 뒤 들여쓰기 코드로 시작하는 body" 에서
//   그 들여쓰기까지 함께 사라진다 — 마크다운에서 4-space 들여쓰기는 코드블록 의미를 가지므로 그
//   손상은 렌더 결과를 바꾼다. 고친 정규식은 "공백/탭만 있다가 개행으로 끝나는 줄"(빈 줄)만 반복
//   제거하고, 그 뒤 처음 나오는 비-빈 줄의 선행 공백(들여쓰기)은 절대 건드리지 않는다.
describe('parseMarkdownFile — body 선행 공백은 빈 줄만 제거하고 들여쓰기는 보존한다', () => {
  const tmpDirs = []
  afterEach(() => {
    while (tmpDirs.length > 0) rmSync(tmpDirs.pop(), { force: true, recursive: true })
  })

  function writeTempDoc(raw) {
    const dir = mkdtempSync(path.join(tmpdir(), 'parse-body-'))
    tmpDirs.push(dir)
    const filePath = path.join(dir, 'doc.md')
    writeFileSync(filePath, raw, 'utf8')
    return filePath
  }

  it('빈 줄 하나 뒤 4-space 들여쓰기 코드로 시작하는 body 는 들여쓰기가 보존된다(재현: 예전엔 소실)', () => {
    const raw =
      '---\ntitle: 테스트\ntype: concept\nstatus: active\n---\n\n    const x = 1;\n다음 줄이다.\n'
    const parsed = parseMarkdownFile(writeTempDoc(raw))

    expect(parsed.body.startsWith('    const x = 1;')).toBe(true)
    // bodyLineOffset 은 raw 안에서 body 의 첫 줄이 실제로 몇 번째 줄인지를 가리켜야 한다 — 리터럴
    //   줄번호를 박는 대신 offset 자신으로 raw 를 인덱싱해 자기검증한다(개수 리터럴 금지).
    expect(raw.split('\n')[parsed.bodyLineOffset]).toBe('    const x = 1;')
  })

  it('빈 줄이 전혀 없이 들여쓰기 코드로 바로 시작하는 body 도 들여쓰기가 보존된다', () => {
    const raw =
      '---\ntitle: 테스트\ntype: concept\nstatus: active\n---\n    const y = 2;\n다음 줄이다.\n'
    const parsed = parseMarkdownFile(writeTempDoc(raw))

    expect(parsed.body.startsWith('    const y = 2;')).toBe(true)
    expect(raw.split('\n')[parsed.bodyLineOffset]).toBe('    const y = 2;')
  })

  it('빈 줄(공백만 있는 줄 포함) 뒤 들여쓰기 없는 본문은 그 빈 줄만 사라진다(회귀 방지 — 실 vault 형태)', () => {
    // 실 vault 문서(예: 프론트매터 뒤 빈 줄 하나 · 그다음 들여쓰기 없는 헤딩)가 이 형태다.
    const raw = '---\ntitle: 테스트\ntype: concept\nstatus: active\n---\n   \n## 개요\n\n본문.\n'
    const parsed = parseMarkdownFile(writeTempDoc(raw))

    expect(parsed.body.startsWith('## 개요')).toBe(true)
    expect(raw.split('\n')[parsed.bodyLineOffset]).toBe('## 개요')
  })

  it('연속된 빈 줄(공백만 있는 줄 포함)은 전부 제거되고 첫 들여쓰기 콘텐츠 줄만 남는다', () => {
    const raw =
      '---\ntitle: 테스트\ntype: concept\nstatus: active\n---\n\n  \n\n    들여쓰기 본문.\n'
    const parsed = parseMarkdownFile(writeTempDoc(raw))

    expect(parsed.body.startsWith('    들여쓰기 본문.')).toBe(true)
    expect(raw.split('\n')[parsed.bodyLineOffset]).toBe('    들여쓰기 본문.')
  })
})
