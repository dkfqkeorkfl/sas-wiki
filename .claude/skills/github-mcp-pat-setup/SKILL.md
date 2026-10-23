---
name: github-mcp-pat-setup
description: 'GitHub 공식 원격 MCP 서버를 프로젝트에 연결하되 PAT(토큰)를 LLM 컨텍스트에서 완전히 격리한다. 사용자가 "GitHub MCP 연결", "git mcp 토큰 설정", "github mcp가 연결이 안 된다", "다른 프로젝트처럼 git 토큰 설정", "프로젝트별 MCP 시크릿 보관"을 요청하거나, "headersHelper + gitignore된 .secret/ + 읽기 가드" 패턴을 새 프로젝트에 재현하려 할 때 호출한다. "connect github mcp here" 처럼 짧게 말해도 마찬가지다. bearer 토큰 인증이 필요한 다른 원격 MCP 서버를 컨텍스트 노출 없이 연결할 때도 사용한다. 설치 시 활성화할 toolset(예: actions·dependabot·labels·projects)을 골라 X-MCP-Toolsets로 켜는 작업도 이 스킬로 한다.'
allowed-tools: Read Write Edit Bash
---

# github-mcp-pat-setup

**GitHub 공식 원격 MCP 서버**를 프로젝트에 연결하되, PAT(Personal Access Token)가
연결을 인증하면서도 **에이전트에게는 절대 보이지 않게** 한다 — MCP config, 환경변수,
채팅 기록 그 어디에도 남기지 않는다. 토큰은 gitignore된 시크릿 파일에만 두고, 연결
시점에 `headersHelper` 스크립트가 그 파일을 읽는다. 이 스크립트는 에이전트의 Bash
도구가 아니라 **Claude Code가 직접** 실행하므로 토큰이 컨텍스트로 유입되지 않는다.
읽기 가드가 에이전트의 토큰 접근을 막는다 — 프로젝트에 경로 보호 하네스가 이미
있으면 그 항목 1개로, 없으면 가드 2개(구버전)로(「4. 보호 가드」 참조).

이 스킬의 존재 이유는 아래의 **격리 불변식**이다. 어떤 단계가 토큰을 노출시킨다면 그
단계가 잘못된 것이다 — 우회하지 말고 멈춰서 다시 생각하라.

## 보안 불변식 (타협 불가)

1. **토큰과 헬퍼를 읽지 마라.** 토큰 파일(`.secret/...`)이나 `github-auth.sh`를
   `cat`/`Read`/`grep`/`head` 하지 마라. 둘 중 하나라도 읽으면 토큰이 에이전트
   컨텍스트로 들어와 설정 전체가 무의미해진다. 설치할 가드들이 이를 의도적으로
   차단한다.
2. **토큰은 사용자가, 별도 터미널에서 작성한다.** Claude의 `!` 프리픽스(기록에 남음)나
   채팅 붙여넣기로 받지 마라. 너는 **빈 파일** 생성과 `chmod`만 한다.
3. **토큰은 커밋되는 config나 환경변수에 두지 마라.** `.mcp.json`·`settings.json`·
   `.bashrc` 어디에도 두지 않는다. 오직 gitignore된 `.secret/` 파일에만.

## 배경 사실 (잘못된 길로 빠지지 않도록)

- **공식 원격** 엔드포인트 `https://api.githubcopilot.com/mcp/`(`type: http`)를 쓴다.
  구버전 npm 패키지 `@modelcontextprotocol/server-github`는 **deprecated/archived**이므로
  쓰지 마라.
- GitHub OAuth에는 **Dynamic Client Registration(RFC 7591)** 메타데이터가 없어 Claude
  Code가 자동 OAuth를 할 수 없다(`/mcp`에 "Authenticate" 항목이 안 뜨는 이유). 그래서
  인증은 OAuth가 아니라 **headersHelper가 주입하는 PAT**로 한다.
- `headersHelper`는 MCP 서버 config 필드다. Claude Code가 연결 시점(세션 시작 + 매
  재연결)에 그 명령을 실행하고, stdout으로 헤더 key/value의 JSON 객체를 받아 요청
  헤더에 병합한다. 에이전트의 Bash 도구가 아니라 Claude Code가 실행하므로 토큰이
  에이전트 시야 밖에 머문다.
