// @vitest-environment node
//
// P3 · Task 9 — `buildFeedItems` 제거로 사라지는 단위 커버리지 중 **대응물이 없던 3건**을 실 git
//   vault 로 옮긴 것. 나머지(FeedItem 7키·다중 docs·정렬·삭제 생존·off-convention 무경고)는 이미
//   GW1~GW18 · RR1~RR6 · MG1~MG3 · BE1~BE3 · PS1~PS5 · IM4 가 덮으므로 여기 다시 쓰지 않는다.
//
// 왜 이 3건인가 — 셋 다 **조용한 데이터 유실**의 자리다:
//   RX1 경로 재사용   : 경로만 보고 끊으면 **살아 있는 문서의 과거 뉴스가 통째로 사라진다**
//   RX2 disable       : 비활성은 삭제가 아니다. 끊으면 문서 화면의 히스토리가 빈다
//   RX3 unresolved    : 형태가 `{path, sha}` 에서 어긋나면 진단이 `undefined undefined` 가 되고,
//                       `.mjs` 라 타입체커가 못 잡는다. 유일한 게이트 소비자는 `checkFeedResolution` 이다
//
// 규범 A(자기참조 공허성 금지): 경로·id·사유는 전부 **리터럴**이다. 프로덕션 상수(`WIKI_PREFIX` 등)를
//   import 해 입력이나 기대값을 만들지 않는다.
import { describe, expect, it } from 'vitest'

import { checkFeedResolution } from '../invariants.mjs'
import { walkFeeds } from '../git-walk.mjs'
import { seedStrayVault } from '../../__tests__/helpers/polluted-vault.mjs'
import { cleanup, commit, feedCommit, git, initVault, writeDoc } from '../../__tests__/helpers/tmp-git-vault.mjs' // prettier-ignore

const ID_MOVED = '0192a000-0000-7000-8000-0000000000aa'
const ID_REUSER = '0192b000-0000-7000-8000-0000000000bb'
const ID_DISABLED = '0192c000-0000-7000-8000-0000000000cc'
const ID_GONE = '0192d000-0000-7000-8000-0000000000dd'
const T1 = '2026-03-01T00:00:00Z'
const T2 = '2026-03-02T00:00:00Z'

const docsOf = (items, title) => items.find((item) => item.title === title)?.docs

describe('walkFeeds — 삭제된 경로와 재사용된 경로를 가른다 (RX1 · pair)', () => {
  it('RX1: 계보가 푸는 옛 경로는 살아 있는 문서로 해석하고, 계보가 없는 삭제 경로만 끊는다', () => {
    // 문서 A 가 x 에 있다가 y 로 이동한 뒤 **다른** 문서 B 가 빈 x 를 재사용했다가 삭제된다.
    //   → x 는 "한 번이라도 삭제된 경로" 집합에 들어간다. 그러나 과거 피드의 diff 가 가리키는 x 는
    //     **그 시점의 A** 이고 A 는 y 로 살아 있다.
    // 짝(C)이 앵커다: 계보 없이 삭제된 z 를 가리키는 피드는 **실제로** 끊긴다 — 이 vault 에서 prune
    //   기계가 살아 있음을 증명한다. 앵커가 없으면 "아무것도 prune 하지 않는 구현" 도 통과한다.
    const vault = initVault()
    try {
      writeDoc(vault, 'concept/x', { id: ID_MOVED, wikiRoot: 'wiki' })
      writeDoc(vault, 'concept/z', { id: ID_GONE, wikiRoot: 'wiki' })
      commit(vault, 'chore: A·C 생성')

      writeDoc(vault, 'concept/x', { body: '## 정의\n\nA 갱신.\n', id: ID_MOVED, wikiRoot: 'wiki' })
      feedCommit(vault, { date: T1, subject: 'A 과거 경로 소식' })

      writeDoc(vault, 'concept/z', { body: '## 정의\n\nC 갱신.\n', id: ID_GONE, wikiRoot: 'wiki' })
      feedCommit(vault, { date: T2, subject: 'C 소식' })

      git(vault, ['mv', 'wiki/concept/x.md', 'wiki/concept/y.md'])
      commit(vault, 'chore: A 를 y 로 이동')

      writeDoc(vault, 'concept/x', { id: ID_REUSER, wikiRoot: 'wiki' })
      commit(vault, 'chore: B 가 x 재사용')
      git(vault, ['rm', '-q', 'wiki/concept/x.md'])
      commit(vault, 'chore: B 삭제')
      git(vault, ['rm', '-q', 'wiki/concept/z.md'])
      commit(vault, 'chore: C 삭제')

      const items = walkFeeds(vault, { count: 50, env: 'dev' })

      expect(items).toHaveLength(2) // 앵커: 두 피드 다 살아 있다(사유 무관 생존)
      expect(docsOf(items, 'C 소식')).toEqual([]) // 앵커: 계보 없는 삭제는 실제로 끊긴다
      expect(docsOf(items, 'A 과거 경로 소식')).toEqual([{ id: ID_MOVED }])
      expect(items.stats.prunedDocRefs).toBe(1) // C 것 1건뿐 — A 가 새면 2가 된다
    } finally {
      cleanup(vault)
    }
  })
})

