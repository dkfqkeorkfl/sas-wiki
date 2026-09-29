// @vitest-environment node
//
// readFrontmatterFieldChange — frontmatter 필드 한 개의 [전, 후].
//
//   · 후 = 넘긴 내용(작업 트리나 인덱스의 문서)의 값.
//   · 전 = 그 필드 줄을 마지막으로 바꾼 커밋의 **바로 전** 값(git blame). 그 줄이 문서가 생길 때부터
//     있었으면 전은 없다(undefined).
//   · 아직 커밋하지 않은 변경은 그 자체가 마지막 변경이다 — 전 = HEAD 의 값.
//   · 필드 줄이 없어진 경우는 blame 할 줄이 없으므로 전 = HEAD 의 값이다.
//   · 필드는 정규식으로 받는다 — id 전용이 아니다.
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { makeGitRunner, readFrontmatterFieldChange } from '../git.mjs'
import {
  cleanup,
  commit,
  git,
  initVault,
  writeDoc,
} from '../../__tests__/helpers/tmp-git-vault.mjs'

const X = '0192f0c0-8000-7000-8000-00000000000a'
const Y = '0192f0c0-8000-7000-8000-00000000000b'
const Z = '0192f0c0-8000-7000-8000-00000000000c'
// 필드 패턴은 테스트 로컬 리터럴이다(프로덕션 상수로 기대값을 만들지 않는다).
const ID_LINE = /^id\s*:([\s\S]*)$/u
const TITLE_LINE = /^title\s*:([\s\S]*)$/u
const HBM = 'wiki/tech/HBM.md'

const read = (vault, rel = HBM) => readFileSync(path.join(vault, rel), 'utf8')
/** 인덱스(stage 0)의 내용 그대로. 테스트 헬퍼 `git` 은 출력을 trim 하므로 쓰지 않는다. */
const staged = (vault, rel) =>
  execFileSync('git', ['show', `:${rel}`], { cwd: vault, encoding: 'utf8' })

function change(vault, rel = HBM, contents = read(vault, rel), pattern = ID_LINE) {
  return readFrontmatterFieldChange(makeGitRunner(vault), rel, { contents, pattern })
}

/** 첫 커밋을 문서와 무관한 파일로 만든다 — 문서가 root 커밋이 아닌 일반 커밋에서 생기게 한다. */
function initWithRoot() {
  const vault = initVault()
  writeFileSync(path.join(vault, 'README.md'), 'root\n')
  commit(vault, 'chore: root')
  return vault
}

