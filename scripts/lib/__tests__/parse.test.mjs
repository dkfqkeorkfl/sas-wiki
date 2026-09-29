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
  extractFrontmatterField,
  findFrontmatterFieldLine,
  parseFrontmatterYaml,
  parseMarkdownFile,
  slugifyHeading,
  upsertFrontmatterField,
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

// 필드 패턴은 테스트 로컬 리터럴이다(캡처 그룹 1 = 콜론 뒤 원시 값).
const ID_LINE = /^id[ \t]*:(.*)$/u
const TITLE_LINE = /^title[ \t]*:(.*)$/u
const ID = '0192f0c0-8000-7000-8000-0123456789ab'
const OTHER_ID = '0192f0c1-0000-7000-b000-000000000003'

describe('extractFrontmatterField — 패턴으로 지정한 frontmatter 필드 한 개의 값', () => {
  it('parseFrontmatterYaml 과 같은 스칼라 규칙으로 값을 해석한다(따옴표 제거)', () => {
    const md = `---\nid: '${ID}'\ntitle: "삼성전자"\n---\n\n본문\n`

    expect(extractFrontmatterField(md, ID_LINE)).toBe(ID)
    expect(extractFrontmatterField(md, TITLE_LINE)).toBe('삼성전자')
  })

  it('따옴표 모양만 다른 같은 값은 같은 값으로 읽힌다', () => {
    const single = extractFrontmatterField(`---\nid: '${ID}'\n---\n`, ID_LINE)
    const double = extractFrontmatterField(`---\nid: "${ID}"\n---\n`, ID_LINE)
    const bare = extractFrontmatterField(`---\nid: ${ID}\n---\n`, ID_LINE)

    expect(new Set([single, double, bare])).toEqual(new Set([ID]))
  })

  it('값이 비었거나 null 표기면 null 이다', () => {
    expect(extractFrontmatterField('---\nid:\ntitle: x\n---\n', ID_LINE)).toBeNull()
    expect(extractFrontmatterField("---\nid: ''\n---\n", ID_LINE)).toBe('')
    expect(extractFrontmatterField('---\nid: ~\n---\n', ID_LINE)).toBeNull()
  })

  it('필드 줄이 없거나 frontmatter 자체가 없으면 undefined 다', () => {
    expect(extractFrontmatterField('---\ntitle: x\n---\n', ID_LINE)).toBeUndefined()
    expect(extractFrontmatterField(`id: ${ID}\n\n본문\n`, ID_LINE)).toBeUndefined()
  })

  it('본문의 같은 모양 줄은 무시한다(frontmatter 블록 안만 본다)', () => {
    const md = `---\ntitle: x\n---\n\nid: ${ID}\n`

    expect(extractFrontmatterField(md, ID_LINE)).toBeUndefined()
  })

  it('같은 키가 두 번 나오면 뒤의 값을 쓴다(parseFrontmatterYaml 의 덮어쓰기 규칙)', () => {
    const md = `---\nid: ${ID}\ntitle: x\nid: ${OTHER_ID}\n---\n`

    expect(extractFrontmatterField(md, ID_LINE)).toBe(OTHER_ID)
    expect(parseFrontmatterYaml(`id: ${ID}\ntitle: x\nid: ${OTHER_ID}`).id).toBe(OTHER_ID)
  })

  it('CRLF 줄끝도 읽는다', () => {
    expect(extractFrontmatterField(`---\r\nid: '${ID}'\r\ntitle: x\r\n---\r\n`, ID_LINE)).toBe(ID)
  })

  it('frontmatter 가 parseFrontmatterYaml 로 해석되지 않으면 필드를 읽지 않는다(throw 하지 않는다)', () => {
    // 검증기가 문서로 인정하지 않는 frontmatter 에서 뽑은 값은 그 문서의 값이 아니다.
    const md = `---\nid: ${ID}\n  broken-indent: 1\n콜론 없는 줄\n---\n`

    expect(() => parseFrontmatterYaml(`id: ${ID}\n  broken-indent: 1\n콜론 없는 줄`)).toThrow()
    expect(extractFrontmatterField(md, ID_LINE)).toBeUndefined()
  })

  it('닫는 --- 가 빠진 문서에서 본문의 id: 예시를 frontmatter 값으로 읽지 않는다', () => {
    // 블록 끝을 본문의 가로줄(---)로 잘못 잡으면 본문 코드 예시가 frontmatter 안으로 들어온다.
    const md = `---\ntitle: x\n\n## 예시\n\n\`\`\`yaml\nid: ${OTHER_ID}\n\`\`\`\n\n---\n\n본문\n`

    expect(extractFrontmatterField(md, ID_LINE)).toBeUndefined()
  })
})

