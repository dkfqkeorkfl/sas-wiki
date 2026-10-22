# Plan: 검사 장치 회귀와 자동·수동 실행 분리

## Summary

실제 문서를 검사하는 가드는 자동 제품 테스트에 두고, 가드·검사기의 동작과 설정 연결을 확인하는 회귀는 수동 `test:harness`로 분리한다. 기존 회귀를 재사용하고 임시 입력으로 검출력·오류 전달을 확인한다. 작업과 커밋은 sas-wiki 안에서만 진행한다.

## User Story

위키 유지보수자로서 문서를 고칠 때 기능·문서 검사를 자동 실행하고, 검사기를 고칠 때는 별도 수동 회귀로 검출력과 실행 연결을 확인하고 싶다.

## Problem → Solution

현재 기본 Vitest는 scripts와 실제 문서 가드를 수집하지만 `test:harness`도 같은 설정에서 harness를 필터링해 실제 가드를 다시 실행한다. 평탄한 `harness/document-rules.test.mjs` 회귀는 이 명령에 수집되지 않는다. pre-push도 이 잘못된 수동 명령을 호출한다.

수동 전용 설정에서 validation-regression만 수집하고, 기본 test/coverage는 같은 기본 설정에서 scripts+실제 문서 가드를 수집한다. pre-push는 일반 test를 실행하고 기존 validate 단계는 P3까지 유지한다.

## Metadata

- Complexity: Medium
- Source PRD: ../prd.md
- PRD Phase: P2 harness-regression
- Dependency: P1 complete
- Estimated Files: 약 12개 코드·설정·가이드 파일과 이 계획·PRD
- Repository: `/workspace/sas-wiki`, `feat/wiki-document-harness`

## UX Design

내부 개발 명령 변경이며 웹 화면의 변화는 없다.

| Touchpoint           | Before                                | After                                 |
| -------------------- | ------------------------------------- | ------------------------------------- |
| test / test:coverage | scripts+실제 가드                     | 동일 대상, 빈 수집 명시 실패          |
| test:harness         | 실제 가드를 다시 실행, 기존 회귀 누락 | 검사기·가드·배선 회귀만 수동 실행     |
| pre-push             | test:harness → validate               | test → validate, P3에서 validate 제거 |
| README 개발 안내     | 실제 문서와 회귀를 혼용               | 자동 집행·수동 회귀 구분              |

## Mandatory Reading

| Priority | File                                                             | Lines / Section      | Why                                         |
| -------- | ---------------------------------------------------------------- | -------------------- | ------------------------------------------- |
| P0       | ../contract.md                                                   | C1–C3, C7–C10        | 소유·명명·수집·실패·범위                    |
| P0       | harness/document-rules.test.mjs                                  | 전체                 | 보존할 기존 정상·위반 회귀                  |
| P0       | harness/wiki-documents/document-rules.mjs                        | 전체                 | 작성 규칙과 진단 코드                       |
| P0       | harness/wiki-documents/**tests**/document-rules.guard.test.mjs   | 전체                 | 실제 집행 대상, repo 좌표·빈 입력·보고 실패 |
| P0       | vitest.config.js, package.json                                   | test / scripts       | 기본 수집·환경·coverage floor               |
| P0       | .husky/pre-push                                                  | 전체                 | 수동 명령 제거와 실패 전달                  |
| P1       | scripts/**tests**/hooks.plumbing.test.mjs                        | 전체                 | 설정 계약과 실제 validate 기능 테스트 분리  |
| P1       | scripts/**tests**/ci.plumbing.test.mjs                           | 전체                 | 수동으로 옮길 CI 연결 계약                  |
| P1       | .github/workflows/ci.yml                                         | 전체                 | 현재 자동 명령과 간접 실행 조사             |
| P1       | README.md                                                        | 개발 / git 훅과 CI   | 변경한 명령의 실제 안내                     |
| P2       | /workspace/docs/prds/convention-harness-unification/rules.md     | R-B1·B2·B4, R-N13–18 | 읽기 전용 부모 명명 기준                    |
| P2       | /workspace/docs/prds/convention-harness-unification/decisions.md | 5절                  | guard / contract / 일반 동작의 의미         |

