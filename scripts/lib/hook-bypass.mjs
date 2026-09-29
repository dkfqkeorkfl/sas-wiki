// 셸 명령이 git 훅을 건너뛰는지 판단한다 — Claude Code 하네스가 Bash 명령을 실행하기 전에 묻는다
// (`.claude/hooks/block-git-hook-bypass.mjs`). 커밋·push 직전 검사(문서 id 판단·validate)는 git 훅이라
// 명령 옵션 하나로 꺼진다. 사람은 그럴 일이 없지만, 에이전트가 막힌 검사를 "통과"시키려고 훅을 끄는
// 일은 여기서 막는다.
//
// 셸 문법을 모두 해석하지는 않는다. 단어(따옴표를 푼 것)와 명령 구분자만 나누고, 명령 치환(`$(…)`·
// 백틱)·프로세스 치환(`<(…)`) 안은 따로 떼어 명령으로 다시 본다. 그리고 **설정이 들어가는 자리**만
// 본다 — git 명령의 옵션, 명령 앞 환경 변수, `git config` 쓰기. 커밋 메시지·검색어·heredoc 본문처럼
// 데이터로 들어간 같은 글자는 막지 않는다.

/** git 긴 옵션은 모호하지 않은 앞부분도 받는다(`--no-veri`). `--no-ver` 는 `--no-verbose` 와 모호하다. */
const NO_VERIFY_RE = /^--no-veri(?:fy?)?$/u
const HOOKS_PATH_RE = /core\.hookspath/iu
const ASSIGNMENT_RE = /^[A-Za-z_]\w*=/u
// `git commit` 에서 값을 받는 짧은 옵션. 묶음(`-am`) 안에서 이 글자 뒤는 그 값이다.
const COMMIT_SHORT_WITH_VALUE = new Set(['C', 'F', 'S', 'c', 'm', 't', 'u'])
// 그중 값을 붙여 쓰지 않으면 다음 단어로 받는 것(`-m <메시지>`). `-S`·`-u` 는 값을 붙여서만 받는다.
const COMMIT_SHORT_WITH_NEXT_VALUE = new Set(['C', 'F', 'c', 'm', 't'])
// `git commit` 에서 값을 다음 단어로 받는 긴 옵션 — 그 값은 옵션으로 보지 않는다.
const COMMIT_LONG_WITH_VALUE = new Set([
  '--author',
  '--cleanup',
  '--date',
  '--file',
  '--fixup',
  '--message',
  '--pathspec-from-file',
  '--reedit-message',
  '--reuse-message',
  '--squash',
  '--template',
  '--trailer',
])
// git 전역 옵션 중 값을 다음 단어로 받는 것(`git-scm.com/docs/git`).
const GIT_GLOBAL_WITH_VALUE = new Set(['-C', '-c', '--config-env', '--git-dir', '--namespace', '--work-tree']) // prettier-ignore
// `git config` 의 쓰기 옵션과, git 2.46 부터의 하위 명령 중 쓰기인 것(`git-scm.com/docs/git-config`).
const CONFIG_WRITE_FLAGS = new Set(['--add', '--edit', '--remove-section', '--rename-section', '--replace-all', '--unset', '--unset-all', '-e']) // prettier-ignore
const CONFIG_WRITE_SUBCOMMANDS = new Set([
  'edit',
  'remove-section',
  'rename-section',
  'set',
  'unset',
])
const CONFIG_OPTIONS_WITH_VALUE = new Set(['--blob', '--comment', '--default', '--file', '--type', '-f']) // prettier-ignore
// 인자를 환경 변수 대입으로 받는 셸 내장 명령·도구.
const ASSIGNING_COMMANDS = new Set(['declare', 'env', 'export', 'local', 'readonly', 'typeset'])
const SHELLS = new Set(['bash', 'dash', 'sh', 'zsh'])
// 명령 앞에 올 수 있는 셸 예약어.
const RESERVED_PREFIXES = new Set(['!', '{', '}'])

const HOOKS_PATH_REASON = 'core.hooksPath 를 바꾸면 husky 가 건 git 훅이 꺼진다'

/**
 * @param {string} command 셸 명령 문자열
 * @returns {string | null} git 훅을 건너뛰면 그 이유, 아니면 null
 */
export function findHookBypass(command) {
  const { commands, nested } = parse(stripHeredocBodies(command))
  for (const inner of nested) {
    const reason = findHookBypass(inner)
    if (reason !== null) return reason
  }
  for (const words of commands) {
    const reason = inspectCommand(words)
    if (reason !== null) return reason
  }
  return null
}