- **fine-grained PAT**로 동작한다. 필요한 권한은 **켠 toolset에 따라 다르다** — 기본
  운영은 Metadata(자동)·Contents·Pull requests·Issues, 거기에 toolset을 더하면 그에 맞는
  권한이 추가로 필요하다(예: actions→Actions, dependabot→Dependabot alerts). 전체 매핑은
  `references/toolsets.md`. 참고로 **Checks(check-runs)는 fine-grained PAT으로 불가**하니
  (App/classic 전용) CI 상태는 `actions`(Actions:read)로 워크플로 run을 읽는다.
- **toolset 선택형이다.** 원격 MCP는 기능을 toolset 단위로 노출하고 기본은 5개뿐이다
  (`context, repos, issues, pull_requests, users`) — actions·dependabot·labels·projects 등은
  꺼져 있다. 설치 시 `X-MCP-Toolsets` 헤더로 켜며, 그 헤더를 정적 `headers`에 두면
  `headersHelper`(토큰)와 공존·병합되어 시크릿 헬퍼를 건드리지 않는다. 표·메커니즘은
  「툴셋 선택」 단계와 `references/toolsets.md` 참조.

## 아키텍처

```
.mcp.json (커밋) ── github http 서버 ── headersHelper ─┐
                                                        ▼
.claude/scripts/github-auth.sh (커밋) ── 읽음 ──► .secret/claude/github-token
                                                    (gitignore, chmod 600,
                                                     사용자가 작성, 절대 안 읽음)
가드 (에이전트의 시크릿 읽기 차단, 하네스 평가로 결정 — 「4. 보호 가드」 참조):
  • 기존 경로 보호 하네스 있음 → 그 하네스 설정에 항목 추가                (커밋)
                                [예: 이 템플릿의 protect-paths-hook.mjs + protected-paths.json]
  • 하네스 없음(fallback)      → .claude/settings.json permissions.deny   (커밋)
                                + .claude/hookify.block-gh-mcp-secret-read.local.md (gitignore)
```

## 전제조건

- 사용자가 대상 레포 접근 권한을 가진 GitHub fine-grained PAT를 보유(또는 곧 발급).
  권한은 켤 toolset에 맞춰 정한다(「툴셋 선택」·`references/toolsets.md`). 너는 토큰을
  볼 필요가 없다.
- **보호 하네스 사전 확인**: `./.secret/**`의 Read/Write와 `github-auth.sh`의 bash 실행을
  이미 막는 PreToolUse 하네스가 있는지 확인한다 — 구현 방식(스크립트명·설정 스키마)은
  프로젝트마다 다를 수 있으므로 특정 파일명을 하드코딩해 전제하지 않는다.
  `<ROOT>/.claude/settings.json`의 `hooks.PreToolUse` 등록을 보고, 경로 기반 차단 훅이
  있으면 그 하네스를 확장한다(4-A). 없으면 4-B(fallback)로 가며, 이때 **hookify
  플러그인**(`bash` 이벤트 가드 제공)이 필요하다 — 없다면 4-B의 hookify 가드를
  `settings.json`의 동등한 `PreToolUse` Bash 훅으로 대체한다(트러블슈팅 참조). 원시 훅
  추가 전 사용자에게 확인받아라.
- devcontainer 주의: 프로젝트가 항상 같은 경로(예: `/workspace`)에 마운트되는
  devcontainer면 절대 경로 `headersHelper`가 모두에게 안정적이다. 팀원이 서로 다른 절대
  경로로 체크아웃하면 아래 "경로 이식성" 참조.

## 절차

먼저 두 가지를 확정한다 — 프로젝트 루트 `<ROOT>`(레포 최상단에서 `pwd`)와 활성화할 **툴셋 목록 `<TOOLSETS>`**(아래 「툴셋 선택」).

> **순서가 중요하다.** 4단계(가드)는 **맨 마지막**에 생성/추가하라 — 어떤 구현이든
> `.secret/`와 `github-auth.sh`에 매칭되므로, 앞선 `chmod`/`claude mcp` 명령을 실행하는
> 동안 가드가 켜져 있으면 너 자신의 셋업이 차단된다. 가드가 이미 있는 프로젝트에서
> *재실행*할 때는 먼저 비활성화하고(hookify는 `enabled: false`, 경로 보호 하네스는 그
> 설정에서 해당 항목을 임시로 제거), 작업 후 그대로 되돌려라.

