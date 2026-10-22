import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { collectHeadDocuments } from '../../../scripts/lib/head-state.mjs'
import { makeGitRunner } from '../../../scripts/lib/git.mjs'
import { cleanup, commit, initVault, writeDoc } from '../../test-utils/tmp-git-vault.mjs'
import { auditHeadDocState, REASON_CODES } from '../document-state.mjs'
import { inspectVault } from '../document-integrity.mjs'

const schemaDir = fileURLToPath(new URL('../../../scripts/schema/', import.meta.url))
const id = '0192a000-0000-7000-8000-0000000000aa'
const otherId = '0192b000-0000-7000-8000-0000000000bb'

describe('draft와 공개 문서의 ID 충돌', () => {
  it.each(['dev', 'prod'])('%s는 충돌한 두 경로를 같은 사유로 제외하고 집행에 실패한다', (env) => {
    const vault = initVault()
    try {
      writeDoc(vault, 'company/공개', { id })
      commit(vault, 'chore: 공개 생성')
      writeDoc(vault, 'dev/초안', { id })
      commit(vault, 'chore: 초안 생성')
      const state = auditHeadDocState(collectHeadDocuments(vault), env, {
        schemaDir,
        runGit: makeGitRunner(vault),
      })
      expect(state.excluded.map((entry) => entry.path).toSorted()).toEqual([
        'wiki/company/공개.md',
        'wiki/dev/초안.md',
      ])
      expect(state.excluded.map((entry) => entry.reasonCode)).toEqual([
        'DUPLICATE_ID',
        'DUPLICATE_ID',
      ])
      expect(state.excluded.every((entry) => entry.message.includes(id))).toBe(true)
      expect(state.headDocs).toEqual([])
      expect(() => inspectVault({ vault, env })).toThrow(/DUPLICATE_ID[\s\S]*wiki\/dev\/초안.md/)
      writeDoc(vault, 'dev/초안', { id: otherId })
      // ID 변경 이력과 혼합하지 않도록 정상 대조군은 별도 저장소에서 확인한다.
    } finally {
      cleanup(vault)
    }
  })

  it.each(['dev', 'prod'])('%s는 서로 다른 ID를 가진 정상 공개·draft 문서를 허용한다', (env) => {
    const vault = initVault()
    try {
      writeDoc(vault, 'company/공개', { id })
      writeDoc(vault, 'dev/초안', { id: otherId })
      commit(vault, 'chore: 정상 문서 생성')
      const state = auditHeadDocState(collectHeadDocuments(vault), env, {
        schemaDir,
        runGit: makeGitRunner(vault),
      })
      expect(state.excluded).toEqual([])
      expect(state.headDocs.map((doc) => doc.filePath).toSorted()).toEqual([
        'wiki/company/공개.md',
        'wiki/dev/초안.md',
      ])
      expect(
        inspectVault({ vault, env })
          .summary.docs.map((doc) => doc.id)
          .toSorted(),
      ).toEqual(env === 'dev' ? [id, otherId] : [id])
    } finally {
      cleanup(vault)
    }
  })

  it('전부 draft인 prod의 문서 0건은 정상이다', () => {
    const vault = initVault()
    try {
      writeDoc(vault, 'dev/초안', { id })
      commit(vault, 'chore: 초안 생성')
      expect(inspectVault({ vault, env: 'prod' }).summary.docs).toEqual([])
    } finally {
      cleanup(vault)
    }
  })

  it('기존 사유 코드와 순서를 유지한다', () => {
    expect(REASON_CODES).toEqual([
      'NO_FRONTMATTER',
      'MISSING_TYPE',
      'SCHEMA_VIOLATION',
      'DUPLICATE_PATH',
      'DUPLICATE_ID',
      'ID_TAMPERED',
      'DELETED_ID_REUSE',
    ])
  })
})