describe('walkFeeds — disable 문서 참조 유지 (RX2)', () => {
  it('RX2: `status: disable` 문서를 가리키는 피드는 연결을 유지한다(비활성 ≠ 삭제)', () => {
    // summary 가 disable 문서를 **스텁 4키**로 계속 서빙하는 이유가 이것이다 — 링크가 살아 있어야
    //   "지금은 비활성" 화면으로 갈 수 있다. 여기서 끊으면 문서 화면의 히스토리가 조용히 빈다.
    const vault = initVault()
    try {
      writeDoc(vault, 'concept/비활성', { id: ID_DISABLED, status: 'disable', wikiRoot: 'wiki' })
      commit(vault, 'chore: 비활성 문서 생성')

      writeDoc(vault, 'concept/비활성', {
        body: '## 정의\n\n비활성 문서 갱신.\n',
        id: ID_DISABLED,
        status: 'disable',
        wikiRoot: 'wiki',
      })
      feedCommit(vault, { date: T2, subject: '비활성 문서 소식' })

      const items = walkFeeds(vault, { count: 50, env: 'dev' })

      expect(items).toHaveLength(1) // 앵커: 픽스처가 실제로 피드를 만들었다
      expect(docsOf(items, '비활성 문서 소식')).toEqual([{ id: ID_DISABLED }])
      expect(items.stats.prunedDocRefs).toBe(0)
    } finally {
      cleanup(vault)
    }
  })
})

describe('walkFeeds — unresolved 진단의 형태와 게이트 (RX3)', () => {
  it('RX3: stray 문서 참조는 `{ path, sha }` 로 집계되고 `checkFeedResolution` 이 그것으로 throw 한다', () => {
    // ★ `unresolvedPaths` 는 유일한 게이트 소비자(`invariants.mjs`)를 갖는다. 형태가 바뀌면 진단
    //   메시지가 `undefined undefined` 로 깨지고, 그 깨짐은 스키마도 타입체커도 못 잡는다(.mjs).
    const { strayFeedSha, vault } = seedStrayVault()
    try {
      const items = walkFeeds(vault, { count: 50, env: 'dev' })

      expect(items.stats.unresolvedPaths).toEqual([
        { path: 'wiki/concept/메모장.md', sha: strayFeedSha },
      ])
      expect(items.stats.unresolvedPaths[0].sha).toMatch(/^[0-9a-f]{40}$/)
      expect(() => checkFeedResolution(items.stats)).toThrow(/wiki\/concept\/메모장\.md/)
    } finally {
      cleanup(vault)
    }
  })
})
