// @vitest-environment node
//
// 감사 후속 — **"조용히 안전이 깨진다"** 계열 5건의 fail-closed 회귀 가드. 층이 둘로 갈린다:
//
// 서빙(가용성) 층 — H3·H4 는 "검증"이 아니라 **누가 보이는가**의 판정이다. 판단이 서지 않으면
//   throw 하지 않고 조용히 숨긴다(숨김은 눈에 띄고 되돌릴 수 있다). 검증(게이트) 층 — H5·H6·H7 은
//   buildContent 의 게이트다. 판단이 서지 않으면 조용히 넘기지 않고 throw 로 멈춘다(누출·오판은
//   조용하고 되돌릴 수 없기 때문이다).
//
//   H3 walkFeeds  — `env === 'prod'` 로 draft 를 걸러 non-dev 오타값이 draft 를 노출(PRD D2 위반).
//   H4 isDraft    — `draft: yes` 처럼 불리언이 아닌 값이 "공개"로 해석.
//   H5 parseVault — frontmatter 없는 .md 를 에러 없이 목록에서 누락.
//   H6 readIdAtCreation — 생성 blob 조회가 실패하면 null(=pre-id) 로 간주해 불변 게이트를 건너뜀.
//   H7 삭제된 문서의 id 재사용 — 과거 피드가 무관한 새 문서로 오귀속된다(정당한 rename 은 면제).
//
// 판정 방향(전 항목 공통): **알 수 없으면 숨기거나 멈춘다** — 서빙 층은 숨김, 게이트 층은 중단.
import { describe, expect, it } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildContent } from '../../validate.mjs'
import { isDraft } from '../draft.mjs'
import { anyMarkdown, collectDeletedDocEvents, makeGitRunner, readIdAtCreation } from '../git.mjs'
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

