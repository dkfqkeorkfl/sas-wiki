// @vitest-environment node
//
// P2 dev/prod 분리 · Task 2·4 — build.mjs `--env` + draft 필터 RED (tdd §3 Task 2·4 · plan §Task 2·4)
//
// 두 seam 을 분리 단언한다:
//   A) parseArgs `--env` — dev|prod 파싱 · 미지정=prod(fail-closed)+console.error 경고 · 잘못된 값 throw.
//   B) buildContent draft 필터 — prod=제외 / dev=포함, `isDraft = flag(fail-open) OR dev/ 폴더(백스톱)` OR-결합.
//      필터는 **parse 이후·validateParsedDocs 이전**(부분 누출 방지) — 스키마-위반 draft 앵커가 구조 증명.
//
// RED 사유 요약:
//   · parseArgs: 현행은 `--env` 를 **알 수 없는 인자로 throw**(build.mjs:182) · 미지정 시 options.env 부재.
//   · buildContent: 현행 signature 는 `{allowDeadlinks,out,schema,vault}`(:46) — `env` 를 **무시**하고
//     전량 빌드 → prod 에도 draft 문서가 그대로 남는다(누출).
//
// **in-process 호출**(subprocess 아님) — 신규 분기(env 4-way × isDraft flag/folder/both)를 v8 커버리지에
//   태우기 위함(build.smoke.test.mjs §11 관례). CLI end-to-end 는 build.cli.test.mjs 소관.
//
// **정본 문서 수 하드코딩 금지**(MEMORY: tests-decoupled-from-canonical-data) — 전부 합성 tmp-vault 로
//   로직만 검증한다. 각 문서는 유효 UUIDv7 id·chore 커밋으로 시딩한다.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { deriveGeneratedAt } from '../lib/parse-vault.mjs'
import { buildContent, parseArgs } from '../validate.mjs'
import {
  cleanup,
  commit,
  git,
  initVault,
  makeOut as makeTempOut,
} from './helpers/tmp-git-vault.mjs'

const outputDirs = []
function makeOut() {
  const out = makeTempOut()
  outputDirs.push(out)
  return out
}
afterAll(() => cleanup(...outputDirs))

// ── 합성 시딩 원자 (helpers/tmp-git-vault.writeDoc 는 draft·비유효 id 를 못 넣으므로 로컬 확장) ──
let idSeq = 0
function nextValidId() {
  return `0192f0d0-0000-7000-8000-${(idSeq += 1).toString(16).padStart(12, '0')}`
}

/**
 * wiki/<rel>.md 를 유효 frontmatter 로 쓴다.
 *  - draft   : 지정 시 `draft: true|false` 프론트매터 추가(parseScalar → boolean).
 *  - id      : 명시하면 그대로(비유효 id 로 스키마-위반 앵커를 만들 때 사용), 생략 시 유효 UUIDv7.
 *  - status  : 'active' | 'disable'.
 * 반환: 이 문서의 frontmatter id(문서 집합 단언에 사용).
 */
function writeWikiDoc(
  root,
  rel,
  {
    body = '## 정의\n\n본문 문단이다.\n',
    draft,
    id,
    status = 'active',
    title,
    type = 'concept',
  } = {},
) {
  const docId = id ?? nextValidId()
  const full = path.join(root, 'wiki', `${rel}.md`)
  mkdirSync(path.dirname(full), { recursive: true })
  const fm = ['---', `id: "${docId}"`, `title: ${title ?? rel.split('/').at(-1)}`, `type: ${type}`, `status: ${status}`] // prettier-ignore
  if (draft !== undefined) fm.push(`draft: ${draft}`)
  fm.push('---', '', body)
  writeFileSync(full, fm.join('\n'))
  return docId
}

/** 문서 배열을 각각 chore 커밋으로 시딩하고 vault 경로를 돌려준다. */
function seedVault(docs) {
  const vault = initVault()
  for (const doc of docs) {
    const docId = writeWikiDoc(vault, doc.rel, doc)
    doc.id = docId
    commit(vault, `chore: ${doc.rel} 생성`)
  }
  return vault
}