describe('readFrontmatterFieldChange — 커밋된 이력', () => {
  it('문서가 생길 때부터 있던 id 는 전이 없다', () => {
    const vault = initWithRoot()
    try {
      writeDoc(vault, 'tech/HBM', { id: X, title: 'HBM' })
      commit(vault, 'chore: HBM 생성')

      expect(change(vault)).toEqual([undefined, X])
    } finally {
      cleanup(vault)
    }
  })

  it('root 커밋에서 생긴 문서도 전이 없다', () => {
    const vault = initVault()
    try {
      writeDoc(vault, 'tech/HBM', { id: X, title: 'HBM' })
      commit(vault, 'chore: HBM 생성')

      expect(change(vault)).toEqual([undefined, X])
    } finally {
      cleanup(vault)
    }
  })

  it('id 를 바꾼 커밋이 있으면 전은 그 커밋 바로 전 값이다(뒤의 본문 수정과 무관)', () => {
    const vault = initWithRoot()
    try {
      writeDoc(vault, 'tech/HBM', { id: X, title: 'HBM' })
      commit(vault, 'chore: HBM 생성')
      writeDoc(vault, 'tech/HBM', { id: Y, title: 'HBM' })
      commit(vault, 'chore: id 변경')
      writeDoc(vault, 'tech/HBM', { body: '## 정의\n\n고친 본문.\n', id: Y, title: 'HBM' })
      commit(vault, 'chore: 본문 수정')

      expect(change(vault)).toEqual([X, Y])
    } finally {
      cleanup(vault)
    }
  })

  it('바꿨다 되돌린 id 는 되돌린 커밋의 바로 전 값과 비교된다', () => {
    const vault = initWithRoot()
    try {
      writeDoc(vault, 'tech/HBM', { id: X, title: 'HBM' })
      commit(vault, 'chore: HBM 생성')
      writeDoc(vault, 'tech/HBM', { id: Y, title: 'HBM' })
      commit(vault, 'chore: id 변경')
      writeDoc(vault, 'tech/HBM', { id: X, title: 'HBM' })
      commit(vault, 'chore: id 되돌림')

      expect(change(vault)).toEqual([Y, X])
    } finally {
      cleanup(vault)
    }
  })

  it('따옴표만 바꾼 커밋은 전과 후가 같은 값이다(데이터로 비교한다)', () => {
    const vault = initWithRoot()
    try {
      writeDoc(vault, 'tech/HBM', { id: X, title: 'HBM' })
      commit(vault, 'chore: HBM 생성')
      writeFileSync(path.join(vault, HBM), read(vault).replace(`id: "${X}"`, `id: '${X}'`))
      commit(vault, 'chore: 따옴표만 변경')

      expect(change(vault)).toEqual([X, X])
    } finally {
      cleanup(vault)
    }
  })

  it('rename 과 함께 id 를 바꾸면 전은 옛 경로의 값이다(한글·따옴표·이모지가 든 경로도)', () => {
    const vault = initWithRoot()
    try {
      writeDoc(vault, 'tech/옛"이름📄', { id: X, title: 'HBM' })
      commit(vault, 'chore: 옛 이름으로 생성')
      git(vault, ['mv', 'wiki/tech/옛"이름📄.md', HBM])
      writeFileSync(path.join(vault, HBM), read(vault).replace(X, Y))
      commit(vault, 'chore: 이름 변경과 id 변경')

      expect(change(vault)).toEqual([X, Y])
    } finally {
      cleanup(vault)
    }
  })

  it('삭제 뒤 같은 경로에 다시 만든 문서는 새 문서다 — 전이 없다', () => {
    const vault = initWithRoot()
    try {
      writeDoc(vault, 'tech/HBM', { id: X, title: 'HBM' })
      commit(vault, 'chore: HBM 생성')
      git(vault, ['rm', '-q', HBM])
      commit(vault, 'chore: HBM 삭제')
      writeDoc(vault, 'tech/HBM', { id: Z, title: 'HBM' })
      commit(vault, 'chore: HBM 다시 생성')

      expect(change(vault)).toEqual([undefined, Z])
    } finally {
      cleanup(vault)
    }
  })

  it('저장소 설정 blame.ignoreRevsFile 이 id 를 바꾼 커밋을 숨기지 못한다', () => {
    // 이 설정은 지정한 커밋을 blame 에서 건너뛰게 한다. 적용되면 변경 커밋이 사라져 전이 없어진다.
    const vault = initWithRoot()
    try {
      writeDoc(vault, 'tech/HBM', { id: X, title: 'HBM' })
      commit(vault, 'chore: HBM 생성')
      writeDoc(vault, 'tech/HBM', { id: Y, title: 'HBM' })
      const changed = commit(vault, 'chore: id 변경')
      writeFileSync(path.join(vault, '.ignore-revs'), `${changed}\n`)
      git(vault, ['config', 'blame.ignoreRevsFile', '.ignore-revs'])

      expect(change(vault)).toEqual([X, Y])
    } finally {
      cleanup(vault)
    }
  })

  it('필드는 정규식으로 고른다 — id 가 아닌 필드도 같은 규칙이다', () => {
    const vault = initWithRoot()
    try {
      writeDoc(vault, 'tech/HBM', { id: X, title: 'HBM' })
      commit(vault, 'chore: HBM 생성')
      writeDoc(vault, 'tech/HBM', { id: X, title: '고대역폭 메모리' })
      commit(vault, 'chore: 제목 변경')

      expect(change(vault, HBM, read(vault), TITLE_LINE)).toEqual(['HBM', '고대역폭 메모리'])
    } finally {
      cleanup(vault)
    }
  })
})

