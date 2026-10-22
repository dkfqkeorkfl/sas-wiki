// 문서 검사 정책의 정상·위반 회귀. 실제 wiki 대신 격리 fixture를 사용한다.
import { describe, expect, it } from 'vitest'

import { mkdirSync, writeFileSync } from 'node:fs'

import path from 'node:path'

import { inspectVault } from '../document-integrity.mjs'

import { anyMarkdown, collectDeletedDocEvents, makeGitRunner } from '../../../scripts/lib/git.mjs'

import { cleanup, commit, git, initVault, writeDoc } from '../../test-utils/tmp-git-vault.mjs'

const UUIDV7_PUBLIC = '0192f0c0-8000-7000-8000-0123456789ab'

const UUIDV7_DRAFT = '0192f0c0-8000-7000-9abc-0123456789ab'

/** frontmatter 에 임의 스칼라(`draft: yes` 등)를 넣은 문서 — writeDoc 은 draft 를 지원하지 않는다. */
function writeRawDoc(root, rel, contents) {
  const full = path.join(root, 'wiki', `${rel}.md`)
  mkdirSync(path.dirname(full), { recursive: true })
  writeFileSync(full, contents)
  return full
}

// ───────────────────────────────────────────────────────────────────────────────
// H5 parseVault — frontmatter 없는 문서는 조용히 사라지지 않는다
// ───────────────────────────────────────────────────────────────────────────────
describe('H5 검증 게이트 — frontmatter 부재는 누락이 아니라 오류다', () => {
  // 기존 구현은 `if (!parsed) return null` + `.filter(Boolean)` 이라 `---` 를 빠뜨린 문서가
  //   **아무 신호 없이** 위키에서 빠졌다. 저자는 올렸다고 믿는데 독자에겐 없는 상태가 된다.
  //
  // 단, 차단은 **검증 게이트(inspectVault)** 에서만 한다 — parseVault 는 dev 서빙의 요청 경로라
  //   거기서 throw 하면 오타 하나가 위키 전체를 죽인다(서빙은 견디고, 검증은 막는다).
  it('inspectVault 는 stray .md 경로를 담아 throw 한다', () => {
    const vault = initVault()
    try {
      writeDoc(vault, 'tech/HBM', { id: UUIDV7_PUBLIC, title: 'HBM' })
      writeRawDoc(vault, 'tech/맨몸', '# 제목만 있고 frontmatter 가 없다\n\n본문.\n')
      commit(vault, 'chore: 문서 2건 생성')

      expect(() => inspectVault({ env: 'prod', vault })).toThrow(/맨몸/u)
    } finally {
      cleanup(vault)
    }
  })

  it('정상 문서만 있으면 게이트도 통과한다 (과잉 차단 아님)', () => {
    const vault = initVault()
    try {
      writeDoc(vault, 'tech/HBM', { id: UUIDV7_PUBLIC, title: 'HBM' })
      commit(vault, 'chore: HBM 문서 생성')

      expect(() => inspectVault({ env: 'prod', vault })).not.toThrow()
    } finally {
      cleanup(vault)
    }
  })
})

// ───────────────────────────────────────────────────────────────────────────────
// H7 삭제된 문서의 UUID 재사용 — 과거 피드가 엉뚱한 문서로 연결된다
// ───────────────────────────────────────────────────────────────────────────────
describe('H7 검증 게이트 — 삭제된 문서의 id 를 다른 문서가 물려받지 못한다', () => {
  // 유일성은 HEAD 기준, 불변성은 자기 이력 기준이라 **둘 다 통과**하는 구멍이 있었다:
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
          inspectVault({ env: 'prod', vault })
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
  //   `inspectVault(...).not.toThrow()` 라는 결과만으로 확인됐는데, 그 결과는 "게이트가 애초에 전혀
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

      expect(() => inspectVault({ env: 'prod', vault })).not.toThrow()
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
          inspectVault({ env: 'prod', vault })
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

      expect(() => inspectVault({ env: 'prod', vault })).not.toThrow()
    } finally {
      cleanup(vault)
    }
  })
})
