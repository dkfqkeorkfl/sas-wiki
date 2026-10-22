# Plan: 실제 문서 집행

## Summary

실제 wiki를 검사하는 Vitest 집행 가드와 파일명·시점 문서 규칙을 하네스에 구성한다. 이 단계에서는 기존 무결성 함수의 동작을 재사용하고, 독립 validate CLI의 제거와 생산 파싱 경로 분리는 P3에 맡긴다. 가드·검사기의 동작을 검증하는 수동 하네스 테스트는 P2에서 구성한다. 구조·파일명은 현재 목표안이며 합의 변경은 계약 C10에 따라 조율한다.

## User Story

문서 작성자로서 일반 test 명령에서 실제 문서 오류를 확인하고, 기존 ID·링크·피드 검사와 진단을 잃지 않는다.

## Problem → Solution

별도 CLI와 기존 평탄한 작성 하네스에 분산된 실제 문서 검사 → `harness/wiki-documents/`의 명시적인 제품 집행 테스트.

## Metadata

- Complexity: Medium
- Source PRD: ../prd.md
- PRD Phase: P1.document-enforcement
- Contract: ../contract.md C2·C4·C5·C7, C3의 자동 수집 부분
- Estimated Files: 기존 규칙 모듈 이동 1개·집행 파일 교체 1개·기존 회귀 import 1개·Vitest 설정 1개·측정된 기존 테스트 예산 보완 2개
- Work boundary: 저장소 파일 수정·보존할 산출물·커밋은 `/workspace/sas-wiki` 내부만 허용. 일회성 테스트 픽스처는 기존 OS 임시 경로 관례를 유지하며 부모 규칙·소비처는 읽기 전용으로 참고한다.

## UX Design

화면 변경이 없는 내부 검사 전환이다. 개발자가 test를 실행하면 실제 문서의 실패 경로와 원인을 확인한다. 위키 본문·ID·API 출력은 바꾸지 않는다.

## Mandatory Reading

| Priority | File                                          | Location                                                                                                          | Why                               |
| -------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| P0       | `docs/prds/wiki-document-harness/contract.md` | C2–C7                                                                                                             | 구조·실행·문서 규칙·판정 기준     |
| P0       | `scripts/validate.mjs`                        | buildContent:58, collectDeadlinks:273, gateDeadlinks:302, gateExcluded:333, writeReport:400, validatePayloads:456 | 기존 검사 순서·심각도·진단        |
| P0       | `scripts/lib/parse-vault.mjs`                 | parseVault:22                                                                                                     | 환경별 gate·stats·wire 공유       |
| P0       | `scripts/lib/head-state.mjs`                  | loadHeadDocState:37                                                                                               | draft·문서 판정의 현재 결합       |
| P0       | `scripts/lib/doc-gate.mjs`                    | judgeDocs:22                                                                                                      | ID·스키마·제외 조건·사유 우선순위 |
| P0       | `scripts/lib/invariants.mjs`                  | checkCommitConventions:18, checkFeedResolution:34, checkInvariants:47                                             | 히스토리·피드·산출물 집행         |
| P1       | `scripts/lib/parse.mjs`                       | collectMarkdownFilesRecursive, parseMarkdownFile                                                                  | 실제 파일 수집과 파싱             |
| P1       | `docs/위키-작성-가이드.md`                    | 4절·6절                                                                                                           | 제목·날짜·시각 금지·갱신 규칙     |
| P1       | `vitest.config.js`                            | test·coverage                                                                                                     | 수집 경계·기존 floor              |

현재 Serena 도구가 없어 소스를 직접 읽고 함수 위치·호출을 확인했다. 사용자가 harness 보호 항목을 임시 해제한 뒤 기존 규칙·테스트 원본도 확인했다. 보호 설정 자체는 수정하지 않는다.

## External Documentation

