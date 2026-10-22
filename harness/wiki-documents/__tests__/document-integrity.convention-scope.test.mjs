// 문서 검사 정책의 정상·위반 회귀. 실제 wiki 대신 격리 fixture를 사용한다.
import { mkdirSync, writeFileSync } from 'node:fs'

import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { inspectVault } from '../document-integrity.mjs'

import { cleanup, feedCommit, git, initVault, writeDoc } from '../../test-utils/tmp-git-vault.mjs'

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
      const result = inspectVault({ env: 'dev', vault })

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

      const result = inspectVault({ env: 'dev', vault })

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

      const result = inspectVault({ env: 'dev', vault })

      expect(result.summary.docs).toHaveLength(1)
      expect(Object.hasOwn(result.stats, 'offConventionCommits')).toBe(false)
      expect(result.stats.unpublishedFeedCommits).toEqual([])
    } finally {
      cleanup(vault)
    }
  })
})

describe('오탐 방지 — 평범한 커밋이 빌드를 죽이지 않는다', () => {
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

      const result = inspectVault({ env: 'dev', vault })

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

      const result = inspectVault({ env: 'dev', vault })

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

      const result = inspectVault({ env: 'dev', vault })

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

      const result = inspectVault({ env: 'dev', vault })

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

      const result = inspectVault({ env: 'dev', vault })

      expect(result.feeds.items).toHaveLength(1)
      expect(result.feeds.items[0].docs.map((doc) => doc.id)).toEqual([ID_A])
      expect(result.stats.unresolvedPaths).toEqual([])
    } finally {
      cleanup(vault)
    }
  })
})
