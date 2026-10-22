// 파싱·생성·피드의 실제 기능 결과를 확인한다.
import { describe, expect, it } from 'vitest'

import { mkdirSync, writeFileSync } from 'node:fs'

import path from 'node:path'

import { isDraft } from '../draft.mjs'

import {
  anyMarkdown,
  collectDeletedDocEvents,
  makeGitRunner,
  readFrontmatterFieldChange,
} from '../git.mjs'

import { parseVault } from '../parse-vault.mjs'

import { walkFeeds } from '../../__tests__/helpers/walk-feeds.mjs'

import {
  cleanup,
  commit,
  feedCommit,
  git,
  initVault,
  writeDoc,
} from '../../__tests__/helpers/tmp-git-vault.mjs'

const UUIDV7_PUBLIC = '0192f0c0-8000-7000-8000-0123456789ab'

const UUIDV7_DRAFT = '0192f0c0-8000-7000-9abc-0123456789ab'

/** frontmatter 에 임의 스칼라(`draft: yes` 등)를 넣은 문서 — writeDoc 은 draft 를 지원하지 않는다. */
function writeRawDoc(root, rel, contents) {
  const full = path.join(root, 'wiki', `${rel}.md`)
  mkdirSync(path.dirname(full), { recursive: true })
  writeFileSync(full, contents)
  return full
}

function draftDoc({ draftValue, id, title }) {
  return [
    '---',
    `title: ${title}`,
    'type: concept',
    'status: active',
    `id: "${id}"`,
    `draft: ${draftValue}`,
    '---',
    '',
    '## 정의',
    '',
    '본문 문단이다.',
    '',
  ].join('\n')
}

// ───────────────────────────────────────────────────────────────────────────────
// H4 isDraft — 불리언이 아닌 draft 값은 draft 로 본다(숨김이 안전한 방향)
// ───────────────────────────────────────────────────────────────────────────────
describe('H4 isDraft — 오탈자 draft 플래그는 공개가 아니다', () => {
  // parse.mjs:parseScalar 는 리터럴 'true'/'false' 만 불리언으로 강제한다. `draft: yes` 는 문자열
  //   'yes' 로 남아 `=== true` 를 통과하지 못하고 **공개**가 됐다. 스키마(type: boolean)가 잡아야
  //   하지만 parseVault 는 문서 스키마 검증을 부르지 않는다(작성 규칙 검사는 하네스가 소유).
  it.each(['yes', 'y', 'on', '1', 'TRUE', 'True'])(
    'draft: %s 는 draft 로 판정한다 (불리언 아님 = 판단 불가 = 숨김)',
    (raw) => {
      expect(isDraft({ frontmatter: { draft: raw }, relPath: 'tech/HBM' })).toBe(true)
    },
  )

  it('draft: 1(숫자)·빈 객체 등 비불리언 truthy 도 draft 다', () => {
    expect(isDraft({ frontmatter: { draft: 1 }, relPath: 'tech/HBM' })).toBe(true)
    expect(isDraft({ frontmatter: { draft: {} }, relPath: 'tech/HBM' })).toBe(true)
  })

  it('미지정·false 는 공개다 (스키마 default false — 의도된 경계, 여기는 뒤집지 않는다)', () => {
    expect(isDraft({ frontmatter: {}, relPath: 'tech/HBM' })).toBe(false)
    expect(isDraft({ frontmatter: { draft: false }, relPath: 'tech/HBM' })).toBe(false)
  })

  it('dev/ 폴더 백스톱은 그대로 유지된다', () => {
    expect(isDraft({ frontmatter: {}, relPath: 'dev/sketch' })).toBe(true)
    expect(isDraft({ frontmatter: { draft: false }, relPath: 'dev/sketch' })).toBe(true)
  })
})

