// @vitest-environment node
//
// P1 통합 · Task 3 — build 배선(단일 지점 적용) — tdd §3 Task 3 (mirror build.vault.test.mjs)
//
// 명시한 억제 목록은 실제 feeds 생성기에 적용하고 문서·본문은 보존한다.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { generatePayloads } from '../test-utils/generatedPayloads.mjs'
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
async function build(entries) {
  if (entries === null) rmSync(ignorePath(ctx.vault), { force: true })
  else writeFileSync(ignorePath(ctx.vault), JSON.stringify(entries), 'utf8')
  const out = makeOut()
  outs.push(out)
  return generatePayloads({ env: 'dev', out, vault: ctx.vault })
}

beforeAll(async () => {
  ctx.vault = seedFeedVault()
  const raw = await build(null) // 빈-억제 1차 빌드 — 억제 대상 id 를 여기서 유도(하드코딩 금지)
  ctx.rawIds = raw.feeds.items.map((item) => item.id)
  ctx.suppressId = raw.feeds.items.find((item) => item.title === '베타 소식').id
})

afterAll(() => {
  cleanup(ctx.vault, ...outs)
})

describe('build 배선 — 실존 feed 억제', () => {
  it('억제된 feed id 가 산출 wiki_feeds.json 에 없다 (#1)', async () => {
    const result = await build([{ id: ctx.suppressId, when: WHEN }])

    expect(result.feeds.items.map((item) => item.id)).not.toContain(ctx.suppressId)
  })

  it('억제 전(빈 목록)에는 그 id 가 존재한다 (#2 대조군 — 우연 부재 아닌 필터 제거임을 증명)', async () => {
    const result = await build([])

    expect(result.feeds.items.map((item) => item.id)).toContain(ctx.suppressId)
  })

  it('나머지 피드는 순서·개수가 정합한다(그 1건만 빠진다) (#3)', async () => {
    const result = await build([{ id: ctx.suppressId, when: WHEN }])

    expect(result.feeds.items.map((item) => item.id)).toEqual(
      ctx.rawIds.filter((id) => id !== ctx.suppressId),
    )
  })
})

describe('build 배선 — fail-open / fail-loud 구분', () => {
  it('ignore-feeds.json 부재 → 전량 통과, 에러 없음 (#5 fail-open)', async () => {
    const result = await build(null)
    expect(result.feeds.items.map((item) => item.id)).toEqual(ctx.rawIds)
  })

  it('존재하지 않는 id 억제 → 빌드 정상 + items 불변 (#4a fail-open)', async () => {
    const result = await build([{ id: MISSING_ID, when: WHEN }])
    expect(result.feeds.items.map((item) => item.id)).toEqual(ctx.rawIds)
  })

  it('스키마 위반 ignore-feeds.json → build FAIL(throw, warn 아님) (#6 fail-loud)', async () => {
    // when 누락 + 비-12hex id → 신뢰 못 할 목록은 조용히 무시하지 않고 build 를 끊는다.
    await expect(build([{ id: 'ABC' }])).rejects.toThrow(
      /ignore-feeds\.json 스키마 위반[\s\S]*(필수 필드 누락 "when"|pattern 위반)/u,
    )
  })
})

describe('build 배선 — 참조 무결성(억제≠참조 파괴)', () => {
  it('억제 후에도 문서·본문 참조가 유지된다 (#7 — 억제는 item 제거일 뿐 ref 무결성 무영향)', async () => {
    const { body, feeds, summary } = await build([{ id: ctx.suppressId, when: WHEN }])

    expect(summary.docs.length).toBeGreaterThan(0)
    for (const item of feeds.items)
      for (const doc of item.docs) {
        const entry = summary.docs.find((entry) => entry.id === doc.id)
        expect(entry).toBeDefined()
        expect(Object.hasOwn(body.docs, entry.breadcrumb.join('/'))).toBe(true)
      }
  })
})
