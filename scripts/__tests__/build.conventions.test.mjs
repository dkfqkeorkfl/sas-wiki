// @vitest-environment node
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { buildContent } from '../build.mjs'

const NAME = 'SAS Wiki Bot'
const EMAIL = 'bot@sas.wiki'
let tick = 1_500_000_000
const dirs = []

function appendDoc(root, rel, paragraph) {
  const full = path.join(root, 'vault', 'wiki', `${rel}.md`)
  writeFileSync(full, `${readFileSync(full, 'utf8')}\n${paragraph}\n`)
}

function commit(cwd, message) {
  const date = nextDate()
  git(cwd, ['add', '-A'])
  git(cwd, ['commit', '--no-gpg-sign', '-m', message], {
    GIT_AUTHOR_DATE: date,
    GIT_COMMITTER_DATE: date,
  })
  return git(cwd, ['rev-parse', 'HEAD'])
}

function git(cwd, args, extraEnv = {}) {
  const result = spawnSync('git', ['-c', 'core.quotepath=false', ...args], {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_EMAIL: EMAIL,
      GIT_AUTHOR_NAME: NAME,
      GIT_COMMITTER_EMAIL: EMAIL,
      GIT_COMMITTER_NAME: NAME,
      ...extraEnv,
    },
  })
  if (result.error && result.status !== 0) throw result.error
  if (result.status !== 0) throw new Error(result.stderr || `git ${args.join(' ')} failed`)
  return result.stdout.trim()
}

function makeVault() {
  const vault = mkdtempSync(path.join(tmpdir(), 'wiki-convention-'))
  const out = mkdtempSync(path.join(tmpdir(), 'wiki-convention-out-'))
  dirs.push(vault, out)
  git(vault, ['init', '-q'])
  return { out, vault }
}

function nextDate() {
  tick += 60
  return `${tick} +0000`
}

// frontmatter 저작 UUIDv7 doc id — 결정적 counter. id 출처가 frontmatter 로 반전됐다(값만 새 계약).
let idSeq = 0
function nextDocId() {
  return `0192f0d0-0000-7000-8000-${(idSeq += 1).toString(16).padStart(12, '0')}`
}

function writeDoc(root, rel, title, body = `${title} 문서의 정의 문단이다.`) {
  const full = path.join(root, 'vault', 'wiki', `${rel}.md`)
  mkdirSync(path.dirname(full), { recursive: true })
  const id = nextDocId()
  writeFileSync(
    full,
    [
      '---',
      `id: "${id}"`,
      `title: ${title}`,
      'type: concept',
      'status: active',
      'tags: ["반도체"]',
      '---',
      '',
      '## 정의',
      '',
      body,
      '',
      '## 로드맵',
      '',
      '세대 전환을 준비한다.',
      '',
    ].join('\n'),
  )
  return id
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { force: true, recursive: true })
})

