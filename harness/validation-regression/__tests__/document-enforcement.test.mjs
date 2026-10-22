import { readFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'

import { repoRoot, withProbe } from '../../test-utils/vitest-probe.mjs'

const guard = 'harness/wiki-documents/__tests__/document-rules.guard.test.mjs'
const rules = 'harness/wiki-documents/document-rules.mjs'
const parser = pathToFileURL(path.join(repoRoot, 'scripts/lib/parse.mjs')).href
const file = 'TREND/2026-08/28. 분석.md'
const valid = '---\ntype: concept\nmeta:\n  asOf: 2026-08-28\n---\n\n2026-08-28 기준 분석입니다.\n'

// 무결성 생성은 fixture stub이다. 실제 가드·검사기·parser의 실행과 실패 전달을 검증한다.
function probe({
  body = valid,
  empty = false,
  parseError = false,
  buildError = false,
  reportError = false,
  warning = false,
} = {}) {
  return withProbe(({ root, write, copy, run }) => {
    copy(guard)
    copy(rules)
    if (!empty) write(`wiki/${file}`, body)
    write(
      'scripts/lib/parse.mjs',
      `import { collectMarkdownFilesRecursive, parseMarkdownFile as parse } from ${JSON.stringify(parser)}
       export { collectMarkdownFilesRecursive }
       export function parseMarkdownFile(file) {
         if (${parseError}) throw new Error('fixture parse failure')
         return parse(file)
       }`,
    )
    write(
      'scripts/validate.mjs',
      `import { appendFileSync } from 'node:fs'
       export function buildContent({ env, onReport }) {
         appendFileSync(new URL('../calls', import.meta.url), env + '\\n')
         if (${buildError}) throw new Error('fixture-sha wiki/missing.md unresolved')
         const error = ${reportError ? "'fixture report write failure'" : 'null'}
         onReport({ env, sourceCommit: 'fixture-sha', summary: { total: 1, included: 1, excluded: 0 },
           prunedFeeds: 0, unresolvedPaths: [], invalidExcludedRefs: [], excluded: [] }, { error })
         return {
           body: { docs: {} }, feeds: { items: [] }, report: { error }, summary: { docs: [] },
           stats: { prunedDocRefs: 0, prunedFeeds: 0, unresolvedPaths: [], warnings: [],
             unpublishedFeedCommits: [], deadlinks: ${warning ? "[{ from: 'wiki/source.md', target: 'missing', reason: 'fixture warning' }]" : '[]'} }
         }
       }`,
    )
    const result = run()
    return { ...result, calls: readFileSync(path.join(root, 'calls'), 'utf8').trim().split('\n') }
  })
}

describe('문서 집행의 검출력과 실패 전달', () => {
  it('정상 문서와 prod의 빈 결과는 통과하며 두 환경을 검사한다', () => {
    const result = probe()
    expect(result.status, result.output).toBe(0)
    expect(result.calls).toEqual(['dev', 'prod'])
  })

  it.each([
    ['AUTHORED_TITLE', valid.replace('type: concept', 'type: concept\ntitle: 중복 제목')],
    ['AS_OF', valid.replace('asOf: 2026-08-28', 'asOf: 2026-08-27')],
    ['FRONTMATTER', '2026-08-28 기준이지만 frontmatter가 없습니다.\n'],
  ])('%s 위반은 문서 경로를 포함해 실패한다', (code, body) => {
    const result = probe({ body })
    expect(result.status, result.output).not.toBe(0)
    expect(result.output).toContain(file)
    expect(result.output).toContain(code)
  })

  it('전체 wiki 입력이 비면 성공하지 않는다', () => {
    const result = probe({ empty: true })
    expect(result.status, result.output).not.toBe(0)
    expect(result.output).toContain('검사할 마크다운 문서가 없습니다')
  })

  it('파싱 예외를 문서 경로와 원인으로 전달한다', () => {
    const result = probe({ parseError: true })
    expect(result.status, result.output).not.toBe(0)
    expect(result.output).toContain(file)
    expect(result.output).toContain('PARSE fixture parse failure')
  })

  it('무결성 검사의 실패에서 경로와 커밋 식별자를 숨기지 않는다', () => {
    const result = probe({ buildError: true })
    expect(result.status, result.output).not.toBe(0)
    expect(result.output).toContain('fixture-sha wiki/missing.md unresolved')
  })

  it('보고서 쓰기 실패를 성공으로 바꾸지 않는다', () => {
    const result = probe({ reportError: true })
    expect(result.status, result.output).not.toBe(0)
    expect(result.output).toContain('fixture report write failure')
  })

  it('링크 경고는 출력하면서 성공을 유지한다', () => {
    const result = probe({ warning: true })
    expect(result.status, result.output).toBe(0)
    expect(result.output).toContain('fixture warning')
    expect(result.output).toContain('missing')
  })
})
