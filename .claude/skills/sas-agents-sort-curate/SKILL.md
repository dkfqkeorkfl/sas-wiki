---
name: sas-agents-sort-curate
description: '`/agent-sort` 를 의존성으로 실행해 DAILY·LIBRARY 분류를 받아, 경고·안내(deprecated·대체·조건부) 스캔과 LIBRARY 상세 재분류·중복 제거를 수행하고, agent-sort 분류와 큐레이션을 통합한 8개 카테고리 ECC 설치 계획을 산출한다. ECC 자산을 프로젝트에 맞게 정리·큐레이션하거나 설치·제거·대체·조건부 결정을 구조화해야 할 때 호출.'
allowed-tools: Read, Glob, Grep, Skill
---

본 스킬은 `/agent-sort` 를 **의존성으로 직접 실행**해 그 분류 산출을 입력으로 받고, 경고·안내 스캔·LIBRARY 상세 재분류·중복 제거를 더해 **통합 전체 결과**를 산출한다. agent-sort 는 고정 출력 스키마가 없으므로, 실행해 나온 실제 산출을 그대로 사용한다.

## 목적

- `/agent-sort` 분류를 정제해 실제 설치·유지·제거 결정을 내릴 수 있는 구조화된 통합 출력을 제공한다.
- 본문·frontmatter 의 경고·안내를 자기지칭 판별과 함께 정확히 분기한다.
- 항목 중복·상충을 제거해 결정 부담을 줄인다.

## 전체 프로세스

```text
[의존성] /agent-sort 실행   ← 본 스킬이 호출
  - 스택 식별
  - DAILY / LIBRARY 분류 (LIBRARY 항목은 off-stack·비활성 사유 포함)
        │ (실제 산출을 그대로 입력으로 인계)
        ▼
[큐레이션] 본 스킬 본체
  - DAILY·설치 항목 경고·안내 스캔 → A-1 / A-2 / A-3 분기 (A-2 > A-3 > A-1)
  - LIBRARY 목록 → 고려 / 비권장 / off-stack 상세 재분류
  - 참조 항목 중복 제거
        │
        ▼
[통합 출력] agent-sort 의 DAILY 분류 + 큐레이션 상세를 통합한 전체 결과
```

## 입력

- **외부 호출 인자**: 없음. 본 스킬이 `/agent-sort` 를 실행해 입력을 자체 확보한다.
- **`/agent-sort` 산출(내부 인계)**: 고정 스키마를 가정하지 않는다. 실행해 나온 실제 산출을 그대로 입력으로 쓴다. 핵심은 **DAILY**(활성·유지)·**LIBRARY**(off-stack·비활성, 사유 포함) 분류이며, 본 스킬은 LIBRARY 를 상세 분류한다.
- **현재 설치 상태**: `~/.claude/{skills,commands,agents,rules}/`

## 출력

agent-sort 의 DAILY 분류 + 큐레이션 상세를 통합한 8개 카테고리 설치 계획 (「최종 출력 카테고리」·「출력 형식」 참조).

## 워크플로우

1. `Skill` 로 `/agent-sort` 를 실행해 분류 산출(DAILY·LIBRARY)을 확보한다. 실행 실패 시 원인 보고 후 종료.
2. `~/.claude/{skills,commands,agents,rules}/` 를 `Glob` 으로 리스트업해 현재 설치 상태를 조회한다.
3. DAILY·설치 항목 각 파일을 `Read`·`Grep` 으로 경고·안내 키워드 스캔하고 「자기지칭 판별」 을 적용한다.
4. **A-2 > A-3 > A-1** 우선순위로 분기한다. 한 항목이 복수 분기에 매칭되면 최상위 1개만 적용한다.
5. LIBRARY 목록을 「B. LIBRARY 목록 — 상세 재분류」 기준으로 고려 / 비권장 / off-stack 재분류한다.
6. 「C. 중복 제거」 규칙을 적용한다.
7. agent-sort 의 DAILY + 큐레이션 상세를 통합한 8개 카테고리를 「출력 형식」 에 따라 출력한다.
8. 결과 하단에 「검증 체크리스트」 를 스스로 체크하여 답한다.

## 큐레이션 규칙

### A. DAILY·설치 항목 — 경고·안내 스캔

본문·frontmatter 를 스캔해 **A-2 > A-3 > A-1** 우선순위로 분기한다.

#### A-1. uninstall 권장

대체 항목·프리퀴짓 안내 없이 폐기 안내만 있는 경우. subject 는 제거 대상.

키워드: `deprecated` / `will be removed` / `retained for one release` / `no longer maintained` / `legacy` (자기지칭 한정)

#### A-2. 대체 셋업

본문이 특정 대체 항목을 명시한 경우. subject 는 제거 대상, 대체 항목은 표에 이름만 노출.

키워드: `superseded by <name>` / `replaced by <name>` / `prefer <name> directly` / `use <name> instead` / `migrate to <name>`

체인: 대체 항목도 deprecated 면 최종 endpoint 까지 추적. 순환 감지 시 중단.

#### A-3. 조건부 셋업

본문이 특정 프리퀴짓·컴패니언 기능을 명시한 경우.

키워드: `requires <name>` / `depends on <name>` / `pairs with <name>` / `companion to <name>` / `works best with <name>` / `prerequisite: <name>`

