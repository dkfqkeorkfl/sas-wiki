// @vitest-environment node
//
// Claude Code 하네스 배선 — 프로젝트 설정(`.claude/settings.json`)이 Bash 명령마다 훅 우회 검사를
// 부르고, 그 스크립트가 우회 명령을 exit 2 로 막는가. 훅 입력·종료 코드 계약은 Claude Code 문서
// (code.claude.com/docs/en/hooks)를 따른다: 입력은 stdin JSON(`tool_input.command`), exit 2 는 도구
// 호출을 막고 stderr 를 Claude 에게 돌려준다.
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const HOOK = path.join(REPO_ROOT, '.claude', 'hooks', 'block-git-hook-bypass.mjs')

function runHook(payload) {
  return spawnSync(process.execPath, [HOOK], {
    encoding: 'utf8',
    input: JSON.stringify(payload),
  })
}

describe('Claude Code 하네스 — git 훅 우회 차단', () => {
  it('프로젝트 설정이 모든 Bash 명령 전에 이 스크립트를 부른다', () => {
    const settings = JSON.parse(readFileSync(path.join(REPO_ROOT, '.claude', 'settings.json'), 'utf8')) // prettier-ignore

    expect(settings.hooks.PreToolUse).toEqual([
      {
        hooks: [
          {
            command: 'node "$CLAUDE_PROJECT_DIR/.claude/hooks/block-git-hook-bypass.mjs"',
            type: 'command',
          },
        ],
        matcher: 'Bash',
      },
    ])
  })

  it('훅을 건너뛰는 명령은 exit 2 로 막고 이유를 stderr 로 알린다', () => {
    const result = runHook({
      hook_event_name: 'PreToolUse',
      tool_input: { command: 'git commit --no-verify -m x' },
      tool_name: 'Bash',
    })

    expect(result.status).toBe(2)
    expect(result.stderr).toMatch(/--no-verify/u)
  })

  it('평범한 명령은 막지 않는다(exit 0, 출력 없음)', () => {
    const result = runHook({
      hook_event_name: 'PreToolUse',
      tool_input: { command: 'git commit -m "docs: 설명"' },
      tool_name: 'Bash',
    })

    expect(result.status).toBe(0)
    expect(`${result.stdout}${result.stderr}`).toBe('')
  })

  it('명령이 없는 입력은 막지 않는다', () => {
    expect(runHook({ hook_event_name: 'PreToolUse', tool_input: {}, tool_name: 'Bash' }).status).toBe(0) // prettier-ignore
  })
})
