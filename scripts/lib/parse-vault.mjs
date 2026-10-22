import { derive } from './derive.mjs'
import { collectFeedItems } from './git-walk.mjs'
import {
  checkGitAvailable,
  checkHistoryIntegrity,
  GIT_HISTORY_TIMEOUT_MS,
  makeGitRunner,
  memoizeGitRunner,
} from './git.mjs'
import { WIKI_PREFIX, loadHeadDocState } from './head-state.mjs'

/**
 * 기능 파싱·렌더·피드 해석의 공통 경로. 문서 감사와 억제 목록 위생 검사는 하네스가 소유한다.
 *
 * @param {string} vaultDir vault 리포 루트(절대경로)
 * @param {'dev'|'prod'} env
 * @param {{ runGit?: Function, headState?: object }} options 한 실행에서 재사용할 처리 상태
 * @returns {{ context: object, stats: object, wire: object }}
 */
export function parseVault(
  vaultDir,
  env,
  { runGit: injectedRunGit, headState: injectedHeadState } = {},
) {
  // 한 파싱 안에서 같은 git 질의는 같은 답을 낸다(리포는 그동안 변하지 않는다). 문서별
  // `git log --follow` 는 검증·파생·역인덱스 3곳이 각각 부르므로 캐시 없이는 프로세스 스폰이 3배다.
  const runGit = memoizeGitRunner(
    injectedRunGit ??
      makeGitRunner(vaultDir, {
        timeoutMs: GIT_HISTORY_TIMEOUT_MS,
        killSignal: 'SIGKILL',
      }),
  )
  checkGitAvailable(runGit)
  assertHistoryIntegrity(runGit, vaultDir)
  const sourceCommit = readSourceCommit(runGit)

  const headState = injectedHeadState ?? loadHeadDocState(vaultDir, env)
  const derived = derive(headState.visibleDocs, runGit, { wikiPrefix: WIKI_PREFIX })
  const { items, stats } = collectFeedItems(vaultDir, { env, headState, runGit })
  stats.excluded = headState.excluded

  return {
    context: { derived, headState, runGit },
    stats,
    wire: {
      bodies: derived.bodies,
      docs: derived.docs,
      generatedAt: deriveGeneratedAt(derived.docs),
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
// ECMA-262(Date 객체 절 · "Time Values and Time Range")가 규정한 표현 가능 범위 — 초과분에
// `new Date(...).toISOString()` 을 걸면 무엇이 왜 잘못됐는지 말하지 않는 `RangeError: Invalid time
// value` 만 남는다(값도 허용범위도 노출하지 않는 불투명 실패).
const MAX_DATE_VALUE_MS = 8_640_000_000_000_000

export function deriveGeneratedAt(docs) {
  const epoch = process.env.SOURCE_DATE_EPOCH
  if (epoch) {
    if (!/^\d+$/.test(epoch)) {
      throw new Error(
        `SOURCE_DATE_EPOCH 형식이 올바르지 않습니다(0 이상의 정수만 허용): "${epoch}"`,
      )
    }
    const epochMs = Number.parseInt(epoch, 10) * 1000
    if (!Number.isFinite(epochMs) || epochMs > MAX_DATE_VALUE_MS) {
      throw new Error(
        `SOURCE_DATE_EPOCH 값이 표현 가능한 날짜 범위를 벗어났습니다: "${epoch}"` +
          `(허용: 0 ~ ${MAX_DATE_VALUE_MS / 1000}초)`,
      )
    }
    return new Date(epochMs).toISOString()
  }
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
export function assertHistoryIntegrity(runGit, vaultDir) {
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

/**
 * 성공한 조회만 캐시한다(실패는 그대로 전파 — 조용한 폴백 금지). 러너 옵션(stdin `input` ·
 * 출력 `encoding`)도 결과를 바꾸므로 키에 넣고 그대로 넘긴다.
 */
function readSourceCommit(runGit) {
  try {
    return runGit(['rev-parse', '--verify', '-q', 'HEAD']).trim()
  } catch (error) {
    if (error.status === 1) return null
    throw error
  }
}