- 프리퀴짓 설치됨 → subject 는 조건부 셋업 미노출
- 프리퀴짓 미설치 → subject 를 조건부 셋업에 리스팅 (필요 기능 이름 병기, 복수면 전체)

#### 자기지칭 판별 (A 전체 공통)

- frontmatter `deprecated: true`, `status: deprecated`, `replaces: <name>`, `requires: <name>` → 자기지칭
- 본문 상단 3~5줄 내 경고·안내 블록 → 자기지칭
- 본문 중간에서 다른 항목·도구 언급, 카탈로그·ADR 템플릿 내 출현 → 오탐 제외

자기지칭이 아닌 매칭은 경고 없음으로 처리.

### B. LIBRARY 목록 — 상세 재분류

agent-sort 가 LIBRARY 로 분류한 항목을 더 세분한다.

| 카테고리  | 기준                                   |
| --------- | -------------------------------------- |
| 고려      | 스택 적합하거나 테스트·학습 가치 있음. |
| 비권장    | 기능 중복, 대안 이미 설치됨.           |
| off-stack | 레포 스택과 명확히 불일치.             |

### C. 중복 제거

대체 셋업의 **대체 항목**, 조건부 셋업의 **필요 기능** 이 다른 카테고리(설치 필요·LIBRARY 재분류)에 있으면 해당 카테고리에서 제거. 참조 표에만 이름으로 노출.

동일 항목이 두 카테고리에 동시 노출되지 않도록 보장.

## 최종 출력 카테고리

통합 결과는 agent-sort 의 DAILY 분류를 이어받고, 큐레이션 상세(A 스캔 + LIBRARY 재분류)를 더한 전체다.

| #   | 카테고리          | 출처                                   |
| --- | ----------------- | -------------------------------------- |
| 1   | 유지·활성 (DAILY) | agent-sort DAILY 중 A 미플래그·설치됨  |
| 2   | 설치 필요         | agent-sort DAILY 중 A 미플래그·미설치  |
| 3   | uninstall 권장    | DAILY·설치 항목 (A-1)                  |
| 4   | 대체 셋업         | DAILY·설치 항목 (A-2)                  |
| 5   | 조건부 셋업       | DAILY·설치 항목 (A-3, 프리퀴짓 미설치) |
| 6   | 고려              | LIBRARY 재분류                         |
| 7   | 비권장            | LIBRARY 재분류                         |
| 8   | off-stack         | LIBRARY 재분류                         |

## 출력 형식

해당 없음 시 섹션 생략 또는 한 줄 요약.

타입 그룹과 「타입」 열은 agent-sort 가 분류하는 전체 자산 타입(skills · commands · agents · rules · hooks · scripts · extras)을 대상으로 한다. 아래 예시의 skills/commands/agents 표기는 예시이며 타입을 제한하지 않는다 — rules·hooks·scripts 분류가 있으면 동일 형식으로 함께 출력한다.

### 1. 유지·활성 (DAILY)

```text
skills
- skill-a, skill-b, ...

commands
- command-a, ...

agents
- agent-a, ...

rules
- rules/typescript, ...

hooks·scripts
- hook-a, script-a, ...
```

### 2. 설치 필요

```text
skills
- skill-c, ...

commands
- command-b, ...
```

### 3. uninstall 권장(deprecated)

```text
skills
- example-skill, ...

commands
- old-command, ...
```

### 4. 대체 셋업

| 이름      | 타입  | 대체 항목                        |
| --------- | ----- | -------------------------------- |
| old-skill | skill | function (skill or cmd or agent) |

### 5. 조건부 셋업

| 이름        | 타입  | 필요 기능                                                            |
| ----------- | ----- | -------------------------------------------------------------------- |
| child-skill | skill | function1 (skill or cmd or agent), function2 (skill or cmd or agent) |

### 6. 고려

| 이름          | 타입  | 기능 요약       | 고려 사유      |
| ------------- | ----- | --------------- | -------------- |
| example-skill | skill | 한 줄 기능 요약 | 부분 정합 사유 |

기능 요약 추출: SKILL.md frontmatter `description` → 본문 상단 → `-`

### 7. 비권장

| 이름 | 타입 | 비권장 사유 |
| ---- | ---- | ----------- |

### 8. off-stack

```text
skills
- django-patterns, swift-reviewer, ...

commands
- rails-migrate, ...
```

## 제약

- 키워드 매칭만으로 판단하지 않는다. **자기지칭 판별 필수**.
- `/agent-sort` 의 1차 분류(DAILY/LIBRARY)는 신뢰하고 재검증하지 않는다. 본 스킬은 LIBRARY 를 상세 분류하고 DAILY·설치 항목을 경고·안내 스캔할 뿐이다.
- 대체·프리퀴짓 이름 추출은 정규식 기반. 모호한 문장은 **사용자 확인으로 에스컬레이션**.

## 검증 체크리스트

각 항목은 결과 하단에 스스로 체크하며 답한다.

- [ ] 작업 중간에 불필요한 파일 수정 혹은 작업 확장이 있었는지 확인
- [ ] 의존성 `/agent-sort` 산출(DAILY·LIBRARY) 대비 작업 결과물에 빠진 항목 체크
- [ ] 분류 작업에 팩트가 아닌 추론이 있었는지 확인
- [ ] 통합 출력에 agent-sort 의 DAILY 분류가 반영됐는지 확인