describe('findFrontmatterFieldLine — 필드 줄의 1 부터 세는 줄 번호', () => {
  // git blame `-L <n>,<n>` 에 그대로 넘기는 값이다. git 은 `\n` 만 줄 끝으로 센다.
  it('extractFrontmatterField 가 읽는 줄(반복되면 마지막 줄)의 번호다', () => {
    const md = `---\ntitle: x\nid: ${ID}\ntype: t\nid: ${OTHER_ID}\n---\n\n본문\n`

    expect(findFrontmatterFieldLine(md, ID_LINE)).toBe(5)
    expect(findFrontmatterFieldLine(md, TITLE_LINE)).toBe(2)
  })

  it('CRLF 문서도 `\\n` 기준으로 센다', () => {
    expect(findFrontmatterFieldLine(`---\r\ntitle: x\r\nid: ${ID}\r\n---\r\n`, ID_LINE)).toBe(3)
  })

  it('필드 줄이 없거나 frontmatter 가 해석되지 않으면 undefined 다', () => {
    expect(findFrontmatterFieldLine('---\ntitle: x\n---\n', ID_LINE)).toBeUndefined()
    expect(
      findFrontmatterFieldLine(`---\nid: ${ID}\n  broken: 1\n콜론 없음\n---\n`, ID_LINE),
    ).toBeUndefined()
    expect(findFrontmatterFieldLine(`id: ${ID}\n`, ID_LINE)).toBeUndefined()
  })
})

describe('upsertFrontmatterField — frontmatter 필드 한 줄을 바꾸거나 넣는다', () => {
  it('필드 줄이 없으면 frontmatter 첫 줄로 넣고 나머지는 바이트 그대로 둔다', () => {
    const md = '---\ntitle: x\ntype: concept\n---\n\n본문\n'

    expect(upsertFrontmatterField(md, ID_LINE, `id: '${ID}'`)).toBe(
      `---\nid: '${ID}'\ntitle: x\ntype: concept\n---\n\n본문\n`,
    )
  })

  it('필드 줄이 있으면 그 줄만 바꾼다', () => {
    const md = "---\ntitle: x\nid: ''\ntype: concept\n---\n\n본문\n"

    expect(upsertFrontmatterField(md, ID_LINE, `id: '${ID}'`)).toBe(
      `---\ntitle: x\nid: '${ID}'\ntype: concept\n---\n\n본문\n`,
    )
  })

  it('같은 키가 여러 줄이면 읽을 때 쓰이는 마지막 줄을 바꾼다', () => {
    const md = '---\nid: a\nid: b\n---\n'
    const next = upsertFrontmatterField(md, ID_LINE, `id: '${ID}'`)

    expect(next).toBe(`---\nid: a\nid: '${ID}'\n---\n`)
    expect(extractFrontmatterField(next, ID_LINE)).toBe(ID)
  })

  it('CRLF 파일에는 CRLF 로 넣는다', () => {
    const md = '---\r\ntitle: x\r\n---\r\n'

    expect(upsertFrontmatterField(md, ID_LINE, `id: '${ID}'`)).toBe(
      `---\r\nid: '${ID}'\r\ntitle: x\r\n---\r\n`,
    )
  })

  it('frontmatter 가 없으면 null 이다(쓸 자리가 없다)', () => {
    expect(upsertFrontmatterField('# 제목\n\n본문\n', ID_LINE, `id: '${ID}'`)).toBeNull()
  })

  it('frontmatter 가 해석되지 않으면 null 이다(깨진 블록에 쓰지 않는다)', () => {
    const md = '---\ntitle: x\n  broken-indent: 1\n---\n'

    expect(upsertFrontmatterField(md, ID_LINE, `id: '${ID}'`)).toBeNull()
  })
})