## Discovery and Traces

| Category / Trace | Evidence                                                                      | Decision                                                        |
| ---------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------- |
| 진입·수집        | package test와 coverage는 같은 vitest.config.js 사용                          | 수집 정의를 복제하지 않음                                       |
| 수동 진입        | test:harness의 `vitest run harness`                                           | 전용 config를 지정해 include를 교체                             |
| 작성 규칙 데이터 | inspectDocument(relativeFile, parsed) → issue[]                               | 기존 96개 회귀를 이동, 기대 판정을 보존                         |
| 집행·상태        | 실제 가드가 파일 수집·parse·inspect·dev/prod buildContent 호출                | 원본 가드의 임시 사본을 격리 실행, 실제 wiki·Git·logs 접근 방지 |
| 실패·로그        | guard의 상대 경로·PARSE, buildContent 예외, report.error·경고                 | 자식 Vitest 종료코드와 출력으로 실패 전달 확인                  |
| 설정·환경        | 기본 Git 설정 격리, hook/test timeout, coverage 86/76/92/89                   | 수동 설정도 공통 환경 상속, floor 유지                          |
| 도우미           | 새 자식 Vitest 실행이 가드 회귀·수집 계약에 필요                              | 두 소비처 공유 코드만 harness/test-utils/vitest-probe.mjs       |
| 훅 연결          | hooks.plumbing의 앞부분은 설정·실행 연결, 마지막은 실제 validate 중복 ID 차단 | 앞부분만 수동 계약으로 이동, 실제 기능은 자동 유지              |
| CI 연결          | ci.plumbing은 workflow 설정만 검사                                            | 수동 ci-pipeline.contract.test.mjs로 이동, workflow 자체 유지   |
| 참조             | README·package·pre-push에서 test:harness 참조                                 | 자동·간접 실행을 재검색, 안내를 실제 중간 상태에 맞춤           |
| 의존성·스키마    | 기존 Vitest·Node fs/child_process, parser 재사용                              | 신규 의존성·스키마·제품 처리 변경 없음                          |

## External Documentation

신규 외부 API·의존성·버전 선택은 없다. 설치된 Vitest 4.1.10의 `vitest list --help`에서 `--filesOnly`, `--json`, `--coverage`, `--root`, `--config`, `--passWithNoTests`를 확인한다. 설정은 기존 defineConfig 객체 패턴을 사용한다.

## Patterns to Mirror

### Naming and test structure

기존 `harness/wiki-documents/__tests__/document-rules.guard.test.mjs`의 분야/직접 **tests** 배치를 따른다. 검사기 동작은 `document-rules.test.mjs`, 가드 실행 동작은 `document-enforcement.test.mjs`, 명령·훅·CI 연결은 `.contract.test.mjs`로 구분한다. 테스트 제목에 계획·진행 식별자를 추가하지 않는다.

### Input and error handling

기존 회귀의 `expect(inspectDocument(file, doc())).toEqual([])`와 개별 issue.code 단언을 유지한다. 가드 회귀는 정상 입력과 단일 결함 입력을 쌍으로 실행하고 종료코드뿐 아니라 경로·진단을 확인한다. 자식 프로세스의 error/signal·timeout은 검사 위반과 구분해 즉시 실패시킨다.

### Configuration

기본 설정의 `include: ['scripts/**/*.test.mjs', 'harness/wiki-documents/__tests__/*.test.mjs']`를 유지한다. 새 vitest.harness.config.js는 기본 설정을 import해 Git 환경·시간 예산을 상속하고 include만 validation-regression으로 교체한다. 수동 실행은 coverage 계측을 끄고 test/coverage는 기존 floor와 제품 분모를 유지한다.

### Temporary fixtures and logging

기존 hooks.plumbing의 `mkdtempSync(tmpdir())`, `spawnSync` 유한 timeout, `finally` cleanup 패턴을 따른다. 새 하네스 도우미는 임시 루트에 정확한 상대 배치의 가드·검사기 사본과 필요한 입력만 만들고, 실제 parser를 재사용한다. 전량 무결성 호출은 명시적인 fixture stub으로 격리하고 dev/prod 호출을 trace로 확인한다. 이 stub의 성공을 기존 validator 전체 규칙 검증으로 주장하지 않는다.

