import { describe, expect, it } from 'vitest'

import { inspectDocument } from './document-rules.mjs'

function doc(asOf = '2026-08-28', extra = {}) {
  return {
    frontmatter: { type: 'concept', meta: { asOf }, ...extra },
    body: `이 분석은 **${asOf} 기준**이다.\n\n## 개요\n\n본문.\n`,
  }
}

describe.each(['TREND', 'REPORT'])('%s 공통 작성 규칙', (kind) => {
  const file = `${kind}/2026-08/28. 원화 강세.md`

  it('두 자리 일자와 표시 제목이 있는 경로를 허용한다', () => {
    expect(inspectDocument(file, doc())).toEqual([])
  })

  it.each([
    '2026-08-28 원화 강세.md',
    '28 원화 강세.md',
    '28.원화 강세.md',
    '8. 원화 강세.md',
    '00. 원화 강세.md',
    '32. 원화 강세.md',
    '28. .md',
    '28.  원화 강세.md',
    '28. 원화 강세 .md',
    '28. 11-30-00 원화 강세.md',
  ])('잘못된 파일명 %s를 거부한다', (name) => {
    expect(inspectDocument(`${kind}/2026-08/${name}`, doc()).length).toBeGreaterThan(0)
  })

  it.each([
    `${kind}/28. 원화 강세.md`,
    `${kind}/2026/28. 원화 강세.md`,
    `${kind}/2026-8/28. 원화 강세.md`,
    `${kind}/2026-13/28. 원화 강세.md`,
    `${kind}/2026-00/28. 원화 강세.md`,
    `${kind}/0000-08/28. 원화 강세.md`,
    `${kind}/2026-08/추가/28. 원화 강세.md`,
    `${kind}/2026-08/28. 원화/강세.md`,
  ])('잘못된 폴더 구조 %s를 거부한다', (rel) => {
    expect(inspectDocument(rel, doc()).length).toBeGreaterThan(0)
  })

  it.each(['2026-02/29', '2100-02/29', '2026-04/31', '2026-02/30'])(
    '실제 존재하지 않는 날짜 %s를 거부한다',
    (date) => {
      expect(
        inspectDocument(`${kind}/${date}. 분석.md`, doc(date.replace('/', '-'))).length,
      ).toBeGreaterThan(0)
    },
  )

  it.each(['2024-02/29', '2000-02/29', '2026-04/30', '0099-08/28'])(
    '윤년·월말·네 자리 연도 %s를 허용한다',
    (date) => {
      expect(inspectDocument(`${kind}/${date}. 분석.md`, doc(date.replace('/', '-')))).toEqual([])
    },
  )

  it.each([undefined, null, 20260828, '2026-08-27', '2026-09-28', '2026-08-28T11:30:00+09:00'])(
    '경로와 다르거나 날짜 문자열이 아닌 asOf %s를 거부한다',
    (asOf) => {
      const parsed = doc()
      parsed.frontmatter.meta.asOf = asOf
      expect(inspectDocument(file, parsed).some((issue) => issue.code === 'AS_OF')).toBe(true)
    },
  )

  it.each([undefined, null, [], {}])('meta가 %s여도 검사 중 예외 없이 거부한다', (meta) => {
    expect(
      inspectDocument(file, doc('2026-08-28', { meta })).some((issue) => issue.code === 'AS_OF'),
    ).toBe(true)
  })

  it.each(['company', 'moc', undefined])('type %s를 거부한다', (type) => {
    expect(
      inspectDocument(file, doc('2026-08-28', { type })).some((issue) => issue.code === 'TYPE'),
    ).toBe(true)
  })

  it.each(['', '## 개요\n\n2026-08-28 기준이다.', '이 분석은 2026-08-27 기준이다.'])(
    '본문 첫 줄의 기준일 누락·불일치를 거부한다',
    (body) => {
      expect(
        inspectDocument(file, { ...doc(), body }).some((issue) => issue.code === 'AS_OF_NOTICE'),
      ).toBe(true)
    },
  )

  it('frontmatter가 없는 문서는 누락으로 판정한다', () => {
    expect(inspectDocument(file, null)).toEqual([
      {
        code: 'FRONTMATTER',
        message: 'frontmatter가 없거나 해석할 수 없습니다.',
      },
    ])
  })

  it('본문 기준일에 숫자를 더 붙여 다른 날짜로 대체할 수 없다', () => {
    const parsed = { ...doc(), body: '이 분석은 2026-08-280 기준이다.' }
    expect(inspectDocument(file, parsed).some((issue) => issue.code === 'AS_OF_NOTICE')).toBe(true)
  })
})

describe('모든 위키 문서의 제목', () => {
  it.each(['concept/메모리.md', 'KOSPI/삼성전자/삼성전자.md', '개요.md'])(
    '%s에는 날짜 규칙을 적용하지 않는다',
    (file) => {
      expect(inspectDocument(file, { frontmatter: {}, body: '' })).toEqual([])
    },
  )

  it.each(['원화 강세', '', null])('중복 작성한 title %s는 거부한다', (title) => {
    expect(
      inspectDocument('concept/메모리.md', {
        frontmatter: { title },
        body: '',
      }),
    ).toEqual([
      {
        code: 'AUTHORED_TITLE',
        message: 'title을 적지 마세요. 표시 제목은 확장자를 뺀 파일명 전체입니다.',
      },
    ])
  })
})
