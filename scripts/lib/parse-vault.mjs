import { derive } from './derive.mjs'
import { parseCommitForFeed } from './feed.mjs'
import { collectFeedItems } from './git-walk.mjs'
import { checkGitAvailable, checkHistoryIntegrity, collectGitLog, makeGitRunner } from './git.mjs'
import { WIKI_PREFIX, loadHeadDocState } from './head-state.mjs'
import { loadIgnoreFeeds, reportIgnoreHygiene } from './ignore.mjs'

/**
 * read-path 순수 파싱: git → pre-wire payload. **엔드포인트와 검증기(validate.mjs)가 공유하는 단일
 * 파싱 엔진**이다. 검증 throw-게이트는 여기서 돌지 않는다 — validate.mjs 가 반환된 `gate`/`stats`
 * 로 게이트를 얹고, on-demand 엔드포인트는 검증된 vault 를 가정하고 이 함수(의 `.wire`)만 부른다.
 *
 * ★ P5 Task 9(D-I) — 얕은 티어 선택 스위치를 제거했다. 문서 게이트 판정은 **항상 깊다**(호출자가
 * 티어를 고를 수 없다) — 얕은 판정으로 서빙하던 `feeds`·`wiki` 가 발행 아티팩트 소비자로 전환되며
 * (D-E·D-F) 이 함수의 얕은 호출자가 0이 됐기 때문이다.
 *
 * @param {string} vaultDir vault 리포 루트(절대경로)
 * @param {'dev'|'prod'} env
 * @param {string} schemaDir 생산 JSON Schema 디렉토리
 * @returns {{ gate: { commits: object[], derived: object, runGit: Function, visibleDocs: object[] }, stats: object, wire: object }}
 */
export function parseVault(vaultDir, env, schemaDir, { runGit: injectedRunGit } = {}) {
  // 한 파싱 안에서 같은 git 질의는 같은 답을 낸다(리포는 그동안 변하지 않는다). 문서별
  // `git log --follow` 는 검증·파생·역인덱스 3곳이 각각 부르므로 캐시 없이는 프로세스 스폰이 3배다.
  const runGit = memoize(injectedRunGit ?? makeGitRunner(vaultDir))
  checkGitAvailable(runGit)
  assertHistoryIntegrity(runGit, vaultDir)
  const commits = collectGitLog(runGit)
  const sourceCommit = commits.length > 0 ? commits[0].hash : null

  const headState = loadHeadDocState(vaultDir, env, { runGit, schemaDir })
  const derived = derive(headState.visibleDocs, runGit, { wikiPrefix: WIKI_PREFIX })
  const { items, stats } = collectFeedItems(vaultDir, { env, headState, runGit })
  stats.excluded = headState.excluded

  // ★ P5 Task 8(D-H) — 이 읽기는 **관용적**이다(malformed 를 삼킨다). `wire.ignore` 는 read-path 소비자
  //   (엔드포인트·GA 계열 회귀)를 위한 참조 값일 뿐, fail-loud 게이트가 아니다 — 그 책임은 `validate.mjs`
  //   가 자신의(관용적이지 않은) 별도 로드로 진다(OQ-P5-6·SU8). 여기서 그대로 throw 하면 malformed
  //   억제 목록 하나가 조회용 생성기 경로까지 죽인다 — 검증도 하지
  //   않는 조회 경로가 검증기와 같은 엄격도를 가질 이유가 없다.
  // try 는 **로드 한 줄만** 감싼다. 계산까지 감싸면 hygiene·커밋 파싱 쪽 버그가 여기서 조용히
  //   삼켜지고, 이미 정상 로드된 `ignore` 까지 `[]` 로 되돌아간다(관용의 범위가 의도보다 넓어진다).
  let ignore = []
  try {
    ignore = loadIgnoreFeeds(vaultDir, schemaDir)
  } catch {
    ignore = []
  }
  const allFeedIds = new Set(
    commits
      .filter((commit) => parseCommitForFeed(commit) !== null)
      .map((commit) => commit.hash.slice(0, 12)),
  )
  for (const stale of reportIgnoreHygiene(ignore, allFeedIds)) {
    stats.warnings.push({ reason: 'stale ignore-feeds 억제(대응 feed 없음)', sha: stale.id })
  }

  return {
    // 게이트 원자재 — validate.mjs 가 여기서 검증 throw-게이트를 얹는다(파싱 자신은 검증하지 않는다).
    gate: { commits, derived, runGit, visibleDocs: headState.visibleDocs },
    stats,
    wire: {
      bodies: derived.bodies,
      docs: derived.docs,
      generatedAt: deriveGeneratedAt(derived.docs),
      ignore,
      items,
      sourceCommit,
      tags: derived.tags,
      tree: derived.tree,
    },
  }
}

/**
 * 아티팩트 `generatedAt` — **`max(doc.updated)`만**(D-B). item ts 는 더 이상 입력이 아니다.
 *
 * 억제된 피드의 ts 가 이 값에 남으면 CWE-204 급 누출이다(B14 실측) — 그래서 아티팩트 층은 문서
 * updated 만 본다. 서빙 시점 `generatedAt` 은 `feeds.mjs` 가 억제 **후** item ts 와 다시 max 를
 * 낸다(두 층 — FC7 소관). 여기서 items 를 다시 받지 않는다: 인자를 남긴 채 무시하면 다음 사람이
 * "빠뜨렸나" 하고 되돌린다.
 */
export function deriveGeneratedAt(docs) {
  const epoch = process.env.SOURCE_DATE_EPOCH
  if (epoch && /^\d+$/.test(epoch)) return new Date(Number.parseInt(epoch, 10) * 1000).toISOString()
  const timestamps = []
  for (const doc of docs) if (doc.updated) timestamps.push(new Date(doc.updated).toISOString())
  if (timestamps.length === 0) return '1970-01-01T00:00:00.000Z'
  timestamps.sort()
  return timestamps.at(-1)
}

/**
 * 얕은/부분 클론 선제 fail. 얕은 히스토리는 생성 커밋을 잘라 **문서 id 와 피드를 조용히 틀리게 만든다**
 * — 빌드는 exit 0, 스키마는 통과, 화면은 정상 렌더. 데이터만 틀린다. 그래서 여기서 시끄럽게 끊는다.
 */
function assertHistoryIntegrity(runGit, vaultDir) {
  const { partialFilter, shallow } = checkHistoryIntegrity(runGit)
  if (shallow) {
    throw new Error(
      `얕은(shallow) 히스토리입니다: ${vaultDir}\n` +
        '얕은 히스토리는 생성 커밋과 feed: 커밋을 잘라 문서 id 와 피드를 조용히 틀리게 만듭니다.\n' +
        `복구: git -C ${vaultDir} fetch --unshallow  (CI 는 actions/checkout 의 fetch-depth: 0)`,
    )
  }
  if (partialFilter) {
    throw new Error(
      `partial clone(필터 "${partialFilter}")입니다: ${vaultDir}\n` +
        'blob 이 지연 로드되면 문서 본문 검증이 조용히 어긋납니다.\n' +
        `복구: 필터 없이 다시 클론하세요 (git -C ${vaultDir} config --unset remote.origin.partialclonefilter 후 full fetch)`,
    )
  }
}

/** 성공한 조회만 캐시한다(실패는 그대로 전파 — 조용한 폴백 금지). */
function memoize(runGit) {
  const cache = new Map()
  return (args) => {
    const key = JSON.stringify(args)
    if (cache.has(key)) return cache.get(key)
    const value = runGit(args)
    cache.set(key, value)
    return value
  }
}