/** summary.docs 의 id 집합(active 10키 · disable 4키 스텁 모두 id 를 갖는다). */
function docIds(result) {
  return result.summary.docs.map((doc) => doc.id)
}

/** 문서 끝에 문단을 덧붙인다(마지막 `##` 섹션에 속하므로 feed anchor 가 산출된다). */
function appendDoc(root, rel, paragraph) {
  const full = path.join(root, 'wiki', `${rel}.md`)
  writeFileSync(full, `${readFileSync(full, 'utf8')}\n${paragraph}\n`)
}

/** 어떤 feed item 이 주어진 doc id 를 참조하는가. */
function feedRefsId(result, id) {
  return result.feeds.items.some((item) => item.docs.some((doc) => doc.id === id))
}

// ────────────────────────────────────────────────────────────────────────────
// A. parseArgs --env (순수 · in-process)
// ────────────────────────────────────────────────────────────────────────────
describe('parseArgs --env — dev|prod · fail-closed 기본 · bogus throw', () => {
  it('--env dev → options.env === "dev" (RED — 현행은 알 수 없는 인자로 throw)', () => {
    expect(parseArgs(['--vault', 'v', '--env', 'dev']).env).toBe('dev')
  })

  it('--env prod → options.env === "prod"', () => {
    expect(parseArgs(['--vault', 'v', '--env', 'prod']).env).toBe('prod')
  })

  it('--env 미지정 → prod (fail-closed 기본, Layer B — RED: 현행은 env 부재)', () => {
    expect(parseArgs(['--vault', 'v']).env).toBe('prod')
  })

  it('--env 미지정 → console.error 경고 (silent 폴백 금지 — RED: 현행은 경고 없음)', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      parseArgs(['--vault', 'v'])

      expect(spy).toHaveBeenCalled()
      expect(spy.mock.calls.flat().join(' ')).toMatch(/prod|fail-closed|미지정/i)
    } finally {
      spy.mockRestore()
    }
  })

  it('--env 잘못된 값(staging) → throw (E3 조용한 폴백 금지)', () => {
    expect(() => parseArgs(['--vault', 'v', '--env', 'staging'])).toThrow()
  })
})

