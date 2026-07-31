// @vitest-environment node
//
// P6 · 접두사 치환의 증거 — 술어 폐쇄 + 행동 무해성 (FS1·FS2·FS4) — tdd §3.7 · plan Task 5 · D-E
//
// ── 왜 이 파일이 A/B 골든마스터보다 먼저인가 ────────────────────────────────────────────────
// plan D-E 는 픽스처 접두사 치환의 증거로 **A/B 교란 일치**(제목의 접두사 밖을 바꾼 팔 A vs 접두사를
// 바꾼 팔 B 의 정규화 출력 동일)를 설계했다. 그 절차는 필요하지만 **비싸고 늦다** — 산출물을 두 번
// 만들어야 하고, `git-walk.mjs:206` 의 `id: commit.hash.slice(0, 12)` 때문에 마스킹 없이는 무조건
// diff 가 난다.
//
// 여기서는 **더 강하고 싼 증거**를 앞에 세운다:
//   FS1  프로덕션에서 커밋 subject 를 **접두사로 심사하는 지점이 어디까지인가**(소스 폐쇄)
//   FS2  그 폐쇄가 참일 때 옛 접두사와 임의 접두사가 **같은 반환·같은 부작용**을 낸다(단위 동치)
//   FS4  컨벤션 검사가 접두사에 **무관**하다(D6 이후 per-kind 규칙이 없다)
// FS3(A/B 교란 일치)은 **보강 측정**으로 강등했고 리포에 착륙시키지 않는다 — 1회용 스크래치
// (`ab-prefix-probe.mjs`)로 돌려 §8-6 에 기록한다(상시화하면 스냅샷 부패 위험만 남는다).
//
// ── 결론 문구를 정직하게 제한한다 (plan D-E 계승) ──────────────────────────────────────────
// 쓸 수 있는 것은 _"정규화 투영 하에서, 실행된 코퍼스 범위에서 접두사에 대한 **관측된 의존이 없다**"_
// 이고, _"접두사는 읽히지 않음이 **증명**되었다"_ 는 **쓰지 않는다**(McKeeman 1998 · Kuchta & Wagner:
// 두 프로그램의 동치성은 결정 불가).
//
// ── RED/green 현황 (작성 시점 실측) ────────────────────────────────────────────────────────
//   FS1·FS2  pin  — **지금도 green**(실측 N8: 프로덕션 접두사 술어는 `feed.mjs` 한 곳뿐).
//                   그것이 곧 "치환해도 안전하다" 의 근거이므로 **치환 전에 관측**해야 한다(§5.1 [2]).
//   FS4      pair — 지금도 green(D6 이후). GREEN 이후에도 항상 통과해야 한다.
//   ★ CX-6D 가 이 셋의 물림을 증명한다 — `FEED_SUBJECT_RE` 를 옛 3종으로 **넓히면** FS1·FS2 가 red 여야
//     한다. red 가 안 나오면 이 파일은 장식이다.
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { checkCommitConventions } from '../invariants.mjs'
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

describe('컨벤션 검사의 접두사 무관성 (FS4 pair)', () => {
  it('FS4: 같은 statuses 면 접두사가 달라도 throw 여부와 진단이 같다', () => {
    // ★ FO1·FO2·FO5 와 **중복이지만 축이 다르다** — FO 는 *per-kind 규칙 소멸*이 주제이고, 여기는
    //   *접두사 무관성*(치환 안전성)이 주제다. REFACTOR 에서 합치지 않는다(합치면 Task 5 의 안전
    //   근거가 FO 파일에 숨는다 — §10.3-4).
    const subjects = [SUBJECTS.legacy, SUBJECTS.chore, SUBJECTS.feed]

    // ① A+D(문서 id 소실 시그니처) — 셋 다 throw 하고 진단이 같다.
    const violating = subjects.map((subject) =>
      violationShape(
        [{ hash: 'c0ffee00fs4a', subject }],
        stubGitStatuses({ c0ffee00fs4a: ['A\twiki/tech/x.md', 'D\twiki/company/y.md'].join('\n') }),
      ),
    )
    // 앵커(양극성 ①): 실제로 throw 했고 메시지가 비어 있지 않다 — "전부 통과" 구현 배제.
    expect(violating.map((shape) => shape.threw)).toEqual([true, true, true])
    expect(violating[0].message).toMatch(/컨벤션 위반/)
    expect(new Set(violating.map((shape) => shape.message)).size).toBe(1)

    // ② M 만(단순 수정) — 셋 다 통과한다. 앵커(양극성 ②): "전부 실패" 구현 배제.
    const clean = subjects.map((subject) =>
      violationShape(
        [{ hash: 'c0ffee00fs4b', subject }],
        stubGitStatuses({ c0ffee00fs4b: 'M\twiki/company/a.md' }),
      ),
    )
    expect(clean.map((shape) => shape.threw)).toEqual([false, false, false])
  })
})