function inspectCommand(allWords) {
  let index = 0
  while (index < allWords.length && RESERVED_PREFIXES.has(allWords[index])) index += 1
  const assignments = []
  while (index < allWords.length && ASSIGNMENT_RE.test(allWords[index])) {
    assignments.push(allWords[index])
    index += 1
  }
  const words = allWords.slice(index)
  const program = basename(words[0] ?? '')
  if (ASSIGNING_COMMANDS.has(program)) {
    assignments.push(...words.slice(1).filter((word) => ASSIGNMENT_RE.test(word)))
  }

  for (const assignment of assignments) {
    if (assignment === 'HUSKY=0') return 'HUSKY=0 은 husky 가 거는 git 훅을 모두 끈다'
    // `GIT_CONFIG_KEY_<n>=core.hooksPath` · `GIT_CONFIG_PARAMETERS` 처럼 환경 변수로 넣는 설정도 git 이 읽는다.
    if (HOOKS_PATH_RE.test(assignment)) return HOOKS_PATH_REASON
  }

  if (SHELLS.has(program) || program === 'eval') {
    // `sh -c '<명령>'` · `eval '<명령>'` 은 그 문자열을 다시 명령으로 실행한다.
    for (const word of words.slice(1)) {
      const nested = /\s/u.test(word) ? findHookBypass(word) : null
      if (nested !== null) return nested
    }
  }

  const gitIndex = words.findIndex((word) => basename(word) === 'git')
  return gitIndex === -1 ? null : inspectGit(words.slice(gitIndex + 1))
}

function inspectGit(words) {
  let index = 0
  while (index < words.length && words[index].startsWith('-')) {
    const option = words[index]
    const [name, attached] = option.startsWith('--') ? option.split(/=(.*)/su) : [option, undefined]
    const value = attached ?? (GIT_GLOBAL_WITH_VALUE.has(name) ? words[index + 1] : undefined)
    if ((name === '-c' || name === '--config-env') && HOOKS_PATH_RE.test(value ?? '')) {
      return HOOKS_PATH_REASON
    }
    index += attached === undefined && GIT_GLOBAL_WITH_VALUE.has(name) ? 2 : 1
  }
  const subcommand = words[index]
  const args = words.slice(index + 1)

  if (subcommand === 'config' && isHooksPathWrite(args)) return HOOKS_PATH_REASON
  const options = subcommand === 'commit' ? commitOptions(args) : untilDoubleDash(args)
  if (options.some((word) => NO_VERIFY_RE.test(word))) {
    return '--no-verify 는 git 훅(커밋·push 직전 검사)을 건너뛴다'
  }
  if (subcommand === 'commit' && options.some((word) => hasShortN(word))) {
    return 'git commit -n 은 --no-verify 와 같아 커밋 직전 검사를 건너뛴다'
  }
  return null
}

/** `git config` 가 core.hooksPath 를 바꾸거나 지우는가. 키 하나만 주면(값 없이) 읽기다. */
function isHooksPathWrite(args) {
  const positional = []
  let writeFlag = false
  for (let index = 0; index < args.length; index += 1) {
    const word = args[index]
    if (!word.startsWith('-')) {
      positional.push(word)
      continue
    }
    if (CONFIG_WRITE_FLAGS.has(word)) writeFlag = true
    if (CONFIG_OPTIONS_WITH_VALUE.has(word)) index += 1
  }
  const keyIndex = positional.findIndex((word) => HOOKS_PATH_RE.test(word))
  if (keyIndex === -1) return false
  return (
    writeFlag || CONFIG_WRITE_SUBCOMMANDS.has(positional[0]) || keyIndex < positional.length - 1
  )
}

/** `git commit` 인자 중 옵션 단어만. 값을 다음 단어로 받는 옵션의 값과 `--` 뒤(경로)는 뺀다. */
function commitOptions(args) {
  const options = []
  for (let index = 0; index < args.length; index += 1) {
    const word = args[index]
    if (word === '--') break
    if (!word.startsWith('-')) continue
    options.push(word)
    if (COMMIT_LONG_WITH_VALUE.has(word) || shortTakesNextWord(word)) index += 1
  }
  return options
}

/** 짧은 옵션 묶음이 값을 다음 단어로 받는가 — 값을 받는 첫 글자가 묶음의 마지막 글자일 때뿐이다. */
function shortTakesNextWord(word) {
  if (!/^-[a-zA-Z]+$/u.test(word)) return false
  const letters = word.slice(1)
  const at = [...letters].findIndex((letter) => COMMIT_SHORT_WITH_VALUE.has(letter))
  return at === letters.length - 1 && COMMIT_SHORT_WITH_NEXT_VALUE.has(letters[at])
}

/** 짧은 옵션 묶음(`-anm`)에서 값을 받는 글자 전에 `n` 이 있는가. */
function hasShortN(word) {
  if (!/^-[a-zA-Z]+$/u.test(word)) return false
  for (const letter of word.slice(1)) {
    if (letter === 'n') return true
    if (COMMIT_SHORT_WITH_VALUE.has(letter)) return false
  }
  return false
}

