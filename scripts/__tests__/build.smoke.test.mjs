// @vitest-environment node
//
// P2 RED-11 · 빌드 파이프라인 스모크(임시 repo 자체 시딩 · 실 git · 결정적) — tdd §6.11
//
// **전면 재작성**(기존 8건): 시딩 컨벤션(`post(<해시>)` → `cwiki`/`uwiki`/`feed`)·산출 파일
//   (`content.json` → 3 페이로드)·단언 대상이 전부 교체됐다. 단언을 약화한 것이 아니라 **새 계약으로 옮겼다**.
//
// RED 사유: `buildContent({ vault, out })` 계약·3 페이로드·`lib/invariants.mjs` 미구현.
//
// 실 vault(`seed-example-vault.mjs`)를 쓰지 않는다 — 스모크는 **최소 시나리오**를 자체 시딩한다
//   (빠르고, 실패 시 원인이 좁다). 실 vault 통합은 `build.vault.test.mjs` 가 맡는다.
//
// **in-process 호출**(execFileSync 아님): 신규 lib(payloads·invariants)이 v8 커버리지에 잡혀야
//   전역 floor 가 내려가지 않는다(tdd §11). CLI 계약은 `build.cli.test.mjs` 가 subprocess 로 본다.
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { buildContent } from '../validate.mjs'
import { loadSchema, validateItem } from '../lib/schema-validator.mjs'

// RED 시점에 이 모듈은 존재하지 않는다. 정적 import 로 적으면 eslint 의 import-x/no-unresolved 가
// 에러를 내고, pre-commit(lint-staged)이 **RED 커밋 자체를 막는다** — 규칙을 억제하는 대신 해석을
// 런타임으로 미룬다. 실패는 "Cannot find module …" 로 명확히 드러나고, in-process 호출이므로
// coverage 계측(vitest.config.ts:20)은 그대로 유지된다.
const { checkInvariants } = await import(new URL('../lib/invariants.mjs', import.meta.url).href)

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SCHEMA_DIR = path.resolve(HERE, '..', 'schema')
const EPOCH = '1700000000' // → 2023-11-14T22:13:20.000Z

// ── 결정성 6필드 (git t/test-lib.sh test_tick 관례) ──────────────────────────
const NAME = 'SAS Wiki Bot'
const EMAIL = 'bot@sas.wiki'
let tick = 1_136_239_445

const ctx = { ids: {}, prevEpoch: undefined, result: null, result2: null, vault: '' }

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
  return execFileSync('git', ['-c', 'core.quotepath=false', ...args], {
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
  }).trim()
}

function nextDate() {
  tick += 60
  return `${tick} +0000`
}

// frontmatter 저작 UUIDv7 doc id — 결정적 counter(문서마다 유일). id 출처가 frontmatter 로 반전됐다.
// 시딩 시 파일에 써 커밋하므로 재빌드(out1·out2)는 같은 id 를 읽어 byte-identical 이 유지된다.
let idSeq = 0
function nextDocId() {
  return `0192f0d0-0000-7000-8000-${(idSeq += 1).toString(16).padStart(12, '0')}`
}

function writeDoc(root, rel, title) {
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
      `${title} 문서의 정의 문단이다.`,
      '',
      '## 로드맵',
      '',
      '세대 전환을 준비한다.',
      '',
    ].join('\n'),
  )
  return id
}

