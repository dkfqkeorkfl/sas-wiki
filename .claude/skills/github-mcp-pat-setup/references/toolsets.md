# GitHub 원격 MCP — toolset 레퍼런스

`github-mcp-pat-setup` 스킬의 **툴셋 선택** 단계 보조 자료다. 설치 시작 시 이 표를
사용자에게 제시해 어떤 toolset을 켤지 정하고, 그에 맞는 FGPAT 권한을 함께 안내한다.

> ⚠️ **이 문서의 표는 "형식 표본 + 마지막 확인 스냅샷"이다 — 불변 사실이 아니다.**
> 권한·지원여부·gap·기본셋 등 휘발성 값은 GitHub가 시간에 따라 바꾼다(공식 문서가
> "these gaps will be solved over time"이라 명시). **사용자에게 제시하기 전에 아래 출처로
> 휘발 칸(🔁 표시 컬럼)을 재검증**하고, 바뀐 값은 갱신하며, "스냅샷 기준일"을 갱신하라.
> 재검증은 선택이 아니라 **필수 단계**다.

**검증 출처 (claim별 교차검증):**

- toolset 목록·기본셋·메커니즘 → [github-mcp-server remote-server.md](https://github.com/github/github-mcp-server/blob/main/docs/remote-server.md) · [README](https://github.com/github/github-mcp-server)
- FGPAT 권한 → [permissions-required-for-fine-grained-personal-access-tokens](https://docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens)
- classic 스코프 → [scopes-for-oauth-apps](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps)
- FGPAT gap(Checks·user-owned Projects 등) → [managing-your-personal-access-tokens](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)
- Claude Code `headers`/`headersHelper` → [code.claude.com MCP](https://code.claude.com/docs/en/mcp)

**스냅샷 기준일: 2026-05-23.**

## toolset 켜는 메커니즘

원격 MCP(`https://api.githubcopilot.com/mcp/`)는 기능을 **toolset 단위**로 노출한다. 세 가지 방법:

- **URL 단일/전체**: `…/mcp/x/<toolset>`(하나), `…/mcp/x/all`(전부).
- **헤더 커스텀 다중**: `X-MCP-Toolsets: context,repos,issues,pull_requests,users,actions`
  (콤마 구분, **기본 5개 포함** — 헤더는 교체이므로 빼면 그 기능이 사라진다). ← 선택형 설치는 이걸 쓴다.
- **읽기전용**: URL `/readonly` 접미사 또는 `X-MCP-Readonly` 헤더.

주의:

- ⚠️ `X-MCP-Toolsets`는 기본값을 **교체**한다(추가 아님). → 기본 5개를 포함해 **원하는 전체**를 적어라.
- 헤더는 `all` 값을 받지 않는다. 전부 켜려면 URL `/mcp/x/all`.
- Claude Code에선 정적 `headers`와 동적 `headersHelper`가 **공존·병합**된다(같은 키는 헬퍼 우선).
  그래서 `X-MCP-Toolsets`를 `headers`에 두면 토큰 헬퍼(`github-auth.sh`)를 건드릴 필요가 없다.
- 변경 후에는 **재연결 필요**(toolset/헤더는 연결 시점에 적용).

## 기본(default) toolset

문서 기준 기본(2026-05 확인) = `context`, `repos`, `issues`, `pull_requests`, `users`.
(실측: 원격 기본 프로파일이 문서보다 약간 넓어 `orgs`/`labels`/`secret_protection` 일부
도구가 보일 수 있다. 헤더로 명시 셋을 지정하면 목록이 확정된다.)

## 전체 toolset 표

지원·필요 권한을 **fine-grained PAT**(권장 기본)와 **classic PAT** 두 토큰 타입으로 나눠 표기.
`✅`=지원/권한 존재, `❌`=미지원, `*`=GitHub 문서에 명시 매핑 없어 추정(검증 권장), `❓`=불명확.

> 🔁 **`기본`·`FGPAT 권한`·`classic 스코프` 컬럼은 휘발성 — 제시 전 위 출처로 재검증 대상.**
> (스냅샷 기준일: 2026-05-23. 아래 값은 그날 확인된 마지막 상태일 뿐이다.)

| toolset               | 기능                             | 기본 | FGPAT 권한                                   | classic 스코프                                |
| --------------------- | -------------------------------- | :--: | -------------------------------------------- | --------------------------------------------- |
| `context`             | 현재 유저/컨텍스트               |  ✅  | ✅ 기본                                      | ✅ 기본                                       |
| `repos`               | 파일·커밋·브랜치·릴리스·코드검색 |  ✅  | ✅ Contents, Metadata                        | ✅ `repo`(비공개)/`public_repo`               |
| `issues`              | 이슈                             |  ✅  | ✅ Issues                                    | ✅ `repo`                                     |
| `pull_requests`       | PR·리뷰·머지                     |  ✅  | ✅ Pull requests                             | ✅ `repo`                                     |
| `users`               | 유저 검색                        |  ✅  | ✅ 기본                                      | ✅ `read:user`                                |
| `actions`             | 워크플로/CI run·log·잡           |  ❌  | ✅ Actions                                   | ✅ `repo`(run 읽기)+`workflow`(파일/dispatch) |
| `dependabot`          | 취약점(의존성) 알림              |  ❌  | ✅ Dependabot alerts                         | ✅ `security_events`(비공개)/`public_repo`    |
| `code_security`       | 코드 스캐닝 알림                 |  ❌  | ✅ Code scanning alerts                      | ✅ `security_events`(또는 `repo`)             |
| `secret_protection`   | 시크릿 스캐닝 알림               |  ❌  | ✅ Secret scanning alerts                    | ✅ `repo` 또는 `security_events`              |
| `security_advisories` | 저장소 보안 권고                 |  ❌  | ✅ Repository security advisories            | ✅ `repo` *                                   |
| `labels`              | 라벨                             |  ❌  | ✅ Issues                                    | ✅ `repo`                                     |
| `orgs`                | 조직·팀                          |  ❌  | ✅ (org) Members                             | ✅ `read:org`/`admin:org`                     |
| `projects`            | Projects(v2) 보드                |  ❌  | **user-owned ❌(gap)** / org=✅ Org Projects | ✅ `project`/`read:project` (user·org 모두)   |
| `git`                 | 저수준 Git API(blob/tree/ref)    |  ❌  | ✅ Contents                                  | ✅ `repo`                                     |
| `gists`               | Gist                             |  ❌  | ✅ (account) Gists                           | ✅ `gist`                                     |
| `notifications`       | 알림                             |  ❌  | ❌ 전용 권한 미검출                          | ✅ `notifications`                            |
| `discussions`         | 디스커션                         |  ❌  | ❌ 전용 권한 미검출(GraphQL)                 | ✅ `repo` * (repo discussions)                |
| `stargazers`          | 스타 목록                        |  ❌  | ✅ Metadata / Starring                       | ✅ 공개=불요 / 비공개=`repo`                  |
| `copilot`             | Copilot 기능                     |  ❌  | ✅ Copilot 권한(org/repo)                    | ❓ 불명확                                     |

> **참고 — Checks(check-runs)**: toolset이 아니라 `pull_requests`의 `get_check_runs` 메서드로 노출.
> **FGPAT 전면 불가**(읽기·쓰기 모두), **classic(`repo`)/App만** 가능. user-owned `projects`와 같은 "classic/App-only" 부류.

## 권한·가용성 주의 (스냅샷 — 제시 전 재검증)

- **Checks(check-runs)는 fine-grained PAT으로 불가** — 읽기·쓰기 모두 GitHub가
  엣지 케이스로 비활성화. **App 토큰/classic PAT만** 가능. CI 통과 여부가 필요하면
  check-runs 말고 `actions`(Actions:read)로 **워크플로 run**을 읽어라.
- **`code_security`는 private repo에서 유료** — Free/Pro 개인 private repo는 GitHub Code
  Security(GHAS) 없이는 코드 스캐닝이 동작하지 않아 알림 0건(public repo는 무료).
- **`security_advisories`(repo-level)**는 직접 작성한 advisory가 없으면 비어 있다.
- **`projects`**는 실제 Projects 보드가 있어야 내용이 있다.
- **`dependabot` 알림은 모든 repo 무료** — private에서도 동작.
- 토큰 권한은 **켠 toolset에 맞춰서만** 추가하라(최소권한). 토큰은 사용자가 별도
  터미널에서 작성한다(SKILL.md 보안 불변식).

## 선택 → `<TOOLSETS>` 만들기

선택 결과를 콤마 구분 문자열로 만든다. 기본 5개를 포함해야 한다(헤더는 교체). 예:

```
context,repos,issues,pull_requests,users,actions,dependabot,labels
```

- "기본만" → `<TOOLSETS>`를 비우고 `.mcp.json`의 `headers` 블록 생략.
- "전부" → 헤더 대신 URL `…/mcp/x/all`.