신규 API·의존성을 사용하지 않는다. 이미 설치·사용 중인 Vitest와 Node fs/path, 기존 파서·검사 함수를 재사용한다.

## Patterns to Mirror

### Naming and placement

하네스 파일은 kebab-case다. 규칙 모듈의 대상 테스트를 `__tests__/` 바로 아래에 둔다. 기존 `inspectDocument` 구현을 새 분야로 이동해 재사용하고, 기존 회귀 테스트의 import도 함께 맞춘다. 검사기 자체는 테스트 전용 도우미가 아니므로 복수 테스트가 사용해도 자기 분야에 둔다. 실제 테스트 전용 도우미를 두 테스트 모듈이 공유할 때만 test-utils로 분리한다.

### Shared parsing and gate order

`buildContent({ env, vault, reportDir, onReport })`는 parseVault를 한 번 호출해 gate·stats·wire를 얻고 검사 전 보고를 수행한다. 이어 commit 규약 → 제외 문서 → 링크 → 피드 해석 → 억제 목록·payload 스키마·불변식을 검사한다. 이 구현을 복사하지 않고 함수로 호출한다.

### Error and diagnostics

buildContent는 위반 시 경로·사유·필요한 SHA를 포함해 throw한다. 반환된 report.error도 실제 집행에서 실패로 올린다. default deadlinks=warn을 그대로 사용하고 stats.deadlinks·stats.warnings·stats.unpublishedFeedCommits를 관측 가능하게 출력한다. 경고 목록이 비어 있어야 한다는 단언을 추가해 정책을 강화하지 않는다.

### Repository coordinates

실 vault가 다른 사용자 소유인 컨테이너에서도 기존 테스트의 Git 전역 설정 격리를 유지한다. 새 가드는 beforeAll에서 기존 GIT_CONFIG_COUNT 뒤에 실제 sas-wiki 경로 하나의 safe.directory를 추가하고 afterAll에서 환경을 복원한다. 전역 Git 설정과 부모 파일은 수정하지 않는다. 기존 build.uuidv7-e2e.test.mjs의 범위 한정 방식을 따른다.

실제 corpus는 테스트 파일의 import.meta.url에서 sas-wiki 루트를 계산한다. cwd나 환경 변수에서 임의로 다른 wiki를 고르지 않는다. 경로 표시는 wiki 기준 상대 POSIX 경로를 사용한다.

## Files to Change

| File                                                             | Action | Responsibility                                                                                               |
| ---------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------ |
| `harness/wiki-documents/document-rules.mjs`                      | MOVE   | 기존 `harness/document-rules.mjs`의 inspectDocument를 중복 없이 이동                                         |
| `harness/wiki-documents/__tests__/document-rules.guard.test.mjs` | CREATE | 실제 문서의 작성 규칙과 dev/prod 전체 무결성을 집행                                                          |
| `harness/wiki-documents.test.mjs`                                | DELETE | 새 집행 파일로 대체해 실제 문서 검사를 중복 실행하지 않음                                                    |
| `harness/document-rules.test.mjs`                                | UPDATE | 이동한 검사기 import만 맞춤. 수동 회귀 분야로의 배치는 P2                                                    |
| `vitest.config.js`                                               | UPDATE | 일반 수집을 scripts 전체 테스트 + wiki-documents 테스트로 명시. coverage floor·Git 환경·기존 timeout 유지    |
| `scripts/__tests__/cli-contract.test.mjs`                        | UPDATE | 실제 측정에서 120초를 초과한 stdout summary 사례의 자식·케이스 예산만 180초로 보완. 다른 기본 예산·단언 유지 |
| `scripts/__tests__/feeds.env-leak.verify.test.mjs`               | UPDATE | 123초가 걸린 실 vault dev/prod 신원 검사 사례의 예산만 180초로 보완. 논리 단언 유지                          |

