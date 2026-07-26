// @vitest-environment node
//
// P2 RED-2 · scripts/wiki/lib/git.mjs (rename 역인덱스 · 삭제 집합 · shallow 판정) — tdd §6.2
//
// RED 사유:
//   ① `getFileHistory`·`buildPathIndex`·`collectDeletedDocPaths`·`checkHistoryIntegrity` 미구현
//      (export 부재) → import 링크 실패(파일 전체 RED).
//   ② `getFileCommitDates` 는 현행이 `%H%x09%aI` 만 뽑아 **당시 경로를 내지 않고**,
//      hash 를 "가장 오래된 커밋"으로 잡는다 → 삭제 후 재생성 문서의 **죽은 id 를 부활**시킨다.
//      신 계약은 **가장 최근 `A`(생성) 커밋**이다(README · 문서 id).
//
// DI 계약(기존 유지): 파싱 래퍼는 runGit(args)=>string 러너를 주입받는다.
//   stub 러너로 (1) 파싱 정확성 (2) 기대 args 를 고정한다.
//
// 계약(GREEN 이 구현할 seam):
//   getFileHistory(runGit, relFilePath)  → [{ oldPath?, pathAtCommit, sha, status, ts }] (최신순)
//   getFileCommitDates(runGit, relPath)  → { created, hash, updated }  (getFileHistory 위의 얇은 래퍼)
//   buildPathIndex(docs, runGit)         → Map<`${sha}:${당시경로}`, docId>   docs: [{ filePath, id }]
//   collectDeletedDocPaths(runGit, { headPaths, wikiPrefix }) → Set<'vault/wiki/….md'>
//   checkHistoryIntegrity(runGit)        → { partialFilter, shallow }
import { describe, expect, it } from 'vitest'

import {
  buildPathIndex,
  checkHistoryIntegrity,
  collectDeletedDocPaths,
  collectEverDeletedDocPaths,
  collectGitLog,
  getCommitDiffHunks,
  getCommitDocStatuses,
  getFileCommitDates,
  getFileHistory,
  makeGitRunner,
} from '../git.mjs'

const US = String.fromCodePoint(31) // Unit Separator (필드)
const RS = String.fromCodePoint(30) // Record Separator (레코드)
const rec = (h, d, s, b) => `${h}${US}${d}${US}${s}${US}${b}${RS}`

/** `rev-parse --is-shallow-repository` · `config --get remote.origin.partialclonefilter` 에 답하는 stub. */
function stubRunner({ filter = '', shallow = 'false' } = {}) {
  return (args) => {
    if (args.includes('--is-shallow-repository')) return shallow
    if (args.includes('remote.origin.partialclonefilter')) return filter
    return ''
  }
}

const HBM_NOW = 'vault/wiki/tech/HBM.md'
const HBM_THEN = 'vault/wiki/concept/HBM.md'
const SCRAP = 'vault/wiki/concept/폐기예정-메모.md'

// `git log --follow --name-status --format=%H%x09%aI -- <path>` 의 **실제** 출력.
// 레코드 = 헤더줄 + 빈 줄 + 상태줄(들). rename 은 `R100\told\tnew`(탭 2개), A/M/D 는 탭 1개.
const HBM_LOG = [
  'sha12\t2026-01-12T00:00:00Z',
  '',
  `R100\t${HBM_THEN}\t${HBM_NOW}`,
  'sha11\t2026-01-11T00:00:00Z',
  '',
  `M\t${HBM_THEN}`,
  'sha04\t2026-01-04T00:00:00Z',
  '',
  `A\t${HBM_THEN}`,
].join('\n')

// 삭제 후 **같은 경로**에 새 문서를 만든 히스토리(최신순) — 새 문서다(README · 문서 id).
const REBORN_LOG = [
  'shaNew\t2026-03-01T00:00:00Z',
  '',
  `A\t${SCRAP}`,
  'shaDel\t2026-02-01T00:00:00Z',
  '',
  `D\t${SCRAP}`,
  'shaOld\t2026-01-01T00:00:00Z',
  '',
  `A\t${SCRAP}`,
].join('\n')

describe('makeGitRunner', () => {
  it('cwd 를 받아 호출 가능한 러너를 반환한다', () => {
    expect(typeof makeGitRunner('/tmp')).toBe('function')
  })
})

describe('collectGitLog', () => {
  it('US/RS 레코드 stdout 을 hash·authorDate·subject·body 로 파싱한다', () => {
    const stdout =
      rec('h1', '2026-01-02T00:00:00+00:00', 'feed: a', 'body1') +
      '\n' +
      rec('h2', '2026-01-01T00:00:00+00:00', 'chore: b', '')

    const calls = []
    const log = collectGitLog((args) => {
      calls.push(args)
      return stdout
    })

    expect(log).toHaveLength(2)
    expect(log[0]).toMatchObject({
      authorDate: '2026-01-02T00:00:00+00:00',
      hash: 'h1',
      subject: 'feed: a',
    })
    expect(log[1].subject).toBe('chore: b')
    expect(calls[0][0]).toBe('log')
    expect(calls[0].some((a) => a.includes('--format'))).toBe(true)
  })

  it('빈 stdout(커밋 0건)은 빈 배열을 반환한다', () => {
    expect(collectGitLog(() => '')).toEqual([])
  })
})

