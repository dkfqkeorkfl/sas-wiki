// 파싱·생성·피드의 실제 기능 결과를 확인한다.
import { readFileSync, readdirSync } from 'node:fs'

import path from 'node:path'

import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { checkCommitConventions } from '../../../harness/wiki-documents/document-invariants.mjs'

import { parseCommitForFeed } from '../feed.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))

/** sas-wiki 리포 루트 — `scripts/lib/__tests__` 의 세 단계 위. cwd 무관. */
const REPO_ROOT = path.resolve(HERE, '..', '..', '..')

/**
 * ★★ **이 파일에서 원시 레거시 토큰을 담는 유일한 줄이 바로 아래다** — 예외 E8 의 표적
 * (`scripts/__tests__/legacy-sweep.test.mjs` 의 레지스트리).
 *
 * 접두사 **무관성**을 증명하려면 옛 접두사를 **입력으로** 쓸 수밖에 없다 — 그것이 이 파일의 주제다.
 * E1 과 같은 형태로 한 줄에 가두고 나머지는 전부 여기서 파생시킨다.
 */
const SUBJECTS = { chore: 'chore: 제목', feed: 'feed: 제목', legacy: 'cwiki: 제목' }

/** 커밋 subject 접두사를 심사하는 **소스 형태 2종**. 리터럴이다(규범 A — 프로덕션에서 유도하지 않는다). */
const PREFIX_REGEX_RE = /\/\^\(?([A-Za-z|]+)\)?:/

const PREFIX_STARTSWITH_RE = /startsWith\('([A-Za-z|]+):'\)/

/**
 * 프로덕션 소스 전수(`scripts/**\/*.mjs` − `__tests__`) — 경로 → 원문.
 *
 * ★ 프로덕션을 **import 하지 않고 텍스트로 읽는다**(§7.5 트립와이어 층). import 하면 "코드가 스스로를
 *   설명" 하는 자기참조가 되어, 코드와 기대가 **함께 틀린** 상태를 통과시킨다.
 */
function productionSources() {
  const sources = new Map()
  for (const dir of ['scripts', 'scripts/lib']) {
    for (const name of readdirSync(path.join(REPO_ROOT, dir))) {
      if (!name.endsWith('.mjs')) continue
      const rel = `${dir}/${name}`
      sources.set(rel, readFileSync(path.join(REPO_ROOT, rel), 'utf8'))
    }
  }
  return sources
}

/**
 * "커밋 subject 를 접두사로 심사하는 지점" 전수.
 *
 * 판정 조건 2개를 **동시에** 만족해야 한다:
 *   ① 그 줄이 `subject` 를 다룬다(상수명 `*SUBJECT*` 포함)
 *   ② 접두사 모양 리터럴(`/^word:` 또는 `startsWith('word:')`)을 담는다
 *
 * ①이 없으면 `extractTrailers` 의 `/^[A-Za-z][A-Za-z-]*:\s*.+$/`(커밋 **본문 트레일러** 파서)와
 * `parse.mjs` 의 각주 파서까지 걸려 폐쇄 주장이 거짓양성으로 무너진다 — 실측으로 확인한 경계다.
 */
function subjectPrefixSites(sources) {
  const sites = []
  for (const [file, source] of sources) {
    source.split('\n').forEach((text, index) => {
      if (!/subject/i.test(text)) return
      const asRegex = text.match(PREFIX_REGEX_RE)
      if (asRegex) sites.push({ file, form: 'regex', line: index + 1, token: asRegex[1] })
      const asStartsWith = text.match(PREFIX_STARTSWITH_RE)
      if (asStartsWith) sites.push({ file, form: 'startsWith', line: index + 1, token: asStartsWith[1] }) // prettier-ignore
    })
  }
  return sites
}

/** `FEED_SUBJECT_RE` 의 정규식 리터럴을 **소스 텍스트에서** 회수한다(못 찾으면 null). */
function feedSubjectLiteral(source) {
  const line = source.split('\n').find((text) => text.includes('FEED_SUBJECT_RE ='))
  const match = line?.match(/=\s*\/(.+)\/([a-z]*)\s*$/)
  return match ? { flags: match[2], source: match[1] } : null
}

/** 부작용 관측용 sink — `parseCommitForFeed` 가 건드리는 두 배열만 담는다. */
const statsSink = () => ({ unpublishedFeedCommits: [], warnings: [] })