규칙 모듈은 실제 집행과 기존 회귀가 사용하는 검사 대상 코드다. 소스·테스트를 새 test-utils로 복제하지 않는다. 기존 회귀는 P1 검증에서 명시 실행하고, P2에서 수동 실행 분야에 배치한다. 기본 include 전환 후에는 세션 임시 경로 `/tmp/wiki-document-harness-p1/existing-regression.config.mjs`에 sas-wiki의 Vitest 설정을 절대 경로로 import·전개하고 test.include만 `harness/document-rules.test.mjs`로 덮어쓴 임시 설정을 만든다. `pnpm exec vitest run --config /tmp/wiki-document-harness-p1/existing-regression.config.mjs --passWithNoTests=false`로 기존 파일 자체를 재검증한다. 테스트 사본이나 영구 수동 명령은 만들지 않는다.

## Step-by-Step Tasks

### Task 1: 작성 규칙 구현과 실제 corpus 집행

- ACTION: 기존 제목·시점 문서 판정 함수를 새 분야로 이동하고 실제 wiki 수집·파싱 결과에 적용한다. 기존 회귀 import를 갱신하고 옛 실제 문서 집행 파일은 새 가드로 대체한다.
- IMPLEMENT: `title` 존재 금지. TREND/REPORT만 `YYYY-MM/DD. 제목.md`, 추가 하위 폴더·시각 접두 금지, 실제 달력 날짜, concept, 정확한 문자열 asOf, 첫 비어 있지 않은 본문 줄의 같은 날짜 기준 안내를 검사한다.
- MIRROR: 위키 작성 가이드 4절·6절과 계약 C4. 파싱은 기존 parse.mjs를 사용한다.
- IMPORTS: 규칙 모듈, collectMarkdownFilesRecursive·parseMarkdownFile, Node fs/path/url, Vitest.
- GOTCHA: frontmatter 부재·파싱 오류를 조용히 건너뛰지 않는다. wiki 입력이 비면 실패한다. 일반 기업 문서에 날짜 규칙을 적용하지 않는다. 스냅샷 신규성·정정 적절성은 자동 보장 대상으로 만들지 않는다.
- VALIDATE: 새 집행 파일을 명시 실행해 실제 문서가 통과하고 모든 위반에 상대 경로·사유가 연결되는지 확인한다. RED는 규칙 모듈이 없는 테스트에서 실제 실패를 확인하고 최소 구현으로 통과시킨다.

### Task 2: 기존 전량 무결성·진단을 같은 집행 파일에 연결

- ACTION: dev/prod 각각 buildContent를 한 번 호출한다.
- IMPLEMENT: 제외 허용치 기본 0과 기존 링크 경고를 유지한다. logs의 환경별 보고서를 만들고 반환 보고서 쓰기 실패를 테스트 실패로 전파한다. 경고는 경로/원인과 함께 노출한다.
- MIRROR: validate의 buildContent 순서와 기존 무결성 함수. 아래 대응표의 모든 검사 조건·진단은 현재 구현을 그대로 사용한다.
- IMPORTS: `../../../scripts/validate.mjs`의 buildContent. 위치는 테스트에서 repo까지 올라간 뒤 scripts를 가리키도록 계산한다.
- GOTCHA: 이는 P3 제거 전의 명시적인 임시 의존이다. 검사 함수를 복사하거나 새 CLI를 만들지 않는다. P3는 이 호출을 테스트 소유 검사기로 바꾸면서 옛 CLI를 제거해야 한다. prod가 draft 제외로 0건인 경우 숫자만으로 실패시키지 않는다.
- VALIDATE: 작성 규칙 검사, dev 전체 집행, prod 집행을 실행한다. 보고서·진단을 확인하고 기존 fixture 테스트로 주요 gate의 실패 원인이 유지되는지 확인한다.

