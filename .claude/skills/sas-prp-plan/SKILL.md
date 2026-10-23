---
name: sas-prp-plan
description: 다음 pending phase 의 plan.md 를 생성한다. PRD 가 존재하고 사용자가 phase Plan 작성을 요청할 때 호출. PRP 플로우 2단계. `/prp-plan` 을 1번 호출해 phase 선택부터 plan.md 산출까지 처리하며, 그 안의 리서치 단계는 거버넌스 가이드를 포함한 일잘러 에이전트로 대신한다. 완전성 검수 후 단일 커밋으로 묶는다.
allowed-tools: Read Write Edit Glob Grep Bash Skill Agent
---

# sas-prp-plan

PRP 플로우 2단계. ECC `/prp-plan` 을 래핑해 다음 phase 의 plan.md(HOW)를 만들고 검수한 뒤, PRD
표 갱신과 함께 한 커밋으로 남긴다.

## 트리거

- PRD 의 `## Implementation Phases` 표에 `pending` phase 가 있고, 다음 phase 구현 직전.
- 사용자가 phase Plan 작성을 요청할 때.

## 입력

- 대상 PRD(현재 브랜치에서 식별).
- PRD 와 같은 폴더의 보조 문서(있으면).

phase 선택은 `/prp-plan` 의 자동 선택을 따른다. 본 스킬은 선택 규칙을 두지 않는다.

## 게이트 (하드)

다음을 모두 충족하지 않으면 즉시 중단하고 사유를 안내한다.

- 현재 브랜치 = `feat/{feature-kebab}`.
- `pending` phase 가 있는 `prd.md` 존재.

미충족 시 PRD 생성이나 브랜치 전환을 안내한다. 그 밖에 작업 트리에 미커밋 변경이 남아 있으면, 이전 단계(`sas-prp-prd`)의 산출물이 아직 정리되지 않았을 가능성을 짚어 정리를 권장한다. 이 권장은 게이트가 아니므로 진행을 막지 않는다.

## 절차

```text
1. /prp-plan 호출 — phase 를 고르고 plan.md 를 생성한다. 보조 문서가 있으면 참조 파일로 함께 넘긴다. 다음을 지시한다.
   · Phase 3(리서치)는 `/prp-plan` 자체 로직 대신 `sas-higency-persona` 에이전트로 처리한다.
   · 거버넌스 — 일잘러에게 `sas-governance-guide` 를 강제 1위임으로 포함해 호출하게 한다(역할: 이 phase 의 구체적 구현 현장 가이드 — 예: IPC 반환 형식, 특정 패턴의 채택 여부 같은 실무 규칙). 그 외 최대 3위임까지는 일잘러가 자율로 고른다.
   · 생략 허용 — 신규 외부 의존·버전 호환성 판단이 없어 기존 확립된 패턴만 쓰는 경우, 또는 사용자가 명시 지시한 경우. 그 외에는 생략하지 않는다. 중대한 선택·불확실성은 사용자 컨펌 후 진행.
   · 산출 — 일잘러의 결과는 `docs/prds/{feature-kebab}/P{num}.{phase-kebab}/research.md` 로 남기고(경로는 이 호출이 고른 phase 번호·이름을 따르며, 공신력 있는 외부 출처만 인용하고 PRD 는 참조하지 않는다), 그 내용을 Phase 3 의 결과로 삼아 Phase 4·5·6을 계속한다. 생략했으면 research.md 를 만들지 않는다.
   · plan.md 의 `## Notes` 에는 research.md 의 요약만 반영한다(전체를 옮기지 않는다). research.md 의 존재 자체가 수행의 증거이므로 별도 표기가 필요 없다. 생략했으면 `SAS Research: 생략 — {사유}` 한 줄을 적는다. 결과에 이 줄이 없으면 그 한 줄만 보강한다.
