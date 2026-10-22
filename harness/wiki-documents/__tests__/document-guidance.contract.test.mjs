import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (file) => readFileSync(new URL(`../../../${file}`, import.meta.url), 'utf8')
const readme = read('README.md')
const guard = read('harness/wiki-documents/__tests__/document-rules.guard.test.mjs')
const invariants = read('harness/wiki-documents/document-invariants.mjs')
const state = read('harness/wiki-documents/document-state.mjs')
const unique = (values) => [...new Set(values)]
const captures = (text, pattern) => [...text.matchAll(pattern)].map((match) => match[1])
const labels = (text) => unique(captures(text, /\[wiki\]\s+([a-z-]+):/g)).sort()
const warningLabels = [
  'deadlink',
  'excluded',
  'invalid-excluded-ref',
  'unpublished-feed',
  'unresolved',
  'warning',
]

function block(name) {
  const start = `<!-- contract:${name} -->`
  const end = `<!-- /contract:${name} -->`
  expect(readme.split(start)).toHaveLength(2)
  expect(readme.split(end)).toHaveLength(2)
  const value = readme.slice(readme.indexOf(start) + start.length, readme.indexOf(end))
  expect(value.trim().length).toBeGreaterThan(0)
  return value
}

describe('문서 검사 안내와 실제 판정·진단의 계약', () => {
  it('불변식 번호와 제목의 개수가 실제 방출 번호와 같다', () => {
    const emitted = unique(captures(invariants, /fail\(\s*`불변식 (\d+):/g))
      .map(Number)
      .sort((a, b) => a - b)
    expect(emitted).toEqual([1, 2, 3, 4, 5, 7, 8])
    const documented = captures(block('invariants'), /^\|\s*(\d+)\s*\|/gm).map(Number)
    expect(documented).toEqual(emitted)
    expect(unique(captures(invariants, /불변식 (\d+)종/g))).toEqual(['7'])
    expect(captures(readme, /^#{2,4}\s+불변식 (\d+)종\s*$/gm)).toEqual(['7'])
  })

  it('제외 사유의 안내와 코드가 우선순위 순서까지 일치한다', () => {
    const expected = [
      'NO_FRONTMATTER',
      'MISSING_TYPE',
      'SCHEMA_VIOLATION',
      'DUPLICATE_PATH',
      'DUPLICATE_ID',
      'ID_TAMPERED',
      'DELETED_ID_REUSE',
    ]
    expect(captures(state.split('export function')[0], /'([A-Z][A-Z_]+)'/g)).toEqual(expected)
    expect(unique(captures(block('reason-codes'), /`([A-Z][A-Z_]+)`/g))).toEqual(expected)
  })

  it('보고·경고 라벨을 양방향으로 안내하며 제거된 라벨을 소개하지 않는다', () => {
    expect(labels(guard)).toEqual(warningLabels)
    expect(labels(block('warning-labels'))).toEqual(warningLabels)
    expect(readme).not.toContain('off-convention')
    expect(guard).not.toContain('off-convention')
  })

  it('라벨 추출은 진단 한 종류를 지운 사본에서 그 부재를 알아낸다', () => {
    const mutated = guard
      .split('\n')
      .filter((line) => !line.includes('[wiki] deadlink:'))
      .join('\n')
    expect(labels(mutated)).toEqual(warningLabels.filter((label) => label !== 'deadlink'))
    expect(labels(guard)).toEqual(warningLabels)
  })

  it('성공 통계의 키와 순서가 안내와 같고 예시 값의 범위를 설명한다', () => {
    const start = guard.indexOf('`[wiki] docs=')
    expect(start).toBeGreaterThan(0)
    const output = guard.slice(start, guard.indexOf('\n      )', start))
    const expected = ['docs', 'body', 'feeds', 'prune', 'prunedFeeds', 'unresolved', 'warnings']
    expect(captures(output, /(\w+)=\$\{/g)).toEqual(expected)
    const example = readme.split('\n').find((line) => line.startsWith('[wiki] docs='))
    expect(example).toBeDefined()
    expect(captures(example, /(\w+)=/g)).toEqual(expected)
    const disclaimer = readme.indexOf('vault 상태에 따라 달라진다', readme.indexOf(example))
    expect(disclaimer).toBeGreaterThan(readme.indexOf(example))
    expect(readme.slice(readme.indexOf(example), disclaimer)).not.toMatch(/^#{1,6}\s/gm)
  })
})