## Files to Change

| File                                                                     | Action | Responsibility                                                                        |
| ------------------------------------------------------------------------ | ------ | ------------------------------------------------------------------------------------- |
| harness/document-rules.test.mjs                                          | MOVE   | validation-regression/**tests**/document-rules.test.mjs로 이동, import 수정·경계 보완 |
| harness/validation-regression/**tests**/document-enforcement.test.mjs    | CREATE | 원본 가드의 정상·위반·빈 입력·예외·보고 실패·경고·prod 빈 결과 검증                   |
| harness/validation-regression/**tests**/test-selection.contract.test.mjs | CREATE | 실제 기본/coverage/수동 수집, 누락·혼입·빈 수집·회귀 무력화 검출                      |
| harness/validation-regression/**tests**/git-hooks.contract.test.mjs      | CREATE | 기존 훅 설정/명령순서·실패 차단 계약 이동                                             |
| scripts/**tests**/hooks.plumbing.test.mjs                                | UPDATE | 위 계약만 분리하고 실제 validate 기능 사례 유지                                       |
| scripts/**tests**/ci.plumbing.test.mjs                                   | MOVE   | validation-regression/**tests**/ci-pipeline.contract.test.mjs, repo 좌표 수정         |
| harness/test-utils/vitest-probe.mjs                                      | CREATE | 최소 두 모듈이 공유하는 자식 Vitest 실행·임시 프로젝트 수명 관리                      |
| vitest.config.js                                                         | UPDATE | passWithNoTests false 명시, 필요한 지원 코드의 제품 계측 제외                         |
| vitest.harness.config.js                                                 | CREATE | 수동 회귀만 수집, 공통 환경 상속                                                      |
| package.json                                                             | UPDATE | test:harness의 전용 설정 연결                                                         |
| .husky/pre-push                                                          | UPDATE | 일반 test 실패 시 중단, validate 임시 유지                                            |
| README.md                                                                | UPDATE | 변경한 개발 명령·훅·회귀 범위 설명만 갱신                                             |

## Step-by-Step Tasks

### Task 1: 영구 수동 회귀와 실행 계약의 실패 확인

- ACTION: 정상/위반·가드 실패 전달·실제 명령 수집을 확인하는 회귀를 먼저 작성한다.
- IMPLEMENT: 기존 검사기 회귀 이동은 GREEN에서 수행한다. RED에서는 새 가드 동작·수집 계약과 공유 probe를 작성하고 임시 수동 설정으로 실행한다. 현재 명령의 회귀 누락·가드 혼입·훅 명령 차이로 실패하는 것을 확인한다.
- MIRROR: 기존 inspectDocument 회귀, hooks.plumbing의 실제 shell 실행.
- IMPORTS: Vitest, Node child_process/fs/os/path/url/module. 실제 parser·가드·검사기는 원본에서 읽어 재사용.
- GOTCHA: 원본 wiki·문서 ID·전역 Git 설정은 수정하지 않는다. 실제 제품 테스트를 수동으로 옮기지 않는다.
- VALIDATE: RED 실패를 원인별로 확인하고 test(P2) 커밋에 인계 사항을 기록한다.

### Task 2: 자동·수동 수집과 배치 연결

- ACTION: 기존 회귀와 설정 계약을 수동 분야로 옮기고 전용 config·명령을 연결한다.
- IMPLEMENT: 기본/coverage는 동일 include 유지. 수동 include는 validation-regression/**tests**/*.test.mjs만 사용한다. 기존 회귀 전체와 추가 경계 사례를 실행한다. 실제 list 결과를 추적 파일 중 역할별 테스트 목록과 대조해 누락·혼입·교집합을 확인한다. 모든 명령의 빈 수집 실패를 실제 임시 프로젝트에서 확인한다.
- MIRROR: 계약 C2·C3·C7과 기존 config.
- IMPORTS: 기본 설정, Vitest defineConfig. 공용 probe는 두 개 이상 소비처에서만 import.
- GOTCHA: CLI filter만 바꾸면 기본 include의 회귀 제외를 덮지 못한다. 수집 목록 기대값을 현재 파일 개수로 고정하지 않는다. 지원 코드와 하네스를 제품 coverage 분모에 넣지 않는다.
- VALIDATE: 실제 list의 test=coverage, test∩harness=∅와 각 역할 전체 포함을 확인한다. 실패·빈 수집·무력화 검출 회귀도 실행한다.

