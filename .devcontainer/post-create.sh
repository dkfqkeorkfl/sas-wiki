#!/usr/bin/env bash
# Dev container post-create: tool install + ECC + Claude/Codex plugins + RTK.
# JSON merges (hooks, MCP) live in Node — see .devcontainer/post-create/*.mjs
set -euo pipefail

# -----------------------------------------------------------------------------
# Paths (this file lives in .devcontainer/)
# -----------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
POST_CREATE_JS_DIR="${SCRIPT_DIR}/post-create"

# -----------------------------------------------------------------------------
# Env (mirror docker-compose / .env; defaults match previous script)
# -----------------------------------------------------------------------------
# CLAUDE_MEM_WORKER_HOST, CLAUDE_MEM_DATA_DIR, HOST_SSH_MOUNT — attach / worker; listed for grep parity
# ECC_INSTALL_LANGUAGES     (required) e.g. typescript
# ECC_SRC_DIR               default /mnt/ecc (docker-compose bind-mount target; host: ECC_HOST_DIR or ../../ecc)
# ECC_CODEX_PROFILE         default developer
# ECC_DEVCONTAINER_MCP_SERVERS   comma allowlist (empty = ecc-mcp.mjs no-op; see docker-compose comments)

# -----------------------------------------------------------------------------
# Node helpers (hooks / MCP merge)
# -----------------------------------------------------------------------------
run_merge_ecc_hooks() {
  node "${POST_CREATE_JS_DIR}/ecc-hooks.mjs"
}

run_merge_ecc_mcp() {
  node "${POST_CREATE_JS_DIR}/ecc-mcp.mjs"
}

# -----------------------------------------------------------------------------
# 1) Versions
# -----------------------------------------------------------------------------
echo "[post-create] versions"
node -v
python3 --version
claude --version

# -----------------------------------------------------------------------------
# 2) Git (bind-mounted workspace)
# -----------------------------------------------------------------------------
if ! git config --global --get-all safe.directory 2>/dev/null | grep -Fxq '/workspace'; then
  git config --global --add safe.directory /workspace
  echo "[post-create] git: added safe.directory /workspace"
else
  echo "[post-create] git: safe.directory /workspace already set"
fi

# -----------------------------------------------------------------------------
# 5) Codex CLI
# -----------------------------------------------------------------------------
echo "[post-create] Codex CLI (OpenAI codex-plugin-cc delegates to local \`codex\`; Node comes from devcontainer.json feature)"
npm install -g @openai/codex

# -----------------------------------------------------------------------------
# 6) Serena (LSP 기반 심볼 탐색·편집 MCP) — 초기화 + 클라이언트 등록
# -----------------------------------------------------------------------------
# 바이너리 설치는 dockerfile(uv tool install -p 3.13 serena-agent)에서 완료됨.
# 여기서는 /workspace bind-mount·~/.claude·~/.codex 가 준비된 시점에 프로젝트 등록만
# 수행한다. 각 클라이언트는 serena 의 공식 네이티브 등록 경로를 쓴다:
# claude-code → ~/.claude.json (user scope), codex → ~/.codex/config.toml (global).
echo "[post-create] serena init"
serena init

echo "[post-create] serena setup claude-code"
if claude mcp get serena >/dev/null 2>&1; then
  # `serena setup claude-code` 는 재실행 시 "already exists" 로 exit 1 하여
  # set -euo pipefail 아래서 스크립트 전체를 중단시킨다 — 존재 여부를 먼저 확인한다.
  echo "[post-create] serena: claude-code 에 이미 등록됨, 건너뜀"
else
  serena setup claude-code
fi

echo "[post-create] serena setup codex"
if codex mcp get serena >/dev/null 2>&1; then
  # `serena setup codex` 는 재실행 시 "already exists" 로 exit 1 하여
  # set -euo pipefail 아래서 스크립트 전체를 중단시킨다 — 존재 여부를 먼저 확인한다.
  echo "[post-create] serena: codex 에 이미 등록됨, 건너뜀"
else
  serena setup codex
fi