describe('getFileHistory (신설 — 당시 경로)', () => {
  it('--name-status 출력에서 상태와 **당시 경로**를 낸다(rename 은 탭 2개)', () => {
    const history = getFileHistory(() => HBM_LOG, HBM_NOW)

    expect(history).toEqual([
      { oldPath: HBM_THEN, pathAtCommit: HBM_NOW, sha: 'sha12', status: 'R', ts: '2026-01-12T00:00:00Z' }, // prettier-ignore
      { pathAtCommit: HBM_THEN, sha: 'sha11', status: 'M', ts: '2026-01-11T00:00:00Z' },
      { pathAtCommit: HBM_THEN, sha: 'sha04', status: 'A', ts: '2026-01-04T00:00:00Z' },
    ])
  })

  it('--follow · --name-status · core.quotepath=false 로 호출하고 경로를 마지막에 둔다', () => {
    // quotepath 를 빼면 한글 경로가 octal escape 로 나와 **역인덱스 키가 통째로 어긋난다**.
    const calls = []
    getFileHistory((args) => {
      calls.push(args)
      return ''
    }, 'vault/wiki/company/삼성전자.md')

    expect(calls[0]).toContain('--follow')
    expect(calls[0]).toContain('--name-status')
    expect(calls[0].join(' ')).toContain('core.quotepath=false')
    expect(calls[0].at(-1)).toBe('vault/wiki/company/삼성전자.md')
  })

  it('빈 로그는 빈 배열이다', () => {
    expect(getFileHistory(() => '', HBM_NOW)).toEqual([])
  })
})

describe('getFileCommitDates — id 는 가장 최근 A(생성) 커밋', () => {
  it('rename 을 포함한 히스토리에서 생성 커밋 hash·created·updated 를 낸다', () => {
    const dates = getFileCommitDates(() => HBM_LOG, HBM_NOW)

    // 이동해도 id 는 안 바뀐다 — 추가(A)는 커밋 4 한 번뿐이다.
    expect(dates.hash).toBe('sha04')
    expect(dates.created).toBe('2026-01-04T00:00:00Z')
    expect(dates.updated).toBe('2026-01-12T00:00:00Z')
  })

  it('삭제 후 같은 경로에 재생성된 문서는 **새 id** 를 갖는다(옛 생성 해시 부활 금지)', () => {
    // 2번째 케이스 의도: "가장 오래된 커밋" 구현(현행)이면 shaOld 를 내어 **죽은 문서의 id 가 부활**한다.
    // 그러면 과거 피드가 엉뚱한 새 문서를 가리킨다(README · 문서 id).
    const dates = getFileCommitDates(() => REBORN_LOG, SCRAP)

    expect(dates.hash).toBe('shaNew')
    expect(dates.created).toBe('2026-03-01T00:00:00Z')
  })

  it('빈 로그(미커밋)는 hash/created/updated 모두 null 이다', () => {
    expect(getFileCommitDates(() => '', 'vault/wiki/x.md')).toEqual({
      created: null,
      hash: null,
      updated: null,
    })
  })
})

describe('buildPathIndex — (커밋, 당시경로) → 현재 문서 id', () => {
  it('이동한 문서는 **양쪽 경로** 모두 현재 id 로 해석된다', () => {
    // 이것이 없으면 이동 전 경로를 가진 과거 피드가 조용히 사라진다(feed.mjs:108-109).
    const index = buildPathIndex([{ filePath: HBM_NOW, id: 'cccccccccccc' }], () => HBM_LOG)

    expect(index.get(`sha11:${HBM_THEN}`)).toBe('cccccccccccc')
    expect(index.get(`sha12:${HBM_NOW}`)).toBe('cccccccccccc')
    expect(index.get(`sha04:${HBM_THEN}`)).toBe('cccccccccccc')
  })

  it('문서마다 자기 히스토리로 색인한다(문서가 없으면 빈 Map)', () => {
    // 2번째 케이스: 하드코딩 Map 리턴 방지.
    expect(buildPathIndex([], () => HBM_LOG).size).toBe(0)
  })
})