> **재실행 안전(멱등).** 모든 단계는 이미 있으면 건너뛴다. 특히 **토큰 파일은 절대
> 덮어쓰지 않는다**(사용자가 써둔 토큰 보존). MCP 서버는 같은 이름이 있으면 `add`가
> no-op이고(중복 등록 안 됨), **설정을 바꿀 땐** `remove` 후 재등록한다(3단계).

### 툴셋 선택 (설치 시작 시 사용자와)

원격 MCP는 기능을 **toolset 단위**로 켠다. 기본은 5개(`context, repos, issues,
pull_requests, users`)뿐이고 **actions·dependabot 등은 꺼져 있다.** 설치를 시작할 때 아래
표를 사용자에게 제시하고 무엇을 켤지 고르게 한다. 전체 19개·상세 권한·주의(유료/빈손
케이스 포함)는 `references/toolsets.md`를 읽어 함께 안내한다. ⚠️ 권한·지원여부·gap 값은
**스냅샷**이라 시간에 따라 바뀌므로(GitHub가 gap을 점진 해소), `references/toolsets.md`에
명시된 출처로 **제시 전 재검증**하라 — 아래 인라인 표도 동일한 스냅샷이다.

| toolset                                                                                                                     | 기능                    | 기본 | 필요 FGPAT 권한                          |
| --------------------------------------------------------------------------------------------------------------------------- | ----------------------- | :--: | ---------------------------------------- |
| `context`·`repos`·`issues`·`pull_requests`·`users`                                                                          | 기본 운영(파일·이슈·PR) |  ✅  | Contents·Issues·Pull requests            |
| `actions`                                                                                                                   | 워크플로/CI run·log     |  ❌  | Actions                                  |
| `dependabot`                                                                                                                | 취약점(의존성) 알림     |  ❌  | Dependabot alerts                        |
| `labels`                                                                                                                    | 라벨                    |  ❌  | Issues                                   |
| `projects`                                                                                                                  | Projects 보드           |  ❌  | Projects (보드 있어야 실효)              |
| `code_security`                                                                                                             | 코드 스캐닝             |  ❌  | Code scanning alerts (private=유료 GHAS) |
| 그 외 (`secret_protection`·`security_advisories`·`orgs`·`git`·`gists`·`notifications`·`discussions`·`stargazers`·`copilot`) | 보안·조직·기타          |  ❌  | `references/toolsets.md`                 |

선택 결과로 **콤마 구분 `<TOOLSETS>`**를 만든다 — 헤더는 기본값을 **교체**하므로 기본
5개를 포함해 **원하는 전체**를 적는다. 예:
`context,repos,issues,pull_requests,users,actions,dependabot,labels`. 각 toolset이 요구하는
FGPAT 권한도 사용자에게 알려 토큰 작성(6단계) 시 함께 넣게 한다(최소권한 — 켠 것만).

> "기본만" → `<TOOLSETS>`를 비우고 3단계에서 `headers`를 생략(기본 프로파일). "전부"
> → 헤더 대신 URL `…/mcp/x/all`(헤더는 `all` 미지원).

### 1. headersHelper 스크립트 (커밋)

`<ROOT>/.claude/scripts/github-auth.sh`를 **Write 도구로**(bash로 파일명을 참조하지
않도록) 생성한 뒤 `chmod 755` 한다:

```bash
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
```

이 스크립트는 토큰 경로를 자기 기준으로 해석하므로 다른 프로젝트로 복사해도 수정이
필요 없다.

### 2. 시크릿 파일 (gitignore, 빈 파일 — 사용자가 나중에 채움)

```bash
mkdir -p <ROOT>/.secret/claude
# 이미 있으면 손대지 않는다 — 사용자가 써둔 토큰을 보존(멱등 재실행).
[ -e <ROOT>/.secret/claude/github-token ] || : > <ROOT>/.secret/claude/github-token
chmod 600 <ROOT>/.secret/claude/github-token
```

**빈 파일**로 만든다(이미 있으면 보존 — 재실행해도 토큰이 지워지지 않는다). 토큰은 절대 네가 쓰지 않는다. (빈 파일 → 헬퍼가 `{}` 출력 →
사용자가 채우기 전까지 깔끔한 401.)

### 3. `.mcp.json`에 MCP 서버 등록 (커밋)

기존 `.mcp.json`의 다른 서버가 보존되도록 CLI를 쓴다(JSON을 손으로 편집하지 마라).
「툴셋 선택」의 `<TOOLSETS>`를 `X-MCP-Toolsets` 정적 헤더로 넣는다:

