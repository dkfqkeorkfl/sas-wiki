// @vitest-environment node
//
// check-doc-ids — 커밋 직전 훅. 이번 커밋에 들어가는 위키 문서마다 id 를 판단한다.
//
// 계약:
//   · 판단이 먼저다 — [전, 후](전 = id 줄을 마지막으로 바꾸기 바로 전 값, 후 = 커밋하려는 값)로
//     정상·미등록·훼손·변경을 가른다(judgeDocId).
//   · 미등록(후가 없거나 형식이 틀리고, 전도 유효하지 않음)이면 UUIDv7 을 채워 커밋한다. 작업 트리에
//     유효한 id 가 있으면 새로 발급하지 않고 그것을 쓴다. 인덱스와 작업 트리에 같은 id 를 넣고,
//     스테이징하지 않은 변경은 커밋에 섞지 않는다.
//   · 훼손(유효했던 id 를 지우거나 깨뜨림)·변경(유효한 id 를 다른 유효한 id 로 바꿈)이면 원래 id 를
//     알리고 커밋을 막는다. 막는 문서가 하나라도 있으면 아무 파일도 고치지 않는다.
//   · 채울 수 없는 문서(frontmatter 없음·해석 불가·UTF-8 아님, 채우면 frontmatter 가 깨짐)도 막는다.
//   · 병합 커밋 중에는 채우지 않는다(판단·차단은 한다).
//   · 경로 지정 커밋(`git commit <경로>`)은 훅이 커밋 뒤 버려지는 임시 인덱스를 보므로, 인덱스를
//     고치지 않고 작업 트리에만 넣은 뒤 커밋을 멈춘다(다시 스테이징해 커밋하라고 알린다).
import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { checkDocIds } from '../check-doc-ids.mjs'
import { cleanup, commit, git, initVault, writeDoc } from './helpers/tmp-git-vault.mjs'

const SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'check-doc-ids.mjs')
const UUIDV7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const X = '0192f0c0-8000-7000-8000-00000000000a'
const Y = '0192f0c0-8000-7000-8000-00000000000b'
const HBM = 'wiki/tech/HBM.md'

/** 인덱스 내용 원문(`git` 헬퍼는 출력을 trim 하므로 쓰지 않는다). */
const staged = (vault, rel) =>
  spawnSync('git', ['show', `:${rel}`], { cwd: vault, encoding: 'utf8' }).stdout
const stagedBytes = (vault, rel) => spawnSync('git', ['show', `:${rel}`], { cwd: vault }).stdout
const worktree = (vault, rel) => readFileSync(path.join(vault, rel), 'utf8')
/** 훅이 넣은 id 줄(`id: '<id>'`)의 값. */
const insertedId = (text) => /^id: '([^']*)'$/mu.exec(text)?.[1]

function runCli(args, { cwd } = {}) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8' })
}

/** 첫 커밋을 문서와 무관한 파일로 만든다. */
function initWithRoot() {
  const vault = initVault()
  writeFileSync(path.join(vault, 'seed.txt'), 'seed\n')
  commit(vault, 'chore: seed')
  return vault
}

/** frontmatter 원문을 그대로 쓴 HBM 문서(writeDoc 은 특이한 id 줄을 만들 수 없다). */
function writeRaw(vault, text, rel = HBM) {
  mkdirSync(path.dirname(path.join(vault, rel)), { recursive: true })
  writeFileSync(path.join(vault, rel), text)
}

