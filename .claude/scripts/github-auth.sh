#!/usr/bin/env bash
# GitHub 원격 MCP 서버(api.githubcopilot.com/mcp/)용 headersHelper.
#
# stdout으로 {"Authorization":"Bearer <token>"}를 출력한다. 토큰은 gitignore된
# 프로젝트 공용 시크릿 폴더에 있으며 MCP config나 환경변수에는 절대 두지 않는다.
# Claude Code가 연결 시점(세션 시작 + 매 재연결)에 이 스크립트를 실행하므로,
# 토큰은 에이전트의 config 뷰와 env 덤프 밖에 머문다.
#
# 토큰 파일 (gitignore; 각 개발자가 별도 터미널에서 생성):
#   .secret/claude/github-token   (chmod 600)
set -uo pipefail

# 프로젝트 이식성을 위해 토큰 경로를 이 스크립트 기준 상대 경로로 해석한다.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." 2>/dev/null && pwd)"
TOKEN_FILE="${GITHUB_MCP_TOKEN_FILE:-${PROJECT_ROOT}/.secret/claude/github-token}"

token=""
if [[ -r "$TOKEN_FILE" ]]; then
  token="$(tr -d '[:space:]' < "$TOKEN_FILE")"
fi

if [[ -z "$token" ]]; then
  # 토큰이 아직 없음 -> 에러 대신 빈 헤더를 출력해 연결이 깔끔하게 실패(401)하게 한다.
  # 활성화하려면 TOKEN_FILE에 실제 토큰을 작성한다.
  printf '{}\n'
  exit 0
fi

printf '{"Authorization": "Bearer %s"}\n' "$token"
