// @vitest-environment node
//
// P1 · RED — 계약 검사의 사정거리 (tdd §3.3 CN1·CN2·CN2b·CN3 · FP1~FP5)
//
// 이 파일이 무는 것: 계약 계층(`checkCommitConventions`·`touchesVault`)은 **현재 prefix 를 유지**하되
//   이관 이전 커밋을 grandfathering 한다. 여기서 가장 큰 위험은 **오탐으로 빌드를 마비시키는 것**이다
//   (plan Risks 1위 · 이 브랜치는 "감사 대응으로 새로 만든 가드가 그 자체로 결함원"이 3회 연속이었다).
//
//   · CN = grandfathering 이 실재하는가(이관 이전 커밋을 위반으로 읽지 않는가).
//   · FP = 평범한 커밋들이 **통과하는가**(전부 "throw 하지 않는다"). 히스토리 계층 술어(`anyMarkdown`)를
//     계약 계층까지 넓히면 이 5종이 전부 빌드를 죽인다(plan 실증).
//   · TP(정탐)는 **기존 `build.conventions.test.mjs` 가 이미 정확히 문다** → 여기에 중복 작성하지 않는다.
//     대신 그 2 스펙은 경로 치환 외 **무수정 pin** 이다(tdd §9.1) — 약화되면 FP 게이트가 통째로 공허해진다.
//
// RED 사유 — 전부 **RED(root)** 다: 픽스처의 문서가 GREEN 이전 코드가 스캔하는 곳(`<vault>/vault/wiki`)에
//   없으므로 HEAD 문서가 0건이 된다. 그래서 각 케이스에 **문서 수 하한**(규범 B)을 앞세웠다 — 이 하한이
//   없으면 "아무 문서도 안 봤으니 위반도 없다"는 **공허한 통과**가 된다(tdd §4.3 이 경고하는 바로 그것).
//   케이스 고유의 물림은 GREEN 이후 §5 반사실이 증명한다: CF8=CN1 · CF11=CN2 · CF9=FP1~FP3 ·
//   CF10=FP4 · CF7=FP5.
//
// 규범 A(자기참조 금지): 경로는 전부 리터럴이고 `wikiRoot` 를 매 호출 명시한다(헬퍼 기본값 무의존).
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { buildContent } from '../validate.mjs'
import { cleanup, feedCommit, git, initVault, writeDoc } from './helpers/tmp-git-vault.mjs'

const ID_A = '0192a000-0000-7000-8000-0000000000aa'
const ID_B = '0192b000-0000-7000-8000-0000000000bb'
const ID_C = '0192c000-0000-7000-8000-0000000000cc'

// FP4 전용 본문 — 서로 겹치는 줄이 없어야 `--find-renames` 가 A+D 를 rename 으로 합치지 않는다.
const BODY_B = [
  '## 정의',
  '',
  '고대역폭 메모리 적층 공정의 열 관리 지표를 다룬다.',
  '접합부 온도, 열저항, 냉각 유로 설계가 핵심 변수다.',
  '',
  '## 배경',
  '',
  '적층 단수가 늘수록 중간층 방열 경로가 길어진다.',
].join('\n')
const BODY_C = [
  '## 개요',
  '',
  '파운드리 선단 노드의 수율 곡선과 학습률을 정리한 문서.',
  '초기 램프업 구간에서 결함 밀도가 지수적으로 감소한다.',
  '',
  '## 지표',
  '',
  '웨이퍼당 다이 수, 결함 밀도, 파라메트릭 수율을 함께 본다.',
].join('\n')

/** author-date 를 명시 주입하는 일반 커밋. */
function commitAt(vault, message, date) {
  git(vault, ['add', '-A'])
  git(vault, ['commit', '--no-gpg-sign', '-m', message], {
    GIT_AUTHOR_DATE: date,
    GIT_COMMITTER_DATE: date,
  })
  return git(vault, ['rev-parse', 'HEAD'])
}