describe('checkDocIds — 미등록이면 채운다', () => {
  it('id 없는 새 문서: 인덱스와 작업 트리의 frontmatter 첫 줄에 같은 UUIDv7 을 넣는다', () => {
    const vault = initVault()
    try {
      writeDoc(vault, 'tech/HBM', { title: 'HBM' })
      git(vault, ['add', '-A'])
      const original = staged(vault, HBM)

      const result = checkDocIds({ vault })

      const id = insertedId(staged(vault, HBM))
      expect(id).toMatch(UUIDV7)
      expect(staged(vault, HBM)).toBe(`---\nid: '${id}'\n${original.slice('---\n'.length)}`)
      expect(insertedId(worktree(vault, HBM))).toBe(id)
      expect(result).toEqual({ blocked: [], filled: [{ id, path: HBM }], skipped: [] })
      expect(git(vault, ['diff', '--', HBM])).toBe('')
    } finally {
      cleanup(vault)
    }
  })

  it.each([
    ['빈 문자열', "''"],
    ['형식이 틀린 값', 'TBD'],
    ['UUIDv4', "'f47ac10b-58cc-4372-a567-0e02b2c3d479'"],
  ])('새 문서의 id 가 %s 이면 그 줄을 제자리에서 새 UUIDv7 로 바꾼다', (_label, raw) => {
    const vault = initVault()
    try {
      writeRaw(vault, `---\ntitle: HBM\nid: ${raw}\ntype: concept\nstatus: active\n---\n\n본문\n`)
      git(vault, ['add', '-A'])

      const { filled } = checkDocIds({ vault })

      expect(filled).toHaveLength(1)
      expect(staged(vault, HBM)).toBe(
        `---\ntitle: HBM\nid: '${filled[0].id}'\ntype: concept\nstatus: active\n---\n\n본문\n`,
      )
    } finally {
      cleanup(vault)
    }
  })

  it('이미 커밋된 문서라도 id 를 한 번도 가진 적이 없으면 채운다', () => {
    // 훅을 건너뛰고 들어온 문서다. 전도 후도 유효한 id 가 아니므로 미등록이다.
    const vault = initWithRoot()
    try {
      writeDoc(vault, 'tech/HBM', { title: 'HBM' })
      commit(vault, 'chore: id 없이 들어온 문서')
      writeDoc(vault, 'tech/HBM', { body: '## 정의\n\n수정.\n', title: 'HBM' })
      git(vault, ['add', '-A'])

      const { filled } = checkDocIds({ vault })

      expect(filled).toEqual([{ id: expect.stringMatching(UUIDV7), path: HBM }])
      expect(insertedId(staged(vault, HBM))).toBe(filled[0].id)
    } finally {
      cleanup(vault)
    }
  })

  it('부분 스테이징: 스테이징하지 않은 변경은 커밋 내용에 섞지 않고 작업 트리에 그대로 남긴다', () => {
    const vault = initVault()
    try {
      writeDoc(vault, 'tech/HBM', { body: '스테이징한 본문\n', title: 'HBM' })
      git(vault, ['add', '-A'])
      writeDoc(vault, 'tech/HBM', { body: '스테이징한 본문\n스테이징 안 한 줄\n', title: 'HBM' })

      const { filled } = checkDocIds({ vault })
      const { id } = filled[0]

      expect(staged(vault, HBM)).toContain(`id: '${id}'`)
      expect(staged(vault, HBM)).not.toContain('스테이징 안 한 줄')
      expect(worktree(vault, HBM)).toContain(`id: '${id}'`)
      expect(worktree(vault, HBM)).toContain('스테이징 안 한 줄')
      const unstaged = git(vault, ['diff', '--', HBM])
        .split('\n')
        .filter((line) => /^[+-][^+-]/u.test(line))
      expect(unstaged).toEqual(['+스테이징 안 한 줄'])
    } finally {
      cleanup(vault)
    }
  })

  it('스테이징 뒤 작업 트리에만 유효한 id 를 적었다면 새로 발급하지 않고 그 id 를 인덱스에 쓴다', () => {
    const vault = initVault()
    try {
      writeDoc(vault, 'tech/HBM', { title: 'HBM' })
      git(vault, ['add', '-A'])
      writeDoc(vault, 'tech/HBM', { id: X, title: 'HBM' })
      const worktreeBefore = worktree(vault, HBM)

      const { filled } = checkDocIds({ vault })

      expect(filled).toEqual([{ id: X, path: HBM }])
      expect(staged(vault, HBM)).toContain(`id: '${X}'`)
      expect(worktree(vault, HBM)).toBe(worktreeBefore)
    } finally {
      cleanup(vault)
    }
  })

  it('새 문서가 여럿이면 문서마다 서로 다른 id 를 넣는다', () => {
    const vault = initVault()
    try {
      writeDoc(vault, 'tech/HBM', { title: 'HBM' })
      writeDoc(vault, 'concept/온디바이스-AI', { title: '온디바이스 AI' })
      git(vault, ['add', '-A'])

      const { filled } = checkDocIds({ vault })

      expect(filled.map((entry) => entry.path).toSorted()).toEqual([
        'wiki/concept/온디바이스-AI.md',
        HBM,
      ])
      expect(new Set(filled.map((entry) => entry.id)).size).toBe(2)
    } finally {
      cleanup(vault)
    }
  })

  it('updateIndex:false 면 작업 트리에만 넣고 인덱스는 그대로 둔다', () => {
    const vault = initVault()
    try {
      writeDoc(vault, 'tech/HBM', { title: 'HBM' })
      git(vault, ['add', '-A'])
      const before = staged(vault, HBM)

      const { filled } = checkDocIds({ updateIndex: false, vault })

      expect(filled).toHaveLength(1)
      expect(staged(vault, HBM)).toBe(before)
      expect(insertedId(worktree(vault, HBM))).toBe(filled[0].id)
    } finally {
      cleanup(vault)
    }
  })

  it('작업 트리 파일의 권한(실행 권한·0600)을 그대로 둔다', () => {
    const vault = initVault()
    try {
      writeDoc(vault, 'tech/HBM', { title: 'HBM' })
      writeDoc(vault, 'tech/비공개', { title: '비공개' })
      chmodSync(path.join(vault, HBM), 0o755)
      chmodSync(path.join(vault, 'wiki/tech/비공개.md'), 0o600)
      git(vault, ['add', '-A'])

      checkDocIds({ vault })

      expect(statSync(path.join(vault, HBM)).mode & 0o777).toBe(0o755)
      expect(statSync(path.join(vault, 'wiki/tech/비공개.md')).mode & 0o777).toBe(0o600)
      expect(git(vault, ['diff', '--name-only'])).toBe('') // 작업 트리 = 인덱스(모드 포함)
    } finally {
      cleanup(vault)
    }
  })

  it('경로에 [ ] 가 있어도 그 문서의 모드로 쓴다(비슷한 이름의 심볼릭 링크 모드를 씌우지 않는다)', () => {
    const vault = initVault()
    try {
      writeDoc(vault, 'tech/대상', { id: X, title: '대상' })
      symlinkSync('대상.md', path.join(vault, 'wiki', 'tech', '2 note.md'))
      writeDoc(vault, 'tech/[2024] note', { title: 'note' })
      git(vault, ['add', '-A'])

      const { filled } = checkDocIds({ vault })

      expect(filled.map((entry) => entry.path)).toEqual(['wiki/tech/[2024] note.md'])
      expect(
        git(vault, ['ls-files', '--stage', '--', ':(literal)wiki/tech/[2024] note.md']),
      ).toMatch(/^100644 /u)
    } finally {
      cleanup(vault)
    }
  })

  it('심볼릭 링크였던 경로를 일반 파일 문서로 바꾸면(타입 변경) 채운다', () => {
    const vault = initWithRoot()
    try {
      writeDoc(vault, 'tech/대상', { id: X, title: '대상' })
      symlinkSync('대상.md', path.join(vault, HBM))
      commit(vault, 'chore: 링크')
      rmSync(path.join(vault, HBM))
      writeDoc(vault, 'tech/HBM', { title: 'HBM' })
      git(vault, ['add', '-A'])

      const { filled } = checkDocIds({ vault })

      expect(filled).toEqual([{ id: expect.stringMatching(UUIDV7), path: HBM }])
      expect(insertedId(staged(vault, HBM))).toBe(filled[0].id)
    } finally {
      cleanup(vault)
    }
  })

  it('작업 트리 쪽이 심볼릭 링크면 링크를 그대로 두고 인덱스만 채운다', () => {
    const vault = initVault()
    try {
      writeDoc(vault, 'tech/HBM', { title: 'HBM' })
      git(vault, ['add', '-A'])
      const target = path.join(vault, 'outside.md')
      writeFileSync(target, 'outside\n')
      rmSync(path.join(vault, HBM))
      symlinkSync(target, path.join(vault, HBM))

      const { filled } = checkDocIds({ vault })

      expect(filled).toHaveLength(1)
      expect(insertedId(staged(vault, HBM))).toBe(filled[0].id)
      expect(lstatSync(path.join(vault, HBM)).isSymbolicLink()).toBe(true)
      expect(readFileSync(target, 'utf8')).toBe('outside\n')
    } finally {
      cleanup(vault)
    }
  })

  it('파일 이름이 길어도 채운다', () => {
    const vault = initVault()
    try {
      writeDoc(vault, `tech/${'가'.repeat(76)}`, { title: '긴 이름' })
      git(vault, ['add', '-A'])

      expect(checkDocIds({ vault }).filled).toHaveLength(1)
      expect(git(vault, ['diff', '--name-only'])).toBe('') // 작업 트리 = 인덱스
    } finally {
      cleanup(vault)
    }
  })
})

