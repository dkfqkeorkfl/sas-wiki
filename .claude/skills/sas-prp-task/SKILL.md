---
name: sas-prp-task
description: 특정 phase 의 RGR(RED/GREEN/REFACTOR) 구현 + PRD 반영을 책임진다. plan.md 가 존재하고 사용자가 phase 구현을 요청할 때 호출. PRP 플로우 3단계. RED·GREEN·REFACTOR 는 `sas-tdd-implement` 스킬에 단계별로 위임하고, GREEN 과 REFACTOR 뒤마다 sas-audit-code 스킬로 감사한 뒤, plan 누적 변경을 PRD 에 반영하며 phase Status 를 complete 로 전이한다. REFACTOR 는 phase 의 GREEN 이 모두 끝난 뒤 한 번이다.
allowed-tools: Read Edit Bash Skill Agent AskUserQuestion
---

# sas-prp-task

PRP 플로우 3단계. 한 phase 의 plan 을 따라 RED → GREEN 을 진행하고, GREEN 이 모두 끝나면
REFACTOR 를 한 번 한 뒤, plan 의 누적 변경을 PRD 에 반영하고 phase 를 complete 로 전이한다.

## 트리거

사용자가 특정 phase 구현을 요청할 때.

## 입력

- 대상 phase 식별자(`P{num}`).

## 게이트 (하드)

다음을 모두 충족하지 않으면 즉시 중단하고 사유를 안내한다.

- 현재 브랜치 = `feat/{feature-kebab}`.
- 대상 phase Status = `in-progress`.
- 해당 phase 의 `plan.md` 존재.

그 밖에 작업 트리에 미커밋 변경이 남아 있으면, 이전 단계(`sas-prp-plan`)의 산출물이 아직 정리되지 않았을 가능성을 짚어 정리를 권장한다. 이 권장은 게이트가 아니므로 진행을 막지 않는다.

## 책임 경계

| 주체              | 담당                                                                     | 비고           |
| ----------------- | ------------------------------------------------------------------------ | -------------- |
| sas-tdd-implement | RED·GREEN·REFACTOR. 위임 우선순위·폴백은 내부 규정을 따른다              | 커밋 불가      |
| sas-audit-code    | audit --mini. GREEN 뒤와 REFACTOR 뒤. 1차 수단·폴백은 내부 규정을 따른다 | 수정·커밋 불가 |
| Claude            | 검증·판정·커밋·문서 작성·도구 설치 등 코딩과 리뷰 밖의 일                | 위임 금지      |

- RED·GREEN·REFACTOR 는 `sas-tdd-implement` 를 `--red`/`--green`/`--refactor` 플래그로 단계마다 호출해 위임한다. 산출 문서 경로는 주지 않는다. GREEN 이후 추가 수정·개선은 `sas-tdd-implement --green --continue` 로 맡긴다. 다음 작업의 RED 와 병렬로 진행할 때는 「작업 간 병렬」을 따른다.
- audit 은 `sas-audit-code --mini` 로 GREEN 뒤와 REFACTOR 뒤에 하며 스코프를 명시해 넘긴다. GREEN 뒤는 "아직 커밋하지 않은 GREEN 변경", REFACTOR 뒤는 "이 phase 의 plan 커밋(docs(P{num})) 이후의 모든 커밋과 아직 커밋하지 않은 변경. 중간에 낀 chore·fix 포함".
- 외부 도구 없이 롤백할 수 있는 작은 일은 Claude 가 직접 해도 되지만, 애매하면 위임한다.
- test·lint·typecheck 같은 외부 도구는 코딩 주체가 개발 중에 쓴다.

## 루프 (RGR + PRD 반영)

```text
[RED → GREEN] (phase 의 작업마다 반복 — 작업 간 병렬은 「작업 간 병렬」 참고)
1. `sas-tdd-implement --red` 호출(입력: plan.md, 보조 문서(있으면)) → RED 테스트 + 인계 사항.
   · 진행할 수 없다고 돌아오면 사용자에게 보고하고 멈춘다.
2. 커밋 — type=test, scope=P{num}. 본문에 RED 가 돌려준 인계 사항을 싣는다.
3. `sas-tdd-implement --green` 호출(입력: plan.md + 보조 문서(있으면) + RED 테스트 + RED 커밋 본문의 인계 사항 + 현재 코드) → 프로덕션 코드. 다음 작업의 RED(1번)와 병렬로 진행할 때는 「작업 간 병렬」을 따른다.
4. sas-audit-code --mini — GREEN 변경 품질 검사. P3 recipe 가 있으면 sas-visual-judge 로 판정한다.
5. 결함이나 P3 미충족이 있으면 `sas-tdd-implement --green --continue` 로 수정·개선을 맡긴다. 필요하면 plan.md 를 고친다. 결함·미충족이 모두 해소될 때까지 4번부터 반복한다.
6. 커밋 — type=feat, scope=P{num}. plan 을 고쳤으면 사유를 본문에 적는다.

[REFACTOR] (phase 당 한 번. GREEN 이 모두 끝난 뒤)
7. `sas-tdd-implement --refactor` 호출(범위: 이 phase 의 커밋들이 바꾼 파일 전체. 지킬 규칙: plan.md 의 패턴·컨벤션. 요구 조건: PRD·plan 의 성능·용량 요구와 하네스) → 정리된 코드 + 보고.
8. 보고 처리 — 「REFACTOR 보고 처리」.
9. sas-audit-code --mini — 이 phase 에서 생긴 모든 diff 품질 검사(plan 커밋(docs(P{num})) 이후의 모든 커밋과 아직 커밋하지 않은 변경. 중간에 낀 chore·fix 등 phase 밖 커밋 포함).
10. 결함이 있으면 수정·개선 — 품질 결함은 `sas-tdd-implement --refactor --continue` 로, 정확성·로직 결함은 `sas-tdd-implement --green --continue` 로 맡긴다. 결함이 모두 해소될 때까지 9번부터 반복한다.
11. 커밋 — type=refactor, scope=P{num}. 정리 대상이 없으면 커밋을 생략하고 근거를 PRD 반영 커밋 본문에 남긴다.

[PRD 반영 + COMPLETE]
12. plan 의 누적 변경 중 PRD 본문에 반영할 후보를 Claude 가 고른다.
    · 기준: 다른 phase 에 영향을 주거나, 합의·특이사항·제약 같은 중대한 결정으로 이 피쳐에 유익한 정보. REFACTOR 보고의 잔여 부채도 후보다.
13. PRD 본문 수정 + 표의 해당 phase Status `in-progress → complete`.
14. 일관성 검증 — PRD 와 plan.md 의 용어·시나리오·제약이 맞는지.
15. 커밋 — type=docs, scope=prd. 반영 항목을 본문에 적는다. 후보가 없어도 status 갱신만 담아 커밋한다.
```

