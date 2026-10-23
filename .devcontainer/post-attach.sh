#!/usr/bin/env bash
# Runs on each container attach: apply permissions.json rules (host SSH sync +
# exec-bit fixes for scripts lost on Windows/drvfs remount), then version hints.

set +e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "$REPO_ROOT"

export HOST_SSH_MOUNT="${HOST_SSH_MOUNT:-/mnt/host-ssh}"

# -----------------------------------------------------------------------------
# permissions.json 규칙 엔진
#
# 형식: [{"src"?: "<dir>/*", "dst": "<dir>/*" | "<glob>" | "<path>", "auth": <mode>, "note"?: "..."}]
#
# - src 있음 -> src 디렉터리의 직계 자식(dotfile 포함, 소켓 제외)을 dst 디렉터리로 복사한 뒤
#               dst 디렉터리 자신 + 복사된 항목 전체를 auth 로 chmod. src/dst 는 반드시 "/*" 로
#               끝나야 한다 — 1단계(직계 자식) 복사만 지원, 재귀 복사는 스코프 밖.
# - src 없음 -> dst 를 glob 패턴(** 재귀 지원)으로 평가해 이미 존재하는 매칭 파일에 auth 를
#               chmod. 매칭이 없으면(아직 파일이 없을 수 있음) 조용히 건너뛴다.
#
# 규칙은 배열 순서대로 순차 실행되고, 겹치는 대상은 나중 규칙이 이긴다 — "디렉터리는 700,
# 그중 *.pub 만 644" 같은 세분화를 규칙 여러 개로 표현하는 방식. (알려진 제약: 복사 직후
# 일괄 chmod 는 파일/디렉터리를 구분하지 않으므로, src 하위에 서브디렉터리가 있는 규칙에서
# 뒤따르는 chmod-only 규칙이 그 서브디렉터리까지 파일과 동일하게 덮어쓸 수 있다. .ssh 처럼
# 서브디렉터리가 없는 평평한 구조를 전제로 한다.)
#
# 경로 문자열의 $VAR/${VAR} 는 envsubst 로 현재 환경변수 기준 확장한다. `~` 는 확장되지
# 않으므로 항상 $HOME 을 쓴다. 상대경로는 이 저장소 루트($REPO_ROOT) 기준으로 평가된다.
# -----------------------------------------------------------------------------

_permission_copy_rule() {
  local idx="$1" src="$2" dst="$3" auth="$4" note="$5"

  if [[ "$src" != */\* || "$dst" != */\* ]]; then
    echo "[post-attach] permissions rule #$idx: src/dst 는 '/*' 로 끝나야 함(1단계 복사 전용); 건너뜀"
    return 0
  fi
  local src_dir="${src%/*}" dst_dir="${dst%/*}"

  if [[ ! -d "$src_dir" ]]; then
    echo "[post-attach] permissions rule #$idx: src 없음 ($src_dir); 건너뜀"
    return 0
  fi
  if ! find "$src_dir" -mindepth 1 -maxdepth 1 -print -quit 2>/dev/null | grep -q .; then
    echo "[post-attach] permissions rule #$idx: src 비어 있음 ($src_dir); 건너뜀"
    return 0
  fi

  if ! mkdir -p "$dst_dir" 2>/dev/null; then
    echo "[post-attach] permissions rule #$idx: dst 디렉터리 생성 실패 ($dst_dir); 건너뜀"
    return 0
  fi

  local f base copied=0 copy_fail=0
  local -a copy_failed
  while IFS= read -r -d '' f; do
    base="$(basename "$f")"
    [[ -S "$f" ]] && continue
    if [[ -d "$f" ]]; then
      if rm -rf "${dst_dir:?}/${base}" 2>/dev/null && cp -a "$f" "$dst_dir/" 2>/dev/null; then
        copied=$((copied + 1))
      else
        copy_fail=$((copy_fail + 1))
        copy_failed+=("$base")
      fi
    elif [[ -f "$f" || -L "$f" ]]; then
      if cp -f "$f" "$dst_dir/${base}" 2>/dev/null; then
        copied=$((copied + 1))
      else
        copy_fail=$((copy_fail + 1))
        copy_failed+=("$base")
      fi
    fi
  done < <(find "$src_dir" -mindepth 1 -maxdepth 1 -print0 2>/dev/null)

  local dir_ok=1
  chmod "$auth" "$dst_dir" 2>/dev/null || dir_ok=0

  local entry chmod_ok=0 chmod_fail=0
  local -a failed
  while IFS= read -r -d '' entry; do
    if chmod "$auth" "$entry" 2>/dev/null; then
      chmod_ok=$((chmod_ok + 1))
    else
      chmod_fail=$((chmod_fail + 1))
      failed+=("$entry")
    fi
  done < <(find "$dst_dir" -mindepth 1 -maxdepth 1 -print0 2>/dev/null)

  echo "[post-attach] permissions rule #$idx: $src_dir -> $dst_dir 로 ${copied}개 항목 복사, chmod $auth 성공 ${chmod_ok}개${note:+ ($note)}"
  if [[ "$copy_fail" -gt 0 ]]; then
    echo "[post-attach] permissions rule #$idx: 경고 — 복사 실패 ${copy_fail}개: ${copy_failed[*]}"
  fi
  if [[ "$dir_ok" -eq 0 || "$chmod_fail" -gt 0 ]]; then
    echo "[post-attach] permissions rule #$idx: 경고 — chmod 실패(디렉터리 $([[ "$dir_ok" -eq 1 ]] && echo ok || echo FAIL), 항목 ${chmod_fail}개 실패) — 호스트 측 읽기전용 속성/ACL 확인 필요${failed[*]:+: ${failed[*]}}"
  fi
}