describe('checkDocIds — 정상이면 건드리지 않는다', () => {
  it('유효한 id 가 있는 새 문서', () => {
    const vault = initVault()
    try {
      writeDoc(vault, 'tech/HBM', { id: X, title: 'HBM' })
      git(vault, ['add', '-A'])
      const before = staged(vault, HBM)

      expect(checkDocIds({ vault })).toEqual({ blocked: [], filled: [], skipped: [] })
      expect(staged(vault, HBM)).toBe(before)
      expect(worktree(vault, HBM)).toBe(before)
    } finally {
      cleanup(vault)
    }
  })

  it('id 는 그대로 두고 본문만 고친 문서, 따옴표만 바꾼 문서, 이동만 한 문서', () => {
    const vault = initWithRoot()
    try {
      writeDoc(vault, 'tech/HBM', { id: X, title: 'HBM' })
      writeDoc(vault, 'tech/따옴표', { id: Y, title: '따옴표' })
      writeDoc(vault, 'tech/이동전', { body: '이동할 문서 본문 '.repeat(20), id: X.replace('a', 'c'), title: '이동' }) // prettier-ignore
      commit(vault, 'chore: 문서들')
      writeDoc(vault, 'tech/HBM', { body: '## 정의\n\n고친 본문.\n', id: X, title: 'HBM' })
      writeRaw(vault, worktree(vault, 'wiki/tech/따옴표.md').replace(`"${Y}"`, `'${Y}'`), 'wiki/tech/따옴표.md') // prettier-ignore
      git(vault, ['add', '-A'])
      git(vault, ['mv', 'wiki/tech/이동전.md', 'wiki/tech/이동후.md'])

      expect(checkDocIds({ vault })).toEqual({ blocked: [], filled: [], skipped: [] })
    } finally {
      cleanup(vault)
    }
  })
})

