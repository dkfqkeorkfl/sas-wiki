// @vitest-environment node
//
// P1 hidden verify · Task 4 — 우회불가(Complete Mediation) + 억제≠삭제 — tdd §3 Task 4
//
// GREEN 이 Task 3 visible 통합에 오버피팅(특정 배선만 통과)하지 못하게 **hidden** 으로 분리한다
//   (`*.verify.test.mjs`). GREEN 완료 후 실행한다.
//
// RED 사유: `scripts/lib/ignore.mjs` 부재 → 아래 지연 import 가 throw → 모듈 수집 실패(전 케이스 RED).
//   설사 모듈이 있어도 build 배선이 없으면 산출 feeds 가 필터를 안 거쳐 RED-A #2/#3 이 실패한다.
//   정적 import 금지(import-x/no-unresolved 가 RED 커밋을 막음) → 런타임 지연 import.
//
// **행동적 no-bypass**(source-grep 아님 — mutation 내성): 빈-억제 빌드(=raw, 필터 항등)와
//   억제 빌드(=filtered)를 실 vault 로 뽑아, filtered 가 applyIgnoreFeeds(raw, entries) 와
//   **멤버십·순서로 일치**함을 단언한다 → 빌드의 유일한 피드 출력 경로가 필터 산출과 같다 = 우회 부재.
//   대조(spec-gaming 방지): 억제 id 가 raw 엔 있는데 filtered 엔 없다 = 데이터 우연 부재가 아니라
//   **필터가 제거**했음.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { buildContent } from '../validate.mjs'
import { checkInvariants } from '../lib/invariants.mjs'
import { cleanup, commit, initVault } from './helpers/tmp-git-vault.mjs'

const { applyIgnoreFeeds } = await import(new URL('../lib/ignore.mjs', import.meta.url).href)

const WHEN = '2026-07-23T00:00:00Z'

// ── 합성 시딩(build.ignore-feeds.test.mjs 와 동형 — 각 파일 자기 vault 시딩으로 격리) ──
let idSeq = 0
function nextValidId() {
  return `0192f0e0-0000-7000-8000-${(idSeq += 1).toString(16).padStart(12, '0')}`
}

function writeWikiDoc(root, rel, { title } = {}) {
  const full = path.join(root, 'wiki', `${rel}.md`)
  mkdirSync(path.dirname(full), { recursive: true })
  const fm = ['---', `id: "${nextValidId()}"`, `title: ${title ?? rel.split('/').at(-1)}`, 'type: concept', 'status: active', '---', '', '## 정의\n\n본문 문단이다.\n'] // prettier-ignore
  writeFileSync(full, fm.join('\n'))
}

function appendDoc(root, rel, paragraph) {
  const full = path.join(root, 'wiki', `${rel}.md`)
  writeFileSync(full, `${readFileSync(full, 'utf8')}\n${paragraph}\n`)
}

function seedFeedVault() {
  const vault = initVault()
  for (const name of ['알파', '베타', '감마']) {
    writeWikiDoc(vault, `company/${name}`, { title: name })
    commit(vault, `cwiki: company/${name} 생성`)
  }
  for (const name of ['알파', '베타', '감마']) {
    appendDoc(vault, `company/${name}`, `## 소식\n\n${name} 업데이트.`)
    commit(vault, `feed: ${name} 소식\n\n${name} 본문.\n\nKeywords: ${name}\nImportance: normal`)
  }
  return vault
}

const ctx = { docId: null, docPath: null, entries: null, filtered: null, raw: null, suppressId: null, vault: null } // prettier-ignore
const ids = (items) => items.map((item) => item.id)

beforeAll(() => {
  ctx.vault = seedFeedVault()

  // raw = 빈-억제 빌드(ignore-feeds.json 부재 → 필터 항등). filtered = 억제 빌드.
  ctx.raw = buildContent({ env: 'dev', vault: ctx.vault })
  const target = ctx.raw.feeds.items.find((item) => item.title === '알파 소식')
  ctx.suppressId = target.id
  ctx.docId = target.docs[0].id // 억제 피드가 가리키는 문서(살아남아야 한다)
  ctx.docPath = ctx.raw.summary.docs.find((doc) => doc.id === ctx.docId).breadcrumb.join('/')
  ctx.entries = [{ id: ctx.suppressId, when: WHEN }]

  writeFileSync(path.join(ctx.vault, 'ignore-feeds.json'), JSON.stringify(ctx.entries), 'utf8')
  ctx.filtered = buildContent({ env: 'dev', vault: ctx.vault })
})

afterAll(() => {
  cleanup(ctx.vault)
})

describe('RED-A 우회불가(Complete Mediation) — 빌드 피드 출력이 필터를 반드시 통과', () => {
  it('raw(빈-억제) 산출에 억제 대상 id 가 존재한다 (#1 대조군)', () => {
    expect(ids(ctx.raw.feeds.items)).toContain(ctx.suppressId)
  })

  it('억제 빌드 산출 == applyIgnoreFeeds(raw, entries) (멤버십·순서 일치 → 우회 경로 부재) (#2)', () => {
    const expected = applyIgnoreFeeds(ctx.raw.feeds.items, ctx.entries)

    expect(ids(ctx.filtered.feeds.items)).toEqual(ids(expected))
  })

  it('억제 id 는 산출 feeds payload(직렬화 포함) 어디에도 노출되지 않는다 (#3)', () => {
    // validate 는 디스크에 쓰지 않는다 — 최종 산출은 반환 payload 다. 직렬화 문자열까지 훑어 억제 id 가
    //   어떤 필드로도 새지 않음을 못 박는다(구: 디스크 wiki_feeds.json 대조 — Complete Mediation).
    expect(ids(ctx.filtered.feeds.items)).not.toContain(ctx.suppressId)
    expect(JSON.stringify(ctx.filtered.feeds)).not.toContain(ctx.suppressId)
  })
})

describe('RED-B 억제≠삭제 — 억제 피드가 가리킨 문서·본문은 생존', () => {
  it('억제 피드의 대상 문서가 summary.docs 에 여전히 존재한다 (#4)', () => {
    expect(ids(ctx.filtered.summary.docs)).toContain(ctx.docId)
  })

  it('그 문서의 body·summary 콘텐츠가 억제 전과 동일하다(억제≠문서삭제) (#5)', () => {
    expect(ctx.filtered.body.docs[ctx.docPath]).toEqual(ctx.raw.body.docs[ctx.docPath])
    expect(ctx.filtered.summary.docs.find((doc) => doc.id === ctx.docId)).toEqual(
      ctx.raw.summary.docs.find((doc) => doc.id === ctx.docId),
    )
  })

  it('억제 후 checkInvariants 가 통과한다(참조 무결성 유지 — dangling 불가) (#6)', () => {
    const { body, feeds, summary } = ctx.filtered

    expect(() => checkInvariants(summary, feeds, body)).not.toThrow()
  })

  it('억제 피드 콘텐츠만 소멸하고 문서는 살아있다(클릭 가능) (#7)', () => {
    // 피드 아이템(title)은 feeds 에서 사라지지만…
    expect(ctx.filtered.feeds.items.find((item) => item.title === '알파 소식')).toBeUndefined()
    // …문서 본문은 body 에 그대로다(문서는 여전히 열린다).
    expect(Object.hasOwn(ctx.filtered.body.docs, ctx.docPath)).toBe(true)
  })
})
