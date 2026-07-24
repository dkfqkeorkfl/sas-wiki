// @vitest-environment node
//
// 감사 후속 — **"검증이 조용히 건너뛰어진다"** 계열 4건의 fail-closed 회귀 가드.
//
// 네 결함은 형태가 같다: 예외·오탈자·경계 입력이 들어오면 게이트가 *막는* 대신 *통과*시킨다.
// 이 제품은 "모든 변경이 기록·추적된다"가 신뢰의 근거이므로, 판단이 서지 않을 때의 기본값은
// **숨김·중단**이어야 한다(숨김은 눈에 띄고 되돌릴 수 있지만, 누출·오판은 조용하고 되돌릴 수 없다).
//
//   H3 walkFeeds  — `env === 'prod'` 로 draft 를 걸러 non-dev 오타값이 draft 를 노출(PRD D2 위반).
//   H4 isDraft    — `draft: yes` 처럼 불리언이 아닌 값이 "공개"로 해석.
//   H5 parseVault — frontmatter 없는 .md 를 에러 없이 목록에서 누락.
//   H6 readIdAtCreation — 생성 blob 조회가 실패하면 null(=pre-id) 로 간주해 불변 게이트를 건너뜀.
//
// 판정 방향(전 항목 공통): **알 수 없으면 숨기거나 멈춘다.**
import { describe, expect, it } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { buildContent } from '../../validate.mjs'
import { isDraft } from '../draft.mjs'
import { makeGitRunner, readIdAtCreation } from '../git.mjs'
import { buildWirePayload } from '../parse-vault.mjs'
import { walkFeeds } from '../git-walk.mjs'
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
  const full = path.join(root, 'vault', 'wiki', `${rel}.md`)
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
  //   하지만 parseVault 는 문서 스키마 검증을 부르지 않는다(검증은 validate.mjs 전용).
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
    commit(vault, 'cwiki: HBM 문서 생성')
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
// H5 parseVault — frontmatter 없는 문서는 조용히 사라지지 않는다
// ───────────────────────────────────────────────────────────────────────────────
describe('H5 검증 게이트 — frontmatter 부재는 누락이 아니라 오류다', () => {
  // 기존 구현은 `if (!parsed) return null` + `.filter(Boolean)` 이라 `---` 를 빠뜨린 문서가
  //   **아무 신호 없이** 위키에서 빠졌다. 저자는 올렸다고 믿는데 독자에겐 없는 상태가 된다.
  //
  // 단, 차단은 **검증 게이트(buildContent)** 에서만 한다 — parseVault 는 dev 서빙의 요청 경로라
  //   거기서 throw 하면 오타 하나가 위키 전체를 죽인다(서빙은 견디고, 검증은 막는다).
  it('buildContent 는 stray .md 경로를 담아 throw 한다', () => {
    const vault = initVault()
    try {
      writeDoc(vault, 'tech/HBM', { id: UUIDV7_PUBLIC, title: 'HBM' })
      writeRawDoc(vault, 'tech/맨몸', '# 제목만 있고 frontmatter 가 없다\n\n본문.\n')
      commit(vault, 'cwiki: 문서 2건 생성')

      expect(() => buildContent({ env: 'prod', vault })).toThrow(/맨몸/u)
    } finally {
      cleanup(vault)
    }
  })

  it('서빙 경로(buildWirePayload)는 stray 가 있어도 죽지 않는다 (가용성 보존)', () => {
    const vault = initVault()
    try {
      writeDoc(vault, 'tech/HBM', { id: UUIDV7_PUBLIC, title: 'HBM' })
      writeRawDoc(vault, 'tech/맨몸', '# frontmatter 없음\n\n본문.\n')
      commit(vault, 'cwiki: 문서 2건 생성')

      expect(() => buildWirePayload(vault, 'prod')).not.toThrow()
    } finally {
      cleanup(vault)
    }
  })

  it('정상 문서만 있으면 게이트도 통과한다 (과잉 차단 아님)', () => {
    const vault = initVault()
    try {
      writeDoc(vault, 'tech/HBM', { id: UUIDV7_PUBLIC, title: 'HBM' })
      commit(vault, 'cwiki: HBM 문서 생성')

      expect(() => buildContent({ env: 'prod', vault })).not.toThrow()
    } finally {
      cleanup(vault)
    }
  })
})