describe('checkDocIds — 훼손·변경이면 커밋을 막는다', () => {
  it('변경: 유효한 id 를 다른 유효한 id 로 바꾸면 원래 id 를 알리고 막는다', () => {
    const vault = initWithRoot()
    try {
      writeDoc(vault, 'tech/HBM', { id: X, title: 'HBM' })
      commit(vault, 'chore: HBM 생성')
      writeDoc(vault, 'tech/HBM', { id: Y, title: 'HBM' })
      git(vault, ['add', '-A'])
      const before = staged(vault, HBM)

      const { blocked, filled } = checkDocIds({ vault })

      expect(filled).toEqual([])
      expect(blocked).toEqual([{ path: HBM, reason: expect.stringContaining(X) }])
      expect(blocked[0].reason).toMatch(/바꿀 수 없/u)
      expect(staged(vault, HBM)).toBe(before)
    } finally {
      cleanup(vault)
    }
  })

  it.each([
    ['id 줄을 지움', (text) => text.replace(/^id: .*\n/mu, '')],
    ['id 를 비움', (text) => text.replace(/^id: .*$/mu, "id: ''")],
    ['id 형식을 깨뜨림', (text) => text.replace(/^id: .*$/mu, 'id: TBD')],
  ])('훼손(%s): 원래 id 를 알리고 막는다 — 새 id 로 채우지 않는다', (_label, damage) => {
    const vault = initWithRoot()
    try {
      writeDoc(vault, 'tech/HBM', { id: X, title: 'HBM' })
      commit(vault, 'chore: HBM 생성')
      writeRaw(vault, damage(worktree(vault, HBM)))
      git(vault, ['add', '-A'])
      const before = staged(vault, HBM)

      const { blocked, filled } = checkDocIds({ vault })

      expect(filled).toEqual([])
      expect(blocked).toEqual([{ path: HBM, reason: expect.stringContaining(X) }])
      expect(staged(vault, HBM)).toBe(before)
      expect(worktree(vault, HBM)).toBe(before)
    } finally {
      cleanup(vault)
    }
  })

  it('이동하면서 id 를 바꾸거나 지워도 이동 전 문서의 id 로 판단해 막는다', () => {
    const vault = initWithRoot()
    try {
      writeDoc(vault, 'tech/바뀜전', { id: X, title: '바뀜' })
      writeDoc(vault, 'tech/지움전', { body: '지울 문서 본문 '.repeat(20), id: Y, title: '지움' })
      commit(vault, 'chore: 문서들')
      git(vault, ['mv', 'wiki/tech/바뀜전.md', 'wiki/tech/바뀜후.md'])
      git(vault, ['mv', 'wiki/tech/지움전.md', 'wiki/tech/지움후.md'])
      writeRaw(vault, worktree(vault, 'wiki/tech/바뀜후.md').replace(X, X.replace('a', 'd')), 'wiki/tech/바뀜후.md') // prettier-ignore
      writeRaw(vault, worktree(vault, 'wiki/tech/지움후.md').replace(/^id: .*\n/mu, ''), 'wiki/tech/지움후.md') // prettier-ignore
      git(vault, ['add', '-A'])

      const { blocked } = checkDocIds({ vault })

      expect(blocked.toSorted((a, b) => a.path.localeCompare(b.path))).toEqual([
        { path: 'wiki/tech/바뀜후.md', reason: expect.stringContaining(X) },
        { path: 'wiki/tech/지움후.md', reason: expect.stringContaining(Y) },
      ])
    } finally {
      cleanup(vault)
    }
  })

  it('줄은 그대로인데 실제 id 가 바뀐 경우(같은 키가 두 줄일 때 이기던 줄을 지움)도 막는다', () => {
    const vault = initWithRoot()
    try {
      writeRaw(vault, `---\nid: '${Y}'\nid: '${X}'\ntitle: HBM\ntype: concept\nstatus: active\n---\n\n본문\n`) // prettier-ignore
      commit(vault, 'chore: id 줄이 둘인 문서') // 실제 id = X
      writeRaw(vault, `---\nid: '${Y}'\ntitle: HBM\ntype: concept\nstatus: active\n---\n\n본문\n`)
      git(vault, ['add', '-A'])

      expect(checkDocIds({ vault }).blocked).toEqual([
        { path: HBM, reason: expect.stringContaining(X) },
      ])
    } finally {
      cleanup(vault)
    }
  })

  it('변경이 이번 커밋이 아니라 이미 이력에 있으면(훅을 건너뛴 커밋) 그렇게 알리고 정정 방법을 가리킨다', () => {
    const vault = initWithRoot()
    try {
      writeDoc(vault, 'tech/HBM', { id: X, title: 'HBM' })
      commit(vault, 'chore: HBM 생성')
      writeDoc(vault, 'tech/HBM', { id: Y, title: 'HBM' })
      commit(vault, 'chore: 훅 없이 들어온 id 변경')
      writeDoc(vault, 'tech/HBM', { body: '## 정의\n\n본문만 수정.\n', id: Y, title: 'HBM' })
      git(vault, ['add', '-A'])

      const { blocked } = checkDocIds({ vault })

      expect(blocked).toEqual([{ path: HBM, reason: expect.stringMatching(/이미 이력/u) }])
      expect(blocked[0].reason).toContain(X)
      expect(blocked[0].reason).not.toMatch(/되돌리세요/u)
    } finally {
      cleanup(vault)
    }
  })

  it('frontmatter 만 깨지고 id 줄은 그대로면 frontmatter 를 고치라고 알린다(id 를 되돌리라고 하지 않는다)', () => {
    const vault = initWithRoot()
    try {
      writeDoc(vault, 'tech/HBM', { id: X, title: 'HBM' })
      commit(vault, 'chore: HBM 생성')
      writeRaw(vault, worktree(vault, HBM).replace('type: concept', ' type: concept'))
      git(vault, ['add', '-A'])

      const { blocked } = checkDocIds({ vault })

      expect(blocked).toEqual([{ path: HBM, reason: expect.stringMatching(/frontmatter/u) }])
      expect(blocked[0].reason).not.toMatch(/되돌리세요/u)
    } finally {
      cleanup(vault)
    }
  })

  it('막는 문서가 있으면 다른 새 문서도 채우지 않는다(아무 파일도 고치지 않는다)', () => {
    const vault = initWithRoot()
    try {
      writeDoc(vault, 'tech/HBM', { id: X, title: 'HBM' })
      commit(vault, 'chore: HBM 생성')
      writeDoc(vault, 'tech/HBM', { id: Y, title: 'HBM' })
      writeDoc(vault, 'concept/새문서', { title: '새 문서' })
      git(vault, ['add', '-A'])
      const newDoc = 'wiki/concept/새문서.md'
      const before = staged(vault, newDoc)

      const { blocked, filled } = checkDocIds({ vault })

      expect(blocked.map((entry) => entry.path)).toEqual([HBM])
      expect(filled).toEqual([])
      expect(staged(vault, newDoc)).toBe(before)
      expect(worktree(vault, newDoc)).toBe(before)
    } finally {
      cleanup(vault)
    }
  })
})