실 vault의 dev/prod 각각의 집행 케이스에는 180초의 케이스 한정 예산을 사용한다. 기존 전량 검사 사례의 120–180초와 같은 범위이며 전역 testTimeout·hookTimeout은 바꾸지 않는다. 개별 Git 호출의 무한 대기 방지는 P3 분리 계획에서 필요한 경계를 정하고 구현한다.

### Task 3: 자동 제품 테스트 수집 연결

- ACTION: Vitest 기본 include를 명시한다.
- IMPLEMENT: `scripts/**/*.test.mjs`와 새 `wiki-documents/__tests__/*.test.mjs`만 기본으로 수집한다. 향후 validation-regression이 기본 test와 coverage에 혼입되지 않게 한다. 테스트 지원 코드를 제품 계측에서 제외하고 기존 floor를 유지한다.
- MIRROR: 계약 C3·C7. test와 test:coverage는 같은 설정의 수집을 사용한다.
- GOTCHA: 현재 기존 tests는 helpers 아래 지원 코드 단위 테스트도 포함한다. 이번 설정 변경으로 이를 누락시키지 않는다. 기존 평탄한 harness fixture는 P2에서 수동 회귀로 정리하며 원본을 보호 정책 밖에서 임의 편집하지 않는다.
- VALIDATE: 실제 Vitest 파일 목록에서 scripts 테스트와 새 집행을 확인하고, 수동 회귀 경로가 없음을 확인한다. 전체 기능 테스트·coverage 결과도 확인한다.

### Task 4: 실제 경로 적용·완료 검수

- ACTION: 이 계획 검수 통과 후 이동할 규칙 모듈과 새 가드의 내용·요구 대응·적용 대상을 검토 가능하게 준비한다.
- IMPLEMENT: 사용자가 harness 보호 항목을 임시 해제했으므로 실제 경로에 직접 적용한다. 다시 차단되면 우회하지 않고 blocked-edit-fallback을 따른다. 이전 `/tmp/wiki-policy-change` 초안은 이 계획의 구현으로 간주하지 않는다.
- GOTCHA: 경로를 바꾼 실험 사본의 성공을 실제 통합 완료로 보고하지 않는다. 실제 적용 전 사용자에게 이전 명령을 재사용하라고 요청하지 않는다.
- VALIDATE: 실제 경로에서 import·repo 좌표·수집·문서 집행을 확인하고 계약의 P1 부분을 완료 검수한다. 통과 후 PRD 상태를 complete로 갱신한다.

### 검증 중 확인한 실 vault 예산 보완

첫 정상 권한 전체 검증은 111개 파일 중 109개, 1,211개 테스트 중 1,209개가 통과했다. 실패는 기존 C4a stdout summary의 자식 `ETIMEDOUT`(120,130ms)과 LK2 dev/prod 신원 검사의 `Test timed out in 120000ms`(123,153ms) 두 건이다. C4a는 summary 자식만 180초로 보완하고, it.each가 공유하는 summary·feeds 그룹의 케이스 예산을 180초로 맞춘다. feeds 자식은 기존 120초에서 중단된다. LK2의 케이스 예산도 180초로 보완한다. 출력·피드 신원·유출 검출 단언과 CLI 기본 120초, C1·C6·픽스처·전역 예산은 유지한다. LK2의 Vitest 예산은 동기 Git 자식의 강제 중단 보장이 아니며 그 경계는 P3에서 처리한다.

검증의 일회성 픽스처까지 공유 마운트 안으로 옮긴 TMPDIR 강제 지정은 제거한다. 기존 테스트가 사용하는 OS 임시 디렉터리를 유지하고 결과 로그·coverage·기능 산출물은 sas-wiki 내부에 저장한다. 위 관측 실행은 실패이며 완료 검증으로 대체하지 않는다.

## Existing Check → Execution and Verification

별도 조사 명세를 유지하지 않는다. 이 표는 P1이 호출하는 기존 검사와 검증의 연결이고, 구체적인 코드 이동·기존 소비처 수정은 P3 plan에 작성한다.