beforeAll(() => {
  const vault = mkdtempSync(path.join(tmpdir(), 'wiki-smoke-'))
  ctx.vault = vault
  git(vault, ['init', '-q'])

  // 1 · 문서 생성(chore — id = frontmatter 저작 UUIDv7)
  ctx.ids.foo = writeDoc(vault, 'concept/foo', '삼성전자')
  commit(vault, 'chore: 삼성전자 문서 생성')

  // 2 · 삭제 후 재생성될 문서 — **옛 id**(부활하면 안 된다)
  ctx.ids.rebornOld = writeDoc(vault, 'concept/reborn', '부활문서')
  commit(vault, 'chore: 부활문서 문서 생성')

  // 3 · 삭제될 문서
  writeDoc(vault, 'misc/del-me', '폐기문서')
  commit(vault, 'chore: 폐기문서 문서 생성')

  // 4 · feed — 살아남는 피드(anchor = 바뀐 섹션)
  appendDoc(vault, 'concept/foo', 'HBM4 양산 로드맵을 공개했다.')
  commit(vault, 'feed: 삼성전자 HBM4 로드맵 공개\n\n본문.\n\nKeywords: HBM\nImportance: breaking')

  // 5 · feed — 대상 문서가 곧 삭제되어 **prune 될** 피드
  appendDoc(vault, 'misc/del-me', '정리 대상으로 분류됐다.')
  commit(vault, 'feed: 폐기문서 관련 소식\n\n본문.\n\nKeywords: 정리\nImportance: normal')

  // 6 · chore — 피드 미발행 수정(재생성 준비: 삭제)
  git(vault, ['rm', '-q', 'wiki/concept/reborn.md'])
  commit(vault, 'chore: 부활문서 삭제')

  // 7 · chore — 삭제(→ 5번 피드가 prune 된다)
  git(vault, ['rm', '-q', 'wiki/misc/del-me.md'])
  commit(vault, 'chore: 폐기문서 삭제')

  // 8 · chore — **같은 경로에 재생성 → 새 문서(새 id)**  (README · 문서 id)
  ctx.ids.rebornNew = writeDoc(vault, 'concept/reborn', '부활문서')
  commit(vault, 'chore: 부활문서 재생성')

  // 9~13 · **경로 재사용 함정** — 살아 있는 문서의 과거 피드가 사라지면 안 된다.
  //   문서 A 를 x 에 만들고 → A 를 가리키는 feed → A 를 y 로 이동 → **다른 문서 B 가 빈 x 를 재사용**
  //   → B 삭제. 이때 x 는 "삭제된 경로" 지만, 그 feed 의 diff 가 가리키는 x 는 **그 시점의 A** 이고
  //   A 는 y 로 멀쩡히 살아 있다. 경로만 보고 prune 하면 A 의 뉴스가 통째로 증발한다.
  ctx.ids.mover = writeDoc(vault, 'company/reuse-x', '이사간문서')
  commit(vault, 'chore: 이사간문서 문서 생성')

  appendDoc(vault, 'company/reuse-x', '신제품 라인업을 공개했다.')
  commit(vault, 'feed: 이사간문서 신제품 공개\n\n본문.\n\nKeywords: 신제품\nImportance: normal')

  git(vault, ['mv', 'wiki/company/reuse-x.md', 'wiki/company/reuse-y.md'])
  commit(vault, 'chore: 이사간문서를 reuse-y 로 이동')

  writeDoc(vault, 'company/reuse-x', '경로재사용문서')
  commit(vault, 'chore: 경로재사용문서 생성')

  git(vault, ['rm', '-q', 'wiki/company/reuse-x.md'])
  commit(vault, 'chore: 경로재사용문서 삭제')

  ctx.prevEpoch = process.env.SOURCE_DATE_EPOCH
  process.env.SOURCE_DATE_EPOCH = EPOCH

  // 결정성 검증용 2회 조립(같은 입력·같은 SOURCE_DATE_EPOCH). validate 는 파일을 쓰지 않으므로
  // in-memory payload 를 대조한다(구: out1·out2 byte-identical).
  ctx.result = buildContent({ vault })
  ctx.result2 = buildContent({ vault })
})

afterAll(() => {
  if (ctx.prevEpoch === undefined) delete process.env.SOURCE_DATE_EPOCH
  else process.env.SOURCE_DATE_EPOCH = ctx.prevEpoch
  for (const dir of [ctx.vault]) {
    if (dir) rmSync(dir, { force: true, recursive: true })
  }
})