# -----------------------------------------------------------------------------
# 7) ECC 소스 검증 (호스트 bind-mount)
# -----------------------------------------------------------------------------
# 이전에는 컨테이너 내부에서 git clone 했으나, docker-compose 가 호스트 `../ecc`
# (env: ECC_HOST_DIR 로 조정) 를 /mnt/ecc 로 bind-mount 한다. 본 단계는 마운트가
# 정상이고 install.sh · rules/common 이 존재하는지만 검증한다.
ECC_SRC_DIR="${ECC_SRC_DIR:-/mnt/ecc}"
echo "[post-create] ECC source (bind-mount): ${ECC_SRC_DIR}"

if [[ ! -d "${ECC_SRC_DIR}" ]]; then
  echo "[post-create] ERROR: ECC source directory missing: ${ECC_SRC_DIR}" >&2
  echo "  호스트의 ECC 디렉토리가 비어 있거나 bind-mount 가 실패했다." >&2
  echo "  호스트에서 ECC 를 클론한 뒤 ECC_HOST_DIR 또는 docker-compose 의 마운트 경로를 확인하라." >&2
  echo "  upstream: https://github.com/affaan-m/everything-claude-code.git" >&2
  exit 1
fi

ECC_ROOT="${ECC_SRC_DIR}"
if [[ ! -f "${ECC_ROOT}/install.sh" ]]; then
  echo "[post-create] ERROR: install.sh missing under ECC_ROOT: ${ECC_ROOT}" >&2
  exit 1
fi
if [[ ! -d "${ECC_ROOT}/rules/common" ]]; then
  echo "[post-create] ERROR: rules/common missing under ECC_ROOT: ${ECC_ROOT}/rules" >&2
  exit 1
fi

# -----------------------------------------------------------------------------
# 8) ECC → Claude (~/.claude)
# -----------------------------------------------------------------------------
RAW_LANGUAGES="${ECC_INSTALL_LANGUAGES-}"
if [[ -z "${RAW_LANGUAGES// }" ]]; then
  echo "[post-create] ERROR: ECC_INSTALL_LANGUAGES is unset or whitespace-only." >&2
  echo "  Set it in .devcontainer/docker-compose.yml (environment), or pass through .devcontainer/.env for Compose." >&2
  echo "  Example: ECC_INSTALL_LANGUAGES=typescript,web" >&2
  echo "  Names: everything-claude-code rules/README.md (./install.sh <lang> …)." >&2
  exit 1
fi