| 검사/현재 위치                                        | 집행                             | P1에서 확인할 검증/기존 근거                                                                                         |
| ----------------------------------------------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| parseVault의 Git 가용성·shallow/partial 가드          | dev/prod buildContent 경유       | `validate.cli.test.mjs`의 환경 전제 사례를 명시 실행; 제거 시 P3에 실질 검증 이전                                    |
| judgeDocs의 type·스키마·UUID·created/updated·stray    | 같은 경유, maxExcluded 0         | `doc-gate.test.mjs`, `build.frontmatter-id.test.mjs`, `fail-closed.verify.test.mjs`                                  |
| 경로/ID 중복·draft/public ID 충돌·사유 우선순위       | 같은 경유                        | `validate.exclusion.test.mjs`, `validate.draft-id-collision.test.mjs`, `head-state.draft-id-collision.test.mjs`      |
| ID 사후 변경·삭제 ID 재사용                           | 같은 경유                        | `build.immutability-gate.test.mjs`, `immutability.verify.test.mjs`, `build.uuidv7-e2e.test.mjs`                      |
| checkCommitConventions의 A+D·rename·기존 예외         | 같은 경유                        | `build.conventions.test.mjs`, `build.convention-scope.test.mjs`, `invariants.feed-only.test.mjs`                     |
| gateDeadlinks의 동명 충돌/대상/앵커·severity          | 같은 경유, warn 보존             | `validate.deadlinks.test.mjs`. 새 실제 집행이 경고를 실패로 만들지 않는지 별도 확인                                  |
| checkFeedResolution의 경로·SHA                        | 같은 경유                        | `git-walk.ref-resolution.test.mjs`, `build.vault.test.mjs`                                                           |
| ignore 파싱·스키마·오래된 항목 경고                   | 같은 경유                        | `build.ignore-feeds.test.mjs`, `build.ignore-mediation.verify.test.mjs`, `summary.suppression-independence.test.mjs` |
| validatePayloads의 summary·feeds·body                 | 같은 경유, 전체 feed 포함        | `build.contract-shape.test.mjs`, `build.wire-payload.test.mjs`                                                       |
| checkInvariants의 참조·body·tree·tags·sourceCommit·ID | 같은 경유                        | `invariants.test.mjs`의 정상/각 위반 사례                                                                            |
| 검사 전 report·제외/prune/참조·쓰기 실패              | reportDir/onReport와 반환 report | `validate.cli.test.mjs`, `build.p5-plumbing.test.mjs`의 실질 진단. CLI 종료코드 자체는 P3 제거 대상                  |
| 제목·날짜·type·asOf·첫 기준일                         | 신규 규칙 모듈 + 실제 corpus     | 가이드와 직접 대조; 부정 입력·검사 무력화의 영구 수동 회귀는 P2가 담당                                               |

기존 검증의 전체 경로는 위 이름에 따라 `scripts/__tests__/` 또는 `scripts/lib/__tests__/`에서 찾는다. 단순 원문·옛 CLI 계약이 아닌 해당 gate의 실제 동작을 검증하는 케이스를 선택한다. 이 단계에서는 기존 validator의 조건·예외·진단을 수정하지 않는다.

## NOT Building

validate 제거·전체 소비처 개명·생산 경로의 ID 감사 분리는 P3다. 수동 명령·영구 회귀·pre-push에서 수동 하네스 호출 제거는 P2에서 연결하며, 최종 CI 산출물 저장과 소비자/가이드 검증은 P4다. 린트 도입·문서 내용 정정은 하지 않는다.

## Testing Strategy

