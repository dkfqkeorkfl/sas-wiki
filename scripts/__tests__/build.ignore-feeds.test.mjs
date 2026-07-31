// @vitest-environment node
//
// P1 통합 · Task 3 — build 배선(단일 지점 적용) — tdd §3 Task 3 (mirror build.vault.test.mjs)
//
// RED 사유: `build.mjs` 가 아직 `ignore-feeds.json` 을 로드·검증·적용하지 않는다 →
//   ① 억제 id 가 산출 wiki_feeds.json 에 그대로 남는다(#1·#3 assertion 실패).
//   ② 스키마 위반 목록이 build 를 멈추지 않는다(#6 throw 미발생).
//   ③ 존재X id 의 stale 경고가 stdout 에 뜨지 않는다(#4b).
//   나머지(#2 대조군·#4a·#5·#7)는 GREEN 이 반드시 유지해야 할 fail-open / 무결성 잠금이다.
//
// **SHA 하드코딩 금지**(build.vault.test.mjs 규약): 억제할 feed id 는 빈-억제 1차 빌드 산출에서
//   제목(안정 좌표)으로 찾아 유도한다. vault 는 임시 git repo 를 스스로 시딩하므로 결정적이다.
//
// 계약(GREEN 이 배선): buildContent 가 vaultDir 루트의 ignore-feeds.json 을 로드 → 스키마 검증
//   (위반=throw, fail-loud) → 피드 수집 직후·buildFeeds 이전 단일 지점에서 applyIgnoreFeeds
//   1회 적용 → reportIgnoreHygiene(stale) 를 경고로 출력. 파일 부재=[](fail-open).
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { buildContent, main } from '../validate.mjs'
import { checkInvariants } from '../lib/invariants.mjs'
import { cleanup, commit, initVault, makeOut } from './helpers/tmp-git-vault.mjs'

const WHEN = '2026-07-23T00:00:00Z'
const MISSING_ID = '000000000000'

// ── 합성 시딩 (tmp-git-vault.writeDoc 은 pre-id 문서만 만들므로 유효 id 로 로컬 확장 — env-filter 미러) ──
let idSeq = 0
function nextValidId() {
  return `0192f0d0-0000-7000-8000-${(idSeq += 1).toString(16).padStart(12, '0')}`
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

/** chore 3문서 + feed 3커밋(알파·베타·감마). ts 오름차순 커밋 → items 는 ts 내림차순 정렬(감마·베타·알파). */
function seedFeedVault() {
  const vault = initVault()
  for (const name of ['알파', '베타', '감마']) {
    writeWikiDoc(vault, `company/${name}`, { title: name })
    commit(vault, `chore: company/${name} 생성`)
  }
  for (const name of ['알파', '베타', '감마']) {
    appendDoc(vault, `company/${name}`, `## 소식\n\n${name} 업데이트.`)
    commit(vault, `feed: ${name} 소식\n\n${name} 본문.\n\nKeywords: ${name}\nImportance: normal`)
  }
  return vault
}

function ignorePath(vault) {
  return path.join(vault, 'ignore-feeds.json')
}

const ctx = { rawIds: null, suppressId: null, vault: null }
const outs = []

/** entries=null → ignore-feeds.json 제거(fail-open), 아니면 기록. 매 호출 새 out 으로 격리 빌드. */
function build(entries) {
  if (entries === null) rmSync(ignorePath(ctx.vault), { force: true })
  else writeFileSync(ignorePath(ctx.vault), JSON.stringify(entries), 'utf8')
  const out = makeOut()
  outs.push(out)
  return buildContent({ env: 'dev', out, vault: ctx.vault })
}

beforeAll(() => {
  ctx.vault = seedFeedVault()
  const raw = build(null) // 빈-억제 1차 빌드 — 억제 대상 id 를 여기서 유도(하드코딩 금지)
  ctx.rawIds = raw.feeds.items.map((item) => item.id)
  ctx.suppressId = raw.feeds.items.find((item) => item.title === '베타 소식').id
})

afterAll(() => {
  cleanup(ctx.vault, ...outs)
})

describe('build 배선 — 실존 feed 억제', () => {
  it('억제된 feed id 가 산출 wiki_feeds.json 에 없다 (#1)', () => {
    const result = build([{ id: ctx.suppressId, when: WHEN }])

    expect(result.feeds.items.map((item) => item.id)).not.toContain(ctx.suppressId)
  })

  it('억제 전(빈 목록)에는 그 id 가 존재한다 (#2 대조군 — 우연 부재 아닌 필터 제거임을 증명)', () => {
    const result = build([])

    expect(result.feeds.items.map((item) => item.id)).toContain(ctx.suppressId)
  })

  it('나머지 피드는 순서·개수가 정합한다(그 1건만 빠진다) (#3)', () => {
    const result = build([{ id: ctx.suppressId, when: WHEN }])

    expect(result.feeds.items.map((item) => item.id)).toEqual(
      ctx.rawIds.filter((id) => id !== ctx.suppressId),
    )
  })
})

describe('build 배선 — fail-open / fail-loud 구분', () => {
  it('ignore-feeds.json 부재 → 전량 통과, 에러 없음 (#5 fail-open)', () => {
    let result
    expect(() => {
      result = build(null)
    }).not.toThrow()
    expect(result.feeds.items.map((item) => item.id)).toEqual(ctx.rawIds)
  })

  it('존재하지 않는 id 억제 → 빌드 정상 + items 불변 (#4a fail-open)', () => {
    let result
    expect(() => {
      result = build([{ id: MISSING_ID, when: WHEN }])
    }).not.toThrow()
    expect(result.feeds.items.map((item) => item.id)).toEqual(ctx.rawIds)
  })

  it('스키마 위반 ignore-feeds.json → build FAIL(throw, warn 아님) (#6 fail-loud)', () => {
    // when 누락 + 비-12hex id → 신뢰 못 할 목록은 조용히 무시하지 않고 build 를 끊는다.
    expect(() => build([{ id: 'ABC' }])).toThrow()
  })
})

describe('build 배선 — hygiene 경고(stale)', () => {
  it('존재하지 않는 id 억제 → stale 경고가 stdout 에 관측된다 (#4b)', async () => {
    writeFileSync(ignorePath(ctx.vault), JSON.stringify([{ id: MISSING_ID, when: WHEN }]), 'utf8')
    const out = makeOut()
    outs.push(out)
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    let printed = ''
    try {
      await main(['--vault', ctx.vault, '--env', 'dev'])
      printed = spy.mock.calls.flat().join('\n') // mockRestore 가 calls 를 비우므로 restore 전에 캡처
    } finally {
      spy.mockRestore()
    }

    expect(printed).toMatch(/000000000000|stale|ignore|억제/iu)
  })
})

describe('build 배선 — 참조 무결성(억제≠참조 파괴)', () => {
  it('억제 후에도 checkInvariants 가 통과한다 (#7 — 억제는 item 제거일 뿐 ref 무결성 무영향)', () => {
    const { body, feeds, summary } = build([{ id: ctx.suppressId, when: WHEN }])

    expect(() => checkInvariants(summary, feeds, body)).not.toThrow()
  })
})
