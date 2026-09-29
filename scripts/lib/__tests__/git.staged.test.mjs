// @vitest-environment node
//
// 인덱스(스테이징 영역) 조작 헬퍼 계약 — 커밋 직전 훅이 "이번에 커밋될 내용"만 읽고 고치기 위한 것.
//
//   listStagedDocChanges : 이번 커밋에 들어가는 문서(추가 A · 수정 M · 이동 R)와 이동 전 경로.
//   readStagedBytes      : 작업 트리가 아니라 인덱스의 내용, 바이트 그대로.
//   writeStagedFile      : 인덱스 내용만 바꾸고 작업 트리와 파일 모드는 건드리지 않는다.
//   isTemporaryIndex     : 훅이 보는 인덱스가 커밋 뒤 버려지는 임시 인덱스(경로 지정 커밋)인가.
//   isMergeInProgress    : 충돌을 풀고 병합 커밋을 만들기 전인가(MERGE_HEAD).
import { chmodSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  isMergeInProgress,
  isTemporaryIndex,
  listStagedDocChanges,
  makeGitRunner,
  readStagedBytes,
  underWikiPrefix,
  writeStagedFile,
} from '../git.mjs'
import {
  cleanup,
  commit,
  git,
  initVault,
  writeDoc,
} from '../../__tests__/helpers/tmp-git-vault.mjs'

const isWikiDoc = underWikiPrefix('wiki/')

describe('listStagedDocChanges — 이번 커밋에 들어가는 문서', () => {
  it('추가·수정·이동한 문서를 내고, 이동은 이동 전 경로를 함께 낸다. 삭제·범위 밖은 뺀다', () => {
    const vault = initVault()
    try {
      writeDoc(vault, 'tech/HBM', { title: 'HBM' })
      writeDoc(vault, 'tech/이동전', { title: '이동' })
      // 본문을 달리한다 — 거의 같은 문서의 삭제·추가는 git 이 이동으로 짝짓는다.
      writeDoc(vault, 'tech/삭제', {
        body: '삭제할 문서의 전혀 다른 본문 '.repeat(20),
        title: '삭제',
      })
      commit(vault, 'chore: 초기 문서')

      writeDoc(vault, 'concept/온디바이스-AI', { title: '온디바이스 AI' }) // A
      writeDoc(vault, 'tech/HBM', { body: '## 정의\n\n수정.\n', title: 'HBM' }) // M
      git(vault, ['add', '-A'])
      git(vault, ['mv', 'wiki/tech/이동전.md', 'wiki/tech/이동후.md']) // R
      git(vault, ['rm', '-q', 'wiki/tech/삭제.md']) // D
      writeFileSync(path.join(vault, 'NOTES.md'), '# 범위 밖\n') // 범위 밖 A
      git(vault, ['add', 'NOTES.md'])

      const changes = listStagedDocChanges(makeGitRunner(vault), { isDocPath: isWikiDoc })

      expect(changes.toSorted((a, b) => a.path.localeCompare(b.path))).toEqual([
        { path: 'wiki/concept/온디바이스-AI.md', status: 'A' },
        { path: 'wiki/tech/HBM.md', status: 'M' },
        { oldPath: 'wiki/tech/이동전.md', path: 'wiki/tech/이동후.md', status: 'R' },
      ])
    } finally {
      cleanup(vault)
    }
  })

  it('사용자가 diff.renames=false 를 설정해도 이동을 이동으로 본다', () => {
    // 설정에 맡기면 이동이 삭제+추가로 보여, 옮긴 문서가 새 문서로 판단된다.
    const vault = initVault()
    try {
      writeDoc(vault, 'tech/이동전', { title: '이동' })
      commit(vault, 'chore: 초기 문서')
      git(vault, ['config', 'diff.renames', 'false'])
      git(vault, ['mv', 'wiki/tech/이동전.md', 'wiki/tech/이동후.md'])

      expect(listStagedDocChanges(makeGitRunner(vault), { isDocPath: isWikiDoc })).toEqual([
        { oldPath: 'wiki/tech/이동전.md', path: 'wiki/tech/이동후.md', status: 'R' },
      ])
    } finally {
      cleanup(vault)
    }
  })

  it('첫 커밋 전(HEAD 없음)에는 스테이징된 문서가 모두 추가다', () => {
    const vault = initVault()
    try {
      writeDoc(vault, 'tech/HBM', { title: 'HBM' })
      git(vault, ['add', '-A'])

      expect(listStagedDocChanges(makeGitRunner(vault), { isDocPath: isWikiDoc })).toEqual([
        { path: 'wiki/tech/HBM.md', status: 'A' },
      ])
    } finally {
      cleanup(vault)
    }
  })

  it('작업 트리에만 있고 스테이징되지 않은 변경은 뺀다', () => {
    const vault = initVault()
    try {
      writeDoc(vault, 'tech/HBM', { title: 'HBM' })
      commit(vault, 'chore: 초기 문서')
      writeDoc(vault, 'tech/HBM', { body: '## 정의\n\n수정.\n', title: 'HBM' })
      writeDoc(vault, 'tech/미스테이징', { title: '미스테이징' })

      expect(listStagedDocChanges(makeGitRunner(vault), { isDocPath: isWikiDoc })).toEqual([])
    } finally {
      cleanup(vault)
    }
  })

  it('일반 파일만 낸다 — 심볼릭 링크는 문서가 아니다(validate 도 일반 파일만 문서로 읽는다)', () => {
    const vault = initVault()
    try {
      writeDoc(vault, 'tech/대상', { title: '대상' })
      symlinkSync('대상.md', path.join(vault, 'wiki', 'tech', '링크.md'))
      git(vault, ['add', '-A'])

      expect(listStagedDocChanges(makeGitRunner(vault), { isDocPath: isWikiDoc })).toEqual([
        { path: 'wiki/tech/대상.md', status: 'A' },
      ])
    } finally {
      cleanup(vault)
    }
  })

  it('따옴표·탭이 든 경로도 그대로 낸다', () => {
    const vault = initVault()
    try {
      writeDoc(vault, 'tech/따옴표"와\t탭', { title: 'x' })
      git(vault, ['add', '-A'])

      expect(listStagedDocChanges(makeGitRunner(vault), { isDocPath: isWikiDoc })).toEqual([
        { path: 'wiki/tech/따옴표"와\t탭.md', status: 'A' },
      ])
    } finally {
      cleanup(vault)
    }
  })
})

