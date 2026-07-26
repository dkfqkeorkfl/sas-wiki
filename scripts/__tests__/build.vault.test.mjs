// @vitest-environment node
//
// P2 RED-12 · 실 vault 통합 (plan Task 12 / tdd §9) — **P2 의 진짜 수용 기준**
//
// 이 파일을 **가장 먼저** 쓴다. 나중에 쓰면 "구현이 낸 결과 = 기대값"이 되어(순환 논증)
// 조용한 유실이 그대로 정답으로 박제된다 — 데이터 파이프라인에서 가장 위험한 함정이다.
//
// RED 사유(작성 시점):
//   ① `lib/invariants.mjs` · `lib/payloads.mjs` 부재 → 모듈 해석 실패(파일 전체 RED).
//   ② `buildContent(root, opts)` 가 아직 `--root` 단일 인자 계약이다 → `{ vault, out }` 미지원.
//   ③ 3 페이로드(wiki_summary/feeds/body.json)와 스키마 3종이 아직 없다.
//   ④ 신 커밋 컨벤션(cwiki/uwiki/feed)·rename 역인덱스·prune·anchor 강등 미구현.
//
// 금지(tdd §14.1 R3): `it.skipIf` / `describe.runIf` / early-return.
//   이 테스트는 서브모듈에 의존하지 않고 임시 repo 를 스스로 시딩하므로(prepareSeedRepo)
//   항상 결정적으로 실행된다 — 건너뛸 환경 조건 자체가 없다.
//
// **SHA 하드코딩 금지**(tdd §9.1 각주): vault 는 재제작 시 전 커밋 해시가 바뀐다.
//   기대값은 git 에서 유도하거나(생성 커밋 = `--follow --diff-filter=A` 의 최신 A)
//   구조적 관계로 단언한다(`feed.docs[0].id === summary.docs(tech/HBM).id`).
//
// 계약(GREEN 이 구현할 seam):
//   buildContent({ vault, out, schema?, allowDeadlinks? })
//     → { summary, feeds, body, stats } · <out>/wiki_{summary,feeds,body}.json 3파일 write
//   stats = { offConventionCommits: [{sha,subject}], prunedDocRefs: number,
//             prunedFeeds: number, unresolvedPaths: [{sha,path}], warnings: [{sha,reason}] }
//   checkInvariants(summary, feeds, body) → 위반 시 throw, 정상이면 void
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { buildContent } from '../validate.mjs'
import { loadSchema, validateItem } from '../lib/validate.mjs'

import { seedVault } from './helpers/seed-example-vault.mjs'
import { git } from './helpers/vault-facts.mjs'

// RED 시점에 이 모듈은 존재하지 않는다. 정적 import 로 적으면 eslint 의 import-x/no-unresolved 가
// 에러를 내고, pre-commit(lint-staged)이 **RED 커밋 자체를 막는다** — 규칙을 억제하는 대신 해석을
// 런타임으로 미룬다. 실패는 "Cannot find module …" 로 명확히 드러나고, in-process 호출이므로
// coverage 계측(vitest.config.ts:20)은 그대로 유지된다.
const { checkInvariants } = await import(new URL('../lib/invariants.mjs', import.meta.url).href)

const HERE = path.dirname(fileURLToPath(import.meta.url)) // scripts/wiki/__tests__
const SCRIPT_DIR = path.resolve(HERE, '..') // scripts/wiki
const SCHEMA_DIR = path.join(SCRIPT_DIR, 'schema')

// 결정성: SOURCE_DATE_EPOCH 를 고정해 generatedAt 을 못 박는다(재빌드 byte-identical 의 전제).
const EPOCH = '1700000000'

// 문서 슬러그(파일명) — 값이 아니라 **관계**로 단언하기 위한 좌표.
const SAMSUNG = 'company/삼성전자'
const HYNIX = 'company/SK하이닉스'
const TSMC = 'company/TSMC'
const HBM = 'tech/HBM' // 커밋 12 에서 concept/ → tech/ 로 이동
const MOC = 'moc/반도체'
const ONDEVICE = 'concept/온디바이스-AI' // 커밋 14 에서 disable
const SCRAP = 'concept/폐기예정-메모' // 커밋 16 에서 삭제