NORMALIZED="${RAW_LANGUAGES//,/ }"
read -r -a LANG_ARGS <<< "${NORMALIZED}"
if [[ ${#LANG_ARGS[@]} -eq 0 ]]; then
  echo "[post-create] ERROR: ECC_INSTALL_LANGUAGES parsed to zero language tokens." >&2
  exit 1
fi

echo "[post-create] ECC install.sh (legacy-compat language args) -> ${LANG_ARGS[*]}"
bash "${ECC_ROOT}/install.sh" --target claude --enable-hooks "${LANG_ARGS[@]}"

# -----------------------------------------------------------------------------
# 9) Merge ECC hooks + MCP into Claude config (Node)
# -----------------------------------------------------------------------------
# echo "[post-create] merge ECC hooks → ~/.claude/settings.json (Node)"
# run_merge_ecc_hooks

echo "[post-create] merge ECC MCP catalog → ~/.claude.json (Node)"
run_merge_ecc_mcp

# -----------------------------------------------------------------------------
# 10) Claude Code plugins
# -----------------------------------------------------------------------------
echo "[post-create] installing Claude Code plugins (claude-mem)"
claude plugin marketplace add thedotmack/claude-mem
claude plugin install claude-mem

# cc-suite 등 xiaolai 계열 플러그인은 /sas-setup-project 흐름에서 설치.
claude plugin marketplace add xiaolai/claude-plugin-marketplace

# -----------------------------------------------------------------------------
# 11) ECC → Codex (~/.codex)
# -----------------------------------------------------------------------------
ECC_CODEX_PROFILE="${ECC_CODEX_PROFILE:-developer}"
echo "[post-create] ECC install.sh --target codex --profile ${ECC_CODEX_PROFILE} (reuse ECC_ROOT)"
bash "${ECC_ROOT}/install.sh" --target codex --enable-hooks --profile "${ECC_CODEX_PROFILE}"

# -----------------------------------------------------------------------------
# 12) RTK
# -----------------------------------------------------------------------------
echo "[post-create] installing rtk-ai/rtk (token-optimized shell output)"
if command -v rtk >/dev/null 2>&1; then
  echo "[post-create] rtk already installed: $(rtk --version)"
else
  curl -fsSL https://raw.githubusercontent.com/rtk-ai/rtk/master/install.sh | sh
fi

if ! command -v rtk >/dev/null 2>&1; then
  echo "[post-create] ERROR: rtk not on PATH after install (expected ~/.local/bin). Check network/GitHub or upstream release assets." >&2
  exit 1
fi

echo "[post-create] initializing RTK for Claude Code hooks (global, auto-patch)"
rtk init -g --auto-patch
rtk init --show
rtk gain

# -----------------------------------------------------------------------------
# 13) pnpm via Corepack + store isolation
# -----------------------------------------------------------------------------
# host 가 9p / drvfs / SMB 마운트로 /workspace 를 공유하는 경우 host 의 pnpm-store 와
# container 의 pnpm-store 가 같은 파일을 쓰면 native 바이너리 호환성 문제가 발생한다.
# storeDir 을 docker-compose 가 마운트한 node_modules named volume(ext4) 안으로 향하게 하면
# pnpm hardlink (same filesystem 요구) 충족 + host store 와 격리된다.
#
# pnpm 은 node feature 가 아니라 Corepack 이 단독 관리한다(devcontainer.json pnpmVersion: none).
# `corepack enable pnpm` 로 pnpm shim 을 깔고, 실제 버전은 프로젝트 package.json 의
# packageManager(예: pnpm@11.2.2) 가 정한다(corepack 이 그 버전을 받아 실행). 이렇게 하면
# npm 글로벌 pnpm + corepack 혼용 안티패턴을 피하고, config 를 쓰는 pnpm 과 읽는 pnpm 이
# 정확히 같은 버전이 된다.
#
# pnpm v11 부터 .npmrc 는 auth/registry 전용이고 store-dir 등은 글로벌
# ~/.config/pnpm/config.yaml 에서만 읽힌다. `pnpm config set --global` 은 실행 pnpm 버전
# 기준의 올바른 글로벌 config 위치를 자동 선택하므로 포맷/경로 변경에 견고하다.
# 비 pnpm 프로젝트에선 이 설정이 그냥 미사용 상태로 무해.
# 이 devcontainer 템플릿은 pnpm/npm 프로젝트 모두에 재사용될 수 있다. corepack strict 모드는
# package.json 의 packageManager 가 다른 매니저(예: npm@x)를 pin 하면 `corepack pnpm` 호출을
# 거부한다(exit 1) → set -euo pipefail 아래에서 post-create 전체가 중단된다(실측 + corepack 문서 확인).
# 따라서 프로젝트가 실제로 pnpm 을 쓸 때만 corepack/pnpm 설정을 적용하고, 그 외엔 건너뛴다.
PNPM_STORE_DIR="/workspace/node_modules/.pnpm-store"
project_uses_pnpm() {
  [[ -f /workspace/pnpm-lock.yaml || -f /workspace/pnpm-workspace.yaml ]] && return 0
  [[ -f /workspace/package.json ]] \
    && node -e 'process.exit(String((require("/workspace/package.json").packageManager)||"").startsWith("pnpm")?0:1)' 2>/dev/null \
    && return 0
  return 1
}

if project_uses_pnpm; then
  echo "[post-create] pnpm 감지됨 — corepack enable pnpm (pnpmVersion: none — corepack 단독 관리)"
  corepack enable pnpm

  # pnpm v11+ 의 `pnpm config set --global` 은 PNPM_HOME 이 PATH 에 있어야 정상 종료한다.
  # 이전엔 `pnpm setup` 으로 부트스트랩을 시도했으나, post-create 는 비대화형 + SHELL 미설정
  # 환경이라 `pnpm setup` 이 "Set the SHELL environment variable" 로 exit 1 한다. `|| true` 로
  # 1차 실패는 묵살되지만 후속 `pnpm config set` 이 동일 분기를 다시 트리거하며 죽고
  # set -euo pipefail 로 post-create 전체가 중단된다.
  # 해결: setup 이 하는 일(PNPM_HOME 디렉토리 생성 + PATH 등록 + SHELL 인지)을 직접 수행하여
  # setup 호출 자체를 회피한다.
  #
  # v11 breaking: 글로벌 바이너리 경로가 ${PNPM_HOME} 에서 ${PNPM_HOME}/bin 으로 변경됨
  # (pnpm.io/global-packages · pnpm.io/settings globalBinDir). PATH 에는 두 경로 모두 prepend
  # 해서 v11+ shim/CLI 가 "PNPM_HOME 이 PATH 에 없다" 분기를 타지 않게 한다. Corepack 경로
  # (실제 pnpm 실행 파일은 corepack shim) 와 직교하므로 충돌하지 않는다.
  # ref: https://pnpm.io/installation (수동 PNPM_HOME 절차)
  export PNPM_HOME="${PNPM_HOME:-${HOME}/.local/share/pnpm}"
  for p in "${PNPM_HOME}/bin" "${PNPM_HOME}"; do
    case ":${PATH}:" in
      *":${p}:"*) ;;
      *) export PATH="${p}:${PATH}" ;;
    esac
  done
  export SHELL="${SHELL:-/bin/bash}"
  mkdir -p "${PNPM_HOME}/bin"
  echo "[post-create] pnpm: PNPM_HOME=${PNPM_HOME} (bin·root 모두 PATH 등록), SHELL=${SHELL}"

  # 새 터미널 세션에서도 PNPM_HOME 이 PATH 에 있도록 ~/.bashrc 에 멱등 등록.
  # pnpm setup 이 추후 실행되어도 동일 블록을 다시 쓰지 않도록 sentinel 로 가드한다.
  BASHRC="${HOME}/.bashrc"
  if [[ -f "${BASHRC}" ]] && ! grep -Fq '# pnpm (post-create bootstrap)' "${BASHRC}"; then
    {
      echo ''
      echo '# pnpm (post-create bootstrap)'
      echo 'export PNPM_HOME="${HOME}/.local/share/pnpm"'
      echo 'for p in "${PNPM_HOME}/bin" "${PNPM_HOME}"; do'
      echo '  case ":${PATH}:" in'
      echo '    *":${p}:"*) ;;'
      echo '    *) export PATH="${p}:${PATH}" ;;'
      echo '  esac'
      echo 'done'
      echo '# pnpm end'
    } >> "${BASHRC}"
    echo "[post-create] pnpm: appended PNPM_HOME block to ${BASHRC}"
  fi

  echo "[post-create] pnpm: set global store-dir -> ${PNPM_STORE_DIR}"
  # /workspace 에서 실행해야 corepack shim 이 프로젝트 packageManager 버전으로 pnpm 을 골라
  # config 를 기록한다(필드가 보여야 정확 버전 선택). 비대화형 다운로드 프롬프트는 비활성화.
  ( cd /workspace && COREPACK_ENABLE_DOWNLOAD_PROMPT=0 pnpm config set store-dir "${PNPM_STORE_DIR}" --global )
else
  echo "[post-create] pnpm 미감지(pnpm-lock·pnpm-workspace·packageManager:pnpm 없음) — corepack/pnpm 설정 건너뜀"
fi

# -----------------------------------------------------------------------------
# 14) node_modules named volume 소유권 보정
# -----------------------------------------------------------------------------
# Windows 호스트 + Docker named volume 조합에서 /workspace/node_modules 가 root:root 755 로
# 마운트되어 vscode 유저가 쓰기 불가한 상태가 된다. pnpm install / store hardlink 실패 방지용.
if [[ -d /workspace/node_modules ]]; then
  echo "[post-create] chown /workspace/node_modules -> vscode:vscode (named volume root-owned 보정)"
  sudo chown -R vscode:vscode /workspace/node_modules
else
  echo "[post-create] /workspace/node_modules 미존재 — chown 생략"
fi

echo "[post-create] done"