describe('readStagedBytes · writeStagedFile — 인덱스만 읽고 쓴다', () => {
  it('readStagedBytes 는 작업 트리가 달라도 인덱스 내용을 바이트 그대로 돌려준다', () => {
    const vault = initVault()
    try {
      writeDoc(vault, 'tech/HBM', { body: '스테이징된 본문\n', title: 'HBM' })
      git(vault, ['add', '-A'])
      writeDoc(vault, 'tech/HBM', { body: '작업 트리 본문\n', title: 'HBM' })

      const staged = readStagedBytes(makeGitRunner(vault), 'wiki/tech/HBM.md')

      expect(Buffer.isBuffer(staged)).toBe(true)
      expect(staged.toString('utf8')).toContain('스테이징된 본문')
      expect(staged.toString('utf8')).not.toContain('작업 트리 본문')
    } finally {
      cleanup(vault)
    }
  })

  it('UTF-8 이 아닌 바이트도 바꾸지 않고 돌려준다', () => {
    const vault = initVault()
    try {
      const cp949 = Buffer.from([0x2d, 0x2d, 0x2d, 0x0a, 0xbb, 0xef, 0xbc, 0xba, 0x0a])
      writeDoc(vault, 'tech/HBM', { title: 'HBM' })
      writeFileSync(path.join(vault, 'wiki', 'tech', 'HBM.md'), cp949)
      git(vault, ['add', '-A'])

      expect(readStagedBytes(makeGitRunner(vault), 'wiki/tech/HBM.md')).toEqual(cp949)
    } finally {
      cleanup(vault)
    }
  })

  it('writeStagedFile 은 인덱스만 바꾸고 작업 트리는 그대로 둔다', () => {
    const vault = initVault()
    try {
      writeDoc(vault, 'concept/온디바이스-AI', { title: '온디바이스 AI' })
      git(vault, ['add', '-A'])
      const abs = path.join(vault, 'wiki', 'concept', '온디바이스-AI.md')
      const worktreeBefore = readFileSync(abs, 'utf8')
      const runGit = makeGitRunner(vault)

      writeStagedFile(runGit, 'wiki/concept/온디바이스-AI.md', '---\ntitle: 인덱스만\n---\n')

      expect(readStagedBytes(runGit, 'wiki/concept/온디바이스-AI.md').toString('utf8')).toBe(
        '---\ntitle: 인덱스만\n---\n',
      )
      expect(readFileSync(abs, 'utf8')).toBe(worktreeBefore)
    } finally {
      cleanup(vault)
    }
  })

  it('writeStagedFile 은 인덱스 항목의 파일 모드를 유지한다', () => {
    const vault = initVault()
    try {
      writeDoc(vault, 'tech/HBM', { title: 'HBM' })
      chmodSync(path.join(vault, 'wiki', 'tech', 'HBM.md'), 0o755)
      git(vault, ['add', '-A'])
      const modeOf = () =>
        git(vault, ['ls-files', '--stage', '--', 'wiki/tech/HBM.md']).split(' ')[0]

      writeStagedFile(makeGitRunner(vault), 'wiki/tech/HBM.md', '---\ntitle: HBM\n---\n')

      expect(modeOf()).toBe('100755')
    } finally {
      cleanup(vault)
    }
  })

  it('경로의 [ ] 를 글롭으로 읽지 않는다 — 비슷한 이름의 다른 파일 모드를 씌우지 않는다', () => {
    // `[2024]` 를 글롭으로 읽으면 `2 note.md`(심볼릭 링크)가 먼저 잡혀 문서가 링크로 커밋된다.
    const vault = initVault()
    try {
      writeDoc(vault, 'tech/대상', { title: 'x' })
      symlinkSync('대상.md', path.join(vault, 'wiki', 'tech', '2 note.md'))
      writeDoc(vault, 'tech/[2024] note', { title: 'note' })
      git(vault, ['add', '-A'])

      writeStagedFile(makeGitRunner(vault), 'wiki/tech/[2024] note.md', '---\ntitle: note\n---\n')

      expect(
        git(vault, ['ls-files', '--stage', '--', ':(literal)wiki/tech/[2024] note.md']),
      ).toMatch(/^100644 /u)
    } finally {
      cleanup(vault)
    }
  })

  it('인덱스에 없는 경로를 쓰려 하면 멈춘다', () => {
    const vault = initVault()
    try {
      expect(() =>
        writeStagedFile(makeGitRunner(vault), 'wiki/tech/없음.md', '---\ntitle: x\n---\n'),
      ).toThrow(/인덱스/u)
    } finally {
      cleanup(vault)
    }
  })
})

