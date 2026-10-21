import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { collectMarkdownFilesRecursive, parseMarkdownFile } from '../scripts/lib/parse.mjs'
import { inspectDocument } from './document-rules.mjs'

const root = path.resolve('wiki')
const files = collectMarkdownFilesRecursive(root)

describe('실제 wiki 문서의 작성 규칙', () => {
  it('검사할 마크다운 문서가 존재한다', () => {
    expect(files.length).toBeGreaterThan(0)
  })

  it.each(files.map((file) => [path.relative(root, file).split(path.sep).join('/'), file]))(
    '%s',
    (rel, file) => {
      const issues = inspectDocument(rel, parseMarkdownFile(file))
      expect(
        issues,
        `${rel}\n${issues.map((issue) => `${issue.code}: ${issue.message}`).join('\n')}`,
      ).toEqual([])
    },
  )
})
