# Wiki document harness

## Problem Statement

실제 문서 검사가 `validate` CLI와 Vitest 하네스로 나뉘고, 하네스 회귀 테스트까지 pre-push에서 실행된다. 규칙을 추가할 때 검사 위치와 실행 책임이 불분명하고 빌드는 검증을 중복 실행한다.

## Evidence

- 사용자는 문서 집행 검사와 스크립트 테스트만 CI·Git 훅에서 강제하고, 검사 장치 자체의 회귀 테스트는 수동으로 실행하도록 확정했다.
- 현재 `build`와 `build-dev`는 validate → summary → feeds를 호출한다.
- 기존 테스트에는 `validate.mjs`의 함수 import, CLI 실행, 문서·설정 원문 검사가 섞여 있다. 소비처를 함께 이전해야 제거가 가능하다.

## Proposed Solution

실제 문서 유효성 검사는 `harness/wiki-documents/`, 검사 장치의 회귀 검증은 `harness/validation-regression/`으로 구분한다. 일반 테스트는 `scripts/`의 대상 옆에 둔다. `test`·`test:coverage`는 스크립트와 문서 집행 검사만 실행하고, `test:harness`는 수동 회귀 검증만 실행한다. 검사가 이전된 뒤 validate CLI를 제거하고 빌드는 운영 산출물 생성만 담당한다.

## Key Hypothesis

검사와 실행 경로를 역할별로 나누면 규칙 누락과 중복 실행을 줄일 수 있다. 기존 검사 목록의 모든 항목에 새 집행 위치가 있고, 일반 테스트·수동 회귀 테스트·운영 빌드가 각각 성공하면 완료로 판정한다.

## What We're NOT Building

- 린트·커스텀 룰·TypeScript 전환·새 외부 의존성.
- 프론트엔드 변경, 문서 내용 추가, 기존 기업 자료 재감사.
- 원격 push, PR 생성, 실제 배포·릴리즈 발행.
- 보호 훅 해제나 우회.

## Success Metrics

| Metric           | Target                                        | How Measured                      |
| ---------------- | --------------------------------------------- | --------------------------------- |
| 검사 이전        | 기존 규칙 전부에 집행 위치 존재               | 검사 대응표·실제 문서 검사        |
| 기본 테스트 범위 | scripts + wiki-documents, 수동 회귀 제외      | Vitest 수집 확인·수동 계약 테스트 |
| 수동 테스트 범위 | validation-regression만                       | 별도 Vitest 설정·수집 확인        |
| 실행 연결        | 훅은 test, CI는 test:coverage 이후 prod build | 실패 전파 테스트·워크플로 계약    |
| 빌드             | validate 호출 없이 prod summary·feeds 생성    | 실제 build와 산출물 확인          |
| 품질             | 기존 coverage floor 유지                      | test:coverage                     |

## Users & Context

**Primary User:** 문서 작성자와 sas-wiki 스크립트 유지보수자.

**Job to Be Done:** 문서를 고치거나 규칙을 추가할 때, 같은 테스트 명령으로 실제 문서의 오류를 차단하고 하네스 변경 시에는 별도 회귀 검증을 수행한다.

**Non-Users:** 위키를 조회하는 웹 사용자는 테스트를 실행하지 않는다.

## Solution Detail

| Priority | Capability                                           | Rationale                    |
| -------- | ---------------------------------------------------- | ---------------------------- |
| Must     | 기존 ID·스키마·히스토리·링크·피드·산출물 불변식 이전 | 검사 누락 방지               |
| Must     | 파일명 제목·TREND/REPORT 날짜 규칙 집행              | 기존 합의 유지               |
| Must     | dev 전체 문서 + prod 참조 관계 검사                  | draft가 가리는 오류도 검출   |
| Must     | 수동 회귀와 자동 집행의 수집 분리                    | 실행 책임 명확화             |
| Must     | validate 제거·소비처 갱신                            | 죽은 명령과 호환 껍데기 제거 |
| Must     | 운영 빌드·CI 산출물 저장                             | 동일 커밋의 릴리즈 입력 확보 |
| Won't    | 린트 도입                                            | 후속 작업                    |

### Directory and naming

- 기능 스크립트와 런타임 공통 코드는 `scripts/`에 유지한다.
- `harness/wiki-documents/`: 실제 문서 집행 검사. `harness/validation-regression/`: 검사 장치 자체의 수동 회귀 검사.
- 테스트는 각 대상 폴더의 `__tests__/` 바로 아래에 두며 그 안에 하위 폴더를 만들지 않는다.
- 폴더·하네스 파일은 kebab-case, 일반 모듈은 camelCase. 단일 소스 테스트는 소스 이름과 대소문자까지 맞춘다. 다중 파일 테스트는 확인하는 일로 이름을 짓는다.
- 단일 테스트 전용 도우미는 테스트 파일 안에 둔다. 둘 이상의 테스트 모듈에서 쓰는 도우미는 `scripts/test-utils/` 또는 `harness/test-utils/`에 둔다. 제품 코드는 이를 import하지 않는다.
- 정적 픽스처는 대상 옆 `__fixtures__/`. 역할별 test-utils 사이 import를 피하고, 테스트 지원 코드는 제품 커버리지에서 제외한다.
- 기존 `.mjs`를 유지하며 이번 변경과 관련 없는 전수 개명은 하지 않는다.

### Commands

| Command           | Responsibility                                  |
| ----------------- | ----------------------------------------------- |
| test              | scripts 기능 테스트 + 실제 wiki 문서 집행       |
| test:coverage     | 같은 범위 + 기존 coverage floor                 |
| test:harness      | 검사 장치 회귀 검증, 수동 실행 전용             |
| build / build-dev | 각 환경 summary·feeds 생성, 전체 검증 호출 없음 |