```bash
claude mcp add-json github '{"type":"http","url":"https://api.githubcopilot.com/mcp/","headers":{"X-MCP-Toolsets":"<TOOLSETS>"},"headersHelper":"<ROOT>/.claude/scripts/github-auth.sh"}' --scope project
```

- `headers`(정적 `X-MCP-Toolsets`)와 `headersHelper`(동적 Authorization)는 Claude Code에서
  **공존·병합**된다(같은 키는 헬퍼 우선). toolset을 바꾸려고 시크릿 헬퍼를 건드릴 필요가 없다.
- `headersHelper`에는 **절대 경로** `<ROOT>`를 쓴다("경로 이식성" 참조).
- `<TOOLSETS>`를 안 정했으면 `"headers":{…}` 블록을 빼서 기본 프로파일로 연결한다. 전부
  켜려면 `url`을 `https://api.githubcopilot.com/mcp/x/all`로 한다(헤더 `all` 미지원).
- **재실행/갱신 시 먼저 상태 확인(멱등 결정):** `claude mcp get github`로 현 등록을 본다 —
  없으면 add, 있는데 toolset 등을 바꿔야 하면 `claude mcp remove github --scope project` 후
  add, 동일하면 그대로 둔다.
- `claude mcp add-json`는 같은 이름의 서버가 있으면 **추가하지 않고 no-op**이다(중복 등록
  안 됨 — 재실행 안전). ⚠️ 그래서 **설정을 바꾸려면**(toolset 변경 등)에는 위처럼 먼저
  `remove` 해야 한다. 그냥 다시 `add` 하면 옛 설정이 그대로 남는다.
- 변경 후 **재연결** 해야 toolset이 적용된다(검증 참조).

### 4. 보호 가드 (커밋 — 하네스 평가 후 결정)

먼저 하네스를 평가한다: **`./.secret/**`의 Read/Write와 `github-auth.sh`의 bash 실행을
이미 막는 기존 PreToolUse 하네스가 있는가?** `<ROOT>/.claude/settings.json`의
`hooks.PreToolUse` 등록을 확인하고, 등록된 훅이 경로 기반으로 Read/Write/Bash를
차단하는 구조인지 본다(예: 이 devcontainer 템플릿처럼 훅 스크립트 + 선언적 path 목록
설정 파일 조합). **특정 스크립트명이나 설정 스키마를 하드코딩해 전제하지 않는다** —
"경로 기반 차단 훅이 존재하는가"만 판단 기준이다. 프로젝트마다 구현이 다를 수 있다.

#### 4-A. 경로 보호 하네스가 있을 때 (권장 경로)

그 하네스의 설정에 `.secret/**`와 `github-auth.sh`를 위한 항목이 이미 있는지 확인하고,
없으면 그 하네스가 쓰는 방식대로 추가한다. 예를 들어 하네스가 이 devcontainer
템플릿의 `.claude/scripts/protect-paths-hook.mjs` + `.claude/config/protected-paths.json`
조합이라면(가장 흔히 배포되는 구현이지만 어디까지나 예시다), `protected-paths.json`의
`entries`에 아래 두 항목이 있는지 확인한다(경로·`block` 배열이 동일하면 재추가하지
않음 — 배열 중복 방지):

```json
{ "path": "./.secret/**", "block": ["read", "write", "bash"], "reason": "프로젝트 공용 시크릿(GitHub MCP 토큰 등)" },
{ "path": "./.claude/scripts/github-auth.sh", "block": ["read", "write", "bash"], "reason": "GitHub MCP 인증 헬퍼 — 실행 결과에 토큰이 찍힘" }
```

이런 항목(또는 다른 구현의 동등한 설정)이면 충분하다 — 경로 기반 `bash` 차단은 보통
읽기/쓰기를 구분하지 않고 셸·코드실행 전부를 막으므로, 구버전의 `permissions.deny`
(Read 도구 + cat류)와 hookify(그 외 모든 bash)가 각각 막던 표면을 그 하네스 항목
하나가 전부 포괄한다. **4-B는 건너뛴다** — 같은 목적의 메커니즘을 동시에 설치하지
않는다(단일 메커니즘 원칙, 중복 설정은 드리프트만 유발한다).

#### 4-B. 경로 보호 하네스가 없을 때 (fallback)

이런 하네스가 없는 프로젝트에서는 아래 구버전 가드 2종을 사용자에게 제안한다(권장:
둘 다 설치 — 서로 다른 도구 표면을 막으므로 하나만으로는 부족하다. 근거는 「가드 설계
근거」 참조). 사용자 확인 후 설치한다.

