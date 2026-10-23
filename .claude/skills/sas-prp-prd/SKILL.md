---
name: sas-prp-prd
description: 새 기능 요구를 PRD 문서로 산출한다. `/docs/prds/{feature}/prd.md` 가 없을 때 호출. PRP 플로우 1단계. 사용자가 "PRD 작성", "기능 요구 정리", "phase 분해" 를 요청하거나 새 기능 개발을 시작할 때 사용. 요구 사항을 정리해 사용자 컨펌을 받은 뒤 `/prp-prd` 를 1번 호출해 PRD 를 쓰며, 그 안의 기술 타당성 리서치 단계는 거버넌스 가이드를 포함한 일잘러 에이전트로 대신한다. PRD 에 담기지 않은 합의·데이터 모델은 같은 폴더의 보조 문서로 보완한다.
allowed-tools: Read Write Edit Glob Grep Bash Skill Agent AskUserQuestion
---

# sas-prp-prd

PRP 플로우 1단계. 요구 사항을 정리해 사용자 컨펌을 받고, ECC `/prp-prd` 를 래핑해 PRD 와 보조
문서를 만들고 검수한 뒤 feature 브랜치에 커밋한다.

## 트리거

- 새 기능 요구·구현 요청이 들어왔고 PRD 가 없을 때.
- 사용자가 새 PRD 생성을 명시 요청할 때. 진행 상태와 무관하다.

## 입력

- 기능 요구 본문.
- 참조 자료(있으면).

## 게이트

하드 게이트 없음. 작업 트리에 미커밋 변경이 남아 있으면, 정리(커밋 등)를 권장한다. 이 권장은 게이트가 아니므로 진행을 막지 않는다.

## 절차

```text
1. 요구 정리·컨펌 — 사용자의 제안·요청과 대화에서 합의한 것을 목표, 범위와 범위 밖, 요구 사항 목록, 합의된 제약·선택, 미결 사항으로 정리해 컨펌을 받는다. 정정이 있으면 반영해 다시 받는다. 컨펌된 내용이 이후 단계의 입력이다.
2. 브랜치 — feat/{feature-kebab} 이 없으면 생성하고, 있으면 checkout.
3. /prp-prd 호출 — PRD 초안 생성. 1번 컨펌 내용을 입력에 넣고, 다음을 지시한다.
   · Phase 5(기술 타당성 리서치)는 `/prp-prd` 자체 로직 대신 `sas-higency-persona` 에이전트로 처리한다. Phase 3(시장·맥락 리서치)은 `/prp-prd` 자체 로직 그대로 둔다.
   · 리서치 범위 — 필수: 사실 확인(컨펌 내용의 전제가 사실인지)과 대안 탐색(요청한 방식보다 표준·관행에 비춰 더 나은 대안이나 시스템이 있는지. 패키지·알고리즘뿐 아니라 정적 분석기·린트·CI·프로세스도 대상이며, 더 나은 것이 있으면 제안한다). 자율: 그 외 무엇을 어떻게 만들지는 일잘러가 정한다 — 요청에 직접 닿는 것만 좁게 보지 않고 관련되거나 도움이 될 것을 폭넓게 살핀다.
   · 거버넌스 — 일잘러에게 `sas-governance-guide` 를 강제 1트랙으로 포함해 호출하게 한다(역할: 전체 방향성·표준 정립 — 아직 규칙이 없는 영역에 새 컨벤션을 제안하고 이를 강제할 하네스까지 함께 제시). 그 외 최대 3트랙까지는 일잘러가 자율로 고른다.
   · 생략 허용 — 신규 외부 의존·버전 호환성 판단이 없어 기존 확립된 패턴만 쓰는 경우, 또는 사용자가 명시 지시한 경우. 그 외에는 생략하지 않는다. 중대한 선택·불확실성은 사용자 컨펌 후 진행.
   · 산출 — 일잘러의 결과는 `docs/prds/{feature-kebab}/research.md` 로 남기고(공신력 있는 외부 출처만 인용하며 PRD 는 참조하지 않는다), 그 내용을 Phase 5 의 결과로 삼아 나머지 단계(Phase 6 DECISIONS·Phase 7 GENERATE)를 계속한다. 생략했으면 research.md 를 만들지 않는다.
   · PRD `## Research Summary` 의 Technical Context 에는 research.md 의 요약만 반영한다(전체를 옮기지 않는다). Market Context 는 Phase 3 결과를 그대로 반영한다. research.md 의 존재 자체가 수행의 증거이므로 별도 표기가 필요 없다. 생략했으면 `SAS Research: 생략 — {사유}` 한 줄을 적는다. 결과에 이 줄이 없으면 그 한 줄만 보강한다.