const BASE_IDENTITY = {
  GIT_AUTHOR_DATE: '1136239445 +0000',
  GIT_AUTHOR_EMAIL: 'bot@sas.wiki',
  GIT_AUTHOR_NAME: 'SAS Wiki Bot',
  GIT_COMMITTER_DATE: '1136239445 +0000',
  GIT_COMMITTER_EMAIL: 'bot@sas.wiki',
  GIT_COMMITTER_NAME: 'SAS Wiki Bot',
}

const ctx = { first: null, result: null, result2: null, vault: '' }

/** 문서의 생성(A) 커밋 sha — created 날짜 파생 검증에 쓴다(id 출처는 더 이상 아니다). */
function creationSha(relDoc) {
  const out = git(ctx.vault, [
    'log',
    '--follow',
    '--diff-filter=A',
    '--format=%H',
    '--',
    docFile(relDoc),
  ])
  return out.split('\n')[0]
}

/** vault 문서의 리포 상대 md 경로. */
function docFile(relDoc) {
  return `wiki/${relDoc}.md`
}

/** 문서 id = frontmatter 에 저작된 불변 UUIDv7 (D1). 이동해도 파일과 함께 옮겨간다 → working tree 에서 읽는다. */
function docId(relDoc) {
  const raw = readFileSync(path.join(ctx.vault, docFile(relDoc)), 'utf8')
  return raw.match(/^id:\s*"([^"]+)"/mu)[1]
}

/** summary 에서 breadcrumb 로 문서를 찾는다(계약에 문자열 path 필드는 없다 — join 으로 유도). */
function docOf(relDoc) {
  return ctx.result.summary.docs.find((doc) => doc.breadcrumb.join('/') === relDoc)
}

/** 헤드라인으로 피드 아이템을 찾는다(sha 하드코딩 회피 — 제목은 시딩 스크립트의 안정 좌표). */
function feedOf(title) {
  return ctx.result.feeds.items.find((item) => item.title === title)
}