describe('build.smoke — 3 페이로드 산출', () => {
  it('3 페이로드(summary·feeds·body)를 in-memory 로 조립하고 유효하다', () => {
    expect(ctx.result.summary.docs.length).toBeGreaterThan(0)
    expect(ctx.result.feeds.items).toBeInstanceOf(Array)
    expect(Object.keys(ctx.result.body.docs).length).toBeGreaterThan(0)
  })

  it('3 페이로드가 strict 스키마를 통과한다', () => {
    const { body, feeds, summary } = ctx.result

    expect(validateItem(summary, loadSchema(path.join(SCHEMA_DIR, 'summary.schema.json')))).toEqual(
      [],
    )
    expect(validateItem(feeds, loadSchema(path.join(SCHEMA_DIR, 'feeds.schema.json')))).toEqual([])
    expect(validateItem(body, loadSchema(path.join(SCHEMA_DIR, 'body.schema.json')))).toEqual([])
  })

  it('불변식 8종이 green 이다', () => {
    const { body, feeds, summary } = ctx.result

    expect(() => checkInvariants(summary, feeds, body)).not.toThrow()
  })

  it('docs[] 는 정확히 1키(id)만 갖는다', () => {
    const refs = ctx.result.feeds.items.flatMap((item) => item.docs)
    const feed = ctx.result.feeds.items.find((item) => item.title === '삼성전자 HBM4 로드맵 공개')

    expect(refs.length).toBeGreaterThan(0)
    for (const ref of refs) expect(Object.keys(ref).toSorted()).toEqual(['id'])
    expect(feed.docs[0]).toEqual({ id: ctx.ids.foo })
  })

  it('제거된 필드가 산출물에 하나도 없다', () => {
    const raw = JSON.stringify([ctx.result.summary, ctx.result.feeds, ctx.result.body])

    for (const dead of [
      '"md":',
      '"sentiment":',
      '"bodyHtml":',
      '"backlinks":',
      '"refs":',
      '"link":',
      '"footnotes":',
    ]) {
      // prettier-ignore
      expect(raw, dead).not.toContain(dead)
    }
  })
})

describe('build.smoke — 삭제·prune·재생성', () => {
  it('삭제된 문서는 summary·body 어디에도 없다', () => {
    const paths = ctx.result.summary.docs.map((doc) => doc.breadcrumb.join('/'))

    expect(paths).not.toContain('misc/del-me')
    expect('misc/del-me' in ctx.result.body.docs).toBe(false)
  })

  it('삭제된 문서만 가리키던 피드는 docs[] 없이 살아남고 건수가 남는다', () => {
    expect(ctx.result.feeds.items.map((item) => item.title)).toEqual([
      '이사간문서 신제품 공개',
      '폐기문서 관련 소식',
      '삼성전자 HBM4 로드맵 공개',
    ])
    expect(ctx.result.feeds.items.find((item) => item.title === '폐기문서 관련 소식').docs).toEqual(
      [],
    )
    expect(ctx.result.stats.prunedFeeds).toBe(0)
    expect(ctx.result.stats.prunedDocRefs).toBe(1)
  })

  it('경로가 재사용·삭제돼도, 그 경로를 떠난 문서의 과거 피드는 살아남는다', () => {
    // 회귀: prune 판정(경로 단위 · 시간 무관)이 역인덱스 조회(시간 인지)보다 먼저 돌면
    // "삭제된 경로" 라는 이유만으로 **살아 있는 문서의 뉴스가 통째로 사라졌다**(feeds=0, prune=1).
    // 역인덱스가 풀어내면 그것이 정답이다 — deletedPaths 는 못 풀 때만 쓰는 분류기다.
    const feed = ctx.result.feeds.items.find((item) => item.title === '이사간문서 신제품 공개')

    expect(feed).toBeDefined()
    expect(feed.docs.map((ref) => ref.id)).toEqual([ctx.ids.mover])

    // 그 문서는 이동한 새 경로에 살아 있다(= prune 대상이 아님이 자명하다).
    const mover = ctx.result.summary.docs.find((doc) => doc.id === ctx.ids.mover)
    expect(mover.breadcrumb.join('/')).toBe('company/reuse-y')
  })

  it('삭제 후 같은 경로에 재생성된 문서는 **새 id** 를 갖는다', () => {
    // 옛 생성 해시가 부활하면 과거 피드가 엉뚱한 새 문서를 가리킨다(README · 문서 id).
    const reborn = ctx.result.summary.docs.find(
      (doc) => doc.breadcrumb.join('/') === 'concept/reborn',
    )

    expect(reborn.id).toBe(ctx.ids.rebornNew)
    expect(reborn.id).not.toBe(ctx.ids.rebornOld)
  })
})

describe('build.smoke — 결정성', () => {
  it('같은 입력·같은 SOURCE_DATE_EPOCH 로 재조립하면 payload 가 byte-identical 이다', () => {
    for (const key of ['summary', 'feeds', 'body']) {
      const first = JSON.stringify(ctx.result[key])
      const second = JSON.stringify(ctx.result2[key])

      expect(second, key).toBe(first)
    }
  })

  it('SOURCE_DATE_EPOCH 가 generatedAt 을 결정한다', () => {
    expect(ctx.result.summary.generatedAt).toBe('2023-11-14T22:13:20.000Z')
    expect(ctx.result.feeds.generatedAt).toBe('2023-11-14T22:13:20.000Z')
  })
})
