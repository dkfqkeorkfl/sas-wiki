// 문서 검사 정책의 정상·위반 회귀. 실제 wiki 대신 격리 fixture를 사용한다.
import { mkdirSync, writeFileSync } from 'node:fs'

import path from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { inspectVault } from '../document-integrity.mjs'

import {
  cleanup,
  commit,
  initVault,
  makeOut as makeTempOut,
} from '../../test-utils/tmp-git-vault.mjs'

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

  it('prod: 스키마-위반 draft 문서는 validate 이전에 배제되어 빌드가 성공한다', () => {
    expect(() => inspectVault({ env: 'prod', out: makeOut(), vault: ctx.vault })).not.toThrow()
  })

  it('dev: 그 문서가 포함되어 validateParsedDocs 가 스키마 위반으로 throw 한다 (경계 드러냄)', () => {
    expect(() => inspectVault({ env: 'dev', out: makeOut(), vault: ctx.vault })).toThrow(/스키마|위반|pattern|id/i) // prettier-ignore
  })
})