// ───────────────────────────────────────────────────────────────────────────────
// H7 삭제된 문서의 UUID 재사용 — 과거 피드가 엉뚱한 문서로 연결된다
// ───────────────────────────────────────────────────────────────────────────────
describe('H7 검증 게이트 — 삭제된 문서의 id 를 다른 문서가 물려받지 못한다', () => {
  // 유일성은 HEAD 기준, 불변성은 자기 생성 blob 기준이라 **둘 다 통과**하는 구멍이 있었다:
  //   A(id X) 삭제 → 무관한 B 가 id X 로 생성 → A 를 가리키던 과거 피드가 B 로 연결된다.
  //   피드=변경이력이 제품의 신뢰 근거인데 귀속이 조용히 틀어지는 형태다.
  it('삭제된 문서의 id 를 다른 경로의 새 문서가 쓰면 id·양쪽 경로를 담아 throw 한다', () => {
    const vault = initVault()
    try {
      writeDoc(vault, 'company/구문서', { id: UUIDV7_PUBLIC, title: '구문서' })
      commit(vault, 'cwiki: 구문서 생성')
      git(vault, ['rm', '-q', 'vault/wiki/company/구문서.md'])
      commit(vault, 'uwiki: 구문서 삭제')
      writeDoc(vault, 'tech/새문서', { id: UUIDV7_PUBLIC, title: '새문서' }) // 같은 id 재사용
      commit(vault, 'cwiki: 새문서 생성')

      expect(() => buildContent({ env: 'prod', vault })).toThrow(/구문서|재사용/u)
    } finally {
      cleanup(vault)
    }
  })

  it('같은 경로로 복원하면 통과한다 (rename·복원 계보는 같은 문서다)', () => {
    const vault = initVault()
    try {
      writeDoc(vault, 'company/문서', { id: UUIDV7_PUBLIC, title: '문서' })
      commit(vault, 'cwiki: 문서 생성')
      git(vault, ['rm', '-q', 'vault/wiki/company/문서.md'])
      commit(vault, 'uwiki: 문서 삭제')
      writeDoc(vault, 'company/문서', { id: UUIDV7_PUBLIC, title: '문서' }) // 같은 경로 복원
      commit(vault, 'cwiki: 문서 복원')

      expect(() => buildContent({ env: 'prod', vault })).not.toThrow()
    } finally {
      cleanup(vault)
    }
  })
})

// ───────────────────────────────────────────────────────────────────────────────
// H6 readIdAtCreation — 생성 blob 조회 실패를 "pre-id" 로 오해하지 않는다
// ───────────────────────────────────────────────────────────────────────────────
describe('H6 readIdAtCreation — git 실패를 삼키지 않는다', () => {
  // 기존 구현은 `catch { return null }` 이었다. null 은 호출부(validate.mjs)에서 "pre-id era
  //   문서" 를 뜻하므로, 조회가 실패했을 뿐인 문서가 **불변 검사 면제** 를 받았다. 즉 제품의 핵심
  //   보증(생성 시점 id 는 바뀌지 않는다)이 예외 경로에서 조용히 꺼졌다.
  it('git show 가 실패하면 throw 한다 (null=pre-id 로 위장하지 않는다)', () => {
    const vault = initVault()
    try {
      writeDoc(vault, 'tech/HBM', { id: UUIDV7_PUBLIC, title: 'HBM' })
      commit(vault, 'cwiki: HBM 문서 생성')

      const real = makeGitRunner(vault)
      const showFails = (args) => {
        if (args.includes('show')) throw new Error('fatal: bad object (모의 blob 조회 실패)')
        return real(args)
      }

      expect(() => readIdAtCreation(showFails, 'vault/wiki/tech/HBM.md')).toThrow(/bad object/u)
    } finally {
      cleanup(vault)
    }
  })

  it('blob 을 읽었고 id 가 없을 때만 null 이다 (pre-id era 는 그대로 통과)', () => {
    const vault = initVault()
    try {
      writeDoc(vault, 'tech/HBM', { title: 'HBM' }) // id 없이 생성
      commit(vault, 'cwiki: HBM 문서 생성')

      expect(readIdAtCreation(makeGitRunner(vault), 'vault/wiki/tech/HBM.md')).toBeNull()
    } finally {
      cleanup(vault)
    }
  })
})