2. plan.md 검증 — PRD 와의 정합, Codex 위임 적합성(범위·산출물 명시 충분).
3. 완전성 검수 — `sas-stickler-persona` 에이전트로 커버리지를 판정한다. (a) 이 phase 에 해당하는 PRD·보조 문서 항목이 plan.md 에 빠짐없이 반영됐는지, (b) research.md 가 있으면 그 핵심이 plan.md `## Notes` 요약에서 빠지지 않았는지, (c) research.md 가 없으면 `## Notes` 에 `SAS Research: 생략 — {사유}` 가 있고 그 사유가 1번 허용 조건에 맞는지. 문서 품질과 리서치 결과의 타당성은 보지 않는다. 미충족은 plan.md 를 보강해 재검수하고, 생략 사유가 허용 조건 밖이면 1번으로 돌아간다.
4. 커밋 — plan.md 와 research.md, /prp-plan 이 갱신한 PRD 표(해당 phase Status = in-progress)를 한 커밋으로. type=docs, scope=P{num}, 본문 끝 `PRP-Auto: true` trailer.
```

## 검증 기준

1. **plan.md**: PRD 와의 정합, Codex 위임 적합성(범위·산출물 명시 충분).
2. **완전성**: 이 phase 에 해당하는 PRD·보조 문서 항목이 plan.md 에 빠짐없이 반영되고, research.md 가 있으면 그 핵심이 plan.md 요약에서 빠지지 않았으며, research.md 가 없으면 `## Notes` 에 `SAS Research: 생략 — {사유}` 가 있고 사유가 허용 조건에 맞음. `sas-stickler-persona` 가 커버리지만 판정하며 문서 품질과 리서치 결과의 타당성은 보지 않는다.

## 안전 규칙

`--no-verify` 등 커밋 훅 우회 옵션은 사용자 명시 요청 시에만 사용한다.

## 산출물

- `/docs/prds/{feature-kebab}/P{num}.{phase-kebab}/plan.md` — 구현 방법(HOW). `/prp-plan` 스키마 준수.
- `/docs/prds/{feature-kebab}/P{num}.{phase-kebab}/research.md` — 일잘러가 리서치를 생략하지 않았으면 생성.
- PRD 표 해당 phase Status = `in-progress`(같은 커밋에 포함).

## DoD

- plan.md 생성과 커밋 완료.
- 완전성 검수 통과(검증 기준 2). 빠진 항목이 남아도 되는 것은 사용자가 미결로 두기로 한 항목뿐이며, 사유를 적어 남긴다.
- PRD 표 해당 phase Status = `in-progress`.

## 후속

`sas-prp-task` 진입 가능.

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

### 브랜치 네이밍

- Feature 브랜치: `feat/{feature-kebab}`. 1 PRD = 1 브랜치. `sas-prp-prd` 가 만든다.

### phase 상태 머신

PRD 본문 `## Implementation Phases` 표가 phase 상태 SSOT.

- `pending → in-progress`: 본 스킬이 plan 산출 시점에 갱신.
- `in-progress → complete`: `sas-prp-task` 가 phase 의 PRD 반영 단계에서 갱신.

### 커밋 메시지 형식

```text
<type>(<scope>): <subject>

<body>

PRP-Auto: true
```

본 스킬의 plan 산출 커밋: `type=docs`, `scope=P{num}`. 본문에 plan 갱신 사유를 적는다. 커밋은 본 스킬을 호출한 에이전트가 한다. 이 스킬이 부른 스킬·커맨드는 커밋하지 않는다.

예:

```text
docs(P1): phase 1 plan 작성

토큰 회전 알고리즘 + 만료 처리 분기 정의.

PRP-Auto: true
```

## 용어

- **PRD**: `/docs/prds/{feature-kebab}/prd.md`. 모든 phase 의 정의·상태를 담는다.
- **plan.md**: 특정 phase 의 구현 방법(HOW).
- **research.md**: 일잘러가 리서치에서 모은 사실·대안·근거의 아카이브. plan.md 의 `## Notes` 는 이 요약만 담는다. 공신력 있는 외부 출처만 인용하며 PRD 를 참조하지 않는다.

## 외부 의존

- ECC `/prp-plan` — `Skill` 도구로 `prp-plan` 이름 그대로 먼저 호출한다. ECC 버전에 따라 스킬·커맨드 어느 쪽으로 등록됐든 호출할 수 있고, 노출된 스킬 목록에 없어도 시도한다. 미등록 오류로 실패할 때만 `~/.claude/commands/prp-plan.md` 를 Read 해 전문 그대로 수행한다. 요약·생략하지 않는다.
- Agent `sas-higency-persona`.
- Agent `sas-stickler-persona`.
