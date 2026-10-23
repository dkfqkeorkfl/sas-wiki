---
name: sas-setup-project
description: 새 devcontainer 또는 호스트 환경에서 Claude Code + Codex 프로젝트 초기 설치·점검을 일괄 수행한다. ECC 와 Codex 가 설치된 상태를 가정하며, 플러그인 권장·설치, cc-suite 세팅, 실행기(Playwright) 세팅, ECC 자산 정리, 훅·MCP 점검, effort·ECC 모드 표시까지 순서대로 처리한다. 새 환경 attach 직후, 프로젝트 초기 점검을 요청받았을 때, 또는 사용자가 명시적으로 호출했을 때 사용.
allowed-tools: Bash(claude plugin *), Bash(claude config *), Bash(ls *), Bash(cat *), Bash(jq *), Bash(grep *), Bash(test *), Bash(find *), Bash(pnpm *), Bash(npm *), Bash(npx *), Bash(yarn *), Bash(bun *), Bash(bunx *), Bash(uv *), Bash(poetry *), Bash(pipenv *), Bash(pip *), Bash(python -m *), Bash(python3 -m *), Bash(playwright *), Bash(apt-get install *), Bash(sudo apt-get install *), Skill, AskUserQuestion, Read, Grep, Glob
disable-model-invocation: true
argument-hint: (인자 불필요)
---

# sas-setup-project

클로드 코드와 코덱스 기반의 새 환경을 한 번의 흐름으로 설치·점검한다. ECC 와 Codex 가 이미 설치되어 있다고 가정한다.

## 입력

- 현재 프로젝트 작업 경로
- `~/.claude/` 글로벌 설정
- 프로젝트 `.claude/` 설정

## 0. 환경 스냅샷 수집 (선행 작업)

본 단계는 1·2·3·6 단계의 분기 입력이다. 아래 항목을 Bash 도구로 직접 조회하여 결과를 표로 정리한 뒤 다음 단계로 진행한다. `!` 기반 사전주입은 사용하지 않는다.

| 항목                        | 확인 명령                                                                                                                          | 용도                         |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| 설치된 플러그인 목록        | `claude plugin list`                                                                                                               | 1단계 표 제시·중복 설치 회피 |
| 글로벌 settings.json 존재   | `test -f ~/.claude/settings.json`                                                                                                  | 훅·MCP 점검 대상 식별        |
| 프로젝트 settings.json 존재 | `test -f .claude/settings.json`                                                                                                    | 훅·MCP 점검 대상 식별        |
| continuous-learning-v2 위치 | `ls -d ~/.claude/plugins/marketplaces/*/plugins/continuous-learning* 2>/dev/null; test -d ~/.claude/skills/continuous-learning-v2` | 6단계 모드 식별              |
| 현재 환경 종류              | `.devcontainer/` 존재 여부·`/proc/1/cgroup` 등                                                                                     | 2단계 환경 제약 첨부         |
| 프로젝트 유형·PM            | `package.json`·`pyproject.toml`·lockfile 존재                                                                                      | 3단계 실행기 세팅 분기       |

수집 결과를 간단한 표로 사용자에게 먼저 제시한 후 1단계로 넘어간다.

## 전체 흐름

```text
0. 환경 스냅샷 수집
1. 플러그인 권장·설치
2. cc-suite 세팅
3. 실행기(Playwright) 세팅
4. ECC 자산 정리 (/sas-agents-sort-curate · agent-sort 통합)
5. 훅 점검 표
6. continuous-learning-v2 훅 연결 점검 (설치된 경우만)
7. MCP 점검 표
8. effort + ECC 모드 표시
```

단계 실패·미설치·사용자 거부는 보고하고 사용자 피드백으로 해결한다. 세세한 예외 처리는 LLM 판단에 맡긴다.

## 실행 규약 (단계별 진행)

본 커맨드는 **한 턴에 한 단계만** 수행한다. **여러 단계를 한 턴에 연속 실행하거나 결과를 끝에 몰아서 출력하는 것은 금지한다** — 점검 전용 단계(5·6·7·8)도 예외 없다.

- 모든 단계는 완료 직후 그 단계 결과(표·요약)를 출력하고, **반드시 `AskUserQuestion` 으로 진행 확인을 받은 뒤에만** 다음 단계를 시작한다(예: "3단계 완료 — 4단계로 진행할까요?"). 사용자 결정이 없는 점검 단계도 동일하게 정지한다.
- 선택·입력이 필요한 단계(1 플러그인 선택, 3 설치 승인, 4 큐레이션 결정)는 사용자 입력을 받기 전 진행하지 않는다.
- 여러 단계의 표·결과를 한 번에 출력했다면 규약 위반이다. 한 단계 출력 → 확인 → 다음 단계 순서를 지킨다.

---

## 1. 플러그인 권장·설치