// ───────────────────────────────────────────────────────────────────────────────
// H3 walkFeeds — env 는 'dev' 만 전량. 그 외 **무엇이든** prod 로 취급(fail-closed)
// ───────────────────────────────────────────────────────────────────────────────
describe('H3 walkFeeds — dev 가 아닌 env 는 전부 draft 를 숨긴다', () => {
  /** draft 문서 하나만 건드리는 피드 커밋을 심은 vault. */
  function seedDraftOnlyFeed() {
    const vault = initVault()
    writeDoc(vault, 'tech/HBM', { id: UUIDV7_PUBLIC, title: 'HBM' })
    commit(vault, 'chore: HBM 문서 생성')
    writeRawDoc(
      vault,
      'tech/비밀',
      draftDoc({ draftValue: 'true', id: UUIDV7_DRAFT, title: '비밀' }),
    )
    feedCommit(vault, { subject: '비밀 문서 초안 작성' })
    return vault
  }

  // git-walk.mjs 는 `loadHeadDocs(dir, env === 'prod')` 로 판정했다 — 'staging'·''·'production'
  //   같은 값이면 excludeDrafts=false 가 되어 draft 참조 피드가 그대로 나갔다. summary/wiki 쪽
  //   parse-vault.mjs 는 `env === 'dev'` 기준이라 **두 경로의 극성이 반대**였다.
  it.each(['prod', 'production', 'staging', 'PROD', '', 'Dev'])(
    'env=%s 는 draft 참조 피드를 노출하지 않는다',
    (env) => {
      const vault = seedDraftOnlyFeed()
      try {
        const items = walkFeeds(vault, { env })
        expect(items.map((item) => item.title)).not.toContain('비밀 문서 초안 작성')
      } finally {
        cleanup(vault)
      }
    },
  )

  it('env 미지정도 draft 를 숨긴다 (미지정 = prod)', () => {
    const vault = seedDraftOnlyFeed()
    try {
      expect(walkFeeds(vault, {}).map((item) => item.title)).not.toContain('비밀 문서 초안 작성')
    } finally {
      cleanup(vault)
    }
  })

  it('env=dev 만 draft 참조 피드를 포함한다 (반대 방향도 고정)', () => {
    const vault = seedDraftOnlyFeed()
    try {
      expect(walkFeeds(vault, { env: 'dev' }).map((item) => item.title)).toContain(
        '비밀 문서 초안 작성',
      )
    } finally {
      cleanup(vault)
    }
  })
})

// ───────────────────────────────────────────────────────────────────────────────
// H6 readFrontmatterFieldChange — 변경 직전 blob 조회 실패를 "처음 등록" 으로 오해하지 않는다
// ───────────────────────────────────────────────────────────────────────────────
describe('H6 readFrontmatterFieldChange — git 실패를 삼키지 않는다', () => {
  // 전(변경 직전 값)이 없으면 호출부는 "처음 등록"으로 판단한다. 조회가 실패했을 뿐인 문서가 그렇게
  //   판단되면 id 변경 검사를 면제받는다 — 제품의 핵심 보증(id 는 바뀌지 않는다)이 예외 경로에서
  //   조용히 꺼진다.
  const ID_LINE = /^id\s*:([\s\S]*)$/u

  it('변경 직전 blob 을 못 읽으면 throw 한다(전 없음으로 위장하지 않는다)', () => {
    const vault = initVault()
    try {
      writeDoc(vault, 'tech/HBM', { id: UUIDV7_PUBLIC, title: 'HBM' })
      commit(vault, 'chore: HBM 문서 생성')
      writeDoc(vault, 'tech/HBM', { id: UUIDV7_DRAFT, title: 'HBM' })
      commit(vault, 'chore: HBM id 변경')

      const real = makeGitRunner(vault)
      const blobFails = (args, options) => {
        if (args.includes('cat-file')) throw new Error('fatal: bad object (모의 blob 조회 실패)')
        return real(args, options)
      }
      const contents = git(vault, ['show', 'HEAD:wiki/tech/HBM.md'])

      expect(() =>
        readFrontmatterFieldChange(blobFails, 'wiki/tech/HBM.md', { contents, pattern: ID_LINE }),
      ).toThrow(/bad object/u)
    } finally {
      cleanup(vault)
    }
  })

  it('이력을 읽었고 id 줄이 문서가 생길 때부터 있었을 때만 전이 없다', () => {
    const vault = initVault()
    try {
      writeDoc(vault, 'tech/HBM', { id: UUIDV7_PUBLIC, title: 'HBM' })
      commit(vault, 'chore: HBM 문서 생성')
      const contents = git(vault, ['show', 'HEAD:wiki/tech/HBM.md'])

      expect(
        readFrontmatterFieldChange(makeGitRunner(vault), 'wiki/tech/HBM.md', {
          contents,
          pattern: ID_LINE,
        }),
      ).toEqual([undefined, UUIDV7_PUBLIC])
    } finally {
      cleanup(vault)
    }
  })
})

describe('원문 파싱의 가용성', () => {
  it('frontmatter가 없는 파일이 있어도 정상 문서와 날짜를 처리한다', () => {
    const vault = initVault()
    try {
      writeDoc(vault, 'tech/HBM', { id: UUIDV7_PUBLIC })
      writeRawDoc(vault, 'tech/맨몸', '# frontmatter 없음\n\n본문.\n')
      commit(vault, 'chore: 문서와 메모 생성')
      const { context, wire } = parseVault(vault, 'prod')
      expect(wire.docs.map((doc) => doc.id)).toEqual([UUIDV7_PUBLIC])
      expect(wire.docs[0].updated).toBeTruthy()
      expect(context.headState.strayDocPaths).toEqual(new Set(['wiki/tech/맨몸.md']))
    } finally {
      cleanup(vault)
    }
  })
})