describe('readFrontmatterFieldChange — 줄은 그대로인데 실제 id 가 바뀐 경우', () => {
  // blame 은 줄 글자를 따라간다. 그 줄이 생길 때 실제로 쓰이던 id 가 아니었다면(뒤의 같은 키가 이겼거나
  //   frontmatter 밖 본문이었다) 다른 줄을 지우거나 경계를 옮기는 커밋만으로 실제 id 가 바뀐다.
  it('id 줄이 둘인 문서에서 이기던 줄을 지우면, 전은 그때 실제로 쓰이던 id 다', () => {
    const vault = initWithRoot()
    try {
      const file = writeDoc(vault, 'tech/HBM', { title: 'HBM' })
      writeFileSync(
        file,
        readFileSync(file, 'utf8').replace('---\n', `---\nid: '${Y}'\nid: '${X}'\n`),
      )
      commit(vault, 'chore: id 줄이 둘인 문서') // 실제 id = X(뒤의 줄이 이긴다)
      writeFileSync(file, readFileSync(file, 'utf8').replace(`id: '${X}'\n`, ''))
      commit(vault, 'chore: 이기던 줄 삭제') // 실제 id = Y

      expect(change(vault)).toEqual([X, Y])
    } finally {
      cleanup(vault)
    }
  })

  it('본문의 id 줄이 닫는 --- 를 옮기는 커밋으로 frontmatter 에 들어와도, 전은 그때 실제로 쓰이던 id 다', () => {
    const vault = initWithRoot()
    try {
      const file = path.join(vault, HBM)
      mkdirSync(path.dirname(file), { recursive: true })
      writeFileSync(file, `---\nid: '${X}'\ntitle: HBM\n---\nid: '${Y}'\n\n본문\n`)
      commit(vault, 'chore: HBM 생성') // 실제 id = X
      // id: X 줄을 지우고 닫는 --- 를 id: Y 줄 아래로 옮긴다 — id: Y 줄 자체는 그대로다.
      writeFileSync(file, `---\ntitle: HBM\nid: '${Y}'\n---\n\n본문\n`)
      commit(vault, 'chore: 경계 이동') // 실제 id = Y

      expect(change(vault)).toEqual([X, Y])
    } finally {
      cleanup(vault)
    }
  })
})

describe('readFrontmatterFieldChange — 아직 커밋하지 않은 내용', () => {
  it('커밋 전 변경은 그 자체가 마지막 변경이다 — 전은 HEAD 의 값', () => {
    const vault = initWithRoot()
    try {
      writeDoc(vault, 'tech/HBM', { id: X, title: 'HBM' })
      commit(vault, 'chore: HBM 생성')
      writeDoc(vault, 'tech/HBM', { id: Z, title: 'HBM' })

      expect(change(vault)).toEqual([X, Z])
    } finally {
      cleanup(vault)
    }
  })

  it('id 줄을 지운 내용은 후가 없고 전은 HEAD 의 값이다', () => {
    const vault = initWithRoot()
    try {
      writeDoc(vault, 'tech/HBM', { id: X, title: 'HBM' })
      commit(vault, 'chore: HBM 생성')
      writeDoc(vault, 'tech/HBM', { title: 'HBM' })

      expect(change(vault)).toEqual([X, undefined])
    } finally {
      cleanup(vault)
    }
  })

  it('HEAD 에도 인덱스에도 없는 새 문서는 전이 없다', () => {
    const vault = initWithRoot()
    try {
      writeDoc(vault, 'tech/HBM', { id: X, title: 'HBM' })

      expect(change(vault)).toEqual([undefined, X])
    } finally {
      cleanup(vault)
    }
  })

  it('예전 문서가 떠난 경로에 새로 만든 문서도 전이 없다', () => {
    const vault = initWithRoot()
    try {
      writeDoc(vault, 'tech/HBM', { id: X, title: 'HBM' })
      commit(vault, 'chore: HBM 생성')
      git(vault, ['rm', '-q', HBM])
      commit(vault, 'chore: HBM 삭제')
      writeDoc(vault, 'tech/HBM', { id: Z, title: 'HBM' })

      expect(change(vault)).toEqual([undefined, Z])
    } finally {
      cleanup(vault)
    }
  })

  it('커밋이 하나도 없는 저장소의 문서는 전이 없다', () => {
    const vault = initVault()
    try {
      writeDoc(vault, 'tech/HBM', { id: X, title: 'HBM' })
      git(vault, ['add', '-A'])

      expect(change(vault)).toEqual([undefined, X])
    } finally {
      cleanup(vault)
    }
  })

  it('스테이징한 rename 과 id 변경은 인덱스 내용으로 옛 경로의 값을 찾는다', () => {
    const vault = initWithRoot()
    try {
      writeDoc(vault, 'tech/옛이름', { id: X, title: 'HBM' })
      commit(vault, 'chore: 옛 이름으로 생성')
      git(vault, ['mv', 'wiki/tech/옛이름.md', HBM])
      writeFileSync(path.join(vault, HBM), read(vault).replace(X, Y))
      git(vault, ['add', '-A'])

      expect(change(vault, HBM, staged(vault, HBM))).toEqual([X, Y])
    } finally {
      cleanup(vault)
    }
  })
})

