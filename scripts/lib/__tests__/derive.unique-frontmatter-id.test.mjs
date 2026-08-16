// @vitest-environment node
//
// P1 · R6 — 유일 게이트가 frontmatter id 로도 성립한다(source-agnostic) — tdd §3 Task 3
//
// RED 사유(이력): 이 스펙 작성 당시 derive 의 중복-id 게이트(당시 derive.mjs:48-54)는 id 가 **git
//   생성 해시**라서, 서로 다른 커밋에서 난 두 문서는 해시가 달라 충돌하지 않았다. frontmatter 에 같은
//   UUIDv7 을 적어 넣어도 그때는 git 해시로 id 를 매겼으므로 충돌을 못 잡았다. → 이후 id 출처가
//   frontmatter 로 반전됐지만(Task 2), 중복 게이트 자체는 derive 에 남지 않고 doc-gate.mjs(judgeDocs
//   의 DUPLICATE_ID)로 **전부 이관**됐다 — "게이트 코드는 그대로, 값 출처만 바뀐다" 던 당초 예상과
//   달리 오늘의 derive 는 어떤 id 소스로도 중복을 검사하지 않는다(그 검사 코드 자체가 없다). 아래
//   케이스는 그 이관을 전제로, derive 가 (게이트 유무와 무관하게) 중복 frontmatter id 에도 throw
//   하지 않음을 회귀로 고정한다.
//
// green-stay(over-fire 방지): frontmatter id 가 **서로 다르면** derive 는 throw 하지 않는다. 지금도
//   GREEN 후에도 통과해야 한다 — 유일 게이트가 정상 문서까지 막지 않음을 못박는다.
import { describe, expect, it } from 'vitest'

import { derive } from '../derive.mjs'

const deriveForTest = (parsedDocs, runGit) => derive(parsedDocs, runGit, { wikiPrefix: 'wiki/' })

const UUIDV7_A = '0192f0c0-8000-7000-8000-0123456789ab'
const UUIDV7_B = '0192f0c0-8000-7000-9abc-0123456789ab'
// 두 문서의 git 생성 해시는 **서로 다르다** → 현행(git-hash id) 에선 충돌하지 않는다.
const HASH_A = 'aaaaaaaaaaaa000000000000000000000000aaaa'
const HASH_B = 'bbbbbbbbbbbb111111111111111111111111bbbb'

function aLog(sha, file) {
  const created = '2026-01-01T00:00:00Z'
  const updated = '2026-01-09T00:00:00Z'
  return [`${sha}\t${updated}`, '', `M\t${file}`, `${sha}\t${created}`, '', `A\t${file}`].join('\n')
}

function makeRunner(logByRelPath) {
  return (args) => {
    const file = String(args.at(-1))
    for (const [rel, log] of Object.entries(logByRelPath)) {
      if (file.includes(`${rel}.md`)) return log
    }
    return ''
  }
}

function aParsedDoc(relPath, id) {
  return {
    body: '## 정의\n\n본문 문단.\n',
    bodyLineOffset: 6,
    breadcrumb: relPath.split('/'),
    filePath: `/tmp/wiki/${relPath}.md`,
    frontmatter: {
      id,
      status: 'active',
      tags: [],
      title: relPath.split('/').at(-1),
      type: 'concept',
    },
    relPath,
  }
}

describe('R6 derive 유일 게이트 — frontmatter id 로도 성립', () => {
  it('두 문서의 frontmatter id 가 같아도 derive 는 throw 하지 않는다(doc-gate 소유)', () => {
    const twins = [aParsedDoc('concept/twin-A', UUIDV7_A), aParsedDoc('concept/twin-B', UUIDV7_A)]
    const runner = makeRunner({
      'concept/twin-A': aLog(HASH_A, 'wiki/concept/twin-A.md'),
      'concept/twin-B': aLog(HASH_B, 'wiki/concept/twin-B.md'),
    })

    expect(() => deriveForTest(twins, runner)).not.toThrow()
  })

  it('frontmatter id 가 서로 다르면 throw 하지 않는다(green-stay)', () => {
    const distinct = [
      aParsedDoc('concept/twin-A', UUIDV7_A),
      aParsedDoc('concept/twin-B', UUIDV7_B),
    ]
    const runner = makeRunner({
      'concept/twin-A': aLog(HASH_A, 'wiki/concept/twin-A.md'),
      'concept/twin-B': aLog(HASH_B, 'wiki/concept/twin-B.md'),
    })

    expect(() => deriveForTest(distinct, runner)).not.toThrow()
  })
})