### Task 3: 자동 훅 연결과 안내 정합

- ACTION: pre-push 첫 단계를 test로 교체하고 수동 회귀 자동 호출을 없앤다.
- IMPLEMENT: 기존 test:harness 대신 test가 실패하면 즉시 exit 1. validate 단계와 기존 오류 안내는 유지. 기존 훅 계약을 수동 분야로 옮겨 test 실패 / validate 실패 / 모두 성공을 실제 shell+가짜 명령으로 검증한다. pre-commit·prepare·uuid 계약과 CI 설정 계약도 보존한다.
- MIRROR: 기존 훅 순서 시험과 계약 C3·C8의 단계 전환.
- IMPORTS: Node spawnSync·fs; 새 수동 훅 계약에서 scripts 테스트 도우미를 import하지 않는다.
- GOTCHA: 실제 원격 push를 하지 않는다. validate 제거는 P3, CI 산출물 변경은 P4다. 기능/기존 validate 동작 테스트는 자동에 남긴다.
- VALIDATE: package의 자동 명령과 훅·workflow의 직접/간접 test:harness 호출이 없는지 확인한다. README의 실행 설명을 현재 단계에 맞춘다.

### Task 4: 완료 검수와 PRD 반영

- ACTION: GREEN 감사 후 phase 전체 diff를 한 번 정리·재검수한다.
- IMPLEMENT: 계약 대응·최종 파일 배치·실제 수집과 실행 결과를 확인한다. 설정 변경이므로 전체 제품 coverage와 수동 회귀를 모두 실행하고 기존 floor를 유지한다.
- GOTCHA: 테스트 개수를 성공 계약으로 고정하지 않는다. 부모 저장소 변경·커밋·push를 하지 않는다. P3·P4 미완료 상태를 유지한다.
- VALIDATE: 5차원 미니 감사(정확성·중복·죽은 코드·정리 부채·편법), 계획 완전성 검수, PRD/계약 일관성 확인 뒤 P2만 complete로 바꾼다.

## Requirement → Verification

| Contract | Implementation / Evidence                                                                                                |
| -------- | ------------------------------------------------------------------------------------------------------------------------ |
| C1       | 자동 scripts 기능 사례 유지, 검사 장치 동작·배선만 수동 이동                                                             |
| C2       | 분야/직접 **tests**/접미/공유 도우미 소비처 검수                                                                         |
| C3       | 실제 list 대조, 빈 수집 실패, 자동 호출 부재·pre-push 실행 시험                                                          |
| C7       | 정상/위반 쌍, no-op 검사기로 기존 회귀가 실패, 빈 corpus·parse/무결성/보고 실패 전달, 경로·SHA·경고, 기존 coverage floor |
| C8       | P2의 훅 교체와 pre-commit·현재 CI 연결 보존; 최종 validate 제거·운영 전달은 P3/P4                                        |
| C9       | sas-wiki 내부 변경·로컬 커밋만, 린트·신규 의존성·문서 내용 변경 없음                                                     |
| C10      | 이 계획의 계약 대응을 구현 전 검수, 완료 후 PRD 한 곳에 상태 기록                                                        |

## Testing Strategy