describe('readFrontmatterFieldChange — 스테이징한 이동에서 id 줄이 없어진 경우', () => {
  it('headPath 로 이동 전 경로를 주면 전은 HEAD 의 이동 전 문서 값이다', () => {
    // 없어진 줄은 blame 할 수 없어 HEAD 의 값을 전으로 쓰는데, 이동했으면 HEAD 에는 옛 경로로 있다.
    const vault = initWithRoot()
    try {
      writeDoc(vault, 'tech/옛이름', { id: X, title: 'HBM' })
      commit(vault, 'chore: 옛 이름으로 생성')
      git(vault, ['mv', 'wiki/tech/옛이름.md', HBM])
      writeDoc(vault, 'tech/HBM', { title: 'HBM' })
      git(vault, ['add', '-A'])

      expect(
        readFrontmatterFieldChange(makeGitRunner(vault), HBM, {
          contents: staged(vault, HBM),
          headPath: 'wiki/tech/옛이름.md',
          pattern: ID_LINE,
        }),
      ).toEqual([X, undefined])
    } finally {
      cleanup(vault)
    }
  })
})

describe('readFrontmatterFieldChange — 이력이 없음을 오류 문구가 아니라 구조로 안다', () => {
  // git 의 오류 문구는 로케일에 따라 번역된다("fatal: " → "Schwerwiegend: "). 문구를 읽어 "이력 없음"을
  //   가리면 영어가 아닌 환경에서 멈춘다 — 그래서 HEAD 와 경로가 있는지를 먼저 묻고, 없으면 blame 을
  //   부르지 않는다.
  const contents = `---\ntitle: HBM\nid: '${X}'\n---\n`

  it('HEAD 가 없으면 blame 을 부르지 않고 전이 없다', () => {
    const calls = []
    const runGit = (args) => {
      calls.push(args)
      if (args.includes('rev-parse'))
        throw Object.assign(new Error('no HEAD'), { status: 1, stderr: '' })
      throw new Error(`예상하지 못한 호출: ${args.join(' ')}`)
    }

    expect(readFrontmatterFieldChange(runGit, HBM, { contents, pattern: ID_LINE })).toEqual([
      undefined,
      X,
    ])
    expect(calls.some((args) => args.includes('blame'))).toBe(false)
  })

  it('HEAD 에도 인덱스에도 없는 경로면 blame 을 부르지 않고 전이 없다', () => {
    const calls = []
    const runGit = (args) => {
      calls.push(args)
      if (args.includes('blame')) throw new Error('Schwerwiegend: no such path')
      return args.includes('rev-parse') ? 'abc\n' : ''
    }

    expect(readFrontmatterFieldChange(runGit, HBM, { contents, pattern: ID_LINE })).toEqual([
      undefined,
      X,
    ])
    expect(calls.some((args) => args.includes('blame'))).toBe(false)
  })
})

describe('readFrontmatterFieldChange — 실패를 삼키지 않는다', () => {
  it('이력이 있는 경로에서 blame 이 실패하면 던진다', () => {
    // "이력 없음" 으로 삼키면 조회 실패가 "처음 등록" 으로 둔갑해 변경 판별이 조용히 꺼진다.
    const failing = (args) => {
      if (args.includes('ls-tree')) return `100644 blob abc\t${HBM}\0`
      if (args.includes('blame')) {
        throw Object.assign(new Error('Command failed: git blame'), {
          status: 128,
          stderr: 'fatal: bad object deadbeef\n',
        })
      }
      return ''
    }
    const contents = `---\ntitle: HBM\nid: '${X}'\n---\n`

    expect(() => readFrontmatterFieldChange(failing, HBM, { contents, pattern: ID_LINE })).toThrow(
      /bad object/u,
    )
  })
})
