---
name: sas-prp-flow
description: PRP 진행 상태를 판정하고 다음 스텝을 안내한다. 사용자가 진행 상태를 묻거나 다음 스텝을 요청할 때 호출. PRD 본문 Implementation Phases 표를 1차 SSOT 로, git 상태·산출물 존재를 보조로 사용해 sas-prp-{prd|plan|task|pr} 중 다음 호출 후보를 제시. 권장 다음 스텝이 sas-prp-plan 또는 sas-prp-task 이면 진행 방식(자율 진행 / plan·task 호출마다 확인 / 단계마다 확인)을 사용자에게 확인하며 이때 현재 모델·effort 도 함께 보고하고, 선택 시 두 스킬을 반복 호출해 모든 phase 완료 상태까지 진행한다 — 확인 모드(plan·task 호출마다 또는 단계마다)는 각 확인 시점마다 계속 여부를 재확인해 원격(Claude 앱 등)에서도 진행·압축 타이밍을 조절할 수 있게 한다(중대한 이슈·특이사항 또는 하위 스킬 자체의 컨펌 요구 발생 시에는 진행 방식과 무관하게 즉시 정지하고 보고). PRD 생성과 PR 생성은 항상 사용자가 직접 호출한다 — 자율 진행 대상이 아니다.
allowed-tools: Read Glob Grep Bash Skill AskUserQuestion
---

# sas-prp-flow

PRP 플로우의 오케스트레이션 스킬. PRD 표와 산출물 존재를 읽어 진행 상태를 판정하고 다음 스텝을
권한다. 사용자가 고르면 plan 과 task 를 반복 호출해 PR 직전까지 진행한다.

## 트리거

사용자가 진행 상태를 묻거나 다음 스텝을 요청할 때.

## 입력

없음. 현재 작업 디렉토리와 브랜치를 기준으로 한다.

## 게이트

없음.

## 상태 판정

- SSOT 는 PRD 본문 `## Implementation Phases` 표의 Status 다. git 상태(commit, diff, 작업 트리)는 보조 근거다.
- 대상 PRD: 현재 브랜치가 `feat/{feature-kebab}` 이면 그 feature 의 PRD. 아니면 미머지 feature 브랜치 중 가장 최근 커밋 브랜치를 후보로 제시하고 사용자 확인을 받는다.

## 판정 표

| 관찰                                         | 판정                  | 권장 다음 스텝                            | 자율 진행 대상              |
| -------------------------------------------- | --------------------- | ----------------------------------------- | --------------------------- |
| PRD 미존재                                   | PRD 미작성            | `sas-prp-prd`                             | 아니오 — 사용자 직접 호출   |
| 모든 phase Status = `pending`                | Plan 미작성           | `sas-prp-plan`                            | 예 (컨펌 후)                |
| `in-progress` phase 1개 + plan 미생성        | 비정상 상태           | 보고하고 사용자에게 질의                  | 아니오                      |
| `in-progress` phase 1개 + plan 존재          | Phase 구현 단계       | `sas-prp-task` (해당 phase)               | 예 (컨펌 후)                |
| `in-progress` phase 가 다중 (Parallel)       | 사용자 선택 필요      | 사용자에게 phase 선택 요청                | 예 — 선택 후 자율 진행 유지 |
| `complete` 후 미완료 `pending` phase 존재    | 다음 phase 진입       | `sas-prp-plan` (phase 선택은 `/prp-plan`) | 예 (컨펌 후)                |
| 모든 phase Status = `complete` + 트리 클린   | PR 가능               | `sas-prp-pr`                              | 아니오 — 사용자 직접 호출   |
| 모든 phase Status = `complete` + 트리 미클린 | 미커밋 변경 확인 필요 | 변경 내역을 보고하고 사용자에게 질의      | 아니오                      |

여러 행에 해당하면 위에서부터 먼저 맞는 행을 따른다.

## 동작 모드

1. 판정 표에 따라 현재 상태와 권장 다음 스텝을 보고한다.
2. 권장이 `sas-prp-prd` 면 안내만 하고 멈춘다. PRD 는 최초 문서이자 구심점이라 사용자가 직접 부른다.
3. 권장이 `sas-prp-pr` 이면 PR 준비 완료를 보고하고 멈춘다. 그 결과는 호스트에서 사용자가 직접 확인해야 하므로 늘 사용자가 직접 부른다.
4. 권장이 `sas-prp-plan` 또는 `sas-prp-task` 면 `AskUserQuestion` 으로 진행 방식을 묻는다.
   - 자율 진행: `sas-prp-pr` 직전까지 가며 「중단 조건」에서만 멈춘다.
   - plan/task 호출마다 확인: 본 스킬이 직접 부르는 `sas-prp-plan`·`sas-prp-task` 가 끝날 때마다 「진행 확인」을 한다. 그 안에서 불리는 하위 스킬·에이전트(`sas-higency-persona`·`sas-stickler-persona`·`sas-tdd-guide`·Codex 등)은 대상이 아니다.
   - 단계(phase)마다 확인: phase 가 complete 로 바뀔 때만 「진행 확인」을 한다.
   - 질문과 함께 현재 모델·effort 를 알린다. 모델은 항상 확인할 수 있고, effort 는 세션의 최근 설정값이 있으면 그 값을, 불확실하면 `/model`·`/effort` 로 직접 확인하라고 덧붙인다. 의도치 않은 모델·effort 로 도는 것을 이 시점에 알아채게 하기 위해서다.
   - 셋 다 거부하면 해당 스텝만 안내하고 멈춘다.
   - 고르면 그 방식으로 「자율 진행」에 들어간다.

## 자율 진행