describe('buildContent — vault 커밋 컨벤션 강제', () => {
  it('uwiki 이동과 전면 재작성이 D+A 로 잡히면 build fail 하고 양쪽 경로를 말한다', () => {
    const { out, vault } = makeVault()
    writeDoc(vault, 'company/삼성전자', '삼성전자')
    commit(vault, 'cwiki: 삼성전자 문서 생성')
    appendDoc(vault, 'company/삼성전자', 'HBM4 양산 로드맵을 공개했다.')
    commit(vault, 'feed: 삼성전자 HBM4 로드맵 공개\n\n본문.\n\nKeywords: HBM')

    const oldPath = path.join(vault, 'vault', 'wiki', 'company', '삼성전자.md')
    const newPath = path.join(vault, 'vault', 'wiki', 'tech', '삼성전자.md')
    mkdirSync(path.dirname(newPath), { recursive: true })
    renameSync(oldPath, newPath)
    writeDoc(
      vault,
      'tech/삼성전자',
      '삼성전자',
      '기존 문장과 겹치지 않는 완전히 다른 장문이다. 생산, 투자, 공급망, 메모리 로드맵을 새로 정리한다.',
    )
    commit(vault, 'uwiki: 삼성전자 문서를 tech/ 로 이동하며 전면 재작성')

    expect(() => buildContent({ out, vault })).toThrow(/컨벤션 위반/)
    expect(() => buildContent({ out, vault })).toThrow(/vault\/wiki\/company\/삼성전자\.md/)
    expect(() => buildContent({ out, vault })).toThrow(/vault\/wiki\/tech\/삼성전자\.md/)
  })

  it('cwiki 커밋이 문서 2개를 추가하면 build fail 한다', () => {
    const { out, vault } = makeVault()
    writeDoc(vault, 'company/a', 'A')
    writeDoc(vault, 'company/b', 'B')
    commit(vault, 'cwiki: 문서 두 개 생성')

    expect(() => buildContent({ out, vault })).toThrow(
      /컨벤션 위반[\s\S]*cwiki:[\s\S]*vault\/wiki\/company\/a\.md[\s\S]*vault\/wiki\/company\/b\.md/,
    )
  })

  it('cwiki 커밋이 문서 1개를 추가하면서 다른 문서를 삭제하면 build fail 한다', () => {
    const { out, vault } = makeVault()
    writeDoc(vault, 'company/old', 'OLD')
    commit(vault, 'cwiki: OLD 문서 생성')
    git(vault, ['rm', '-q', 'vault/wiki/company/old.md'])
    writeDoc(
      vault,
      'company/new',
      'NEW',
      '서로 다른 문서임을 드러내는 길고 무관한 본문이다. 매출, 공급망, 장비 투자, 해외 법인, 신규 로드맵을 다룬다.',
    )
    commit(vault, 'cwiki: NEW 문서 생성과 OLD 삭제')

    expect(() => buildContent({ out, vault })).toThrow(/컨벤션 위반/)
    expect(() => buildContent({ out, vault })).toThrow(/vault\/wiki\/company\/new\.md/)
    expect(() => buildContent({ out, vault })).toThrow(/vault\/wiki\/company\/old\.md/)
  })

  it('깨끗한 git mv 는 같은 id 를 유지하고 과거 feed 를 살린다', () => {
    const { out, vault } = makeVault()
    const originalId = writeDoc(vault, 'company/이동문서', '이동문서')
    commit(vault, 'cwiki: 이동문서 문서 생성')
    appendDoc(vault, 'company/이동문서', '신제품 라인업을 공개했다.')
    commit(vault, 'feed: 이동문서 신제품 공개\n\n본문.\n\nKeywords: 신제품')
    mkdirSync(path.join(vault, 'vault', 'wiki', 'tech'), { recursive: true })
    renameSync(
      path.join(vault, 'vault', 'wiki', 'company', '이동문서.md'),
      path.join(vault, 'vault', 'wiki', 'tech', '이동문서.md'),
    )
    commit(vault, 'uwiki: 이동문서를 tech 로 이동')

    const result = buildContent({ out, vault })
    const feed = result.feeds.items.find((item) => item.title === '이동문서 신제품 공개')

    expect(feed).toBeDefined()
    expect(feed.docs.map((ref) => ref.id)).toEqual([originalId])
    expect(result.summary.docs.find((doc) => doc.id === originalId).breadcrumb.join('/')).toBe(
      'tech/이동문서',
    )
  })
})

