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
    ['범위 옵션을 붙인 설정 변경', 'git config --local core.hooksPath /tmp/hooks'],
    ['범위 옵션을 붙인 설정 삭제', 'git config --global --unset core.hooksPath'],
    ['줄 이어쓰기 뒤의 옵션', 'git commit -m x \\\n--no-verify'],
    ['줄 이어쓰기로 나눈 git 명령', 'git \\\n  commit -n -m x'],
    ['줄 이어쓰기 뒤의 HUSKY=0', '\\\nHUSKY=0 git commit -m x'],
    ['리다이렉션 뒤의 옵션', 'git commit 2>&1 --no-verify -m x'],
    ['중괄호가 든 인자 뒤의 옵션', 'git push origin HEAD@{0}:main --no-verify'],
    ['명령 치환 뒤의 옵션', 'git commit -m $(cat msg.txt) --no-verify'],
    ['프로세스 치환 뒤의 옵션', 'git commit -F <(printf x) --no-verify'],
    ['백틱 뒤의 옵션', 'git commit -m `cat m` -n'],
    ['명령 치환 안의 명령', 'echo "$(git commit --no-verify -m x)"'],
    ['값을 붙여 쓴 -m 뒤의 -n', 'git commit -mtest -n'],
    ['here-string 다음 줄', 'grep x <<< hello\ngit commit --no-verify -m x'],
    ['산술 시프트 다음 줄', 'echo $((1<<2))\ngit commit --no-verify -m x'],
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
    ['메시지 안의 core.hooksPath', 'git commit -m "fix: core.hooksPath 처리"'],
    ['메시지 전체가 HUSKY=0', 'git commit -m "HUSKY=0"'],
    ['로그 검색', 'git log --grep=core.hooksPath'],
    ['저장소 검색', 'git grep -n core.hooksPath'],
    ['변경 검색', 'git log -S core.hooksPath --oneline'],
    ['출처와 함께 설정 읽기', 'git config --show-origin core.hooksPath'],
    ['범위를 붙여 설정 읽기', 'git config --local core.hooksPath'],
    ['grep 으로 HUSKY=0 찾기', 'grep -rn HUSKY=0 README.md'],
    ['rg 로 HUSKY=0 찾기', "rg 'HUSKY=0' ."],
    ['백슬래시 구분자 heredoc 본문', 'cat <<\\EOF\ngit commit --no-verify -m x\nEOF'],
    ['빈 명령', ''],
  ])('%s → 허용한다', (_label, command) => {
    expect(findHookBypass(command)).toBeNull()
  })
})

describe('findHookBypass — 이상한 입력에도 죽지 않는다', () => {
  it.each([
    ['닫히지 않은 작은따옴표', "git commit -m 'x"],
    ['닫히지 않은 큰따옴표', 'git commit -m "x'],
    ['닫히지 않은 명령 치환', 'echo $(git status'],
    ['끝이 백슬래시', 'git commit -m x \\'],
  ])('%s', (_label, command) => {
    expect(() => findHookBypass(command)).not.toThrow()
  })
})
