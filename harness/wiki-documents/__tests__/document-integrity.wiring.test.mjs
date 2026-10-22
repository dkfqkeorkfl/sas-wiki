import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  cleanup,
  commit,
  feedCommit,
  initVault,
  writeDoc,
} from '../../test-utils/tmp-git-vault.mjs'

const payloads = await vi.importActual('../../../scripts/lib/payloads.mjs')
const parsing = await vi.importActual('../../../scripts/lib/parse-vault.mjs')
const roots = []
afterEach(() => {
  cleanup(...roots.splice(0))
  vi.doUnmock('../../../scripts/lib/payloads.mjs')
  vi.doUnmock('../../../scripts/lib/parse-vault.mjs')
  vi.resetModules()
})

function seed() {
  const vault = initVault()
  roots.push(vault)
  writeDoc(vault, 'concept/문서', { id: '0192a000-0000-7000-8000-0000000000aa' })
  commit(vault, 'chore: 문서 생성')
  writeDoc(vault, 'concept/문서', {
    id: '0192a000-0000-7000-8000-0000000000aa',
    body: '갱신된 문서입니다.\n',
  })
  feedCommit(vault, { subject: '문서 갱신' })
  return vault
}

describe('공유 기능 결과에 대한 전체 집행 연결', () => {
  it('정상 wire는 통과하지만 스키마 위반을 만드는 빌더는 실패한다', async () => {
    const vault = seed()
    const normal = await import('../document-integrity.mjs')
    expect(normal.inspectVault({ vault, env: 'dev' }).feeds.items).toHaveLength(1)
    vi.resetModules()
    vi.doMock('../../../scripts/lib/payloads.mjs', () => ({
      ...payloads,
      buildFeeds(input) {
        return { ...payloads.buildFeeds(input), unexpected: true }
      },
    }))
    const broken = await import('../document-integrity.mjs')
    expect(() => broken.inspectVault({ vault, env: 'dev' })).toThrow(
      /산출물 스키마 위반[\s\S]*unexpected/,
    )
  })

  it('스키마를 통과하는 tree 누락도 불변식 집행에서 실패한다', async () => {
    const vault = seed()
    vi.resetModules()
    vi.doMock('../../../scripts/lib/payloads.mjs', () => ({
      ...payloads,
      buildSummary(input) {
        return { ...payloads.buildSummary(input), tree: [] }
      },
    }))
    const broken = await import('../document-integrity.mjs')
    expect(() => broken.inspectVault({ vault, env: 'dev' })).toThrow(/불변식 3[\s\S]*tree/)
  })

  it('빌드의 200건 윈도우 바깥 참조도 전량 집행에서 검출한다', async () => {
    const vault = seed()
    const missingId = '0192b000-0000-7000-8000-0000000000bb'
    vi.resetModules()
    vi.doMock('../../../scripts/lib/parse-vault.mjs', () => ({
      ...parsing,
      parseVault(...args) {
        const result = parsing.parseVault(...args)
        const item = result.wire.items[0]
        result.wire.items = Array.from({ length: 201 }, (_, index) => ({
          ...item,
          id: index.toString(16).padStart(12, '0'),
          docs: index === 200 ? [{ id: missingId }] : item.docs,
        }))
        return result
      },
    }))
    const broken = await import('../document-integrity.mjs')
    expect(() => broken.inspectVault({ vault, env: 'dev' })).toThrow(
      new RegExp(`불변식 1[\\s\\S]*${missingId}`),
    )
  })
})