아래 표를 사용자에게 제시하고, 번호 선택을 받아 채택된 항목만 LLM 이 `claude plugin install` 로 설치한다. 미선택 항목은 설치 명령만 출력한다. 다중 선택은 쉼표·범위·`전체`/`없음` 단축어를 허용한다. 0단계에서 이미 설치된 플러그인은 표에 `(설치됨)` 으로 표기하고 재설치하지 않는다.

| 번호 | 플러그인             | 설치 명령                                                            | 기능·사유                                                                                                     |
| :--: | -------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
|  1   | cc-suite             | `claude plugin install cc-suite@xiaolai`                             | Codex 연동. 공식 OpenAI 플러그인 이슈로 오픈소스 토킷 사용.                                                   |
|  2   | skill-creator        | `claude plugin install skill-creator@claude-plugins-official`        | 스킬 신규 생성·트리거 튜닝·벤치마크 보조.                                                                     |
|  3   | claude-md-management | `claude plugin install claude-md-management@claude-plugins-official` | CLAUDE.md 감사·세션 학습 반영.                                                                                |
|  4   | session-report       | `claude plugin install session-report@claude-plugins-official`       | 세션 종료 시 작업 보고 산출.                                                                                  |
|  5   | hookify              | `claude plugin install hookify@claude-plugins-official`              | `.claude/hookify.*.local.md` 룰을 PreToolUse·PostToolUse·Stop·UserPromptSubmit 에서 실제로 발동시키는 런타임. |

- 완료 후, 설치된 플러그인의 자동 업데이트를 원하면 `/plugin` 메뉴의 **marked for update** 토글을 켜도록 사용자에게 안내한다.

## 2. cc-suite 세팅

1단계에서 cc-suite 가 채택되었으면 다음 순서로 처리한다.

1. **CRLF → LF 일괄 변환** — cc-suite 상류 저장소가 `.gitattributes` 부재로 CRLF 체크아웃되어 셸·`.mjs`·`.json` 등 80여 파일이 깨진다. `/cc-suite:init` 호출 전 1회 변환한다.

   ```bash
   find ~/.claude/plugins/cache/xiaolai/cc-suite -type f -not -path "*/.git/*" -exec sed -i 's/\r$//' {} +
   ```

2. `/cc-suite:init` 호출.

   - **호출 입력에 환경 제약을 첨부한다.** 예: 컨테이너 환경 → 헤드리스 E2E·시각 QA(Playwright)는 수행 가능(3단계에서 세팅), OS 통합(clipboard·tray·global shortcut)·실디스플레이 육안만 host 전용.

3. **`.cc-suite.md` 필수 지시 확인.** `references/cc-suite-project-instructions.md` 를 읽고, 그 내용이 `.cc-suite.md` 의 Project-Specific Instructions 에 있는지 확인한다. 없으면 그 자리에서 추가한다. 참고 파일에 항목이 늘어나면 늘어난 만큼 같은 방식으로 확인한다.

## 3. 실행기(Playwright) 세팅

목적: 이 컨테이너에서 기능 E2E(P2)·시각/상호작용 QA(P3)를 **헤드리스로 직접 실행**할 수 있게 한다. 프로젝트 유형이 사전에 정해지지 않으므로 0단계 스냅샷의 매니페스트로 감지 후 유형별로 설치한다.

- 프로젝트의 매니페스트·락파일·테스트 러너로 유형과 패키지 매니저를 감지하고, 그 패키지 매니저로 Playwright 를 설치한다.
- 유형별 설치 명령:
  - 웹 프런트(JS/TS): `playwright install --with-deps` (브라우저 + OS 의존)
  - Electron: `playwright install-deps` (Chromium 번들 → OS 의존만)
  - Python: `playwright install --with-deps chromium`
- 감지·설치 명령을 사용자에게 제시한 뒤 실행한다. Playwright 대상이 아닌 레포(문서·셸 전용 등)는 건너뛰고 사유를 보고한다.

## 4. ECC 자산 정리 (/sas-agents-sort-curate)

`/sas-agents-sort-curate` 를 호출한다. 이 스킬이 의존성으로 `/agent-sort` 를 선행 실행(레포 스캔·도구체인 식별·DAILY/LIBRARY 분류)한 뒤 큐레이션(경고·안내 스캔 + LIBRARY 상세 재분류)을 더해 **통합 8개 카테고리** 설치 계획을 산출한다. 각 파일은 삭제보다 LIBRARY 이동·라우팅을 우선한다. 스킬이 판별하지 못한 항목만 사용자에게 질의한다.

## 5. 훅 점검 표

대상: `~/.claude/settings.json` 과 프로젝트 `.claude/settings.json`, 그리고 프로젝트 `.codex/hooks.json`. 세 파일을 Read 또는 `cat` 으로 읽어 hooks 섹션을 분석한다.