/** sha → `git show --name-status` stdout. 기존 `invariants.feed-only.test.mjs:36` 패턴 재사용. */
function stubGitStatuses(byHash) {
  return (args) => (args.includes('show') ? (byHash[args.at(-1)] ?? '') : '')
}

/** throw 메시지에서 **subject 만** 지운다 — 접두사가 아니라 *그 밖의 모든 것*이 같은지 보기 위해. */
function violationShape(commits, runGit) {
  try {
    checkCommitConventions(commits, runGit, 'wiki/')
    return { threw: false }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const masked = commits.reduce((text, commit) => text.replaceAll(commit.subject, '<subject>'), message) // prettier-ignore
    return { message: masked, threw: true }
  }
}

describe('접두사 술어 폐쇄 — 프로덕션에서 subject 접두사를 심사하는 곳 (FS1 pin · CX-6D)', () => {
  it('FS1: subject 접두사 심사 지점이 `feed.mjs` 의 `feed:` 뿐이다', () => {
    // ★ 이것이 픽스처 치환의 **1차 근거**다. 접두사를 읽는 곳이 하나뿐이고 그 하나가 `feed:` 만
    //   본다면, 옛 접두사를 다른 값으로 바꿔도 프로덕션의 판정이 달라질 표면이 없다.
    // ★ 실측(N8): 폐쇄 = 2 지점(정규식 1 + `startsWith` 1) · 둘 다 `scripts/lib/feed.mjs` · 둘 다 `feed`.
    //   tdd §3.7 은 "정확히 1개" 라 적었는데 그것은 **정규식만 센 수치**다(§보고 참조) — 여기서는
    //   `startsWith('feed:')`(feed.mjs:61, 미발행 feed 커밋 검출)까지 세어 폐쇄를 더 넓게 잡는다.
    const sites = subjectPrefixSites(productionSources())

    expect(sites.map(({ file, form, token }) => ({ file, form, token }))).toEqual([
      { file: 'scripts/lib/feed.mjs', form: 'regex', token: 'feed' },
      { file: 'scripts/lib/feed.mjs', form: 'startsWith', token: 'feed' },
    ])

    // 소스 리터럴을 **회수**해 3중 대조(문서 아님 · 소스 · 리터럴 기대)를 완성한다.
    const literal = feedSubjectLiteral(productionSources().get('scripts/lib/feed.mjs'))
    expect(literal).toEqual({ flags: '', source: String.raw`^feed:\s+(.+)$` })

    // ★ 앵커 3개(규범 B) — 스캔이 0을 낸 것과 "정규식이 실제로 그렇게 동작한다" 를 가른다.
    const recovered = new RegExp(literal.source, literal.flags)
    expect(recovered.test(SUBJECTS.feed)).toBe(true)
    expect(recovered.test(SUBJECTS.chore)).toBe(false)
    expect(recovered.test(SUBJECTS.legacy)).toBe(false)
  })
})

describe('행동 무해성 — 옛 접두사와 임의 접두사가 구분되지 않는다 (FS2 pin · CX-6D)', () => {
  it('FS2: `parseCommitForFeed` 의 반환과 부작용이 두 접두사에서 동일하다', () => {
    // ★ 치환의 안전성을 **단위층에서** 증명한다 — A/B 골든마스터보다 강하고 싸다.
    //   (강하다: 마스킹 없이 전량 비교한다 · 싸다: 산출물을 만들지 않는다.)
    const legacyStats = statsSink()
    const choreStats = statsSink()
    const commit = (subject) => ({ authorDate: '2026-01-01T00:00:00Z', body: '', hash: 'c0ffee00fs02', subject }) // prettier-ignore

    const legacyResult = parseCommitForFeed(commit(SUBJECTS.legacy), legacyStats)
    const choreResult = parseCommitForFeed(commit(SUBJECTS.chore), choreStats)

    // 앵커 먼저(규범 B): `feed:` 는 **non-null** 을 낸다 — 함수가 늘 null 을 내는 것을 배제한다.
    expect(parseCommitForFeed(commit(SUBJECTS.feed), statsSink())).not.toBeNull()

    expect(legacyResult).toBeNull()
    expect(choreResult).toBeNull()
    expect(legacyStats).toEqual(choreStats)
    expect(legacyStats).toEqual({ unpublishedFeedCommits: [], warnings: [] })
  })
})