**permissions 읽기 가드**

`<ROOT>/.claude/settings.json`에 병합한다(기존 키 보존, 파일 없으면 생성). 이미
`Read(./.secret/**)` 항목이 있으면 다시 넣지 않는다(배열 중복 방지):

```json
{
  "permissions": {
    "deny": ["Read(./.secret/**)"]
  }
}
```

이는 **Read 도구**와 Claude Code가 파일 읽기로 인식하는 bash 명령(`cat`/`head`/
`tail`/`sed`)을 `.secret/`에 대해 차단한다.

**hookify 읽기 가드** (gitignore, local — 두 가드 중 마지막에 생성)

`<ROOT>/.claude/hookify.block-gh-mcp-secret-read.local.md`를 생성한다:

```markdown
---
name: block-gh-mcp-secret-read
enabled: true
event: bash
action: block
pattern: \.secret/|github-auth\.sh
---

🛑 **차단됨: 프로젝트 시크릿 접근**

이 Bash 명령은 프로젝트 시크릿 폴더(`.secret/`) 또는 GitHub MCP 인증 헬퍼를
참조합니다. 시크릿은 설계상 에이전트 컨텍스트와 분리되어 있습니다 — GitHub 토큰은
연결 시점에 MCP `headersHelper`만 읽으며 에이전트는 읽지 않습니다.

시크릿을 변경하려면 별도 터미널에서 `.secret/` 아래 파일을 편집하세요.
```

이 파일은 gitignore(`.claude/*.local.*` 매칭)되므로 **공유되지 않는다** — 각 개발자의
설정에서 다시 생성되거나(이 스킬을 통해) 별도로 배포된다.

hookify 플러그인이 없다면 명령이 `\.secret/|github-auth\.sh`에 매칭될 때 0이 아닌
값으로 종료하는 동등한 `PreToolUse` Bash 훅을 `settings.json`에 추가한다(트러블슈팅
참조). 원시 훅 추가 전 사용자에게 확인받아라.

### 5. .gitignore

`<ROOT>/.gitignore`에 `.secret/`가 있는지 확인하고 없으면 추가한다. 토큰뿐 아니라 모든
시크릿을 git 밖에 둔다.

### 6. 토큰을 사용자에게 인계

사용자에게 PAT를 **별도 터미널에서** 토큰 파일에 작성하라고 안내한다. 예:

```
printf '%s' 'github_pat_xxx' > .secret/claude/github-token
```

이걸 대신 실행하지 말고, 토큰을 채팅으로 받지도 마라.

## 가드 설계 근거

**하네스 있을 때(4-A) 항목 1개로 충분한 이유**: 경로 기반 `bash` 차단은 보통 읽기/쓰기
구분 없이 셸·코드실행 전부를 막는다(`cat`/`head`/`tail`/`sed`뿐 아니라
`xxd`/`od`/`base64`/`python -c "open(...)"`/리다이렉션 등 전부 포함 — 이 devcontainer
템플릿의 `protect-paths-hook.mjs`가 그렇게 동작한다). 여기에 Read 도구 차단까지 같은
항목이 함께 처리하므로, 구버전이 두 메커니즘으로 나눠 막던 표면을 하나로 포괄한다.

**하네스 없을 때(4-B) 가드 2개를 함께 두는 이유**: 서로 다른 도구 표면을 막으므로 어느
하나만으로는 부족하다:

- `permissions.deny: Read(./.secret/**)` → **Read 도구** + Claude Code가 파일 읽기로
  인식하는 bash 명령(`cat`/`head`/`tail`/`sed`).
- hookify(`event: bash`) → 시크릿/헬퍼를 참조하는 **그 외 모든 bash**(`xxd`, `od`,
  `base64`, `python -c "open(...)"`, 리다이렉션 등).

두 경로 모두에서 `headersHelper` 자체는 어느 가드에도 걸리지 않는다 — Claude Code가
연결 시점에 내부적으로 실행하며, 바로 이 방식으로 토큰이 에이전트를 거치지 않고
GitHub에 도달한다.

## 검증 (검증하려고 토큰을 읽지 마라)

사용자가 토큰을 작성하고 **Claude Code를 재시작**한 뒤(MCP 서버와 그 도구는 시작 시점에
로드됨):

```bash
claude mcp get github
```

