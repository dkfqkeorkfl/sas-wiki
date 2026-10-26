// 파싱·생성·피드의 실제 기능 결과를 확인한다.
import { spawnSync } from 'node:child_process'

import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'

import { tmpdir } from 'node:os'

import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { parsePayloads } from '../test-utils/vaultPayloads.mjs'

const NAME = 'SAS Wiki Bot'

const EMAIL = 'bot@sas.wiki'

let tick = 1_500_000_000

const dirs = []

function appendDoc(root, rel, paragraph) {
  const full = path.join(root, 'wiki', `${rel}.md`)
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
  dirs.push(vault)
  git(vault, ['init', '-q'])
  return { vault }
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
  const full = path.join(root, 'wiki', `${rel}.md`)
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

describe('parsePayloads — feed 참조의 explained prune', () => {
  it('삭제된 옛 문서 경로에 새 문서가 살아 있어도 옛 feed 는 unresolved 가 아니라 prune 된다', () => {
    const { vault } = makeVault()
    writeDoc(vault, 'company/x', '옛문서')
    commit(vault, 'chore: 옛문서 생성')
    appendDoc(vault, 'company/x', '퇴역 전 마지막 소식을 남긴다.')
    commit(vault, 'feed: 옛문서 마지막 소식\n\n본문.\n\nKeywords: 퇴역')
    git(vault, ['rm', '-q', 'wiki/company/x.md'])
    commit(vault, 'chore: 옛문서 삭제')
    writeDoc(vault, 'company/x', '새문서')
    commit(vault, 'chore: 새문서 생성')

    const result = parsePayloads({ vault })

    expect(result.feeds.items).toEqual(
      expect.arrayContaining([expect.objectContaining({ docs: [], title: '옛문서 마지막 소식' })]),
    )
    expect(result.stats.prunedDocRefs).toBeGreaterThanOrEqual(1)
    expect(result.stats.prunedFeeds).toBe(0)
    expect(result.stats.unresolvedPaths).toEqual([])
  })
})
