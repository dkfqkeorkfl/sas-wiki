---
name: sas-prp-pr
description: 모든 phase 가 complete 된 후 최종 audit·수정·PR 생성을 책임진다. PRD 표 모든 phase Status = complete 시점에 호출. PRP 플로우 4단계. sas-audit-code --full → 결함 수정 → push + PR 또는 로컬 머지.
allowed-tools: Read Edit Bash Skill Agent
---

# sas-prp-pr

PRP 플로우 4단계. 모든 phase 가 끝난 브랜치를 전체 감사하고 결함을 고친 뒤 PR 을 만든다. phase
상태는 바꾸지 않는다.

## 트리거

PRD 의 `## Implementation Phases` 표에서 모든 phase Status = `complete` 일 때.

## 입력

- 대상 PRD.
- 대상 브랜치(`feat/{feature-kebab}`).

## 게이트 (하드)

다음을 모두 충족하지 않으면 즉시 중단하고 사유를 안내한다.

- 현재 브랜치 = `feat/{feature-kebab}`.
- PRD 표의 모든 phase Status = `complete`, 그리고 그 작업(코드 변경 + 문서)이 모두 커밋되어 있다.

미충족 시 미완료 phase 나 미커밋 사유를 안내한다. 그 밖에 작업 트리에 미커밋 변경이 남아 있으면, 이전 단계(`sas-prp-task`)의 산출물이 아직 정리되지 않았을 가능성을 짚어 정리를 권장한다. 이 권장은 게이트가 아니므로 진행을 막지 않는다.

## 책임 경계

| 주체           | 담당                                                                        | 비고            |
| -------------- | --------------------------------------------------------------------------- | --------------- |
| sas-audit-code | audit --full. 내부에서 Codex audit 1차, 불가 시 서브에이전트 폴백           | 수정·커밋 불가  |
| Codex          | 수정 코딩(`/cc-suite:continue`. 이어갈 세션이 없으면 `/cc-suite:implement`) | 커밋 불가       |
| Claude         | 검증·판정·커밋·push·PR 생성, 도구 설치·환경 세팅                            | Codex 위임 금지 |

외부 도구 없이 롤백할 수 있는 작은 일은 Claude 가 직접 해도 되지만, 애매하면 위임한다.

## 주석 규약

코드와 주석은 PRD·`plan.md`·`docs/memory` 같은 저장소 내부 문서를 참조하지 않고 자기완결적으로 쓴다. 감사와 수정 두 시점에 적용한다.

- 감사: 절차 1번의 `sas-audit-code --full` 은 이 브랜치 변경분의 기존 주석이 규약을 어겼는지도 본다.
- 수정: 절차 2번에서 새로 쓰거나 고치는 주석도 규약을 따른다.
- 금지: "PRD 참고", "plan.md 결정 참조" 같은 내부 문서 참조. 이 문서들은 자주 바뀌고 완료 뒤 아카이빙·삭제되어 참조가 끊긴다.
- 허용: 공식 문서·표준 스펙·공인 커뮤니티(언어·프레임워크 공식 사이트, RFC 등) 참조.
- 배경이 PRD·plan 에만 있어 코드만으로 복원되지 않으면, 문서를 가리키는 대신 그 배경을 주석에 옮겨 적는다.

## 절차

