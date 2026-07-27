import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { docPath, judgeDocs } from './doc-gate.mjs'
import { isDraft } from './draft.mjs'
import { makeGitRunner } from './git.mjs'
import {
  collectMarkdownFilesRecursive,
  derivePathAndBreadcrumb,
  parseMarkdownFile,
} from './parse.mjs'
import { loadSchema } from './validate.mjs'

/** vault 문서의 리포 상대 경로 접두사 — 여기가 유일한 소유자다(이관 가능성). */
export const WIKI_PREFIX = 'wiki/'

/** 생산 JSON Schema 디렉토리 — 이 모듈은 scripts/lib/ 이므로 상위 scripts/schema. */
const SCHEMA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'schema')

/**
 * HEAD 시점의 문서 상태 계층 — 수집·가시성(env)·문서 게이트 판정을 **한 곳에서** 한다.
 *
 * 서빙(`git-walk.mjs collectFeedItems`)과 검증·파생(`parse-vault.mjs parseVault`)이 **같은 이것**을
 * 쓴다. 예전에는 두 파일이 같은 판정을 각자 구현했고, 그러면 한쪽만 바뀔 때 "서빙되는 문서 집합"과
 * "검증되는 문서 집합"이 조용히 갈린다(P3 Task 9 가 통합).
 *
 * `deepDocGate` 는 비용 티어 스위치다(D-A) — 켠 호출자(`validate`·생성기)만 git 을 파는 판정을 얻고,
 * 라이브 서빙 경로는 git spawn 0 인 얕은 판정만 받는다.
 *
 * @param {string} vaultDir
 * @param {'dev'|'prod'} env
 * @param {{ deepDocGate?: boolean, runGit?: Function, schemaDir?: string }} [options]
 */
export function loadHeadDocState(
  vaultDir,
  env,
  { deepDocGate = false, runGit: injectedRunGit, schemaDir = SCHEMA_DIR } = {},
) {
  const runGit = injectedRunGit ?? makeGitRunner(vaultDir)
  const wikiDir = path.join(vaultDir, ...WIKI_PREFIX.split('/').filter(Boolean))

  // 위키 루트에 있으나 파싱에 실패한 `.md`(frontmatter 부재 등). **문서 후보이되 문서는 아니다** —
  //   피드가 이런 파일을 가리키면 조용히 넘기지 않고 unresolved 로 시끄럽게 끊어야 어느 커밋이
  //   깨진 문서를 참조하는지 알 수 있다(validate.cli 계약: sha + 경로). 이 판정은 "지금 위키 루트
  //   안에 있는가"를 묻는 **HEAD 상태 계층**이므로 여기서 prefix 를 쓰는 것이 정당하다 — 커밋별 diff
  //   루프(히스토리 계층)에 prefix 리터럴을 되돌려 넣으면 P2 가 없앤 결합이 부활한다.
  const strayDocPaths = new Set()

  const parsedDocs = collectMarkdownFilesRecursive(wikiDir)
    .map((filePath) => {
      const parsed = parseMarkdownFile(filePath)
      if (!parsed) {
        strayDocPaths.add(
          `${WIKI_PREFIX}${path.relative(wikiDir, filePath).split(path.sep).join('/')}`,
        )
        return null
      }
      const derived = derivePathAndBreadcrumb(filePath, wikiDir)
      return { ...parsed, breadcrumb: derived.breadcrumb, relPath: derived.path }
    })
    .filter((doc) => doc !== null)

  const visibleCandidates = env === 'dev' ? parsedDocs : parsedDocs.filter((doc) => !isDraft(doc))
  const draftExcludedDocs = env === 'dev' ? [] : parsedDocs.filter((doc) => isDraft(doc))
  const judged = judgeDocs(visibleCandidates, {
    runGit: deepDocGate ? runGit : undefined,
    strayPaths: strayDocPaths,
    wikiPrefix: WIKI_PREFIX,
    wikiSchema: loadSchema(path.join(schemaDir, 'wiki-doc.schema.json')),
  })
  const visibleDocs = judged.visible
  const excluded = judged.excluded
  const excludedPaths = new Set(excluded.map((entry) => entry.path))
  // 비교 좌표는 **판정한 쪽과 같은 함수**로 만든다 — 문자열을 각자 조립하면 한쪽만 정규화가 바뀔 때
  //   매칭이 조용히 어긋나 "제외했는데 여전히 서빙되는" 상태가 된다.
  const invalidDocs = visibleCandidates.filter((doc) =>
    excludedPaths.has(docPath(doc, WIKI_PREFIX)),
  )
  const invalidSet = new Set(invalidDocs)
  const invalidRefs = invalidDocs
    .map((doc) => ({ filePath: `${WIKI_PREFIX}${doc.relPath}.md`, id: doc.frontmatter.id }))
    .filter((doc) => typeof doc.id === 'string')

  const headDocs = parsedDocs
    .filter((doc) => !invalidSet.has(doc))
    .map((doc) => {
      const id = doc.frontmatter.id ?? doc.relPath
      // **문자열이 아닌 id 는 버린다.** 통합 전 `parse-vault` 에는 이 가드가 없어 `id: undefined` 가
      //   `buildPathIndex` 로 흘러들 수 있었다 — prod 의 draft 문서는 `judgeDocs`(스키마: id 필수)를
      //   거치지 않기 때문이다. 안전한 방향의 변화이며, 서빙 경로(구 git-walk)의 동작을 채택한 것이다.
      return typeof id === 'string'
        ? {
            draft: isDraft({ frontmatter: doc.frontmatter, relPath: doc.relPath }),
            filePath: `${WIKI_PREFIX}${doc.relPath}.md`,
            id,
          }
        : null
    })
    .filter((doc) => doc !== null)

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