- 검사기: 기존 TREND/REPORT·title 회귀 보존. 일반 문서, 빈 줄/CRLF 첫 기준일, 복수 위반을 추가한다.
- 실제 가드: 정상 문서 통과, authored title/날짜 위반·frontmatter 부재·파싱 예외·빈 corpus 실패. buildContent 예외의 경로/SHA, 보고서 쓰기 실패 전파. 경고는 성공 유지·출력 관측. prod 결과 0건을 오류로 만들지 않는다. dev/prod 각 호출을 trace로 확인한다.
- 무력화: 임시 검사기를 항상 [] 반환으로 바꿨을 때 기존 정상/위반 회귀가 실제 실패함을 확인한다. 원본을 수정하거나 외부 뮤테이션 러너를 도입하지 않는다.
- 수집: 각 명령의 실제 Vitest 목록으로 test=coverage 및 수동 비중첩 확인. 전체 역할별 파일과 대조해 가드 누락·회귀 누락을 검출한다. 빈 임시 root의 명령은 실제 실패해야 한다.
- 훅: 실제 pre-push shell을 가짜 pnpm/node와 실행해 test 실패 시 validate 미실행, validate 실패 시 실패, 둘 다 성공 시 성공을 확인한다.
- 경계: 자식 실행은 유한 timeout·maxBuffer와 정리 보장. 이 P2 probe의 제한을 제품 Git 무한 대기 해소로 주장하지 않는다(P3 책임).

## Validation Commands

```sh
pnpm exec vitest list --filesOnly --json
pnpm exec vitest list --coverage --filesOnly --json
pnpm exec vitest list --config vitest.harness.config.js --filesOnly --json
pnpm run test:harness --maxWorkers=1
pnpm run test:coverage --maxWorkers=1
pnpm exec prettier --check <수정 파일>
git diff --check
```

설정이 바뀌므로 관련 전체 스위트를 coverage로 실행한다. GREEN과 정리 검수에서 같은 성공 실행을 재사용하며, 추가 코드 수정이나 실패가 있을 때만 필요한 검증을 반복한다. 이 단계에서 build·네트워크·브라우저·데이터베이스 검증은 변경 대상이 아니므로 실행하지 않는다. Git 의존 검증은 기존에 확인한 샌드박스 정지 문제가 재발하지 않도록 승인된 실행 환경에서 실행한다.

## Acceptance Criteria

- 실제 가드는 자동, 검사기·가드 동작/설정 계약은 수동 명령으로 구분된다.
- 정상·위반·무력화·누락·실패 전달 회귀가 모두 통과한다.
- test/coverage가 같은 집합이고 수동과 겹치지 않으며 빈 수집은 실패한다.
- 훅·CI·빌드·pretest 등 자동 경로에서 test:harness를 부르지 않는다.
- 기존 기능 테스트·pre-commit·진단·경고와 coverage floor를 보존한다.
- README·계획·PRD 상태가 실제 중간 결과와 일치한다.
- 작업은 sas-wiki 내부 로컬 커밋에서 끝내고 P3/P4는 시작하지 않는다.

## Risks

| Risk                                                  | Mitigation                                                        |
| ----------------------------------------------------- | ----------------------------------------------------------------- |
| 수집 계약이 설정 원문만 잠가 실제 누락을 못 잡음      | 실제 Vitest list와 역할별 파일 전수 대조                          |
| 회귀 명령에서 실제 wiki/Git를 다시 전량 검사          | 임시 root와 원본 가드 사본·명시적 fixture stub으로 격리           |
| fixture 검사가 다른 코드로 구현돼 가드 변경을 못 잡음 | 가드·검사기·기존 회귀 원문 자체를 복사해 실행                     |
| 설정 계약 이동으로 기능 coverage 손실                 | 실제 기능 사례는 scripts에 유지하고 전체 제품 coverage 실행       |
| 무한 재귀 실행·임시 파일 잔류                         | 자식은 가드/단위 회귀 한정 include, 유한 timeout, finally cleanup |
| 보호 정책 재차 차단                                   | 우회 없이 blocked-edit-fallback 적용, 설정 자체에 접근하지 않음   |

## Notes

SAS Research: 생략 — 신규 외부 의존·버전 판단 없이 기존 Vitest 설정·회귀·임시 프로세스 패턴을 사용한다. 내부 소비처와 명명 규약은 위 파일에서 직접 확인했다.

사용자 승인에 따라 Codex가 계획·구현·검수를 직접 수행한다. Claude 전용 Skill/Agent 호출을 실행한 것으로 기록하지 않는다. PRD·계약은 기존 목표를 유지하고 구현 전 계획 완전성을 검수한다.