describe('checkDocIds — 채울 수 없는 문서는 막는다', () => {
  it.each([
    ['frontmatter 가 없는 새 파일', '# 메모\n'],
    ['frontmatter 가 해석되지 않는 새 문서', '---\ntitle: HBM\n  broken-indent: 1\n---\n\n본문\n'],
    ['id 줄 아래 들여쓴 블록이 있어 채우면 frontmatter 가 깨지는 새 문서', '---\ntitle: HBM\nid:\n  - x\ntype: concept\n---\n\n본문\n'], // prettier-ignore
  ])('%s', (_label, text) => {
    const vault = initVault()
    try {
      writeRaw(vault, text)
      git(vault, ['add', '-A'])

      const { blocked, filled } = checkDocIds({ vault })

      expect(filled).toEqual([])
      expect(blocked).toEqual([{ path: HBM, reason: expect.stringMatching(/frontmatter/u) }])
      expect(staged(vault, HBM)).toBe(text)
      expect(worktree(vault, HBM)).toBe(text)
    } finally {
      cleanup(vault)
    }
  })

  it('UTF-8 이 아닌 문서(CP949)는 바이트를 바꾸지 않고 막는다', () => {
    const vault = initVault()
    try {
      // `---\ntitle: ` + CP949 "삼성전자" + `\n---\n`
      const cp949 = Buffer.concat([
        Buffer.from('---\ntitle: '),
        Buffer.from([0xbb, 0xef, 0xbc, 0xba, 0xc0, 0xfc, 0xc0, 0xda]),
        Buffer.from('\n---\n'),
      ])
      mkdirSync(path.join(vault, 'wiki', 'tech'), { recursive: true })
      writeFileSync(path.join(vault, HBM), cp949)
      git(vault, ['add', '-A'])

      const { blocked, filled } = checkDocIds({ vault })

      expect(filled).toEqual([])
      expect(blocked).toEqual([{ path: HBM, reason: expect.stringMatching(/UTF-8/u) }])
      expect(stagedBytes(vault, HBM)).toEqual(cp949)
      expect(readFileSync(path.join(vault, HBM))).toEqual(cp949)
    } finally {
      cleanup(vault)
    }
  })
})