/** 위키 **밖** 파일 — frontmatter 가 없어 문서로 해석되지 않는다(README·docs/*). */
function writePlain(vault, relPath, text) {
  const full = path.join(vault, ...relPath.split('/'))
  mkdirSync(path.dirname(full), { recursive: true })
  writeFileSync(full, text, 'utf8')
}

describe('grandfathering — 이관 이전 커밋은 현행 계약의 심사 대상이 아니다 (CN1·CN2·CN2b)', () => {
  it('CN1: 이관 이전 `cwiki:` 커밋들이 빌드를 죽이지 않는다', () => {
    // 이관 후 계약 술어는 `wiki/` 를 본다 → 옛 커밋의 statuses 가 **빈다**. 그것을 "레거시 접두사인데
    // 신규 0개"로 읽으면 히스토리 재작성이 금지된 이상 **고칠 수도 없는** 위반으로 빌드가 영구히 죽는다.
    // 실 리포 HEAD 도달 히스토리에 `cwiki:` 7건 · `uwiki:` 6건이 실재한다(2026-08-01 · `git log HEAD --format=%s` 실측).
    const vault = initVault()
    try {
      writeDoc(vault, 'company/삼성', { id: ID_A, wikiRoot: 'vault/wiki' })
      commitAt(vault, 'cwiki: 삼성 생성', '2026-01-01T00:00:00Z')
      writeDoc(vault, 'tech/HBM', { id: ID_B, wikiRoot: 'vault/wiki' })
      commitAt(vault, 'cwiki: HBM 생성', '2026-01-02T00:00:00Z')
      git(vault, ['mv', 'vault/wiki', 'wiki'])
      commitAt(vault, 'chore: 문서 루트 이관', '2026-06-01T00:00:00Z')

      // 컨벤션 위반으로 판정되면 여기서 throw 한다 — 그것이 CN1 의 실패 모드다.
      const result = buildContent({ env: 'dev', vault })

      // 규범 B: "위반 없음"이 **문서를 실제로 보고 난 결론**이어야 한다(0건 대 0건의 공허한 통과 배제).
      expect(result.summary.docs).toHaveLength(2)
    } finally {
      cleanup(vault)
    }
  })

  it('CN2: 이관 **이전** 경로를 건드린 접두어 없는 커밋은 off-convention 경고 대상이 아니다', () => {
    const vault = initVault()
    try {
      writeDoc(vault, 'company/삼성', { id: ID_A, wikiRoot: 'vault/wiki' })
      commitAt(vault, 'chore: 삼성 생성', '2026-01-01T00:00:00Z')
      writeDoc(vault, 'company/삼성', { body: '## 정의\n\n대개편 갱신.\n', id: ID_A, wikiRoot: 'vault/wiki' }) // prettier-ignore
      commitAt(vault, '문서 대개편', '2026-01-02T00:00:00Z')
      git(vault, ['mv', 'vault/wiki', 'wiki'])
      commitAt(vault, 'chore: 문서 루트 이관', '2026-06-01T00:00:00Z')

      const result = buildContent({ env: 'dev', vault })

      expect(result.summary.docs).toHaveLength(1)
      expect(Object.hasOwn(result.stats, 'offConventionCommits')).toBe(false)
      expect(result.stats.unpublishedFeedCommits).toEqual([])
    } finally {
      cleanup(vault)
    }
  })

  it('CN2b: 이관 **이후** 경로를 건드린 접두어 없는 커밋도 feed 경고 대상이 아니다', () => {
    const vault = initVault()
    try {
      writeDoc(vault, 'company/삼성', { id: ID_A, wikiRoot: 'vault/wiki' })
      commitAt(vault, 'chore: 삼성 생성', '2026-01-01T00:00:00Z')
      git(vault, ['mv', 'vault/wiki', 'wiki'])
      commitAt(vault, 'chore: 문서 루트 이관', '2026-06-01T00:00:00Z')
      writeDoc(vault, 'company/삼성', {
        body: '## 정의\n\n대개편 갱신.\n',
        id: ID_A,
        wikiRoot: 'wiki',
      })
      commitAt(vault, '문서 대개편 2', '2026-06-02T00:00:00Z')

      const result = buildContent({ env: 'dev', vault })

      expect(result.summary.docs).toHaveLength(1)
      expect(Object.hasOwn(result.stats, 'offConventionCommits')).toBe(false)
      expect(result.stats.unpublishedFeedCommits).toEqual([])
    } finally {
      cleanup(vault)
    }
  })
})

