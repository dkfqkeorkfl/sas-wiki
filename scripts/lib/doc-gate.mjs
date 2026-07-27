import path from 'node:path'

import { anyMarkdown, collectDeletedDocEvents, readIdAtCreation, readIdAtDeletion } from './git.mjs'
import { validateItem } from './validate.mjs'

export const REASON_CODES = [
  'NO_FRONTMATTER',
  'MISSING_TYPE',
  'SCHEMA_VIOLATION',
  'DUPLICATE_PATH',
  'DUPLICATE_ID',
  'ID_TAMPERED',
  'DELETED_ID_REUSE',
]

export function judgeDocs(parsedDocs, ctx) {
  const wikiPrefix = ctx.wikiPrefix
  const wikiSchema = ctx.wikiSchema
  const issues = new Map()

  const docs = parsedDocs ?? []
  for (const doc of docs) {
    if (doc.frontmatter?.type === undefined) {
      setIssue(issues, doc, 'MISSING_TYPE', `type 필드가 없습니다: ${docPath(doc, wikiPrefix)}`)
      continue
    }

    const errors = validateItem(doc.frontmatter ?? {}, wikiSchema, docPath(doc, wikiPrefix))
    if ('created' in (doc.frontmatter ?? {}) || 'updated' in (doc.frontmatter ?? {})) {
      errors.push('created/updated는 frontmatter에서 제거되었습니다(git 히스토리 유도).')
    }
    if (errors.length > 0) {
      setIssue(issues, doc, 'SCHEMA_VIOLATION', errors.join('\n'))
    }
  }

  for (const [relPath, group] of groupsBy(docs, (doc) => doc.relPath)) {
    if (relPath === undefined || group.length < 2) continue
    for (const doc of group) {
      setIssue(issues, doc, 'DUPLICATE_PATH', `중복 path 발견: ${relPath}`, {
        force: !issues.has(doc),
      })
    }
  }

  for (const [id, group] of groupsBy(docs, (doc) => doc.frontmatter?.id)) {
    if (typeof id !== 'string' || group.length < 2) continue
    const idLooksValid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(id)
    for (const [index, doc] of group.entries()) {
      if (!idLooksValid && index === 0 && issues.get(doc)?.reasonCode === 'SCHEMA_VIOLATION') {
        continue
      }
      if (issues.get(doc)?.reasonCode === 'MISSING_TYPE') continue
      setIssue(issues, doc, 'DUPLICATE_ID', `중복 id 발견: ${id}`, { force: true })
    }
  }

  if (typeof ctx.runGit === 'function') {
    for (const doc of docs) {
      if (issues.has(doc)) continue
      const idAtCreation = readIdAtCreation(ctx.runGit, docPath(doc, wikiPrefix))
      if (idAtCreation !== null && idAtCreation !== doc.frontmatter.id) {
        setIssue(
          issues,
          doc,
          'ID_TAMPERED',
          `id 사후 변조: 생성 시점 id(${idAtCreation}) ≠ 현재 frontmatter id(${doc.frontmatter.id})`,
        )
      }
    }

    const livePathById = new Map(
      docs
        .filter((doc) => !issues.has(doc) && typeof doc.frontmatter?.id === 'string')
        .map((doc) => [doc.frontmatter.id, docPath(doc, wikiPrefix)]),
    )
    for (const event of collectDeletedDocEvents(ctx.runGit, { isDocPath: anyMarkdown })) {
      const deletedId = readIdAtDeletion(ctx.runGit, event)
      if (deletedId === null || !livePathById.has(deletedId)) continue
      const doc = docs.find((candidate) => candidate.frontmatter?.id === deletedId)
      if (doc && !issues.has(doc)) {
        setIssue(
          issues,
          doc,
          'DELETED_ID_REUSE',
          `삭제된 문서의 id 재사용: ${deletedId} ${event.path} -> ${livePathById.get(deletedId)}`,
        )
      }
    }
  }

  const excluded = []
  for (const strayPath of ctx.strayPaths ?? []) {
    excluded.push({
      id: null,
      message: `frontmatter 가 없어 문서로 해석되지 않는 파일: ${strayPath}`,
      path: strayPath,
      reasonCode: 'NO_FRONTMATTER',
    })
  }
  for (const [doc, issue] of issues.entries()) {
    excluded.push({
      id: typeof doc.frontmatter?.id === 'string' ? doc.frontmatter.id : null,
      message: issue.message,
      path: docPath(doc, wikiPrefix),
      reasonCode: issue.reasonCode,
    })
  }
  excluded.sort((a, b) => a.path.localeCompare(b.path, 'ko'))

  const excludedDocs = new Set(issues.keys())
  return {
    excluded,
    visible: docs.filter((doc) => !excludedDocs.has(doc)),
  }
}

function docPath(doc, wikiPrefix) {
  return `${wikiPrefix}${doc.relPath}.md`.split(path.sep).join('/')
}

function setIssue(issues, doc, reasonCode, message, { force = false } = {}) {
  if (!force && issues.has(doc)) return
  issues.set(doc, { message, reasonCode })
}

function groupsBy(values, getKey) {
  const out = new Map()
  for (const value of values) {
    const key = getKey(value)
    if (!out.has(key)) out.set(key, [])
    out.get(key).push(value)
  }
  return out
}