describe('isTemporaryIndex — 커밋 뒤 저장소 인덱스로 남는 인덱스만 영속으로 본다', () => {
  it.each([
    ['GIT_INDEX_FILE 미설정(훅 밖 수동 실행)', () => undefined, false],
    ['상대 경로 .git/index (일반 커밋)', () => '.git/index', false],
    ['절대 경로 <git-dir>/index.lock (commit -a · --include)', (gitDir) => path.join(gitDir, 'index.lock'), false], // prettier-ignore
    ['<git-dir>/next-index-*.lock (경로 지정 커밋의 임시 인덱스)', (gitDir) => path.join(gitDir, 'next-index-4242.lock'), true], // prettier-ignore
  ])('%s → %s', (_label, indexFileOf, expected) => {
    const vault = initVault()
    try {
      const gitDir = path.join(vault, '.git')

      expect(isTemporaryIndex(makeGitRunner(vault), { cwd: vault, indexFile: indexFileOf(gitDir) })).toBe(expected) // prettier-ignore
    } finally {
      cleanup(vault)
    }
  })
})

describe('isMergeInProgress — MERGE_HEAD 가 있을 때만 참', () => {
  it('병합 전에는 거짓, 충돌로 멈춘 병합 중에는 참', () => {
    const vault = initVault()
    try {
      writeFileSync(path.join(vault, 'seed.txt'), 'base\n')
      commit(vault, 'chore: base')
      const mainBranch = git(vault, ['symbolic-ref', '--short', 'HEAD'])
      git(vault, ['checkout', '-q', '-b', 'side'])
      writeFileSync(path.join(vault, 'seed.txt'), 'side\n')
      commit(vault, 'chore: side')
      git(vault, ['checkout', '-q', mainBranch])
      writeFileSync(path.join(vault, 'seed.txt'), 'main\n')
      commit(vault, 'chore: main')
      const runGit = makeGitRunner(vault)

      expect(isMergeInProgress(runGit)).toBe(false)
      expect(() => git(vault, ['merge', '--no-edit', 'side'])).toThrow() // 충돌로 멈춘다
      expect(isMergeInProgress(runGit)).toBe(true)
    } finally {
      cleanup(vault)
    }
  })
})