// P5 Task 9(D-I) — `buildWirePayload` 는 이제 `parseVault(...).wire` 다(얕은/깊은 구분이 사라져
//   전용 wrapper 가 무의미해졌다). 좌표만 바뀌었을 뿐 이 스펙의 단언(가용성 보존)은 무변경이다.
const SCHEMA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'schema')

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
      commit(vault, 'chore: 문서 2건 생성')

      expect(() => buildContent({ env: 'prod', vault })).toThrow(/맨몸/u)
    } finally {
      cleanup(vault)
    }
  })

  it('서빙 경로(parseVault)는 stray 가 있어도 죽지 않는다 (가용성 보존)', () => {
    const vault = initVault()
    try {
      writeDoc(vault, 'tech/HBM', { id: UUIDV7_PUBLIC, title: 'HBM' })
      writeRawDoc(vault, 'tech/맨몸', '# frontmatter 없음\n\n본문.\n')
      commit(vault, 'chore: 문서 2건 생성')

      expect(() => parseVault(vault, 'prod', SCHEMA_DIR)).not.toThrow()
    } finally {
      cleanup(vault)
    }
  })

  it('정상 문서만 있으면 게이트도 통과한다 (과잉 차단 아님)', () => {
    const vault = initVault()
    try {
      writeDoc(vault, 'tech/HBM', { id: UUIDV7_PUBLIC, title: 'HBM' })
      commit(vault, 'chore: HBM 문서 생성')

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
      commit(vault, 'chore: 구문서 생성')
      git(vault, ['rm', '-q', 'wiki/company/구문서.md'])
      commit(vault, 'chore: 구문서 삭제')
      writeDoc(vault, 'tech/새문서', { id: UUIDV7_PUBLIC, title: '새문서' }) // 같은 id 재사용
      commit(vault, 'chore: 새문서 생성')

      // 진단이 세 가지를 모두 담아야 조치가 가능하다 — 재사용된 id · 삭제된 경로 · 현재 경로.
      //   느슨한 `/구문서|재사용/` 은 셋 중 하나만 있어도 통과해 약한 진단을 눈감아준다.
      const detail = (() => {
        try {
          buildContent({ env: 'prod', vault })
          return null
        } catch (error) {
          return error.message
        }
      })()

      expect(detail, 'id 재사용을 잡지 못했다').not.toBeNull()
      expect(detail).toContain(UUIDV7_PUBLIC)
      expect(detail).toContain('company/구문서.md')
      expect(detail).toContain('tech/새문서.md')
    } finally {
      cleanup(vault)
    }
  })

  // ★ rename 계보 면제의 실제 메커니즘은 `buildPathIndex` 가 아니다(그것은 git-walk.mjs 의 feed 경로
  //   역인덱스 전용이다) — H7 이 실제로 쓰는 `collectDeletedDocEvents` 는 명령줄에 **`--find-renames`
  //   를 못박아 둔다**(git.mjs 의 "커맨드라인 플래그가 config 를 이기므로" 주석). 그래서 아래
  //   `diff.renames=false` config 는 이 게이트의 rename 감지를 **끄지 못한다** — 로컬 config 로 감지가
  //   꺼져도(사용자 환경차) 이 게이트가 흔들리지 않음을 보이려는 의도로 남겨 둔다. 이전에는 이 사실이
  //   `buildContent(...).not.toThrow()` 라는 결과만으로 확인됐는데, 그 결과는 "게이트가 애초에 전혀
  //   발동하지 않는" 경우와 구별되지 않는다(SILENT_PASS) — 그래서 메커니즘 자체를 직접 확인하는
  //   앵커(collectDeletedDocEvents 가 이 커밋을 삭제 이벤트로 잡지 않는다)를 결과 단언과 짝짓는다.
  it('rename 감지는 config 가 아니라 명령줄 플래그가 결정한다 — 정당한 문서 이동은 통과한다', () => {
    const vault = initVault()
    try {
      git(vault, ['config', 'diff.renames', 'false'])
      writeDoc(vault, 'company/구경로', { id: UUIDV7_PUBLIC, title: '문서' })
      commit(vault, 'chore: 문서 생성')
      git(vault, ['mv', 'wiki/company/구경로.md', 'wiki/company/새경로.md'])
      commit(vault, 'chore: 문서 이동')

      // 양성 앵커(메커니즘): config 가 꺼져 있어도 이 이동은 삭제 이벤트로 잡히지 않는다 — R 로
      //   흡수된다는 뜻이다. 이 확인이 없으면 "게이트가 그냥 아무것도 안 잡는다" 로도 통과한다.
      const events = collectDeletedDocEvents(makeGitRunner(vault), { isDocPath: anyMarkdown })
      expect(events, 'rename 이 삭제 이벤트로 새어 나왔다').toEqual([])

      expect(() => buildContent({ env: 'prod', vault })).not.toThrow()
    } finally {
      cleanup(vault)
    }
  })

  // 3차 감사 지적. 초판은 이 케이스를 "복원 = 같은 문서" 로 보고 **통과**시켰다(경로 일치 면제).
  //   그 규칙은 어디에도 없었다 — 데이터 계약(README · 문서 id)은 정반대를 못박는다:
  //   "지운 경로에 다시 문서를 만들면 그건 복원이 아니라 새 문서다."
  //   경로는 정체성이 아니다. 삭제는 그 문서의 피드를 prune 하므로, 같은 경로에 옛 id 를 다시 쓰면
  //   prune 된 이력이 새 내용 위로 되살아나 오귀속된다 — 게이트가 막아야 할 바로 그 사고다.
  it('같은 경로로 재생성하며 옛 id 를 재사용하면 막는다 (경로는 정체성이 아니다)', () => {
    const vault = initVault()
    try {
      writeDoc(vault, 'company/문서', { id: UUIDV7_PUBLIC, title: '문서' })
      commit(vault, 'chore: 문서 생성')
      git(vault, ['rm', '-q', 'wiki/company/문서.md'])
      commit(vault, 'chore: 문서 삭제')
      writeDoc(vault, 'company/문서', { id: UUIDV7_PUBLIC, title: '전혀 다른 신규 문서' })
      commit(vault, 'chore: 같은 경로에 신규 문서 생성')

      let detail = ''
      expect(() => {
        try {
          buildContent({ env: 'prod', vault })
        } catch (error) {
          detail = error.message
          throw error
        }
      }).toThrow(/재사용/u)
      expect(detail, 'id 를 짚어야 한다').toContain(UUIDV7_PUBLIC)
      expect(detail, '삭제 경로를 짚어야 한다').toContain('company/문서.md')
    } finally {
      cleanup(vault)
    }
  })

  // 대조군 — 삭제된 경로를 **새 id 로** 재생성하는 것은 계약이 정한 정상 경로다(막지 않는다).
  it('같은 경로라도 새 UUIDv7 을 부여하면 통과한다 (계약이 정한 정상 경로)', () => {
    const vault = initVault()
    try {
      writeDoc(vault, 'company/문서', { id: UUIDV7_PUBLIC, title: '문서' })
      commit(vault, 'chore: 문서 생성')
      git(vault, ['rm', '-q', 'wiki/company/문서.md'])
      commit(vault, 'chore: 문서 삭제')
      writeDoc(vault, 'company/문서', { id: UUIDV7_DRAFT, title: '신규 문서' })
      commit(vault, 'chore: 같은 경로에 신규 문서 생성')

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
      commit(vault, 'chore: HBM 문서 생성')

      const real = makeGitRunner(vault)
      const showFails = (args) => {
        if (args.includes('show')) throw new Error('fatal: bad object (모의 blob 조회 실패)')
        return real(args)
      }

      expect(() => readIdAtCreation(showFails, 'wiki/tech/HBM.md')).toThrow(/bad object/u)
    } finally {
      cleanup(vault)
    }
  })

  it('blob 을 읽었고 id 가 없을 때만 null 이다 (pre-id era 는 그대로 통과)', () => {
    const vault = initVault()
    try {
      writeDoc(vault, 'tech/HBM', { title: 'HBM' }) // id 없이 생성
      commit(vault, 'chore: HBM 문서 생성')

      expect(readIdAtCreation(makeGitRunner(vault), 'wiki/tech/HBM.md')).toBeNull()
    } finally {
      cleanup(vault)
    }
  })
})
