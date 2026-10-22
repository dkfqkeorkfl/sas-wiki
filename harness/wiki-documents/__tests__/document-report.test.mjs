import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { loadSchema, validateItem } from '../../../scripts/lib/schema-validator.mjs'
import { cleanup, commit, initVault, makeOut, writeDoc } from '../../test-utils/tmp-git-vault.mjs'
import { inspectVault } from '../document-integrity.mjs'

const schema = loadSchema(
  fileURLToPath(new URL('../../../scripts/schema/report.schema.json', import.meta.url)),
)
const id = '0192a000-0000-7000-8000-0000000000aa'

describe('문서 집행 보고와 실패 관측', () => {
  it.each(['dev', 'prod'])('%s의 JSON/TXT가 같은 커밋·총계를 담고 스키마를 지킨다', (env) => {
    const vault = initVault(),
      reportDir = makeOut()
    try {
      writeDoc(vault, 'concept/문서', { id })
      const sha = commit(vault, 'chore: 문서 생성')
      let observed
      const result = inspectVault({
        vault,
        env,
        reportDir,
        onReport(report) {
          observed = report
        },
      })
      const report = JSON.parse(readFileSync(result.report.jsonPath, 'utf8'))
      const text = readFileSync(result.report.txtPath, 'utf8')
      expect(path.basename(result.report.jsonPath)).toBe(`summary.report.${env}.json`)
      expect(path.basename(result.report.txtPath)).toBe(`summary.report.${env}.txt`)
      expect(validateItem(report, schema)).toEqual([])
      expect(report).toEqual(observed)
      expect(report.sourceCommit).toBe(sha)
      expect(text).toContain(sha)
      expect(text).toContain('total=1 included=1 excluded=0')
      expect(result.summary.sourceCommit).toBe(sha)
      expect(existsSync(path.join(vault, 'cache'))).toBe(false)
    } finally {
      cleanup(vault, reportDir)
    }
  })

  it('보고 경로가 없으면 파일을 만들지 않으면서 같은 사실을 알린다', () => {
    const vault = initVault()
    try {
      writeDoc(vault, 'concept/문서', { id })
      commit(vault, 'chore: 문서 생성')
      let observed
      const { report } = inspectVault({
        vault,
        env: 'dev',
        onReport(value) {
          observed = value
        },
      })
      expect(report).toEqual({ error: null, jsonPath: null, txtPath: null })
      expect(observed.summary).toEqual({ total: 1, included: 1, excluded: 0 })
      expect(existsSync(path.join(vault, 'logs'))).toBe(false)
    } finally {
      cleanup(vault)
    }
  })

  it.each([false, true])(
    '쓰기 실패는 성공이 되지 않고 정책 동시 실패($0)도 관측된다',
    (duplicate) => {
      const vault = initVault(),
        out = makeOut()
      try {
        writeDoc(vault, 'concept/문서', { id })
        if (duplicate) writeDoc(vault, 'concept/복사', { id })
        commit(vault, 'chore: 문서 생성')
        const blocker = path.join(out, 'file')
        writeFileSync(blocker, 'directory blocker')
        let observed
        let detail
        expect(() => {
          try {
            inspectVault({
              vault,
              env: 'dev',
              reportDir: path.join(blocker, 'logs'),
              onReport(payload, write) {
                observed = { payload, write }
              },
            })
          } catch (error) {
            detail = error.message
            throw error
          }
        }).toThrow(/리포트 쓰기 실패/)
        expect(observed.write.error).toBeTruthy()
        expect(detail).toContain(observed.write.error)
        expect(observed.payload.summary.excluded).toBe(duplicate ? 2 : 0)
        if (duplicate) expect(detail).toContain('DUPLICATE_ID')
      } finally {
        cleanup(vault, out)
      }
    },
  )

  it('정책 실패 전 제외와 참조의 진단을 파일과 관측 채널에 남긴다', () => {
    const vault = initVault(),
      reportDir = makeOut()
    try {
      writeDoc(vault, 'concept/문서', { id })
      writeDoc(vault, 'concept/복사', { id })
      commit(vault, 'chore: 문서 생성')
      let observed
      expect(() =>
        inspectVault({
          vault,
          env: 'dev',
          reportDir,
          onReport(value) {
            observed = value
          },
        }),
      ).toThrow(/DUPLICATE_ID/)
      const saved = JSON.parse(
        readFileSync(path.join(reportDir, 'summary.report.dev.json'), 'utf8'),
      )
      expect(saved).toEqual(observed)
      expect(saved.excluded.map((entry) => entry.path).toSorted()).toEqual([
        'wiki/concept/문서.md',
        'wiki/concept/복사.md',
      ])
      expect(validateItem(saved, schema)).toEqual([])
    } finally {
      cleanup(vault, reportDir)
    }
  })
})
