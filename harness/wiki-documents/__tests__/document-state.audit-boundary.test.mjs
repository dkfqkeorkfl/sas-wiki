import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { loadHeadDocState, WIKI_PREFIX } from '../../../scripts/lib/head-state.mjs'
import { makeGitRunner } from '../../../scripts/lib/git.mjs'
import { loadSchema } from '../../../scripts/lib/schema-validator.mjs'
import { cleanup, commit, initVault, writeDoc } from '../../test-utils/tmp-git-vault.mjs'
import { judgeDocs } from '../document-state.mjs'

describe('현재 문서 수집과 ID 이력 감사의 경계', () => {
  it('동일한 문서를 수집하고 Git 이력을 감사할 때만 ID 변경을 판정한다', () => {
    const vault = initVault()
    const originalId = '0192e000-0000-7000-8000-0000000000e2'
    const changedId = '0192e000-0000-7000-8000-0000000000e3'
    try {
      writeDoc(vault, 'company/정상', { id: '0192e000-0000-7000-8000-0000000000e1' })
      writeDoc(vault, 'company/변경', { id: originalId })
      commit(vault, 'chore: 문서 생성')
      writeDoc(vault, 'company/변경', { id: changedId })
      commit(vault, 'chore: ID 변경')
      const state = loadHeadDocState(vault, 'dev')
      const context = {
        strayPaths: state.strayDocPaths,
        wikiPrefix: WIKI_PREFIX,
        wikiSchema: loadSchema(
          fileURLToPath(new URL('../../../scripts/schema/wiki-doc.schema.json', import.meta.url)),
        ),
      }
      expect(state.parsedDocs).toHaveLength(2)
      expect(state.excluded).toEqual([])
      expect(judgeDocs(state.parsedDocs, context).excluded).toEqual([])
      const audited = judgeDocs(state.parsedDocs, { ...context, runGit: makeGitRunner(vault) })
      expect(audited.excluded).toEqual([
        expect.objectContaining({
          path: 'wiki/company/변경.md',
          id: changedId,
          reasonCode: 'ID_TAMPERED',
        }),
      ])
    } finally {
      cleanup(vault)
    }
  })
})
