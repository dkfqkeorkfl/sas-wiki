import path from 'node:path'

import { isDraft } from './draft.mjs'
import {
  collectMarkdownFilesRecursive,
  derivePathAndBreadcrumb,
  parseMarkdownFile,
} from './parse.mjs'

/** 문서와 피드가 공유하는 현재 위키 루트. */
export const WIKI_PREFIX = 'wiki/'

/** 파일 수집과 원문 파싱. 작성 규칙과 ID 이력을 감사하지 않는다. */
export function collectHeadDocuments(vaultDir) {
  const wikiDir = path.join(vaultDir, WIKI_PREFIX)
  const files = collectMarkdownFilesRecursive(wikiDir)
  const parsedDocs = []
  const strayDocPaths = new Set()
  for (const filePath of files) {
    let parsed
    try {
      parsed = parseMarkdownFile(filePath)
    } catch (error) {
      throw new Error(`${path.relative(vaultDir, filePath)}: PARSE ${error.message}`, {
        cause: error,
      })
    }
    if (!parsed) {
      strayDocPaths.add(path.relative(vaultDir, filePath).split(path.sep).join('/'))
      continue
    }
    const derived = derivePathAndBreadcrumb(filePath, wikiDir)
    parsedDocs.push({ ...parsed, breadcrumb: derived.breadcrumb, relPath: derived.path })
  }
  return { files, parsedDocs, strayDocPaths }
}

/** 제외 목록과 피드 해석이 공유하는 리포 상대 POSIX 경로. */
export function docPath(doc, wikiPrefix = WIKI_PREFIX) {
  return `${wikiPrefix}${doc.relPath}.md`.split(path.sep).join('/')
}

/** 이미 계산한 제외 데이터를 투영한다. 검사 정책은 호출하지 않는다. */
export function createHeadDocState({ parsedDocs, strayDocPaths }, env, excluded = []) {
  const excludedPaths = new Set(excluded.map((entry) => entry.path))
  const invalidDocs = parsedDocs.filter((doc) => excludedPaths.has(docPath(doc)))
  const invalidSet = new Set(invalidDocs)
  const candidates = env === 'dev' ? parsedDocs : parsedDocs.filter((doc) => !isDraft(doc))
  const visibleDocs = candidates.filter((doc) => !invalidSet.has(doc))
  const draftExcludedDocs = env === 'dev' ? [] : parsedDocs.filter((doc) => isDraft(doc))
  const invalidRefs = invalidDocs
    .map((doc) => ({ filePath: docPath(doc), id: doc.frontmatter.id }))
    .filter((doc) => typeof doc.id === 'string')
  const headDocs = parsedDocs
    .filter((doc) => !invalidSet.has(doc))
    .flatMap((doc) => {
      const id = doc.frontmatter.id ?? doc.relPath
      return typeof id === 'string' ? [{ draft: isDraft(doc), filePath: docPath(doc), id }] : []
    })
  return {
    draftExcludedDocs,
    excluded,
    headDocs,
    invalidDocs,
    invalidRefs,
    parsedDocs,
    strayDocPaths,
    visibleDocs,
  }
}

export function loadHeadDocState(vaultDir, env) {
  return createHeadDocState(collectHeadDocuments(vaultDir), env)
}