describe('CN3 — 위키 밖에서 삭제된 .md 가 문서 후보 게이트를 통과할 때의 계상 (잔여 pin)', () => {
  it('CN3: unresolved(시끄러움)가 아니라 prune(조용함)으로 계상한다 — 결정된 동작을 못박는다', () => {
    // tdd §3.3 CN3 · plan F-5. 삭제 수집이 `.md` 전량으로 넓어지면 위키 **밖** 삭제 경로도
    // `everDeletedPaths` 에 들어가고, 문서 후보 게이트(`everWikiPaths ∪ everDeletedPaths`)를 통과한다.
    // 메인 세션 결정 = **(a) prune 으로 pin**(코드 변경 0). 근거: ① 실 리포에서 도달 불가능(기존 `feed:`
    // 커밋 6건은 전부 위키 경로만 건드린다) ② 어차피 `docs.length === 0` 이면 피드가 드랍되므로 관측
    // 차이는 통계 수치뿐 ③ 이 코드 경로 자체가 F-2(이중 빌더 통합)에서 소멸한다.
    // **미정으로 두지 않는다** — 미정이면 나중에 누가 바꿔도 아무도 모른다.
    const vault = initVault()
    try {
      writeDoc(vault, 'company/삼성', { id: ID_A, wikiRoot: 'wiki' })
      commitAt(vault, 'chore: 삼성 생성', '2026-01-01T00:00:00Z')
      writePlain(vault, 'docs/폐기.md', '# 폐기 예정 메모\n\n초안이다.\n')
      commitAt(vault, 'chore: 폐기 메모 초안', '2026-01-02T00:00:00Z')

      writeDoc(vault, 'company/삼성', {
        body: '## 정의\n\n정리 갱신.\n',
        id: ID_A,
        wikiRoot: 'wiki',
      })
      writePlain(vault, 'docs/폐기.md', '# 폐기 예정 메모\n\n초안을 갱신했다.\n')
      feedCommit(vault, { date: '2026-01-03T00:00:00Z', subject: '정리 소식' })

      git(vault, ['rm', '-q', 'docs/폐기.md'])
      commitAt(vault, 'chore: 폐기 메모 제거', '2026-01-04T00:00:00Z')

      const result = buildContent({ env: 'dev', vault })

      expect(result.feeds.items).toHaveLength(1)
      expect(result.feeds.items[0].docs.map((doc) => doc.id)).toEqual([ID_A])
      expect(result.stats.unresolvedPaths).toEqual([])
      expect(result.stats.prunedDocRefs).toBe(1) // ← pin: prune 쪽에 계상된다
      expect(result.stats.prunedFeeds).toBe(0) // 위키 문서 1건이 살아 있으므로 피드는 드랍되지 않는다
    } finally {
      cleanup(vault)
    }
  })
})

