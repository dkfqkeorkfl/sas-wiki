import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { validateItem } from '../schema-validator.mjs'

const schema = JSON.parse(
  readFileSync(new URL('../../schema/wiki-doc.schema.json', import.meta.url), 'utf8'),
)

describe('파일명 제목을 사용하는 문서 스키마', () => {
  it('frontmatter title 없이 문서 스키마를 통과한다', () => {
    const frontmatter = {
      id: '0192a000-0000-7000-8000-0000000000aa',
      status: 'active',
      type: 'concept',
    }

    expect(validateItem(frontmatter, schema)).toEqual([])
  })
})