// ────────────────────────────────────────────────────────────────────────────
// B. buildContent draft 필터 — OR-결합(flag / dev/ 폴더 / both)
//    Vault A(공용): keep(공개) · secretFlag(draft:true) · devFolder(dev/, 플래그無) · both(dev/+draft)
// ────────────────────────────────────────────────────────────────────────────
describe('draft 필터 — prod 제외 / dev 포함 (OR 이중신호)', () => {
  const ctx = { devResult: null, ids: {}, prodResult: null, vault: '' }

  beforeAll(() => {
    const docs = [
      { key: 'keep', rel: 'concept/keep' }, // draft 미지정 → 공개(Layer A)
      { draft: true, key: 'secretFlag', rel: 'concept/secret' }, // 플래그만
      { key: 'devFolder', rel: 'dev/hidden' }, // dev/ 폴더만(플래그 없음)
      { draft: true, key: 'both', rel: 'dev/both' }, // 플래그 + dev/ 폴더 동시
      { key: 'devPrefix', rel: 'develop/notdraft' }, // dev 접두어이나 dev/ 세그먼트 아님 → 공개
    ]
    ctx.vault = seedVault(docs)
    for (const doc of docs) ctx.ids[doc.key] = doc.id
    // 현행은 env 무시 → 두 빌드 모두 4문서를 낸다(throw 없음). GREEN 후 prod=1 / dev=4.
    ctx.prodResult = buildContent({ env: 'prod', out: makeOut(), vault: ctx.vault })
    ctx.devResult = buildContent({ env: 'dev', out: makeOut(), vault: ctx.vault })
  })

  afterAll(() => {
    cleanup(ctx.vault)
  })

  it('prod: draft 미지정 문서(keep)는 공개다 (Layer A fail-open — 반전 금지)', () => {
    expect(docIds(ctx.prodResult)).toContain(ctx.ids.keep)
  })

  it('prod: draft:true 플래그 문서(secretFlag)는 제외된다 (RED)', () => {
    expect(docIds(ctx.prodResult)).not.toContain(ctx.ids.secretFlag)
  })

  it('prod: dev/ 폴더 문서(devFolder)는 플래그 없어도 제외된다 (백스톱 — RED)', () => {
    expect(docIds(ctx.prodResult)).not.toContain(ctx.ids.devFolder)
  })

  it('prod: 플래그+dev/ 동시(both)도 제외된다 (OR 이중신호 — AND 반전 방지, RED)', () => {
    expect(docIds(ctx.prodResult)).not.toContain(ctx.ids.both)
  })

  it('prod: `develop/` 문서(devPrefix)는 dev/ 세그먼트가 아니므로 공개다 (접두어 오탐 방지)', () => {
    expect(docIds(ctx.prodResult)).toContain(ctx.ids.devPrefix)
  })

  it('dev: draft 문서 전부 포함(keep·secretFlag·devFolder·both·devPrefix)', () => {
    const ids = docIds(ctx.devResult)
    expect(ids).toContain(ctx.ids.keep)
    expect(ids).toContain(ctx.ids.secretFlag)
    expect(ids).toContain(ctx.ids.devFolder)
    expect(ids).toContain(ctx.ids.both)
    expect(ids).toContain(ctx.ids.devPrefix)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// B'. 완전 배제 앵커 — 필터가 validateParsedDocs **이전**임을 구조 증명(부분 누출 방지)
//     draft 문서를 **스키마 위반(비유효 id)** 으로 시딩:
//       prod → 필터가 validate 전에 배제 → 빌드 성공(위반 미검증)
//       dev  → 포함 → validateParsedDocs 가 pattern 위반으로 throw
// ────────────────────────────────────────────────────────────────────────────
describe('완전 배제 앵커 — 필터 = validate 이전 (부분 누출 방지)', () => {
  const ctx = { vault: '' }

  beforeAll(() => {
    // keep: 유효 공개 문서. badDraft: draft:true + **비유효 id**(UUIDv7 pattern 위반).
    //   type 은 유효(concept)라 build.mjs:65 의 early type-throw 는 타지 않는다 — 위반은 오직
    //   validateParsedDocs(:72) 의 id pattern 이며, 그 지점은 필터보다 뒤다.
    ctx.vault = seedVault([
      { rel: 'concept/keep' },
      { draft: true, id: 'not-a-valid-uuid', rel: 'concept/bad-draft' },
    ])
  })

  afterAll(() => {
    cleanup(ctx.vault)
  })

  it('prod: 스키마-위반 draft 문서는 validate 이전에 배제되어 빌드가 성공한다 (RED — 현행은 전량 검증→throw)', () => {
    expect(() => buildContent({ env: 'prod', out: makeOut(), vault: ctx.vault })).not.toThrow()
  })

  it('dev: 그 문서가 포함되어 validateParsedDocs 가 스키마 위반으로 throw 한다 (경계 드러냄)', () => {
    expect(() => buildContent({ env: 'dev', out: makeOut(), vault: ctx.vault })).toThrow(/스키마|위반|pattern|id/i) // prettier-ignore
  })
})

// ────────────────────────────────────────────────────────────────────────────
// C. 빈 prod 빌드 — 전 문서 draft → 0문서 exit 0 + 유효 빈 payload (Task 4)
// ────────────────────────────────────────────────────────────────────────────
describe('빈 prod 빌드 — 전 문서 draft → 0문서 우아 처리', () => {
  const ctx = { prodResult: null, vault: '' }

  beforeAll(() => {
    // 전 문서 draft(유효 frontmatter) → 현행 prod 는 env 무시로 2문서를 낸다(throw 아님). GREEN 후 0문서.
    ctx.vault = seedVault([
      { draft: true, rel: 'concept/draft-a' },
      { draft: true, rel: 'concept/draft-b' },
    ])
    ctx.prodResult = buildContent({ env: 'prod', out: makeOut(), vault: ctx.vault })
  })

  afterAll(() => {
    cleanup(ctx.vault)
  })

  it('prod 빌드는 throw 하지 않는다 (0문서 exit 0)', () => {
    // 현행도 valid draft 문서라 throw 하지 않는다(안정 가드). RED 는 아래 empties.
    expect(ctx.prodResult).toBeDefined()
  })

  it('prod summary.docs 가 빈 배열이다 (RED — 현행은 draft 2문서 잔존)', () => {
    expect(ctx.prodResult.summary.docs).toEqual([])
  })

  it('prod feeds.items · body.docs 가 비어 있다 (RED)', () => {
    expect(ctx.prodResult.feeds.items).toEqual([])
    expect(ctx.prodResult.body.docs).toEqual({})
  })

  it('deriveGeneratedAt([]) 는 1970 epoch 다 (빈 산출물 경로 회귀 락 — P5 Task 1 · 1인자로 축소)', () => {
    // SOURCE_DATE_EPOCH 미설정 + 빈 산출물 → epoch 폴백(build.mjs:140). GREEN 무관 순수 단위 락.
    const prev = process.env.SOURCE_DATE_EPOCH
    delete process.env.SOURCE_DATE_EPOCH
    try {
      expect(deriveGeneratedAt([])).toBe('1970-01-01T00:00:00.000Z')
    } finally {
      if (prev !== undefined) process.env.SOURCE_DATE_EPOCH = prev
    }
  })
})

// ────────────────────────────────────────────────────────────────────────────
// D. prod 누출 0 — id 기반 구조 단언(정본) + "draft" 필드 grep(보강)
// ────────────────────────────────────────────────────────────────────────────
describe('prod 누출 0 — draft 문서 id 부재(정본) + draft 필드 부재(보강)', () => {
  const ctx = { ids: {}, prodResult: null, vault: '' }

  beforeAll(() => {
    const docs = [
      { key: 'keep', rel: 'concept/keep' },
      { draft: true, key: 'secret', rel: 'concept/secret' },
    ]
    ctx.vault = seedVault(docs)
    for (const doc of docs) ctx.ids[doc.key] = doc.id
    ctx.prodResult = buildContent({ env: 'prod', out: makeOut(), vault: ctx.vault })
  })

  afterAll(() => {
    cleanup(ctx.vault)
  })

  it('secret(draft) id 가 직렬화 prod payload(summary·feeds·body) 어디에도 없다 (정본 구조 단언 — RED)', () => {
    const serialized = JSON.stringify({
      body: ctx.prodResult.body,
      feeds: ctx.prodResult.feeds,
      summary: ctx.prodResult.summary,
    })

    expect(docIds(ctx.prodResult)).not.toContain(ctx.ids.secret)
    expect(serialized).not.toContain(ctx.ids.secret)
    // 과잉검출 방지 2번째 케이스: keep 은 그대로 실린다.
    expect(serialized).toContain(ctx.ids.keep)
  })

  it('prod payload 에 "draft" 필드 토큰이 없다 (보강 grep — pick 화이트리스트라 현행도 green, 미래 회귀 방어)', () => {
    const serialized = JSON.stringify({
      body: ctx.prodResult.body,
      feeds: ctx.prodResult.feeds,
      summary: ctx.prodResult.summary,
    })

    expect(serialized).not.toContain('"draft"')
  })
})

// ────────────────────────────────────────────────────────────────────────────
// E. disable + draft 동시 — 제외 우선순위(draft > disable-stub)
// ────────────────────────────────────────────────────────────────────────────
describe('disable + draft 동시 — prod 완전 배제(제외 우선순위)', () => {
  const ctx = { devResult: null, ids: {}, prodResult: null, vault: '' }

  beforeAll(() => {
    const docs = [
      { key: 'keep', rel: 'concept/keep' },
      { draft: true, key: 'disableDraft', rel: 'concept/dead', status: 'disable' },
    ]
    ctx.vault = seedVault(docs)
    for (const doc of docs) ctx.ids[doc.key] = doc.id
    ctx.prodResult = buildContent({ env: 'prod', out: makeOut(), vault: ctx.vault })
    ctx.devResult = buildContent({ env: 'dev', out: makeOut(), vault: ctx.vault })
  })

  afterAll(() => {
    cleanup(ctx.vault)
  })

  it('prod: disable+draft 문서는 disable 스텁으로도 안 나온다 (draft 가 disable 처리보다 앞선다 — RED)', () => {
    expect(docIds(ctx.prodResult)).not.toContain(ctx.ids.disableDraft)
  })

  it('dev: 그 문서는 disable 스텁으로 나온다 (env=dev 는 포함, status=disable)', () => {
    const stub = ctx.devResult.summary.docs.find((doc) => doc.id === ctx.ids.disableDraft)
    expect(stub).toBeDefined()
    expect(stub.status).toBe('disable')
  })
})

// ────────────────────────────────────────────────────────────────────────────
// F. draft 문서를 가리킨 feed: 커밋 — prod 는 prune(unresolved 아님) / dev 는 노출
//    통합 feed 해석 경로: draft 배제 문서의 과거 feed 는 삭제와 동급으로 prune 돼
//    checkFeedResolution 을 통과해야 한다(빈/부분 prod 빌드가 중단되지 않음).
// ────────────────────────────────────────────────────────────────────────────
describe('draft feed 필터 — prod prune / dev 노출 (통합 feed 해석)', () => {
  const ctx = { devResult: null, ids: {}, prodResult: null, vault: '' }

  beforeAll(() => {
    const vault = initVault()
    ctx.ids.keep = writeWikiDoc(vault, 'concept/keep') // 공개 앵커(prod docs 가 0 이 아니게)
    commit(vault, 'chore: keep 생성')
    ctx.ids.secret = writeWikiDoc(vault, 'concept/secret', { draft: true })
    commit(vault, 'chore: secret 생성')
    // feed: 커밋이 draft(secret)를 건드린다 → prod 에서 이 feed 는 prune 대상이다.
    appendDoc(vault, 'concept/secret', '비공개 소식이 추가됐다.')
    commit(vault, 'feed: secret 소식\n\n본문.\n\nKeywords: 소식\nImportance: normal')
    ctx.vault = vault
    ctx.prodResult = buildContent({ env: 'prod', out: makeOut(), vault })
    ctx.devResult = buildContent({ env: 'dev', out: makeOut(), vault })
  })

  afterAll(() => {
    cleanup(ctx.vault)
  })

  it('prod: draft(secret)를 가리킨 feed 는 prune 되고 unresolved=0 (build 중단 없음)', () => {
    expect(ctx.prodResult.stats.unresolvedPaths).toEqual([])
    expect(ctx.prodResult.stats.prunedFeeds).toBeGreaterThan(0)
    expect(feedRefsId(ctx.prodResult, ctx.ids.secret)).toBe(false)
  })

  it('dev: 같은 feed 가 secret 을 정상 참조한다', () => {
    expect(feedRefsId(ctx.devResult, ctx.ids.secret)).toBe(true)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// G. 이동한 draft 의 **과거경로** feed — rename-aware 역인덱스 좌표로 prune
//    순수 git mv(R)라 concept/movable 은 삭제(D)가 아니다 → everDeletedPaths 에 없다.
//    buildPathIndex(--follow) 가 rename 좌표를 담기에 이 과거경로 feed 를
//    정상 배제로 분류할 수 있다(좌표 누락이면 unresolved → build 중단 = RED 회귀 감지).
// ────────────────────────────────────────────────────────────────────────────
describe('이동한 draft feed — 과거경로도 prune (rename 좌표)', () => {
  const ctx = { prodResult: null, vault: '' }

  beforeAll(() => {
    const vault = initVault()
    writeWikiDoc(vault, 'concept/keep')
    commit(vault, 'chore: keep 생성')
    writeWikiDoc(vault, 'concept/movable', { draft: true })
    commit(vault, 'chore: movable 생성')
    appendDoc(vault, 'concept/movable', '이동 전 소식.') // feed at 과거경로 concept/movable
    commit(vault, 'feed: movable 소식\n\n본문.\n\nKeywords: 소식\nImportance: normal')
    // 순수 rename(내용 수정 없음) 단독 커밋 → git 이 R 로 감지(D 아님). 이동+재작성 혼합은
    // 커밋 컨벤션 가드가 막으므로(build 은 R 만 허용) 여기서도 pure mv 만 한다.
    mkdirSync(path.join(vault, 'wiki', 'tech'), { recursive: true })
    git(vault, ['mv', 'wiki/concept/movable.md', 'wiki/tech/movable.md'])
    commit(vault, 'chore: movable 을 tech/ 로 이동')
    ctx.vault = vault
    ctx.prodResult = buildContent({ env: 'prod', out: makeOut(), vault })
  })

  afterAll(() => {
    cleanup(ctx.vault)
  })

  it('prod: 과거경로(concept/movable) feed 가 unresolved 없이 prune 된다', () => {
    expect(ctx.prodResult.stats.unresolvedPaths).toEqual([])
    expect(ctx.prodResult.stats.prunedFeeds).toBeGreaterThan(0)
  })
})

// ────────────────────────────────────────────────────────────────────────────
// H. draft+public 혼합 feed — prod 는 피드를 **유지**하되 draft docRef 만 per-ref prune
// ────────────────────────────────────────────────────────────────────────────
describe('draft+public 혼합 feed — per-ref prune', () => {
  const ctx = { devResult: null, ids: {}, prodResult: null, vault: '' }

  beforeAll(() => {
    const vault = initVault()
    ctx.ids.pub = writeWikiDoc(vault, 'concept/pub')
    commit(vault, 'chore: pub 생성')
    ctx.ids.secret = writeWikiDoc(vault, 'concept/secret', { draft: true })
    commit(vault, 'chore: secret 생성')
    // 한 feed 커밋이 pub·secret 둘 다 건드린다(다중 문서 피드).
    appendDoc(vault, 'concept/pub', '공개 소식.')
    appendDoc(vault, 'concept/secret', '비공개 소식.')
    commit(vault, 'feed: pub·secret 공동 소식\n\n본문.\n\nKeywords: 소식\nImportance: highlight')
    ctx.vault = vault
    ctx.prodResult = buildContent({ env: 'prod', out: makeOut(), vault })
    ctx.devResult = buildContent({ env: 'dev', out: makeOut(), vault })
  })

  afterAll(() => {
    cleanup(ctx.vault)
  })

  function feedDocIds(result) {
    const item = result.feeds.items.find((it) => it.docs.some((doc) => doc.id === ctx.ids.pub))
    return item ? item.docs.map((doc) => doc.id) : []
  }

  it('prod: 피드는 남되 pub 만 참조하고 secret(draft)는 per-ref prune 된다', () => {
    const ids = feedDocIds(ctx.prodResult)
    expect(ids).toContain(ctx.ids.pub)
    expect(ids).not.toContain(ctx.ids.secret)
    expect(ctx.prodResult.stats.unresolvedPaths).toEqual([])
  })

  it('dev: 같은 피드가 pub·secret 둘 다 참조한다', () => {
    const ids = feedDocIds(ctx.devResult)
    expect(ids).toContain(ctx.ids.pub)
    expect(ids).toContain(ctx.ids.secret)
  })
})