4. 보조 문서 — 컨펌 내용 중 PRD 와 research.md 에 담기지 않은 것은 같은 폴더에 md 파일로 보완한다. 합의한 계약은 contract.md, 데이터 모델은 data-model.md 처럼 내용에 맞는 이름을 쓰고, 무엇을 만들지는 Claude 가 정한다. PRD 끝 「## 보조 문서」 절에 파일 목록을 적는다. 없으면 절을 만들지 않는다.
5. 완전성 검수 — `sas-stickler-persona` 에이전트로 커버리지를 판정한다. (a) 1번 컨펌 내용이 PRD 와 보조 문서에 빠짐없이 반영됐는지, (b) research.md 가 있으면 그 핵심이 PRD `## Research Summary` 요약에서 빠지지 않았는지, (c) research.md 가 없으면 `## Research Summary` 에 `SAS Research: 생략 — {사유}` 가 있고 그 사유가 3번 허용 조건에 맞는지. 문서 품질과 리서치 결과의 타당성은 보지 않는다. 미충족은 PRD 나 보조 문서를 보강해 재검수하고, 생략 사유가 허용 조건 밖이면 3번으로 돌아간다.
6. 산출물 검증 — Implementation Phases 표가 채워졌고 모든 phase Status = pending.
7. 커밋 — PRD·research.md·보조 문서를 한 커밋으로. type=docs, scope=prd, 본문 끝 `PRP-Auto: true` trailer.
```

## 산출물

- `/docs/prds/{feature-kebab}/prd.md` — `/prp-prd` 스키마 + `## Implementation Phases` 표(모든 phase `pending`).
- `/docs/prds/{feature-kebab}/research.md` — 일잘러가 리서치를 생략하지 않았으면 생성.
- 같은 폴더의 그 외 보조 문서(있으면) — contract.md, data-model.md 등.
- 브랜치 `feat/{feature-kebab}`.

## DoD

- 1번 요구 정리가 사용자 컨펌을 받음.
- PRD 생성, Implementation Phases 표 작성, 모든 phase Status = `pending`.
- 보조 문서가 있으면 PRD 「## 보조 문서」 절에 목록이 있음.
- 완전성 검수 통과. 빠진 항목이 남아도 되는 것은 사용자가 미결로 두기로 한 항목뿐이며, 사유를 적어 남긴다. research.md 가 있거나, 없으면 `## Research Summary` 에 `SAS Research: 생략 — {사유}` 표기 존재.
- 브랜치 `feat/{feature-kebab}` 진입.
- 커밋 완료.

## 후속

`sas-prp-plan` 진입 가능.

---

## 공통 규약

### 디렉토리 구조

```text
docs/prds/
└── {feature-kebab}/
    ├── prd.md
    ├── research.md
    ├── contract.md 등 보조 문서(있으면)
    └── P{num}.{phase-kebab}/
        ├── plan.md
        └── research.md
```

본 스킬은 `prd.md` 와 보조 문서를 산출한다. `P{num}.{phase-kebab}/` 하위는 `sas-prp-plan` 이 만든다.

### 브랜치 네이밍

- Feature 브랜치: `feat/{feature-kebab}`. 1 PRD = 1 브랜치.
- 본 스킬 최초 진입 시 없으면 생성한다.

### phase 상태 머신

PRD 본문 `## Implementation Phases` 표가 phase 상태 SSOT.

| #   | Phase        | Description                | Status  | Parallel | Depends | PRP Plan |
| --- | ------------ | -------------------------- | ------- | -------- | ------- | -------- |
| 1   | {Phase name} | {What this phase delivers} | pending | -        | -       | -        |

- Status 값: `pending` | `in-progress` | `complete`.
- 본 스킬은 모든 phase 를 `pending` 으로 작성한다. 이후 전이는 다른 스킬의 몫이다.

### 커밋 메시지 형식

```text
<type>(<scope>): <subject>

<body>

PRP-Auto: true
```

본 스킬의 PRD 첫 생성 커밋: `type=docs`, `scope=prd`. 커밋은 본 스킬을 호출한 에이전트가 한다. 이 스킬이 부른 스킬·에이전트·커맨드는 커밋하지 않는다.

예:

```text
docs(prd): 인증 토큰 회전 기능 PRD 작성

PRP-Auto: true
```

## 용어

- **PRD**: `/docs/prds/{feature-kebab}/prd.md`. 모든 phase 의 정의·상태를 담는다.
- **research.md**: 일잘러가 Phase 5(기술 타당성 리서치)에서 모은 사실·대안·근거의 아카이브. PRD 의 `## Research Summary` 중 Technical Context 는 이 요약만 담는다. 공신력 있는 외부 출처만 인용하며 PRD 를 참조하지 않는다.
- **보조 문서**: PRD 에 담기지 않은 합의·데이터 모델을 담는 같은 폴더의 md 파일. PRD 와 함께 아카이빙된다.
- **Implementation Phases**: PRD 본문의 phase 상태 표. 본 플로우의 status SSOT.

## 외부 의존

- ECC `/prp-prd` — `Skill` 도구로 `prp-prd` 이름 그대로 먼저 호출한다. ECC 버전에 따라 스킬·커맨드 어느 쪽으로 등록됐든 호출할 수 있고, 노출된 스킬 목록에 없어도 시도한다. 미등록 오류로 실패할 때만 `~/.claude/commands/prp-prd.md` 를 Read 해 전문 그대로 수행한다. 요약·생략하지 않는다.
- Agent `sas-higency-persona`.
- Agent `sas-stickler-persona`.