describe('collectDeletedDocPaths — 삭제되어 HEAD 에 없는 문서', () => {
  const DELETED_LOG = [`D\t${SCRAP}`, `D\tvault/wiki/tech/HBM.md`, 'D\tREADME.md'].join('\n')

  it('삭제된 vault 문서 경로만 낸다', () => {
    const deleted = collectDeletedDocPaths(() => DELETED_LOG, {
      headPaths: new Set([HBM_NOW]),
      wikiPrefix: 'vault/wiki/',
    })

    expect(deleted.has(SCRAP)).toBe(true)
    expect(deleted.has('README.md')).toBe(false) // vault 문서가 아니다
  })

  it('삭제 후 재생성된 경로는 포함하지 않는다(HEAD 에 있다)', () => {
    // 2번째 케이스: HEAD 대조 없이 D 만 긁으면 살아 있는 문서를 prune 해버린다.
    const deleted = collectDeletedDocPaths(() => DELETED_LOG, {
      headPaths: new Set([HBM_NOW]),
      wikiPrefix: 'vault/wiki/',
    })

    expect(deleted.has(HBM_NOW)).toBe(false)
    expect(deleted.size).toBe(1)
  })
})

describe('collectEverDeletedDocPaths — HEAD 재생성 여부와 무관한 삭제 이력', () => {
  const DELETED_LOG = [`D\t${SCRAP}`, `D\tvault/wiki/tech/HBM.md`, 'D\tREADME.md'].join('\n')

  it('삭제 후 같은 경로에 재생성된 vault 문서도 삭제 이력으로 남긴다', () => {
    const deleted = collectEverDeletedDocPaths(() => DELETED_LOG, { wikiPrefix: 'vault/wiki/' })

    expect(deleted.has(SCRAP)).toBe(true)
    expect(deleted.has(HBM_NOW)).toBe(true)
    expect(deleted.has('README.md')).toBe(false)
  })
})

describe('getCommitDocStatuses — 커밋별 vault 문서 상태', () => {
  it('A/M/D/R 상태를 vault md 경로만 골라 파싱한다', () => {
    const stdout = [
      `A\tvault/wiki/company/a.md`,
      `M\tvault/wiki/company/b.md`,
      `D\tvault/wiki/company/c.md`,
      `R100\tvault/wiki/company/old.md\tvault/wiki/tech/new.md`,
      `A\tREADME.md`,
    ].join('\n')
    const calls = []

    const statuses = getCommitDocStatuses(
      (args) => {
        calls.push(args)
        return stdout
      },
      'abc123',
      'vault/wiki/',
    )

    expect(statuses).toEqual([
      { path: 'vault/wiki/company/a.md', status: 'A' },
      { path: 'vault/wiki/company/b.md', status: 'M' },
      { path: 'vault/wiki/company/c.md', status: 'D' },
      { oldPath: 'vault/wiki/company/old.md', path: 'vault/wiki/tech/new.md', status: 'R' },
    ])
    expect(calls[0]).toContain('--name-status')
    expect(calls[0]).toContain('--find-renames')
    expect(calls[0].at(-1)).toBe('abc123')
  })
})

describe('checkHistoryIntegrity — shallow · partial clone 판정', () => {
  it('shallow 리포를 shallow 로 판정한다', () => {
    // 얕은 히스토리는 생성 커밋을 잘라 **문서 id 를 조용히 틀리게** 만든다.
    expect(checkHistoryIntegrity(stubRunner({ shallow: 'true' }))).toEqual({
      partialFilter: '',
      shallow: true,
    })
  })

  it('partial clone(blob 필터)을 검출한다', () => {
    expect(checkHistoryIntegrity(stubRunner({ filter: 'blob:none' }))).toEqual({
      partialFilter: 'blob:none',
      shallow: false,
    })
  })

  it('정상 full clone 은 둘 다 아니다', () => {
    // 2번째 케이스: 하드코딩 true 리턴 방지(정상 리포가 빌드를 죽이면 안 된다).
    expect(checkHistoryIntegrity(stubRunner({}))).toEqual({ partialFilter: '', shallow: false })
  })
})

describe('getCommitDiffHunks', () => {
  it('git show --unified=0 출력에서 파일별 hunk(startLine,lineCount)를 파싱한다', () => {
    const show = [
      'diff --git a/vault/wiki/foo.md b/vault/wiki/foo.md',
      'index 0000000..1111111 100644',
      '--- a/vault/wiki/foo.md',
      '+++ b/vault/wiki/foo.md',
      '@@ -10,0 +11,2 @@ heading',
      '+added',
      '+more',
    ].join('\n')

    const calls = []
    const hunks = getCommitDiffHunks((args) => {
      calls.push(args)
      return show
    }, 'abc123')

    expect(hunks['vault/wiki/foo.md']).toEqual([{ lineCount: 2, startLine: 11 }])
    expect(calls[0]).toContain('show')
  })

  it('빈 diff 는 빈 객체를 반환한다', () => {
    expect(getCommitDiffHunks(() => '', 'abc123')).toEqual({})
  })
})