`✓ Connected`와 `Scope: Project config`를 기대한다. 이 명령 문자열에는 가드 매칭
부분문자열이 없으므로 가드가 켜져 있어도 실행된다.

- `Failed`/`401`/`403` → 토큰 미작성, 또는 fine-grained PAT의 권한/레포 접근 부족.
  **토큰을 들여다보지 마라.** 사용자에게 토큰 존재 여부와, **켠 toolset에 맞는 권한**
  (`references/toolsets.md` 매핑 — 기본은 Contents/Pull requests/Issues/Metadata)이 대상
  레포에 있는지 확인을 요청하라.
- GitHub MCP **도구**(`mcp__github__*`)는 재시작 후에야 호출 가능하다. 세션 중 등록만으로는
  부족하다.

## 커밋 vs 로컬 유지

- **커밋(공유):** `.mcp.json`, `.claude/scripts/github-auth.sh`, `.gitignore`, 그리고
  가드 설정 — 4-A 경로면 기존 하네스의 설정 파일(이 템플릿 기준
  `.claude/config/protected-paths.json`), 4-B 경로면 `.claude/settings.json`.
- **절대 커밋 안 함(gitignore):** `.secret/`(토큰)와 (4-B 경로일 때만) hookify
  `*.local.md` 규칙. 팀원은 클론 후 자기 토큰만 `.secret/claude/github-token`에
  작성한다.

## 경로 이식성

`.mcp.json`은 `headersHelper`를 **절대 경로**로 저장한다. 이는 모두가 같은 경로로 레포를
마운트할 때만 이식 가능하다(devcontainer `/workspace` 경우). 팀원이 서로 다른 절대
경로를 쓰면 커밋된 값이 그들에게서 해석되지 않는다 — 대안: 마운트 경로 표준화
(devcontainer), 또는 각 개발자가 로컬에서 `headersHelper`를 자기 절대 경로로 지정. 헬퍼
*스크립트*는 경로 독립적(토큰을 자기 기준으로 해석)이라 영향받는 건 `headersHelper`
문자열 하나뿐이다.

## 트러블슈팅

- **너 자신의 셋업 명령이 차단됨 — 경로 보호 하네스 (4-A 경로):** 재실행 시 하네스
  설정에 이미 있는 `.secret/**`·`github-auth.sh` 항목이 걸린 것이다. 그 설정을 직접
  수정할 수 있으면 항목을 임시로 지우고 작업한 뒤 그대로 복원한다. 하네스 설정
  자체가 보호 대상이라 직접 수정이 막혀 있으면, 이런 상황을 다루는 프로젝트 지침이
  있는지 확인해 그대로 따르거나, 없으면 사용자에게 상황을 안내하고 직접 수정해
  달라고 요청한다.
- **너 자신의 셋업 명령이 차단됨 — hookify (4-B 경로):** hookify 가드가 활성
  상태다. `.local.md` 규칙에서 `enabled: false`로 두고 작업을 마친 뒤 `enabled:
true`로 되돌려라. 최초 실행에서는 가드를 맨 마지막에 만들면 이를 피할 수 있다.
- **hookify 플러그인 없음(4-B 경로):** 명령이 `\.secret/|github-auth\.sh`에 매칭될 때
  0이 아닌 값으로 종료하는 동등한 `PreToolUse` Bash 훅을 `settings.json`에 추가한다.
  원시 훅 추가 전 사용자에게 확인받아라. 그 사이에도 `permissions.deny`가 Read
  도구는 막는다.
- **`headersHelper`가 무시됨 / 토큰이 있는데 401:** 스크립트가 `chmod 755`인지,
  `.mcp.json`의 경로가 절대 경로이고 정확한지, 토큰 파일에 불필요한 공백이 없는지
  확인하라(헬퍼가 제거하긴 하지만 파일 존재·읽기 가능 여부를 확인). 토큰을 읽지 말고
  `claude mcp get github`로 진단하라.

## 다른 bearer-token MCP 서버로 일반화

bearer 토큰이 컨텍스트 밖에 있어야 하는 모든 원격 MCP에 같은 형태가 통한다:
`.secret/<service>/<token>`을 gitignore로 유지하고, 작은 `headersHelper`를 그것에
가리키게 하고, 4단계의 가드(경로 보호 하네스가 있으면 그 설정에 항목 1개, 없으면
가드 2개)를 재사용한다(패턴이 이미 `.secret/` 전체를 커버). 서버 URL, 헤더 이름,
토큰 파일명만 바꾸면 된다.