function untilDoubleDash(args) {
  const end = args.indexOf('--')
  return end === -1 ? args : args.slice(0, end)
}

function basename(word) {
  return word.slice(word.lastIndexOf('/') + 1)
}

/**
 * heredoc 본문(`<<EOF` 다음 줄부터 구분자 줄까지)은 명령이 아니라 입력 데이터라 지운다.
 *
 * `<<<`(here-string)와 `1<<2` 같은 산술 시프트는 heredoc 이 아니다. 구분자는 따옴표·백슬래시로
 * 감쌀 수 있다(`<<'EOF'` · `<<"EOF"` · `<<\EOF`).
 */
function stripHeredocBodies(command) {
  const lines = command.split('\n')
  const kept = []
  const heredoc =
    /(?<![<\d])<<(?!<)(-?)[ \t]*(?:\\([\w.-]+)|(['"])([\w.-]+)\3|([A-Za-z_][\w.-]*))/gu
  for (let index = 0; index < lines.length; index += 1) {
    kept.push(lines[index])
    for (const match of lines[index].matchAll(heredoc)) {
      const dash = match[1]
      const delimiter = match[2] ?? match[4] ?? match[5]
      while (index + 1 < lines.length) {
        index += 1
        const line = dash ? lines[index].replace(/^\t+/u, '') : lines[index]
        if (line === delimiter) break
      }
    }
  }
  return kept.join('\n')
}

/**
 * 명령 문자열을 명령(단어 배열)들로 나눈다. 따옴표·백슬래시를 풀고, 줄 이어쓰기(`\` + 줄바꿈)는
 * 이어 붙인다. 명령 치환·프로세스 치환·백틱 안의 문자열은 `nested` 로 따로 낸다.
 *
 * @returns {{ commands: string[][], nested: string[] }}
 */
function parse(text) {
  const commands = [[]]
  const nested = []
  let word = ''
  let inWord = false
  const flush = () => {
    if (inWord) commands.at(-1).push(word)
    word = ''
    inWord = false
  }
  const endCommand = () => {
    flush()
    commands.push([])
  }
  const takeNested = (start, end) => {
    nested.push(text.slice(start, end))
    inWord = true
  }

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    const next = text[index + 1]
    if (char === '\\') {
      if (next !== '\n') {
        word += next ?? ''
        inWord = true
      }
      index += 1
    } else if (char === "'") {
      const close = indexOrEnd(text, "'", index + 1)
      word += text.slice(index + 1, close)
      inWord = true
      index = close
    } else if (char === '"') {
      inWord = true
      for (index += 1; index < text.length && text[index] !== '"'; index += 1) {
        if (text[index] === '\\' && '"\\$`\n'.includes(text[index + 1] ?? '')) {
          if (text[index + 1] !== '\n') word += text[index + 1]
          index += 1
        } else if (text[index] === '$' && text[index + 1] === '(') {
          const close = matchParen(text, index + 1)
          takeNested(index + 2, close)
          index = close
        } else if (text[index] === '`') {
          const close = indexOrEnd(text, '`', index + 1)
          takeNested(index + 1, close)
          index = close
        } else {
          word += text[index]
        }
      }
    } else if ((char === '$' || char === '<' || char === '>') && next === '(') {
      const close = matchParen(text, index + 1)
      takeNested(index + 2, close)
      index = close
    } else if (char === '`') {
      const close = indexOrEnd(text, '`', index + 1)
      takeNested(index + 1, close)
      index = close
    } else if (char === '&' && (/[<>]$/u.test(word) || next === '>')) {
      // 리다이렉션(`2>&1` · `&>파일`)의 `&` 는 명령 구분자가 아니다.
      word += char
      inWord = true
    } else if (char === '\n' || ';&|()'.includes(char)) {
      endCommand()
    } else if (/\s/u.test(char)) {
      flush()
    } else {
      word += char
      inWord = true
    }
  }
  flush()
  return { commands: commands.filter((words) => words.length > 0), nested }
}

function indexOrEnd(text, search, from) {
  const found = text.indexOf(search, from)
  return found === -1 ? text.length : found
}

/** `text[open]` 의 `(` 와 짝인 `)` 의 위치(따옴표 안의 괄호는 세지 않는다). 없으면 문자열 끝. */
function matchParen(text, open) {
  let depth = 0
  for (let index = open; index < text.length; index += 1) {
    const char = text[index]
    if (char === '\\') index += 1
    else if (char === "'" || char === '"') index = indexOrEnd(text, char, index + 1)
    else if (char === '(') depth += 1
    else if (char === ')' && --depth === 0) return index
  }
  return text.length
}