describe('checkDocIds — 병합 커밋 중', () => {
  it('미등록 문서는 채우지 않고 알린다(병합 커밋에 훅의 수정을 섞지 않는다)', () => {
    const vault = initVault()
    try {
      writeFileSync(path.join(vault, 'seed.txt'), 'base\n')
      commit(vault, 'chore: base')
      const mainBranch = git(vault, ['symbolic-ref', '--short', 'HEAD'])
      git(vault, ['checkout', '-q', '-b', 'side'])
      writeDoc(vault, 'tech/HBM', { title: 'HBM' }) // id 없이 들어온 새 문서
      writeFileSync(path.join(vault, 'seed.txt'), 'side\n')
      commit(vault, 'chore: side')
      git(vault, ['checkout', '-q', mainBranch])
      writeFileSync(path.join(vault, 'seed.txt'), 'main\n')
      commit(vault, 'chore: main')
      expect(() => git(vault, ['merge', '--no-edit', 'side'])).toThrow() // seed.txt 충돌로 멈춘다
      writeFileSync(path.join(vault, 'seed.txt'), 'resolved\n')
      git(vault, ['add', '-A'])
      const before = staged(vault, HBM)

      expect(checkDocIds({ vault })).toEqual({
        blocked: [],
        filled: [],
        skipped: [{ path: HBM, reason: expect.stringMatching(/병합.*id:.*git add/su) }],
      })
      expect(staged(vault, HBM)).toBe(before)
      expect(worktree(vault, HBM)).toBe(before)
    } finally {
      cleanup(vault)
    }
  })
})

