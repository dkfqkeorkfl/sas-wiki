import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { collectMarkdownFilesRecursive } from '../../../scripts/lib/parse.mjs'
import { collectHeadDocuments } from '../../../scripts/lib/head-state.mjs'
import {
  GIT_HISTORY_TIMEOUT_MS,
  makeGitRunner,
  memoizeGitRunner,
} from '../../../scripts/lib/git.mjs'
import { inspectVault } from '../document-integrity.mjs'
import { inspectDocument } from '../document-rules.mjs'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const wikiDir = path.join(root, 'wiki')
const files = collectMarkdownFilesRecursive(wikiDir)
const relativePath = (base, file) => path.relative(base, file).split(path.sep).join('/')
let snapshot
let runGit

beforeAll(() => {
  const rawCount = process.env.GIT_CONFIG_COUNT ?? '0'
  const count = Number(rawCount)
  if (
    !/^\d+$/u.test(rawCount) ||
    !Number.isSafeInteger(count) ||
    count >= Number.MAX_SAFE_INTEGER
  ) {
    throw new Error(`GIT_CONFIG_COUNT가 유효한 Git 설정 개수가 아닙니다: ${rawCount}`)
  }
  // 전역 설정을 읽지 않는 테스트 환경에서도 이 실제 vault만 신뢰한다. 기존 설정은 보존한다.
  vi.stubEnv(`GIT_CONFIG_KEY_${count}`, 'safe.directory')
  vi.stubEnv(`GIT_CONFIG_VALUE_${count}`, path.resolve(root))
  vi.stubEnv('GIT_CONFIG_COUNT', String(count + 1))
  snapshot = collectHeadDocuments(root)
  runGit = memoizeGitRunner(
    makeGitRunner(root, { timeoutMs: GIT_HISTORY_TIMEOUT_MS, killSignal: 'SIGKILL' }),
  )
})

afterAll(() => {
  vi.unstubAllEnvs()
})

describe('실제 위키 문서', () => {
  it('집행할 마크다운 문서가 존재한다', () => {
    expect(files.length, `${wikiDir}: 검사할 마크다운 문서가 없습니다.`).toBeGreaterThan(0)
  })

  it.each(files.map((file) => [relativePath(wikiDir, file), file]))(
    '%s의 작성 규칙을 지킨다',
    (relativeFile, file) => {
      const parsed = snapshot.parsedDocs.find((doc) => doc.filePath === file) ?? null
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
      const { body, feeds, report, stats, summary } = inspectVault({
        env,
        snapshot,
        runGit,
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

      console.log(
        `[wiki] docs=${summary.docs.length} body=${Object.keys(body.docs).length} feeds=${feeds.items.length}` +
          ` prune=${stats.prunedDocRefs} prunedFeeds=${stats.prunedFeeds}` +
          ` unresolved=${stats.unresolvedPaths.length}` +
          ` warnings=${stats.warnings.length + stats.unpublishedFeedCommits.length + stats.deadlinks.length}`,
      )
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