### Existing document contracts

- 제목은 `.md`를 제외한 파일명 전체다. 작성 frontmatter에는 title을 두지 않으며 API의 title은 유지한다.
- TREND·REPORT는 `wiki/{종류}/YYYY-MM/DD. 제목.md`. meta.asOf와 첫 본문의 기준일은 경로 날짜와 같아야 한다.
- ID 자동 생성·검증 pre-commit 훅을 유지한다.
- 조회·생성의 파싱·가시성·문서 제외 의미와 산출물 계약은 유지한다. 전체 무결성 집행만 테스트가 소유한다.

## Technical Approach

**Feasibility:** 기존 Vitest·파서·무결성 함수를 재사용한다. 신규 외부 의존성 없이 구현한다.

- 이전 중에는 기존 validate를 유지하고 대체 검증을 확인한 뒤 제거한다.
- 옛 CLI 인자·stdout만 검증하는 테스트는 명령 제거와 함께 정리한다. CLI 테스트가 포함하던 실질 규칙·진단 검증은 함수 호출 회귀로 보존한다.
- 문서 전체를 각 규칙마다 재파싱하지 않고, 환경별 검사에서 파싱 결과를 공유한다.
- 수동 회귀는 잘못된 픽스처가 실패하고 정상 픽스처가 통과함을 검증하며 수집·훅 실패 전파도 확인한다.
- CI는 full-history checkout → format → test:coverage → prod build → 산출물 저장 순서다. 실제 릴리즈 발행은 하지 않는다.
- 구현·리뷰·문서 검수는 Codex가 직접 수행한다. Claude 전용 Skill/cc-suite 호출을 실행했다고 기록하지 않는다.

| Risk                                | Mitigation                                                       |
| ----------------------------------- | ---------------------------------------------------------------- |
| validate 소비처 누락                | imports·spawn·설정·README 대응표 작성                            |
| fixture title과 실제 작성 정책 충돌 | 실제 문서 집행과 검사기 회귀의 입력 범위 구분                    |
| 환경별 가시성 차이                  | dev·prod 집행 각각 실행                                          |
| 느린 실 vault 테스트                | 환경별 파싱 공유·변경 범위부터 검증·최종 안정 상태에서 전체 실행 |
| 보호 경로 수정 차단                 | 변경안을 스크래치패드에서 준비하고 사용자 직접 적용; 우회 금지   |

## Implementation Phases

| #   | Phase                 | Description                              | Status   | Parallel | Depends | PRP Plan                          |
| --- | --------------------- | ---------------------------------------- | -------- | -------- | ------- | --------------------------------- |
| 1   | current-checks        | 기존 검사·호출·소비처 조사와 이전 대응표 | complete | -        | -       | [plan](P1.current-checks/plan.md) |
| 2   | document-tests        | 실제 문서 집행을 테스트로 이전           | pending  | -        | 1       | -                                 |
| 3   | validation-regression | 수동 회귀·수집 분리·실패 전달 검증       | pending  | -        | 2       | -                                 |
| 4   | pipeline-transition   | validate 제거·빌드·훅·CI·가이드 전환     | pending  | -        | 3       | -                                 |

### Phase Details

- P1: 규칙별 기존 위치·새 위치·검증 수단과 제거할 CLI 전용 계약을 기록한다.
- P2: 전량 검사와 문서 작성 규칙을 새 테스트 위치에서 실행하고 기존 문서를 수정하지 않고 통과시킨다.
- P3: 잘못된 문서의 검출력과 자동/수동 수집 분리를 검사한다. 하네스 개발 때 수동 실행한다.
- P4: 새 검사 작동을 확인한 뒤 옛 명령을 제거하고 전체 테스트·커버리지·운영 산출물을 검증한다.

**Parallelism:** 실행 경로 전환이 앞 단계 검사를 전제로 하므로 phase는 순차 진행한다.

## Decisions Log

| Decision  | Choice                                   | Rationale                            |
| --------- | ---------------------------------------- | ------------------------------------ |
| 작업 문서 | sas-wiki/docs/prds/wiki-document-harness | 사용자 지정                          |
| 브랜치    | feat/wiki-document-harness 유지          | 기존 작업에서 이어서 진행하도록 승인 |
| 회귀 검사 | test:harness로 수동 실행                 | 사용자 최종 정정                     |
| 커밋      | 로컬만, push 금지                        | 사용자 승인 범위                     |
| PRP 실행  | 산출물·완료 기준 유지, Codex 직접 수행   | 현재 도구 환경에 맞춘 승인된 대체    |

## Research Summary

**Market Context:** 내부 검사 체계의 재구성이며 시장 기능을 추가하지 않는다. 입력 요구와 저장소 관행을 근거로 한다.

**Technical Context:** 기존 Vitest, parseVault, 문서 게이트, 무결성 함수와 Git 훅을 재사용한다. `/workspace/docs/prds/convention-harness-unification/`의 이름·배치 규칙을 적용한다.

SAS Research: 생략 — 신규 외부 의존·버전 변경 없이 기존 확립된 내부 패턴을 재배치한다. P1의 저장소 조사·소비처 확인은 수행한다.

## Open Questions

- 보호 경로 적용은 사용자 실행이 필요할 수 있다. 대체 파일·명령을 구체화한 뒤 안내한다.
- 제거할 validate CLI를 외부 소비자가 전제하는 경우 생산자 변경과 함께 필요한 소비자 변경을 별도로 보고한다.

_Generated: 2026-10-22_
_Status: approved scope; implementation pending_