모든 phase 가 `complete` 이고 작업 트리가 깨끗한 상태, 곧 `sas-prp-pr` 직전에 이를 때까지 반복한다. 처음 고른 진행 방식은 루프 내내 유지한다.

1. 호출 전에 작업 트리가 깨끗한지 확인한다. 미커밋 변경이 있으면 「중단 조건」으로 보고한다. 판정에 따라 `sas-prp-plan`(phase 선택은 `/prp-plan`) 또는 `sas-prp-task`(대상 phase)를 부른다.
2. 호출이 끝나면, 「plan/task 호출마다 확인」이면 「진행 확인」을 한다.
3. 판정 표로 상태를 다시 읽는다.
4. `in-progress` phase 가 여럿(Parallel)이면 다음 phase 를 사용자에게 묻는다. 이 질문은 자율 진행을 취소하지 않으며, 고른 phase 로 계속한다.
5. phase 가 `complete` 로 바뀌었을 때 「단계(phase)마다 확인」이면 「진행 확인」을 한다. 그 외에는 1번으로 돌아간다.
6. 모든 phase 가 `complete` 이고 트리가 깨끗하면 멈추고 "PR 준비 완료, `sas-prp-pr` 직접 호출 필요"를 보고한다.
7. 「중단 조건」이 생기면 진행 방식과 무관하게 바로 멈추고 상황을 보고한 뒤 지시를 기다린다.

### 진행 확인

`AskUserQuestion` 으로 계속할지 묻는다.

- 계속: 판정 표에 따라 다음 스킬을 부른다.
- 정지: 자율 진행을 멈춘다. 이때 `/compact` 를 하고 `sas-prp-flow` 를 다시 부르면 PRD 표 기준으로 이어서 진행된다.

`AskUserQuestion` 은 원격 클라이언트(Claude 앱 등)에도 노출되므로, 사용자가 자리에 없어도 원격에서 답해 진행·정지 시점을 조절할 수 있다.

### 중단 조건

- `sas-prp-plan`·`sas-prp-task` 의 하드 게이트 실패(브랜치 불일치, PRD·plan 부재 등).
- `sas-higency-persona`·`sas-stickler-persona` 루프가 자율 임계치를 넘어 사용자 컨펌을 요구하는 경우. 그 컨펌을 이 스킬이 대신하지 않는다.
- `sas-audit-code`(`--mini`) 감사가 통과 판정을 내지 못하거나 결함이 해소되지 않는 경우.
- 예상과 다른 git 상태(작업 트리 미클린, 커밋 형식 불일치, 충돌 등).
- 그 밖에 하위 스킬이 사용자 컨펌을 요구하는 모든 지점. 이 스킬이 대신 답하지 않는다.

자율 진행 중에도 하위 스킬·에이전트(`sas-prp-plan`·`sas-prp-task`·`sas-higency-persona`·`sas-stickler-persona`)의 컨펌 요구·게이트·루프 제어는 그대로다. 본 스킬은 스텝 사이의 재호출 수고를 없앨 뿐, 하위 스킬·에이전트의 판단을 대신하거나 우회하지 않는다.

## 산출물

- 컨펌 전: 상태 판정 결과와 권장 다음 스텝 안내(텍스트).
- 자율 진행 후: 각 phase 의 plan/task 완료 커밋 이력과 최종 도달 상태(PR 준비 완료 / 중단 사유·지점 / 진행 확인에서 사용자가 정지를 고른 시점과 phase).

## DoD

- 컨펌 전: 현재 상태 판정과 권장 다음 스텝이 명시된 보고.
- 자율 진행 시: 모든 phase 완료(PR 준비 완료 보고), 중단 사유 명시, 진행 확인에서 사용자가 정지를 고른 시점 명시 중 하나로 종료.

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

### phase 상태 머신 (참고용)

PRD 본문 `## Implementation Phases` 표가 phase 상태 SSOT.

| 상태        | 전이                                              |
| ----------- | ------------------------------------------------- |
| pending     | PRD 생성 시 기본값 (`sas-prp-prd`)                |
| in-progress | plan 산출 시 `sas-prp-plan` 이 갱신               |
| complete    | phase 의 PRD 반영 단계에서 `sas-prp-task` 가 갱신 |

본 스킬은 Status 를 바꾸지 않는다.

### 커밋 메시지 형식 (참고용)

```text
<type>(<scope>): <subject>

<body>

PRP-Auto: true
```

| 시점                               | type       | scope    |
| ---------------------------------- | ---------- | -------- |
| sas-prp-prd                        | `docs`     | `prd`    |
| sas-prp-plan                       | `docs`     | `P{num}` |
| sas-prp-task RED                   | `test`     | `P{num}` |
| sas-prp-task GREEN                 | `feat`     | `P{num}` |
| sas-prp-task REFACTOR              | `refactor` | `P{num}` |
| sas-prp-task PRD 반영              | `docs`     | `prd`    |
| sas-prp-task·sas-prp-pr audit 수정 | `fix`      | `audit`  |

- 본문 끝의 `PRP-Auto: true` trailer 가 자체 생성 커밋의 식별 마커다.
- 형식에 맞지 않는 커밋은 작업 내용을 확인해 진행 상태를 추론하거나 사용자에게 묻는다.

## 용어

- **PRD**: `/docs/prds/{feature-kebab}/prd.md`. 모든 phase 의 정의·상태를 담는다.
- **Implementation Phases**: PRD 본문의 phase 상태 표. 본 플로우의 status SSOT.

## 후속 호출 후보

`sas-prp-prd`, `sas-prp-plan`, `sas-prp-task`, `sas-prp-pr`.