## 작업 간 병렬

phase 에 작업이 여럿이면 각 작업이 위 루프의 [RED → GREEN] 을 순서대로 반복한다. 작업 N 의 GREEN(3번)과 작업 N+1 의 RED(1번)는 서로 입출력·상태에 영향이 없으면 병렬로 진행하고, 작업 N+1 이 작업 N 의 산출물을 전제하는 등 영향이 있으면 순차로 간다. 이 판단은 매번 Claude 가 두 작업의 의존 관계를 보고 내린다.

병렬로 진행할 때는 `sas-tdd-implement` 를 `--green`(작업 N)과 `--red`(작업 N+1) 플래그로 한 번에 함께 호출한다. 두 결과를 받은 뒤 각자의 다음 단계(작업 N 은 4번부터, 작업 N+1 은 2번부터)를 진행한다.

## REFACTOR 보고 처리

- 제안이 합당하면 처리한다 — 구현 방법을 바꿔야 풀리는 제안은 `sas-tdd-implement --green --continue` 로 맡기고, 범위를 넘는 가벼운 정리는 별도 커밋(type=refactor, scope=P{num}, 본문에 범위 밖 정리임을 명시)으로 한다.
- 후속 작업 여부 등 사용자 확인이 필요하면 `AskUserQuestion` 으로 묻는다.

## 안전 규칙

`--no-verify` 등 커밋 훅 우회 옵션은 사용자 명시 요청 시에만 사용한다.

## 산출물

- 구현 코드 + RED·GREEN 커밋 + REFACTOR 커밋(정리 대상이 있을 때) + PRD 반영 커밋.
- PRD 본문·표 갱신(Status = `complete`).

## DoD

- 해당 phase 의 RED·GREEN + REFACTOR(정리 대상이 있을 때) + PRD 반영·complete 커밋 완료.
- PRD 표 해당 phase Status = `complete`.
- PRD ↔ plan 일관성 검증 통과.

## 후속

- 추가 `pending` phase 가 있으면 `sas-prp-plan` 으로 복귀.
- 모든 phase Status = `complete` 면 `sas-prp-pr` 진입 가능.

---

## 공통 규약

### 디렉토리 구조

```text
docs/prds/
└── {feature-kebab}/
    ├── prd.md
    ├── contract.md 등 보조 문서(있으면)
    └── P{num}.{phase-kebab}/
        └── plan.md
```

### 브랜치 네이밍

- Feature 브랜치: `feat/{feature-kebab}`. 1 PRD = 1 브랜치.

### phase 상태 머신

PRD 본문 `## Implementation Phases` 표가 phase 상태 SSOT.

- `in-progress → complete`: 본 스킬이 PRD 반영 단계(루프 12-13)에서 갱신.

### 커밋 메시지 형식

```text
<type>(<scope>): <subject>

<body>

PRP-Auto: true
```

| 시점                                                            | type       | scope    |
| --------------------------------------------------------------- | ---------- | -------- |
| RED                                                             | `test`     | `P{num}` |
| GREEN                                                           | `feat`     | `P{num}` |
| REFACTOR (정리 대상이 있을 때. 범위 밖 가벼운 정리는 별도 커밋) | `refactor` | `P{num}` |
| PRD 반영 + complete                                             | `docs`     | `prd`    |
| 본 표 외 코딩(lint/test 등)                                     | `fix`      | `audit`  |

- 본문은 자유 기술. plan 을 고친 커밋은 사유를, RED 커밋은 `sas-tdd-implement --red` 가 돌려준 인계 사항을 본문에 싣는다.
- 본문 끝에 `PRP-Auto: true` trailer 를 붙인다.
- 작업 주체(Claude/Codex/에이전트)가 섞이면 본문에 `claude:` / `codex:` 줄로 구분할 수 있다. 강제는 아니다.

예 (GREEN):

```text
feat(P1): 토큰 회전 핵심 로직 구현

codex: rotation 구현 + audit 결함 2건 수정
claude: plan.md 에 누락 expiry 케이스 갱신

PRP-Auto: true
```

## 용어

- **plan.md**: phase 의 구현 방법(HOW).
- **audit --mini**: `sas-audit-code --mini`. 스코프는 「책임 경계」의 audit 항목을 따른다.

## 외부 의존

- Skill `sas-tdd-implement` (`.claude/skills/sas-tdd-implement/SKILL.md`).
- Skill `sas-audit-code` (audit --mini. 내부에서 `/cc-suite:audit` 호출).
- Skill `sas-visual-judge` (P3 판정).