```text
1. sas-audit-code --full — 기본 브랜치와의 merge-base 부터 HEAD 까지의 diff 를 스코프로 리뷰한다. full 전용 추가 감사 3항목 중 다음 둘은 결과의 「추가 감사 (Full 전용)」 절에서 발견·미발견·해당 없음을 확인한다.
   · 테스트코드: 리팩토링·정책 변경으로 대상 패턴이 이미 사라졌는데 남아 있는 레거시 가드레일 테스트(과거 전환 검증용, 재발 가능성 없음). 재발 방지용 상시 가드레일 테스트와 구분한다. 병합할 수 있는 중복 테스트도 함께 식별한다.
   · 주석: 이 브랜치 변경분의 기존 주석이 「주석 규약」을 어겼는지.
2. 결함이 있으면 수정·개선한다. 레거시 가드레일 테스트 제거, 중복 테스트 병합, 주석 규약 위반 수정을 포함한다. 판정은 Claude 가 하고 코드 수정은 책임 경계대로 Codex 에 맡기며, 항목별 사용자 컨펌은 거치지 않는다.
3. 작업이 PRD 범위를 벗어나지 않았는지, PRD·plan 과 맞는지, 「주석 규약」을 지켰는지 본다.
4. 수정이 있으면 커밋 — type=fix, scope=audit.
5. 안내 출력:
   > PR 진행 전 ECC 모드 `strict` 또는 git hook 하네스가 설정되어 있어야 테스트·품질 게이트가 보장됩니다.
6. PR 생성 — 원격이 있으면 `/prp-pr` 호출(내부 `gh` 단계는 가능하면 GitHub MCP 로 대체. 「외부 의존」 참조). PR 생성이 실패하면 멈추고 사유를 보고한다. 원격이 없을 때만 로컬 머지로 끝낸다. 기본 브랜치(`main`)를 checkout 한 뒤 feat 브랜치를 머지하고, 충돌이 나면 멈추고 보고한다. push 는 하지 않는다.
```

## 안전 규칙

`--no-verify`, `--force`, `--allow-empty` 는 사용자 명시 요청 시에만 사용한다.

## 산출물

- audit 을 통과한 브랜치.
- PR URL 또는 로컬 머지 결과.

## DoD

- audit 통과(테스트코드·주석 감사 포함). critical·high 미해결 0건.
- PR URL 또는 로컬 머지 결과 보고.
- 이 스킬에서 생긴 수정(`fix(audit)` 커밋 등)이 전부 반영됨.
- 코드·주석이 「주석 규약」을 준수함.

## 후속

프로젝트 종료. 다음 기능은 `sas-prp-prd` 에서 새 PRD 로 시작한다.

---

## 공통 규약

### 브랜치 네이밍

- Feature 브랜치: `feat/{feature-kebab}`. 1 PRD = 1 브랜치.

### phase 상태 머신

PRD 본문 `## Implementation Phases` 표가 phase 상태 SSOT.

- 본 스킬은 phase Status 를 바꾸지 않는다. 모든 phase 가 이미 `complete` 인 상태로 들어온다.

### 커밋 메시지 형식

```text
<type>(<scope>): <subject>

<body>

PRP-Auto: true
```

본 스킬의 audit 수정 커밋: `type=fix`, `scope=audit`.

예:

```text
fix(audit): full audit critical 2건 반영

codex: token_store.ts null-guard 추가, retry 정책 단순화

PRP-Auto: true
```

## 용어

- **PRD**: `/docs/prds/{feature-kebab}/prd.md`.
- **audit --full**: `sas-audit-code --full`. 9차원 전수 audit + 스킬 고유 추가 3항목. 내부에서 `/cc-suite:audit --full` 을 1차로 부르고, 불가 시 서브에이전트로 폴백한다.

## 외부 의존

- Skill `sas-audit-code` (audit --full. 내부에서 `/cc-suite:audit` 호출).
- 슬래시 `/cc-suite:continue`, `/prp-pr`.
  - `/prp-pr` 호출 방식: `Skill` 도구로 `prp-pr` 이름 그대로 먼저 호출한다. ECC 버전에 따라 스킬·커맨드 어느 쪽으로 등록됐든 호출할 수 있고, 노출된 스킬 목록에 없어도 시도한다. 미등록 오류로 실패할 때만 `~/.claude/commands/prp-pr.md` 를 Read 해 전문 그대로 수행한다. 요약·생략하지 않는다.
  - `/prp-pr` 내부 gh 대체: 커맨드 본문의 `gh pr list/create/view/checks` 같은 gh 전용 단계는 가능하면 GitHub MCP(`mcp__github__create_pull_request`, `mcp__github__pull_request_read` 등. 자격증명 노출 최소화)로 대신한다. MCP 를 쓸 수 없을 때만 원문 그대로 `gh` 를 쓴다.
- CLI `gh` — GitHub MCP 를 쓸 수 없을 때만 폴백으로 사용.
