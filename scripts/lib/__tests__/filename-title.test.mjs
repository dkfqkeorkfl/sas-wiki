import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { derive } from '../derive.mjs'
import { validateItem } from '../schema-validator.mjs'

const schema = JSON.parse(
  readFileSync(new URL('../../schema/wiki-doc.schema.json', import.meta.url)),
)
const ID = '0192a000-0000-7000-8000-0000000000aa'

function document(relPath, extra = {}) {
  return {
    body: '## 개요\n\n기준 시점의 분석이다.\n',
    breadcrumb: relPath.split('/'),
    frontmatter: { id: ID, status: 'active', type: 'concept', ...extra },
    relPath,
  }
}

function generate(docs) {
  return derive(
    docs,
    (args) => [`${'a'.repeat(40)}\t2026-08-28T00:00:00Z`, '', `A\t${args.at(-1)}`].join('\n'),
    { wikiPrefix: 'wiki/' },
  )
}

describe('파일명이 표시 제목의 유일한 출처다', () => {
  it('frontmatter title 없이 문서 스키마를 통과한다', () => {
    expect(validateItem(document('concept/메모리').frontmatter, schema)).toEqual([])
  })

  it.each(['active', 'disable'])('%s 문서는 기존 title 대신 파일명 전체를 표시한다', (status) => {
    const { docs } = generate([
      document('TREND/2026-08/28. 원화 강세', {
        status,
        title: '옛 제목',
      }),
    ])
    expect(docs[0].title).toBe('28. 원화 강세')
  })

  it.each(['삼성전자', 'AI사업과-우주개발', 'v2.0 분석'])(
    '파일명 %s의 공백·하이픈·마침표를 보존한다',
    (name) => {
      expect(generate([document(`concept/${name}`)]).docs[0].title).toBe(name)
    },
  )

  it('날짜가 붙은 파일명으로 월별 트리를 정렬한다', () => {
    const later = document('REPORT/2026-08/28. 가 분석')
    const earlier = document('REPORT/2026-08/04. 나 분석', {
      id: '0192a000-0000-7000-8000-0000000000bb',
    })
    const { tree } = generate([later, earlier])
    expect(tree[0].children[0].docs).toEqual([earlier.frontmatter.id, later.frontmatter.id])
  })
})
