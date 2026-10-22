import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { collectMarkdownFilesRecursive, parseMarkdownFile } from '../../../scripts/lib/parse.mjs'
import { buildContent } from '../../../scripts/validate.mjs'
import { inspectDocument } from '../document-rules.mjs'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const wikiDir = path.join(root, 'wiki')
const files = collectMarkdownFilesRecursive(wikiDir)
const relativePath = (base, file) => path.relative(base, file).split(path.sep).join('/')

describe('실제 위키 문서', () => {
  it('집행할 마크다운 문서가 존재한다', () => {
    expect(files.length, `${wikiDir}: 검사할 마크다운 문서가 없습니다.`).toBeGreaterThan(0)
  })

  it.each(files.map((file) => [relativePath(wikiDir, file), file]))(
    '%s의 작성 규칙을 지킨다',
    (relativeFile, file) => {
      let parsed
      try {
        parsed = parseMarkdownFile(file)
      } catch (error) {
        throw new Error(
          `${relativeFile}: PARSE ${error instanceof Error ? error.message : String(error)}`,
          { cause: error },
        )
      }
      const issues = inspectDocument(relativeFile, parsed)
      expect(
        issues,
        `${relativeFile}\n${issues.map((issue) => `${issue.code}: ${issue.message}`).join('\n')}`,
      ).toEqual([])
    },
  )

  it.each(['dev', 'prod'])(
    '%s 문서·이력·참조·산출물의 무결성을 지킨다',
    (env) => {
      const { report, stats } = buildContent({
        env,
        onReport(payload, write) {
          console.log(
            `[wiki] env=${payload.env} total=${payload.summary.total}` +
              ` included=${payload.summary.included} excluded=${payload.summary.excluded}` +
              ` prunedFeeds=${payload.prunedFeeds} unresolved=${payload.unresolvedPaths.length}` +
              ` invalidExcludedRefs=${payload.invalidExcludedRefs.length}` +
              ` sourceCommit=${payload.sourceCommit}`,
          )
          for (const entry of payload.excluded) {
            console.log(`[wiki] excluded: ${entry.path} ${entry.reasonCode} ${entry.message}`)
          }
          for (const entry of payload.unresolvedPaths) {
            console.log(`[wiki] unresolved: ${entry.sha} ${entry.path}`)
          }
          for (const entry of payload.invalidExcludedRefs) {
            console.log(`[wiki] invalid-excluded-ref: ${entry.sha} ${entry.path}`)
          }
          if (write.error) console.error(`[wiki] report error (${env}): ${write.error}`)
        },
        reportDir: path.join(root, 'logs'),
        vault: root,
      })

      for (const entry of stats.deadlinks) {
        console.warn(
          `[wiki] deadlink: ${relativePath(root, entry.from)}` +
            ` -> [[${entry.target}${entry.anchor ? `#${entry.anchor}` : ''}]] (${entry.reason})`,
        )
      }
      for (const entry of stats.warnings) {
        console.warn(`[wiki] warning: ${entry.sha} ${entry.reason}`)
      }
      for (const entry of stats.unpublishedFeedCommits) {
        console.warn(`[wiki] unpublished-feed: ${entry.sha} ${entry.subject}`)
      }

      expect(report.error, `${env} 보고서 쓰기 실패: ${report.error}`).toBeNull()
    },
    180000,
  )
})