describe('오탐 방지 — 평범한 커밋이 빌드를 죽이지 않는다 (FP1~FP5)', () => {
  it('FP1: 접두어 없는 커밋의 위키 **밖** 문서 재작성(A+D)은 위반이 아니다', () => {
    // 실물 사례: P1 Task 1 베이스라인 착륙 커밋이 정확히 `A README.md` + `D docs/data-contract.md` 다.
    // 계약 검사가 `.md` 전량을 봤다면 **자기 자신이 위반**이 된다.
    const vault = initVault()
    try {
      writeDoc(vault, 'company/삼성', { id: ID_A, wikiRoot: 'wiki' })
      commitAt(vault, 'chore: 삼성 생성', '2026-01-01T00:00:00Z')
      writePlain(vault, 'docs/old.md', '# 옛 안내\n\n짧은 안내문이다.\n')
      commitAt(vault, 'chore: 안내 문서 추가', '2026-01-02T00:00:00Z')

      git(vault, ['rm', '-q', 'docs/old.md'])
      writePlain(
        vault,
        'docs/new.md',
        '# 운영 지침\n\n앞 문서와 한 문장도 겹치지 않는 완전히 다른 장문이다. 배포 절차, 롤백 기준, 장애 등급, 온콜 교대, 사후 회고 양식을 새로 정리한다.\n',
      )
      commitAt(vault, '문서 정리', '2026-01-03T00:00:00Z')

      const result = buildContent({ env: 'dev', vault })

      expect(result.summary.docs).toHaveLength(1)
    } finally {
      cleanup(vault)
    }
  })

  it('FP2: `feed:` 커밋이 위키 밖 `.md` 를 **추가**해도 위반이 아니다', () => {
    // `.md` 전량을 계약 계층에 적용하면 `feed` 는 "신규 추가 금지" 규칙에 걸려 위반이 된다.
    const vault = initVault()
    try {
      writeDoc(vault, 'company/삼성', { id: ID_A, wikiRoot: 'wiki' })
      commitAt(vault, 'chore: 삼성 생성', '2026-01-01T00:00:00Z')

      writeDoc(vault, 'company/삼성', {
        body: '## 정의\n\n소식 갱신.\n',
        id: ID_A,
        wikiRoot: 'wiki',
      })
      writePlain(vault, 'docs/release.md', '# 릴리스 노트\n\n0.1.0 을 배포했다.\n')
      feedCommit(vault, { date: '2026-01-02T00:00:00Z', subject: '소식' })

      const result = buildContent({ env: 'dev', vault })

      expect(result.summary.docs).toHaveLength(1)
      expect(result.feeds.items).toHaveLength(1)
    } finally {
      cleanup(vault)
    }
  })

  it('FP3: `chore:` 커밋이 위키 문서 1개 + 위키 밖 `.md` 를 추가해도 위반이 아니다', () => {
    // `.md` 전량이면 `added.length === 2` 라 위키 문서만 보는 범위 계약을 잃는다.
    const vault = initVault()
    try {
      writeDoc(vault, 'company/삼성', { id: ID_A, wikiRoot: 'wiki' })
      writePlain(vault, 'README.md', '# sas-wiki\n\n데이터 계약 정본이다.\n')
      commitAt(vault, 'chore: 문서 생성', '2026-01-01T00:00:00Z')

      const result = buildContent({ env: 'dev', vault })

      expect(result.summary.docs).toHaveLength(1)
    } finally {
      cleanup(vault)
    }
  })

  it('FP4: 합법 커밋들의 병합은 위반이 아니다(브랜치 전체를 한 커밋의 저작으로 이중계상 금지)', () => {
    // 공유 함수 `getCommitDocStatuses` 에 `diffMerges` 를 **기본값으로 박으면** 병합 커밋이 topic 의
    // A(b 생성)와 D(c 삭제)를 한꺼번에 저작한 것으로 보여 A+D 오탐이 난다. 이 리포 히스토리에 병합
    // 커밋 1건이 실재한다(`3e592c0 Merge branch 'main' into test`). PR6c 가 같은 계약을 args 쪽에서 문다.
    const vault = initVault()
    try {
      writeDoc(vault, 'company/a', { id: ID_A, wikiRoot: 'wiki' })
      commitAt(vault, 'chore: a 생성', '2026-01-01T00:00:00Z')
      writeDoc(vault, 'company/c', { body: BODY_C, id: ID_C, title: 'c', wikiRoot: 'wiki' })
      commitAt(vault, 'chore: c 생성', '2026-01-02T00:00:00Z')
      const mainBranch = git(vault, ['rev-parse', '--abbrev-ref', 'HEAD'])

      git(vault, ['checkout', '-q', '-b', 'topic'])
      // b·c 의 본문을 **rename 유사도 임계 밖으로** 벌린다. 기본 본문을 그대로 쓰면 둘이 57% 유사해
      //   `--find-renames` 가 A+D 를 단일 `R057` 로 합쳐버리고, 그러면 added=0·deleted=0 이라 이 스펙이
      //   겨냥한 A+D 오탐 조건에 **애초에 도달하지 못한다**(공허 통과). CF10 이 이 함정을 잡아냈다.
      writeDoc(vault, 'company/b', { body: BODY_B, id: ID_B, title: 'b', wikiRoot: 'wiki' })
      commitAt(vault, 'chore: b 생성', '2026-01-03T00:00:00Z')
      git(vault, ['rm', '-q', 'wiki/company/c.md'])
      commitAt(vault, 'chore: c 삭제', '2026-01-04T00:00:00Z')

      // 양쪽 브랜치가 **서로 다른 문서**를 건드려 병합이 어느 부모에도 TREESAME 이 아니게 한다(§6.3).
      git(vault, ['checkout', '-q', mainBranch])
      writeDoc(vault, 'company/a', { body: '## 정의\n\n본선 보강.\n', id: ID_A, wikiRoot: 'wiki' })
      commitAt(vault, 'chore: a 보강', '2026-01-05T00:00:00Z')
      git(vault, ['merge', '--no-ff', 'topic', '-m', 'Merge branch topic'], {
        GIT_AUTHOR_DATE: '2026-01-06T00:00:00Z',
        GIT_COMMITTER_DATE: '2026-01-06T00:00:00Z',
      })

      // **위험 실재 앵커(규범 B)** — "throw 하지 않는다"는 부재 단언이라, 픽스처가 실제로 A+D 를
      //   만들지 못하면 조용히 공허해진다. git 수준에서 first-parent diff 가 A 와 D 를 **둘 다**
      //   내는지 먼저 확인한다. rename 이 둘을 합치면 여기서 시끄럽게 죽는다.
      const mergeDiff = git(vault, ['show', '--find-renames', '--diff-merges=first-parent', '--name-status', '--format=', 'HEAD']) // prettier-ignore
      expect(mergeDiff).toMatch(/^A\s+wiki\/company\/b\.md$/mu)
      expect(mergeDiff).toMatch(/^D\s+wiki\/company\/c\.md$/mu)

      const result = buildContent({ env: 'dev', vault })

      expect(result.summary.docs).toHaveLength(2) // a · b (c 는 삭제됨)
    } finally {
      cleanup(vault)
    }
  })

  it('FP5: `feed:` 커밋이 위키 밖 `.md` 를 **수정**해도 unresolved 가 아니다(문서 후보 사전 게이트)', () => {
    // prefix 게이트를 그냥 열면 README 가 "해석되지 않은 feed 문서 참조"로 잡혀 **빌드가 죽는다**.
    // 문서 후보는 prefix 리터럴이 아니라 git rename 계보(pathIndex)와 draft 배제 좌표에서 유도한다.
    const vault = initVault()
    try {
      writeDoc(vault, 'company/삼성', { id: ID_A, wikiRoot: 'wiki' })
      writePlain(vault, 'README.md', '# sas-wiki\n\n초안이다.\n')
      commitAt(vault, 'chore: 문서·README 초기화', '2026-01-01T00:00:00Z')

      writeDoc(vault, 'company/삼성', {
        body: '## 정의\n\n소식 갱신.\n',
        id: ID_A,
        wikiRoot: 'wiki',
      })
      writePlain(vault, 'README.md', '# sas-wiki\n\n초안을 갱신했다.\n')
      feedCommit(vault, { date: '2026-01-02T00:00:00Z', subject: '소식' })

      const result = buildContent({ env: 'dev', vault })

      expect(result.feeds.items).toHaveLength(1)
      expect(result.feeds.items[0].docs.map((doc) => doc.id)).toEqual([ID_A])
      expect(result.stats.unresolvedPaths).toEqual([])
    } finally {
      cleanup(vault)
    }
  })
})
