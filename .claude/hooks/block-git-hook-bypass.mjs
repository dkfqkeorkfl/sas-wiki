#!/usr/bin/env node
// Claude Code PreToolUse 훅 — Bash 명령이 git 훅(커밋·push 직전 검사)을 건너뛰면 실행 전에 막는다.
//
// 입력은 stdin 의 JSON 이고 명령은 `tool_input.command` 다. exit 2 는 도구 호출을 막고 stderr 를
// Claude 에게 이유로 돌려준다. 그 밖의 종료 코드는 막지 않는다(code.claude.com/docs/en/hooks).
// 판단은 `scripts/lib/hook-bypass.mjs` 가 한다.
import { readFileSync } from 'node:fs'

import { findHookBypass } from '../../scripts/lib/hook-bypass.mjs'

const input = JSON.parse(readFileSync(0, 'utf8'))
const command = input?.tool_input?.command
const reason = typeof command === 'string' ? findHookBypass(command) : null
if (reason !== null) {
  console.error(
    `이 리포에서는 git 훅을 건너뛰는 명령을 쓰지 않습니다: ${reason}.\n` +
      '훅이 알려 준 문제(문서 id·validate)를 고친 뒤 다시 실행하세요. id 규칙 정정처럼 꼭 필요하면 ' +
      '사용자에게 직접 실행을 요청하세요.',
  )
  process.exit(2)
}
