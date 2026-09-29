// @vitest-environment node
//
// findHookBypass — 셸 명령이 git 훅(커밋·push 직전 검사)을 건너뛰는가. Claude Code 하네스
// (`.claude/hooks/block-git-hook-bypass.mjs`)가 Bash 명령을 실행하기 전에 묻는다.
//
// 막는 것(git 공식 문서 기준):
//   · `--no-verify` — `git-commit(1)` "Bypass the pre-commit and commit-msg hooks", `git-push(1)`
//     "With --no-verify, the hook is bypassed completely". git 은 긴 옵션의 모호하지 않은 앞부분도
//     받으므로(`--no-veri`) 그것도 막는다.
//   · `git commit -n` — `-n` 은 commit 에서 `--no-verify` 의 짧은 형태다(push 의 `-n` 은 `--dry-run`).
//   · `HUSKY=0` — husky 가 훅을 모두 끄는 환경 변수(husky `h` 스크립트 `[ "${HUSKY-}" = "0" ] && exit 0`).
//   · `core.hooksPath` 를 바꾸거나 지우기 — husky 는 이 설정으로 훅을 건다. 읽기는 허용한다.
//
// 허용하는 것: 커밋 메시지·heredoc 본문처럼 **데이터로 들어간 같은 글자**, `git push -n`.
import { describe, expect, it } from 'vitest'

import { findHookBypass } from '../hook-bypass.mjs'

describe('findHookBypass — git 훅을 건너뛰는 명령을 찾는다', () => {
  it.each([
    ['git commit --no-verify', 'git commit --no-verify -m "x"'],
    ['옵션 뒤의 --no-verify', 'git commit -m "x" --no-verify'],
    ['--no-verify 의 앞부분', 'git commit --no-veri -m x'],
    ['git commit -n', 'git commit -n -m x'],
    ['짧은 옵션 묶음 속 -n', 'git commit -anm x'],
    ['git push --no-verify', 'git push --no-verify origin main'],
    ['git merge --no-verify', 'git merge --no-verify side'],
    ['git 전역 옵션 뒤', 'git -C /repo -c user.name=x commit --no-verify -m x'],
    ['절대 경로 git', '/usr/bin/git commit -n -m x'],
    ['따옴표로 감싼 옵션', "git commit '--no-verify' -m x"],
    ['&& 뒤의 명령', 'git add -A && git commit --no-verify -m x'],
    ['sh -c 안의 명령', "sh -c 'git commit --no-verify -m x'"],
    ['bash -c 안의 명령', 'bash -c "git add -A; git commit -n -m x"'],
    ['HUSKY=0 앞 환경 변수', 'HUSKY=0 git commit -m x'],
    ['export HUSKY=0', 'export HUSKY=0'],
    ['env HUSKY=0', 'env HUSKY=0 git push'],
    ['따옴표 친 HUSKY=0', "HUSKY='0' git commit -m x"],
    ['-c core.hooksPath', 'git -c core.hooksPath=/dev/null commit -m x'],
    ['대소문자가 다른 설정 키', 'git -c core.HOOKSPATH=/tmp commit -m x'],
    ['core.hooksPath 설정 변경', 'git config core.hooksPath /tmp/hooks'],
    ['core.hooksPath 설정 삭제', 'git config --unset core.hooksPath'],
    ['환경 변수로 넣는 설정', 'GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0=/tmp git commit -m x'], // prettier-ignore
  ])('%s → 막는다', (_label, command) => {
    expect(findHookBypass(command)).toEqual(expect.any(String))
  })

  it.each([
    ['평범한 커밋', 'git commit -m "docs: 설명"'],
    ['-a 와 -m 묶음', 'git commit -am "x"'],
    ['메시지가 -n 으로 시작', 'git commit -m -n'],
    ['메시지 안의 같은 글자', 'git commit -m "docs: --no-verify 와 HUSKY=0 을 막는 하네스"'],
    [
      'heredoc 커밋 메시지 안의 같은 글자',
      "git commit -F - <<'EOF'\nchore: git commit --no-verify 와 core.hooksPath 설명\nHUSKY=0\nEOF",
    ],
    ['push dry-run', 'git push -n origin main'],
    ['core.hooksPath 읽기', 'git config --get core.hooksPath'],
    ['core.hooksPath 값만 묻기', 'git config core.hooksPath'],
    ['git 이 아닌 명령의 --no-verify', 'npm publish --no-verify'],
    ['grep 으로 찾기', 'grep -rn "no-verify" README.md'],
    ['HUSKY 가 0 이 아님', 'HUSKY=2 git commit -m x'],
    ['빈 명령', ''],
  ])('%s → 허용한다', (_label, command) => {
    expect(findHookBypass(command)).toBeNull()
  })
})