describe('checkDocIds — 병합 커밋 중에도 판단·차단은 한다', () => {
  it.each([
    ['id 를 바꾼 브랜치', (vault) => writeDoc(vault, 'tech/HBM', { id: Y, title: 'HBM' })],
    ['id 줄을 지운 브랜치', (vault) => writeDoc(vault, 'tech/HBM', { title: 'HBM' })],
  ])('%s를 병합하면 원래 id 를 알리고 막는다', (_label, damage) => {
    const vault = initVault()
    try {
      writeFileSync(path.join(vault, 'seed.txt'), 'base\n')
      writeDoc(vault, 'tech/HBM', { id: X, title: 'HBM' })
      commit(vault, 'chore: base')
      const mainBranch = git(vault, ['symbolic-ref', '--short', 'HEAD'])
      git(vault, ['checkout', '-q', '-b', 'side'])
      damage(vault)
      writeFileSync(path.join(vault, 'seed.txt'), 'side\n')
      commit(vault, 'chore: side')
      git(vault, ['checkout', '-q', mainBranch])
      writeFileSync(path.join(vault, 'seed.txt'), 'main\n')
      commit(vault, 'chore: main')
      expect(() => git(vault, ['merge', '--no-edit', 'side'])).toThrow() // seed.txt 충돌로 멈춘다
      writeFileSync(path.join(vault, 'seed.txt'), 'resolved\n')
      git(vault, ['add', '-A'])
      const before = staged(vault, HBM)

      expect(checkDocIds({ vault })).toEqual({
        blocked: [{ path: HBM, reason: expect.stringContaining(X) }],
        filled: [],
        skipped: [],
      })
      expect(staged(vault, HBM)).toBe(before)
    } finally {
      cleanup(vault)
    }
  })
})

describe('pre-commit 훅으로 실행 — 실제 커밋', () => {
  /** 이 스크립트를 부르는 pre-commit 훅 디렉터리를 만든다(`core.hooksPath` 로 지정한다). */
  function hooksDir() {
    const dir = mkdtempSync(path.join(tmpdir(), 'check-doc-ids-hooks-'))
    const hook = path.join(dir, 'pre-commit')
    writeFileSync(hook, `#!/bin/sh\nexec "${process.execPath}" "${SCRIPT}" --vault .\n`)
    chmodSync(hook, 0o755)
    return dir
  }

  const commitArgs = (hooks, args) => [
    '-c',
    `core.hooksPath=${hooks}`,
    'commit',
    '--no-gpg-sign',
    ...args,
  ]
  const commitWithHook = (vault, hooks, args) => git(vault, commitArgs(hooks, args))
  const tryCommit = (vault, hooks, args) =>
    spawnSync('git', commitArgs(hooks, args), {
      cwd: vault,
      encoding: 'utf8',
      env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' }, // prettier-ignore
    })
  const committedId = (vault) => insertedId(git(vault, ['show', `HEAD:${HBM}`]))

  it.each([
    ['git commit', ['-m', 'chore: HBM 생성']],
    ['git commit -a', ['-a', '-m', 'chore: HBM 생성']],
    ['git commit --include <경로>', ['-m', 'chore: HBM 생성', '--include', '--', HBM]],
  ])('%s: 커밋된 blob 에 id 가 있고 작업 트리·인덱스와 같다', (_label, args) => {
    const vault = initWithRoot()
    const hooks = hooksDir()
    try {
      writeDoc(vault, 'tech/HBM', { title: 'HBM' })
      git(vault, ['add', '-A'])

      commitWithHook(vault, hooks, args)

      expect(committedId(vault)).toMatch(UUIDV7)
      expect(insertedId(worktree(vault, HBM))).toBe(committedId(vault))
      expect(git(vault, ['status', '--porcelain'])).toBe('')
    } finally {
      cleanup(vault, hooks)
    }
  })

  it('git commit <경로>: 임시 인덱스라 커밋을 멈추고 작업 트리에만 넣는다 → 다시 커밋하면 들어간다', () => {
    const vault = initWithRoot()
    const hooks = hooksDir()
    try {
      writeDoc(vault, 'tech/HBM', { title: 'HBM' })
      git(vault, ['add', '-A'])
      const head = git(vault, ['rev-parse', 'HEAD'])

      const first = tryCommit(vault, hooks, ['-m', 'chore: HBM 생성', '--', HBM])

      expect(first.status).not.toBe(0)
      expect(first.stderr).toMatch(/git add/u)
      expect(git(vault, ['rev-parse', 'HEAD'])).toBe(head)
      const id = insertedId(worktree(vault, HBM))
      expect(id).toMatch(UUIDV7)

      git(vault, ['add', HBM])
      commitWithHook(vault, hooks, ['-m', 'chore: HBM 생성', '--', HBM])

      expect(committedId(vault)).toBe(id)
      expect(git(vault, ['status', '--porcelain'])).toBe('')
    } finally {
      cleanup(vault, hooks)
    }
  })

  it('git commit <경로> 를 하위 폴더에서 해도, 안내한 git add 명령을 그 자리에서 그대로 쓸 수 있다', () => {
    const vault = initWithRoot()
    const hooks = hooksDir()
    try {
      writeDoc(vault, 'tech/HBM', { title: 'HBM' })
      git(vault, ['add', '-A'])
      const subdir = path.join(vault, 'wiki', 'tech')

      const first = spawnSync('git', commitArgs(hooks, ['-m', 'chore: HBM 생성', '--', 'HBM.md']), {
        cwd: subdir,
        encoding: 'utf8',
        env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' }, // prettier-ignore
      })
      const advice = /(git add -- .+) 후 다시 커밋/u.exec(first.stderr)?.[1]

      expect(first.status).not.toBe(0)
      expect(advice).toBeDefined()
      expect(spawnSync('sh', ['-c', advice], { cwd: subdir, encoding: 'utf8' }).status).toBe(0)
      expect(git(vault, ['diff', '--name-only'])).toBe('')
    } finally {
      cleanup(vault, hooks)
    }
  })

  it('id 를 바꾼 커밋은 만들어지지 않고 원래 id 가 안내된다', () => {
    const vault = initWithRoot()
    const hooks = hooksDir()
    try {
      writeDoc(vault, 'tech/HBM', { id: X, title: 'HBM' })
      commit(vault, 'chore: HBM 생성')
      const head = git(vault, ['rev-parse', 'HEAD'])
      writeDoc(vault, 'tech/HBM', { id: Y, title: 'HBM' })
      git(vault, ['add', '-A'])

      const result = tryCommit(vault, hooks, ['-m', 'chore: id 변경'])

      expect(result.status).not.toBe(0)
      expect(result.stderr).toContain(X)
      expect(git(vault, ['rev-parse', 'HEAD'])).toBe(head)
    } finally {
      cleanup(vault, hooks)
    }
  })
})