- 실제 corpus: 작성 규칙을 문서별로 진단하고 dev/prod 검사 결과를 확인한다. 문서 수를 현재 값으로 고정하지 않는다.
- 기존 gate: 위 대응표의 정상/위반 사례를 명시 실행한다. 테스트 함수 import만으로 생략되지 않았는지 실행 결과를 확인한다.
- 경계: 빈 wiki, 일반 문서, 윤년/잘못된 날짜, timestamp asOf, 본문 첫 줄 위치의 검출력은 개발 중 임시 픽스처로 확인하고 P2에서 영구 수동 회귀로 정식 편입한다. 이를 기본 test에 검사기 단위 테스트로 혼입하지 않는다.
- 관측: 보고서 쓰기 실패·경로·SHA·경고가 묻히지 않는지 확인한다. 숫자 테스트 개수와 현재 corpus 건수는 완료 조건으로 고정하지 않는다.

## Validation Commands

```sh
pnpm exec vitest run --passWithNoTests=false --testNamePattern='실제 위키 문서'
pnpm exec vitest list --filesOnly
pnpm run test:coverage --maxWorkers=1
pnpm run format:check
git diff --check
```

첫 명령은 새 집행 suite의 제목을 그대로 사용하도록 구현한다. 파일 목록은 실제 수집 경로와 대조한다. test와 coverage는 같은 설정을 사용하므로 전체 스위트는 coverage에서 실행한다. 실패가 발견되면 해당 사례를 수정·재검증한 뒤 전체 검증을 다시 한다. 기존 gate의 선택 실행은 위 대응표 파일을 필터로 지정한다. 컨테이너 파일시스템의 Git 조회 경합을 줄이기 위해 최종 전체 검증은 워커 하나로 실행하며, 전역 시간 제한과 커버리지 임계는 유지한다. 샌드박스에서 Git 실행이 거부되면 승인된 정상 실행 환경을 사용하며 실패를 규칙 통과로 처리하지 않는다. 실제 실행한 검증 결과만 완료 근거로 기록한다.

## Acceptance Criteria

- 실제 문서 집행 파일과 작성 규칙 모듈이 올바른 분야·이름으로 배치된다.
- C4·C5·C7의 P1 집행이 기존 조건·예외·심각도·진단을 보존한다.
- 기본 test와 coverage가 scripts+실제 문서 집행을 수집하고 회귀 분야를 제외한다.
- 새 규칙과 기존 gate, 실제 경로의 통합·전체 기능·coverage 검증이 통과한다.
- 문서 본문·ID·생산 API와 coverage floor를 바꾸지 않는다.
- 실제 적용·완료 검수 전 phase를 complete로 기록하지 않는다. 남은 P2–P4가 구현 완료인 것처럼 보고하지 않는다. 부모 저장소의 파일·설정·커밋은 변경하지 않는다.

## Risks

| Risk                                                   | Mitigation                                                               |
| ------------------------------------------------------ | ------------------------------------------------------------------------ |
| old validate 임시 의존을 남긴 채 전체 작업을 완료 처리 | P3 필수 제거 대상으로 명시·후속 plan에서 재검색                          |
| warn 목록에 빈 배열 단언을 넣어 정책 강화              | warning은 관측, 치명적 gate만 실패로 유지                                |
| 검사기와 테스트 전용 도우미 혼동                       | 검사기는 자기 분야에 두고 테스트 전용 공유 코드에만 test-utils 기준 적용 |
| 자동 수집 변경으로 기존 중첩 tests 누락                | scripts 재귀 글롭·실제 수집 목록 대조                                    |

## Notes

SAS Research: 생략 — 기존 내부 Vitest 수집·파서·검사 함수만 사용하며 신규 외부 의존·버전 판단이 없다. 사실·패턴·호출 경로는 위 Mandatory Reading의 비보호 원본에서 확인했다.

공식 Skill 호출·Claude 전용 위임은 현재 도구로 실행하지 않았고 Codex가 계획을 작성했다. 계획 완전성 검수와 실제 구현·검증은 별개다. `/tmp`의 과거 초안·검수 메모는 참고 자료이며 최종 계약이나 이 계획의 구현 완료 증거가 아니다.