function prepareSeedRepo() {
  const repo = mkdtempSync(path.join(tmpdir(), 'wiki-vault-repo-'))
  execFileSync('git', ['init', '-q', '-b', 'main', repo], { encoding: 'utf8' })
  writeFileSync(path.join(repo, 'README.md'), '# sas-wiki\n', 'utf8')
  git(repo, ['add', '-A'])
  execFileSync(
    'git',
    ['-C', repo, 'commit', '-q', '--no-gpg-sign', '-m', 'Initialize README with project title'],
    {
      encoding: 'utf8',
      env: { ...process.env, ...BASE_IDENTITY },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  seedVault({ branch: 'test', repo })
  return repo
}

beforeAll(() => {
  ctx.vault = prepareSeedRepo()

  ctx.first = process.env.SOURCE_DATE_EPOCH
  process.env.SOURCE_DATE_EPOCH = EPOCH

  // in-process 호출 — 신규 lib(payloads·invariants)이 v8 커버리지에 잡히게 한다(tdd §11).
  // validate 는 파일을 쓰지 않으므로 결정성은 in-memory payload 2회 조립으로 대조한다(구: out1·out2).
  ctx.result = buildContent({ vault: ctx.vault })
  ctx.result2 = buildContent({ vault: ctx.vault })
})

afterAll(() => {
  if (ctx.first === undefined) delete process.env.SOURCE_DATE_EPOCH
  else process.env.SOURCE_DATE_EPOCH = ctx.first
  for (const dir of [ctx.vault]) if (dir) rmSync(dir, { force: true, recursive: true })
})

describe('실 vault ① 문서 집합', () => {
  it('active 5 · disable 1 · 삭제된 문서는 부재한다', () => {
    const { docs } = ctx.result.summary
    const paths = docs.map((doc) => doc.breadcrumb.join('/')).toSorted()

    expect(paths).toEqual([HYNIX, TSMC, SAMSUNG, MOC, ONDEVICE, HBM].toSorted())
    expect(paths).not.toContain(SCRAP) // 커밋 16 에서 git rm — 어디에도 남지 않는다
    expect(docs.filter((doc) => doc.status === 'active')).toHaveLength(5)
    expect(docs.filter((doc) => doc.status === 'disable')).toHaveLength(1)
  })

  it('disable 문서는 4키 스텁이다(본문 필드가 새지 않는다)', () => {
    const stub = docOf(ONDEVICE)

    expect(Object.keys(stub).toSorted()).toEqual(['breadcrumb', 'id', 'status', 'title'])
  })

  it('active doc 은 정확히 10키다(md·html·path 부재)', () => {
    const samsung = docOf(SAMSUNG)

    expect(Object.keys(samsung).toSorted()).toEqual([
      'aliases',
      'breadcrumb',
      'created',
      'excerpt',
      'id',
      'status',
      'tags',
      'title',
      'type',
      'updated',
    ])
  })

  it('body.docs 키는 active 5개 경로다(disable·삭제 문서 부재 — 불변식 2)', () => {
    expect(Object.keys(ctx.result.body.docs).toSorted()).toEqual(
      [SAMSUNG, HYNIX, TSMC, HBM, MOC].toSorted(),
    )
  })

  it('tree 에 concept 노드가 없다(disable·삭제만 남은 폴더는 노드째 사라진다)', () => {
    expect(ctx.result.summary.tree.map((node) => node.path).toSorted()).toEqual([
      'company',
      'moc',
      'tech',
    ])
  })

  it('tags 는 active 문서만 역색인한다(삭제 문서의 태그 키는 생기지 않는다)', () => {
    const { tags } = ctx.result.summary

    expect(tags['반도체'].toSorted()).toEqual([docId(SAMSUNG), docId(HYNIX), docId(TSMC), docId(MOC)].toSorted()) // prettier-ignore
    expect(tags['메모리'].toSorted()).toEqual([docId(SAMSUNG), docId(HYNIX), docId(HBM)].toSorted())
    expect(tags['파운드리']).toEqual([docId(TSMC)])
    expect(tags['AI']).toEqual([docId(HBM)]) // 온디바이스-AI(disable)는 세지 않는다
    expect('임시' in tags).toBe(false) // 삭제된 폐기예정-메모의 태그
  })

  it('문서 id 는 frontmatter UUIDv7 이며 rename 후에도 불변이다', () => {
    const hbm = docOf(HBM)
    const created = git(ctx.vault, ['log', '-1', '--format=%aI', creationSha(HBM)])

    // 커밋 12 에서 concept/HBM → tech/HBM 으로 이동했지만 id 는 frontmatter 저작 UUIDv7 이라 불변이다.
    // created 는 여전히 생성 커밋(커밋 4)의 author date 에서 파생된다.
    expect(hbm.id).toBe(docId(HBM))
    expect(hbm.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u)
    expect(hbm.created).toBe(created)
  })

  it('excerpt 는 본문 첫 문단 평문이다(heading 건너뛰기 · HEAD 스냅샷)', () => {
    // 커밋 10(uwiki 오탈자 수정)이 반영된 HEAD 본문이어야 한다 — 과거 스냅샷이 아니다.
    expect(docOf(HBM).excerpt).toBe(
      'HBM(High Bandwidth Memory)은 DRAM 다이를 수직으로 적층해 대역폭을 크게 끌어올린 메모리다.',
    )
    // 불릿 + 위키링크 블록 → 마커가 전부 스트립된 평문
    expect(docOf(MOC).excerpt).toBe('삼성전자 SK하이닉스 TSMC')
  })
})

describe('실 vault ② rename (커밋 11 ↔ 12) — 조용한 유실의 본진', () => {
  it('이동한 문서를 가리키던 과거 피드가 살아 있다', () => {
    expect(feedOf('HBM4 로드맵 갱신')).toBeDefined()
  })

  it('당시 경로(concept/HBM)가 현재 문서(tech/HBM)로 해석된다', () => {
    const item = feedOf('HBM4 로드맵 갱신')

    expect(item.docs.map((ref) => ref.id)).toEqual([docOf(HBM).id])
  })

  it('feed 문서 참조는 현재 문서 id 만 싣는다', () => {
    const item = feedOf('HBM4 로드맵 갱신')

    expect(item.docs[0]).toEqual({ id: docOf(HBM).id })
  })

  it('feed 문서 참조에는 anchorText 가 없다', () => {
    const item = feedOf('HBM4 로드맵 갱신')

    expect(Object.keys(item.docs[0])).toEqual(['id'])
  })

  it('해석 실패 경로가 0건이다(집계기가 실제로 센다는 증거는 feed.test #13)', () => {
    // vacuous 방지: "0건"만 두면 집계기가 고장나도(항상 빈 배열) 통과한다 →
    // 해석이 **실제로 일어났다**는 하한을 같은 블록에 짝지운다.
    const resolved = ctx.result.feeds.items.flatMap((item) => item.docs)

    expect(resolved.length).toBeGreaterThanOrEqual(6)
    expect(ctx.result.stats.unresolvedPaths).toEqual([])
  })
})

describe('실 vault ③ prune (커밋 15 ↔ 16)', () => {
  it('삭제된 문서만 가리키던 피드는 docs[] 없이 살아남는다', () => {
    expect(feedOf('폐기예정 메모 관련 소식').docs).toEqual([])
  })

  it('prune 건수가 stats 에 남는다(조용한 삭제 금지)', () => {
    expect(ctx.result.stats.prunedDocRefs).toBe(1)
    expect(ctx.result.stats.prunedFeeds).toBe(0)
  })

  it('발행 6건이 모두 남는다', () => {
    expect(ctx.result.feeds.items).toHaveLength(6)
  })
})

describe('실 vault ④ disable (커밋 13 ↔ 14)', () => {
  it('disable 된 문서를 가리키던 피드는 살아 있다(prune 하지 않는다)', () => {
    expect(feedOf('온디바이스 AI, 스마트폰 탑재 확대')).toBeDefined()
  })

  it('그 피드는 disable 스텁을 가리킨다(불변식 1 이 disable 을 포함하는 이유)', () => {
    const item = feedOf('온디바이스 AI, 스마트폰 탑재 확대')

    expect(item.docs.map((ref) => ref.id)).toEqual([docOf(ONDEVICE).id])
  })

  it('disable 피드도 문서 id 만 싣는다', () => {
    const item = feedOf('온디바이스 AI, 스마트폰 탑재 확대')

    expect(item.docs[0]).toEqual({ id: docOf(ONDEVICE).id })
  })
})

describe('실 vault ⑤ 다중 문서 (커밋 9)', () => {
  it('한 커밋이 문서 2개를 고치면 docs[] 가 2건이다', () => {
    expect(feedOf('SK하이닉스·삼성전자, HBM 공급 계약 체결').docs).toHaveLength(2)
  })

  it('두 문서를 정확히 가리킨다(표시 순서는 자유)', () => {
    const item = feedOf('SK하이닉스·삼성전자, HBM 공급 계약 체결')

    expect(item.docs.map((ref) => ref.id).toSorted()).toEqual(
      [docOf(SAMSUNG).id, docOf(HYNIX).id].toSorted(),
    )
  })

  it('각 문서 참조는 id 만 싣는다', () => {
    const item = feedOf('SK하이닉스·삼성전자, HBM 공급 계약 체결')

    expect(item.docs.map((ref) => Object.keys(ref))).toEqual([['id'], ['id']])
  })

  it('각 문서 참조에는 anchorText 가 없다', () => {
    const item = feedOf('SK하이닉스·삼성전자, HBM 공급 계약 체결')

    expect(item.docs.every((ref) => !Object.hasOwn(ref, 'anchorText'))).toBe(true)
  })

  it('trailer 가 keywords·importance 로 파싱된다(Tags: 는 사라졌다)', () => {
    const item = feedOf('SK하이닉스·삼성전자, HBM 공급 계약 체결')

    expect(item.keywords).toEqual(['HBM', '공급계약'])
    expect(item.importance).toBe('highlight')
    expect('tags' in item).toBe(false)
  })

  it('FeedItem 은 정확히 7키다(제거 필드가 하나도 없다)', () => {
    const item = feedOf('삼성전자, HBM3E 12단 양산 승인')

    expect(Object.keys(item).toSorted()).toEqual([
      'body',
      'docs',
      'id',
      'importance',
      'keywords',
      'title',
      'ts',
    ])
  })
})

describe('실 vault ⑥ anchor null (커밋 17)', () => {
  it('frontmatter 만 고친 피드도 문서 id 만 싣는다', () => {
    expect(feedOf('삼성전자 거래소 정보 정정').docs[0]).toEqual({ id: docOf(SAMSUNG).id })
  })

  it('그래도 문서는 가리킨다(문서 참조까지 사라지면 안 된다)', () => {
    expect(feedOf('삼성전자 거래소 정보 정정').docs[0].id).toBe(docOf(SAMSUNG).id)
  })

  it('body.meta 는 HEAD 스냅샷이다(커밋 17 의 KOSPI · KRX 가 아니다)', () => {
    expect(ctx.result.body.docs[SAMSUNG].meta.exchange).toBe('KOSPI')
  })

  it('body doc 은 정확히 4키다(html·headings·meta·sources)', () => {
    expect(Object.keys(ctx.result.body.docs[SAMSUNG]).toSorted()).toEqual([
      'headings',
      'html',
      'meta',
      'sources',
    ])
  })
})

describe('실 vault ⑦ 전역 계약', () => {
  it('3 페이로드가 strict 스키마를 통과한다(제거 필드 0)', () => {
    const { body, feeds, summary } = ctx.result

    expect(validateItem(summary, loadSchema(path.join(SCHEMA_DIR, 'summary.schema.json')))).toEqual([]) // prettier-ignore
    expect(validateItem(feeds, loadSchema(path.join(SCHEMA_DIR, 'feeds.schema.json')))).toEqual([])
    expect(validateItem(body, loadSchema(path.join(SCHEMA_DIR, 'body.schema.json')))).toEqual([])
  })

  it('불변식 8종이 green 이다', () => {
    const { body, feeds, summary } = ctx.result

    expect(() => checkInvariants(summary, feeds, body)).not.toThrow()
  })

  it('sourceCommit 3종이 동일하고 vault HEAD 와 일치한다(불변식 7)', () => {
    const head = git(ctx.vault, ['rev-parse', 'HEAD'])
    const { body, feeds, summary } = ctx.result

    expect(summary.sourceCommit).toBe(head)
    expect(feeds.sourceCommit).toBe(head)
    expect(body.sourceCommit).toBe(head)
  })

  it('schemaVersion 은 정수 1이고 body 봉투에는 generatedAt 이 없다', () => {
    const { body, feeds, summary } = ctx.result

    expect(Number.isInteger(summary.schemaVersion)).toBe(true)
    expect([summary.schemaVersion, feeds.schemaVersion, body.schemaVersion]).toEqual([1, 1, 1])
    expect('generatedAt' in body).toBe(false)
  })

  it('규약 밖 커밋 warning 이 0건이다(루트 README 커밋은 vault 를 안 건드린다)', () => {
    // vacuous 방지 짝: 파서가 실제로 커밋을 훑었다는 하한(피드 5건)과 같은 블록에 둔다.
    expect(ctx.result.feeds.items.length).toBeGreaterThanOrEqual(5)
    expect(Object.hasOwn(ctx.result.stats, 'offConventionCommits')).toBe(false)
    expect(ctx.result.stats.unpublishedFeedCommits).toEqual([])
  })

  it('같은 SOURCE_DATE_EPOCH 로 재조립하면 payload 가 byte-identical 이다', () => {
    for (const key of ['summary', 'feeds', 'body']) {
      expect(JSON.stringify(ctx.result2[key]), key).toBe(JSON.stringify(ctx.result[key]))
    }
  })

  it('generatedAt 은 SOURCE_DATE_EPOCH 가 결정한다', () => {
    expect(ctx.result.summary.generatedAt).toBe('2023-11-14T22:13:20.000Z')
  })

  it('빌드가 서브모듈 워킹트리를 더럽히지 않는다(--out 분리)', () => {
    expect(git(ctx.vault, ['status', '--porcelain'])).toBe('')
  })
})