describe('CLI 계약', () => {
  it('채운 문서를 경로와 id 로 알리고 exit 0', () => {
    const vault = initVault()
    try {
      writeDoc(vault, 'tech/HBM', { title: 'HBM' })
      git(vault, ['add', '-A'])

      const result = runCli(['--vault', vault])

      expect(result.status).toBe(0)
      expect(result.stdout).toMatch(/wiki\/tech\/HBM\.md/u)
      expect(result.stdout).toContain(insertedId(staged(vault, HBM)))
    } finally {
      cleanup(vault)
    }
  })

  it('막은 문서가 있으면 사유를 알리고 exit 1', () => {
    const vault = initWithRoot()
    try {
      writeDoc(vault, 'tech/HBM', { id: X, title: 'HBM' })
      commit(vault, 'chore: HBM 생성')
      writeDoc(vault, 'tech/HBM', { id: Y, title: 'HBM' })
      git(vault, ['add', '-A'])

      const result = runCli(['--vault', vault])

      expect(result.status).toBe(1)
      expect(result.stderr).toMatch(/wiki\/tech\/HBM\.md/u)
      expect(result.stderr).toContain(X)
    } finally {
      cleanup(vault)
    }
  })

  it('판단할 것이 없으면 아무것도 출력하지 않고 exit 0', () => {
    const vault = initVault()
    try {
      const result = runCli(['--vault', vault])

      expect(result.status).toBe(0)
      expect(`${result.stdout}${result.stderr}`).toBe('')
    } finally {
      cleanup(vault)
    }
  })

  it('알 수 없는 인자는 호출 계약 위반이라 exit 2', () => {
    const result = runCli(['--bogus'])

    expect(result.status).toBe(2)
    expect(result.stderr).not.toBe('')
  })

  it('--help 는 사용법을 출력하고 exit 0', () => {
    const result = runCli(['--help'])

    expect(result.status).toBe(0)
    expect(result.stdout).toMatch(/check-doc-ids/u)
  })

  it('git 저장소가 아닌 경로는 실행 실패라 exit 1', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'check-doc-ids-nogit-'))
    try {
      const result = runCli(['--vault', dir], { cwd: dir })

      expect(result.status).toBe(1)
      expect(result.stderr).not.toBe('')
    } finally {
      cleanup(dir)
    }
  })
})