describe('buildContent — D26 접두어 없는 커밋의 vault A+D 동시 발생', () => {
  // 현행: 접두어(cwiki|uwiki|feed) 없는 커밋은 컨벤션 검사에서 통째로 스킵된다.
  // D26: 접두어 없는 커밋도 검사해, 한 커밋 안 vault 문서 A+D 동시 발생(= git 이 rename 으로 못 붙인
  //   이동 = 문서 id 소실 시그니처)이면 build fail. 정당한 이동(R)·단순 수정(M)은 통과(과잉검출 방지).
  it('[R-T4b 양성] 접두어 없는 커밋이 문서 하나를 삭제+다른 문서를 추가하면 build fail 한다', () => {
    const { out, vault } = makeVault()
    // 두 문서를 **각각** cwiki 커밋으로 시드한다(한 cwiki 가 2개를 추가하면 그 자체가 위반이다).
    writeDoc(vault, 'company/삼성전자', '삼성전자')
    commit(vault, 'cwiki: 삼성전자 문서 생성')
    writeDoc(vault, 'company/SK하이닉스', 'SK하이닉스')
    commit(vault, 'cwiki: SK하이닉스 문서 생성')

    // 접두어 없는 subject 로 한 문서 삭제 + 전혀 다른 새 문서 추가를 한 커밋에(rename 으로 안 붙게 무관한 장문).
    git(vault, ['rm', '-q', 'vault/wiki/company/삼성전자.md'])
    writeDoc(
      vault,
      'tech/온디바이스AI',
      '온디바이스 AI',
      '앞 문서와 한 문장도 겹치지 않는 완전히 다른 장문이다. 엣지 추론, 전력 효율, NPU 세대, 모바일 배포, 온디바이스 학습 전략을 새로 정리한다.',
    )
    commit(vault, '문서 대개편')

    expect(() => buildContent({ out, vault })).toThrow(/컨벤션 위반/)
    expect(() => buildContent({ out, vault })).toThrow(/vault\/wiki\/company\/삼성전자\.md/)
    expect(() => buildContent({ out, vault })).toThrow(/vault\/wiki\/tech\/온디바이스AI\.md/)
  })

  it('[R-T4b 음성] 접두어 없는 커밋이 기존 문서만 수정하면 build fail 하지 않는다', () => {
    // 과잉검출 가드: 일상 수정 커밋(A=0·D=0)은 D26 이 잡으면 안 된다. GREEN 전후 모두 통과.
    const { out, vault } = makeVault()
    writeDoc(vault, 'company/삼성전자', '삼성전자')
    commit(vault, 'cwiki: 삼성전자 문서 생성')
    appendDoc(vault, 'company/삼성전자', '실적 발표 내용을 반영했다.')
    commit(vault, 'fix: 오타 수정')

    expect(() => buildContent({ out, vault })).not.toThrow()
  })

  it('[R-T4b 음성] 접두어 없는 커밋의 정당한 이동(git 이 R 로 인식)은 build fail 하지 않는다', () => {
    // --find-renames 가 R 로 흡수한 이동은 A/D 가 남지 않는다 → 문서 id 유지. GREEN 전후 모두 통과.
    const { out, vault } = makeVault()
    writeDoc(vault, 'company/삼성전자', '삼성전자')
    commit(vault, 'cwiki: 삼성전자 문서 생성')
    mkdirSync(path.join(vault, 'vault', 'wiki', 'tech'), { recursive: true })
    renameSync(
      path.join(vault, 'vault', 'wiki', 'company', '삼성전자.md'),
      path.join(vault, 'vault', 'wiki', 'tech', '삼성전자.md'),
    )
    commit(vault, '폴더 재배치') // 접두어 없음 — 그래도 정당한 이동이므로 통과해야 한다

    expect(() => buildContent({ out, vault })).not.toThrow()
  })
})

describe('buildContent — feed 참조의 explained prune', () => {
  it('삭제된 옛 문서 경로에 새 문서가 살아 있어도 옛 feed 는 unresolved 가 아니라 prune 된다', () => {
    const { out, vault } = makeVault()
    writeDoc(vault, 'company/x', '옛문서')
    commit(vault, 'cwiki: 옛문서 생성')
    appendDoc(vault, 'company/x', '퇴역 전 마지막 소식을 남긴다.')
    commit(vault, 'feed: 옛문서 마지막 소식\n\n본문.\n\nKeywords: 퇴역')
    git(vault, ['rm', '-q', 'vault/wiki/company/x.md'])
    commit(vault, 'uwiki: 옛문서 삭제')
    writeDoc(vault, 'company/x', '새문서')
    commit(vault, 'cwiki: 새문서 생성')

    const result = buildContent({ out, vault })

    expect(result.feeds.items.map((item) => item.title)).not.toContain('옛문서 마지막 소식')
    expect(result.stats.prunedDocRefs).toBeGreaterThanOrEqual(1)
    expect(result.stats.unresolvedPaths).toEqual([])
  })
})