_permission_chmod_rule() {
  local idx="$1" dst="$2" auth="$3" note="$4"

  shopt -s globstar nullglob dotglob
  local raw=($dst)
  shopt -u globstar nullglob dotglob

  # nullglob 은 와일드카드가 포함된 패턴에만 적용된다 — dst 가 와일드카드 없는 리터럴
  # 경로(예: known_hosts)면 파일이 없어도 그 문자열 그대로 살아남으므로, 존재 여부로
  # 한 번 더 걸러야 "파일이 아직 없음"과 "존재하는데 chmod 거부됨"을 구분할 수 있다.
  local matches=()
  local m
  for m in "${raw[@]}"; do
    [[ -e "$m" ]] && matches+=("$m")
  done

  if [[ "${#matches[@]}" -eq 0 ]]; then
    echo "[post-attach] permissions rule #$idx: '$dst' 매칭 없음; 건너뜀"
    return 0
  fi

  local f ok=0 fail=0
  local -a failed
  for f in "${matches[@]}"; do
    if chmod "$auth" "$f" 2>/dev/null; then
      ok=$((ok + 1))
    else
      fail=$((fail + 1))
      failed+=("$f")
    fi
  done

  echo "[post-attach] permissions rule #$idx: '$dst' 매칭 ${#matches[@]}개 중 ${ok}개 chmod $auth 성공${note:+ ($note)}"
  if [[ "$fail" -gt 0 ]]; then
    echo "[post-attach] permissions rule #$idx: 경고 — ${fail}개 chmod 실패 — 호스트 측 읽기전용 속성/ACL 확인 필요: ${failed[*]}"
  fi
}

apply_permission_rules() {
  local config="$1"
  if [[ ! -r "$config" ]]; then
    echo "[post-attach] permissions 설정 없음 ($config); 권한 규칙 건너뜀"
    return 0
  fi
  if ! command -v jq >/dev/null 2>&1; then
    echo "[post-attach] jq 없음; 권한 규칙 건너뜀"
    return 0
  fi
  if ! command -v envsubst >/dev/null 2>&1; then
    echo "[post-attach] envsubst 없음; 권한 규칙 건너뜀"
    return 0
  fi

  local n
  n=$(jq 'length' "$config" 2>/dev/null) || {
    echo "[post-attach] $config 파싱 실패; 권한 규칙 건너뜀"
    return 0
  }

  local i rule src dst auth note
  for ((i = 0; i < n; i++)); do
    rule=$(jq -c ".[$i]" "$config")
    src=$(jq -r '.src // empty' <<<"$rule" | envsubst)
    dst=$(jq -r '.dst // empty' <<<"$rule" | envsubst)
    auth=$(jq -r '.auth // empty' <<<"$rule")
    note=$(jq -r '.note // empty' <<<"$rule")

    if [[ -z "$dst" || -z "$auth" ]]; then
      echo "[post-attach] permissions rule #$i: dst/auth 누락; 건너뜀"
      continue
    fi

    if [[ -n "$src" ]]; then
      _permission_copy_rule "$i" "$src" "$dst" "$auth" "$note"
    else
      _permission_chmod_rule "$i" "$dst" "$auth" "$note"
    fi
  done
}

apply_permission_rules "${SCRIPT_DIR}/conf/permissions.json"

echo "=== npm outdated (-g, depth 0) ==="
npm outdated -g --depth=0 2>&1
echo
echo "=== tool versions (manual upgrade if newer exists) ==="
if command -v claude >/dev/null 2>&1; then
  claude --version 2>&1
else
  echo "claude: not on PATH"
fi
if command -v codex >/dev/null 2>&1; then
  codex --version 2>&1
else
  echo "codex: not on PATH"
fi
node -v 2>&1
npm -v 2>&1

exit 0
