# Plan: document tests

## Summary

전체 문서 무결성 검사와 작성 규칙을 하네스 테스트로 이전한다. 독립 CLI는 새로 만들지 않고, 실제 집행 테스트와 픽스처 회귀가 같은 테스트 전용 함수를 사용한다.

## User Story

문서 작성자로서 test 명령에서 문서 오류를 발견하고, 검사기 개발자로서 잘못된 픽스처의 검출력을 수동으로 확인한다.

## Problem → Solution

validate CLI와 작성 규칙 검사의 분리 → 문서 집행 테스트와 재사용 가능한 테스트 전용 검사 함수.

## Metadata

- Complexity: Large
- Source PRD: ../prd.md
- PRD Phase: P2.document-tests
- Estimated Files: 5 new protected files plus status documents

## UX Design

내부 검사 재배치다. API 응답과 위키 문서 본문은 변경하지 않는다.

## Mandatory Reading

| File                        | Why                       |
| --------------------------- | ------------------------- |
| scripts/validate.mjs        | 기존 검사·보고 순서       |
| scripts/lib/parse-vault.mjs | gate·stats·wire 재사용    |
| scripts/lib/parse.mjs       | Markdown 파싱·파일 수집   |
| scripts/lib/invariants.mjs  | 히스토리·피드·산출물 검사 |
| ../check-migration.md       | 이전 범위·CLI 제거 경계   |

## External Documentation

신규 라이브러리·API 없이 저장소에서 사용 중인 Vitest·Node·Git 패턴을 적용한다.

## Patterns to Mirror

- parseVault는 한 환경의 검사를 위해 한 번 호출한다. gate의 문서·역인덱스와 wire를 재사용한다.
- 문서 단위 위반은 경로·사유를 포함한다. Git feed 참조 오류는 SHA를 포함한다.
- 제외·prune 리포트는 치명적 검사 전에 기록해 실패를 진단한다.
- 실제 문서 전체를 픽스처 테스트가 수정하지 않는다. 오류 주입은 tmp vault에서 한다.

## Files to Change

| File                                                              | Action                                                    |
| ----------------------------------------------------------------- | --------------------------------------------------------- |
| harness/test-utils/inspect-document.mjs                           | CREATE: 파일명 제목·시점 문서 규칙, 비어 있는 corpus 거부 |
| harness/test-utils/inspect-vault.mjs                              | CREATE: 기존 무결성 검사와 보고 함수, CLI 없음            |
| harness/wiki-documents/**tests**/wiki-documents.guard.test.mjs    | CREATE: 실제 작성 규칙·dev/prod 집행                      |
| harness/validation-regression/**tests**/document-rules.test.mjs   | CREATE: 정상·오류 입력의 검출력 회귀                      |
| harness/validation-regression/**tests**/vault-validation.test.mjs | CREATE: 실제 임시 Git vault의 검출력 회귀                 |

보호 경로 변경은 스크래치패드의 신규 파일 변경안을 사용자가 직접 적용한다. 기존 보호 파일을 읽는 우회나 부분 수정은 하지 않는다. 기존 세 파일의 정리는 새 검사가 연결된 뒤 P4에서 한다.

## Step-by-Step Tasks

1. ACTION: inspectDocument와 실제 파일 수집기를 작성한다. IMPLEMENT: frontmatter title 금지, 두 시점 분류의 경로·실제 달력·concept·asOf·첫 기준일 검사. GOTCHA: 0000년, 윤년, ISO timestamp, 날짜 앞뒤 숫자와 빈 corpus를 구분한다. VALIDATE: 정상·오류 쌍 회귀.
2. ACTION: buildContent의 의미를 inspectVault로 이전한다. IMPLEMENT: 공용 생산 파서·게이트를 재사용하고 CLI argv/main은 옮기지 않는다. IMPORTS: scripts/lib의 파서·schema·invariants·ignore. VALIDATE: 정상·ID·링크·prod 가시성·보고 회귀.
3. ACTION: 실제 문서 집행 테스트를 만든다. IMPLEMENT: 작성 규칙 한 번, dev/prod 각각 한 번의 전량 무결성 검사. VALIDATE: 실제 문서와 prod 참조 관계 통과.
4. ACTION: 스크래치패드에서 초안을 실행하고 사용자에게 보호 경로 적용을 요청한다. GOTCHA: 위치만 절대 경로로 바꾼 검증용 사본을 사용하며 이를 실제 통합 완료로 기록하지 않는다.
5. ACTION: 사용자 적용 후 실제 경로에서 재검증한다. VALIDATE: 모듈 import·schema 기준 경로·실제 corpus 테스트. 이후 phase를 complete로 바꾼다.

## Testing Strategy

| Area                                    | Expected                      |
| --------------------------------------- | ----------------------------- |
| TREND/REPORT 정상·윤년·잘못된 날짜·경로 | 정상은 통과, 위반은 사유 코드 |
| title·type·asOf·기준일·빈 corpus        | 부정 입력 검출                |
| 정상 dev/prod tmp vault                 | 문서와 진단 생성              |
| ID 부재·형식·중복·사후 변경             | 경로 포함 실패                |
| 깨진 링크·앵커·prod-only 링크           | 엄격 집행 실패                |
| 억제 목록 파싱·제외 허용치              | 잘못된 입력 실패              |

## Validation Commands

- 초안: 임시 Vitest 설정으로 동일 로직의 경로 조정 사본을 실행한다.
- 적용 후: 해당 실제 집행·회귀 테스트를 각각 명시 실행한다.
- `pnpm exec prettier --check docs/prds/wiki-document-harness`, `git diff --check`.
- 전체 테스트·커버리지는 P4 전환 후 안정된 상태에서 실행한다.

## Acceptance Criteria

- 검사는 CLI 없이 하네스의 테스트 함수와 실제 문서 테스트로 실행된다.
- 실제 문서 수정 없이 dev·prod 집행이 통과한다.
- 보호 경로의 실제 파일 적용과 검증이 끝나기 전에는 phase를 complete로 기록하지 않는다.
- 기존 validate는 아직 유지한다. 제거는 P4의 책임이다.

## Notes

SAS Research: 생략 — 기존 파서·검사 함수를 재사용하며 신규 의존·버전 판단이 없다.

현재 초안의 함수·픽스처 검증은 Codex 직접 수행이다. 별도 에이전트 감사로 간주하지 않는다. 초안 테스트가 통과해도 실제 경로의 통합 검증과 최종 전체 검증을 대신하지 않는다.
