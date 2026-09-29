// 셸 명령이 git 훅을 건너뛰는지 판단한다 — Claude Code 하네스가 Bash 명령을 실행하기 전에 묻는다
// (`.claude/hooks/block-git-hook-bypass.mjs`). 커밋·push 직전 검사(문서 id 판단·validate)는 git 훅이라
// 명령 옵션 하나로 꺼진다. 사람은 그럴 일이 없지만, 에이전트가 막힌 검사를 "통과"시키려고 훅을 끄는
// 일은 여기서 막는다.
//
// 셸 문법을 모두 해석하지는 않는다. 단어(따옴표를 푼 것)와 명령 구분자만 나눠, git 명령의 옵션으로
// 들어간 단어만 본다 — 커밋 메시지·heredoc 본문처럼 데이터로 들어간 같은 글자는 막지 않는다.

/** git 긴 옵션은 모호하지 않은 앞부분도 받는다(`--no-veri`). `--no-ver` 는 `--no-verbose` 와 모호하다. */
const NO_VERIFY_RE = /^--no-veri(?:fy?)?$/u
const HOOKS_PATH_RE = /core\.hookspath/iu
// `git commit` 에서 값을 받는 짧은 옵션. 묶음(`-am`) 안에서 이 글자 뒤는 그 값이다.
const COMMIT_SHORT_WITH_VALUE = new Set(['C', 'F', 'S', 'c', 'm', 't', 'u'])
// `git commit` 에서 값을 다음 단어로 받는 옵션 — 그 값(`-m -n` 의 `-n`)은 옵션으로 보지 않는다.
const COMMIT_VALUE_OPTIONS = new Set([
  '-C',
  '-F',
  '-c',
  '-m',
  '-t',
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
const GIT_GLOBAL_VALUE_OPTIONS = new Set(['-C', '-c', '--config-env', '--git-dir', '--namespace', '--work-tree']) // prettier-ignore
const CONFIG_READ_FLAGS = new Set(['--get', '--get-all', '--get-regexp', '-l', '--list'])
const SHELLS = new Set(['bash', 'dash', 'sh', 'zsh'])

/**
 * @param {string} command 셸 명령 문자열
 * @returns {string | null} git 훅을 건너뛰면 그 이유, 아니면 null
 */
export function findHookBypass(command) {
  for (const words of splitCommands(tokenize(stripHeredocBodies(command)))) {
    const reason = inspectCommand(words)
    if (reason !== null) return reason
  }
  return null
}

function inspectCommand(words) {
  for (const word of words) {
    if (word === 'HUSKY=0') return 'HUSKY=0 은 husky 가 거는 git 훅을 모두 끈다'
  }

  const program = basename(words.find((word) => !/^\w+=/u.test(word)) ?? '')
  if (SHELLS.has(program) || program === 'eval') {
    // `sh -c '<명령>'` · `eval '<명령>'` 은 그 문자열을 다시 명령으로 실행한다.
    for (const word of words.slice(1)) {
      const nested = word.includes(' ') ? findHookBypass(word) : null
      if (nested !== null) return nested
    }
  }

  const gitIndex = words.findIndex((word) => basename(word) === 'git')
  const hooksPathIndex = words.findIndex((word) => HOOKS_PATH_RE.test(word))
  if (gitIndex === -1) {
    // `GIT_CONFIG_KEY_0=core.hooksPath` 처럼 환경 변수로 넣는 설정도 git 이 읽는다.
    return hooksPathIndex !== -1 && words.slice(0, hooksPathIndex + 1).every((word) => /^\w+=/u.test(word)) // prettier-ignore
      ? 'core.hooksPath 를 바꾸면 husky 가 건 git 훅이 꺼진다'
      : null
  }

  let index = gitIndex + 1
  while (index < words.length && words[index].startsWith('-')) {
    index += GIT_GLOBAL_VALUE_OPTIONS.has(words[index]) ? 2 : 1
  }
  const subcommand = words[index]
  const args = words.slice(index + 1)

  if (hooksPathIndex !== -1 && !isHooksPathRead(subcommand, args)) {
    return 'core.hooksPath 를 바꾸면 husky 가 건 git 훅이 꺼진다'
  }
  const optionWords = subcommand === 'commit' ? commitOptions(args) : untilDoubleDash(args)
  if (optionWords.some((word) => NO_VERIFY_RE.test(word))) {
    return '--no-verify 는 git 훅(커밋·push 직전 검사)을 건너뛴다'
  }
  if (subcommand === 'commit' && optionWords.some((word) => hasShortN(word))) {
    return 'git commit -n 은 --no-verify 와 같아 커밋 직전 검사를 건너뛴다'
  }
  return null
}

/** `git config` 로 core.hooksPath 를 읽기만 하는가. 키 하나만 주면(값 없이) 읽기다. */
function isHooksPathRead(subcommand, args) {
  if (subcommand !== 'config') return false
  if (args.some((word) => CONFIG_READ_FLAGS.has(word)) || ['get', 'list'].includes(args[0])) {
    return true
  }
  const positional = args.filter((word) => !word.startsWith('-'))
  return (
    positional.length === 1 &&
    HOOKS_PATH_RE.test(positional[0]) &&
    args.length === positional.length
  )
}

/** `git commit` 인자 중 옵션 단어만. 값을 받는 옵션의 값 단어와 `--` 뒤(경로)는 뺀다. */
function commitOptions(args) {
  const options = []
  for (let index = 0; index < args.length; index += 1) {
    const word = args[index]
    if (word === '--') break
    if (!word.startsWith('-')) continue
    options.push(word)
    const lastShort = /^-[a-zA-Z]+$/u.test(word) ? word.at(-1) : null
    if (COMMIT_VALUE_OPTIONS.has(word) || (lastShort !== null && 'CFcmt'.includes(lastShort))) {
      index += 1
    }
  }
  return options
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

/** heredoc 본문(`<<EOF` 다음 줄부터 구분자 줄까지)은 명령이 아니라 입력 데이터라 지운다. */
function stripHeredocBodies(command) {
  const lines = command.split('\n')
  const kept = []
  for (let index = 0; index < lines.length; index += 1) {
    kept.push(lines[index])
    for (const match of lines[index].matchAll(/<<(-?)\s*(['"]?)([\w.-]+)\2/gu)) {
      const [, dash, , delimiter] = match
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
 * 따옴표·백슬래시를 풀어 단어로 나눈다. 명령 구분자(`;` `&` `|` 줄바꿈 괄호)는 따로 한 토큰(null)이다.
 * 따옴표 안의 구분자·공백은 단어의 일부다.
 */
function tokenize(command) {
  const tokens = []
  let word = ''
  let inWord = false
  const flush = () => {
    if (inWord) tokens.push(word)
    word = ''
    inWord = false
  }
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index]
    if (char === "'") {
      const end = command.indexOf("'", index + 1)
      const close = end === -1 ? command.length : end
      word += command.slice(index + 1, close)
      inWord = true
      index = close
    } else if (char === '"') {
      inWord = true
      for (index += 1; index < command.length && command[index] !== '"'; index += 1) {
        if (command[index] === '\\' && '"\\$`'.includes(command[index + 1] ?? '')) index += 1
        word += command[index] ?? ''
      }
    } else if (char === '\\') {
      word += command[index + 1] ?? ''
      inWord = true
      index += 1
    } else if (/\s/u.test(char) && char !== '\n') {
      flush()
    } else if (';&|\n(){}`'.includes(char)) {
      flush()
      tokens.push(null)
    } else {
      word += char
      inWord = true
    }
  }
  flush()
  return tokens
}

function splitCommands(tokens) {
  const commands = [[]]
  for (const token of tokens) {
    if (token === null) commands.push([])
    else commands.at(-1).push(token)
  }
  return commands.filter((words) => words.length > 0)
}