| 영역 | 훅 이름 | 설명 | 동작 | 특이사항 |
| ---- | ------- | ---- | ---- | -------- |

- **영역**: 훅이 속한 계통 (예: `ECC`, `RTK`, `claude-mem`, 플러그인 이름, `프로젝트`).
- **동작**:
  - `정상` — 의도된 모든 동작을 수행.
  - `비정상` — 일부만 동작 (의존성·환경 등으로 일부 실패).
  - `미동작` — 스크립트 자체가 실행되지 않음.
- **판정 기준**: 훅 정의의 객관 자료(스크립트 존재, matcher, command, 외부 의존). 추정 금지.
- **특이사항**: 조건부 동작·환경 의존·중복 등 보조 정보.

`.codex/hooks.json`(경로 보호 훅의 Codex CLI 쪽 등록)은 이 틀로 정의 자체는 판정하되, 다음 한 가지는 별도로 처리한다.

- Codex CLI는 훅 정의가 있어도 사람이 `/hooks` 로 승인(trust)하기 전까지 조용히 건너뛴다(에러·경고 없이 skip) — 정의가 있다는 사실만으로 "정상"이라 단정하지 않는다.
- 승인 여부는 `~/.codex/config.toml` 의 `[hooks.state."..."]` 항목 중 이 프로젝트의 `.codex/hooks.json` 경로가 키에 포함된 항목이 있는지로 **참고용으로만** 확인한다. 그 항목의 `trusted_hash` 가 현재 훅 정의의 해시와 실제로 일치하는지는 Codex 내부 알고리즘이라 재계산할 수 없으므로, 항목이 있으면 "승인 이력 있음(일치 여부 미확인)", 없으면 "미승인 — 최초 1회 `/hooks` 로 직접 승인 필요"로만 특이사항에 적는다. 추정하여 "정상"으로 단정하지 않는다.

## 6. continuous-learning-v2 훅 연결 점검

전제: 4단계 카테고리화 이후에도 `continuous-learning-v2` 가 설치 유지된 경우에만 수행. 그 외에는 건너뛴다. 0단계 스냅샷의 위치값으로 모드를 식별한다.

| 발견 위치                                  | 모드     | 처리                                                                                                                                             |
| ------------------------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `~/.claude/plugins/` 하위                  | 플러그인 | 자동 wiring (별도 조치 없음).                                                                                                                    |
| `~/.claude/skills/continuous-learning-v2/` | 스킬     | `~/.claude/settings.json` 의 PreToolUse · PostToolUse 양쪽에 `observe.sh` 연결 여부 점검. 미연결 시 추가 방법을 사용자에게 안내(자동 편집 금지). |

## 7. MCP 점검 표

대상: 현재 활성화된 MCP 서버 전체. 글로벌·프로젝트 `settings.json` 의 `mcpServers` 와 플러그인 동봉 MCP 정의를 확인한다.

| 이름 | 동작 | 특이사항 |
| ---- | ---- | -------- |

- **이름**: MCP 서버 식별자 (예: `context7`, `serena`, `github`, `exa`).
- **동작**:
  - `정상` — 핸드셰이크 성공 + 인증/API 키 연동 완료 → 실제 호출 가능.
  - `비정상` — 연결은 되었으나 API 키·토큰 미설정 등으로 일부 기능 실패.
  - `미동작` — 등록은 되었으나 핸드셰이크 실패·프로세스 미기동.
- **판정 기준**: `mcpServers` 엔트리, 필수 환경변수·토큰 설정, 도구 목록 응답 여부. 추정 금지.
- **특이사항 예**: "MCP 연동되었으나 API 토큰 미설정", "도구 호출 시 401", "OS 의존성 누락".

## 8. effort + ECC 모드 표시

- **effort**: `settings.json` 의 `effortLevel` 값.
- **ECC 모드**: 적용 우선순위(환경변수 → `settings.json` → 프로젝트 설정)에 따른 현재 값과 출처.

표시 예: `strict` / `standard`.

---

## 출력

- 0단계 환경 스냅샷 표
- 단계별 점검·실행 결과 요약
- 3단계 실행기 세팅 결과(감지 유형·설치 명령)
- 4단계 ECC 자산 8개 카테고리 정리 결과
- 5단계 훅 점검 표
- 7단계 MCP 점검 표
- 8단계 effort 값과 ECC 모드 (출처 포함)
- 미설치·미설정 항목의 권장 목록

## 참고 경로

- `~/.claude/settings.json`
- 프로젝트 `.claude/settings.json`
- 프로젝트 `.codex/hooks.json`, `~/.codex/config.toml` (Codex 훅 신뢰 상태)
- `.devcontainer/docker-compose.yml` (ECC 모드 환경변수)
- `~/.claude/plugins/`, `~/.claude/skills/`
- `references/cc-suite-project-instructions.md` (`.cc-suite.md` 필수 지시 목록)
