# Plan: 검증한 운영 산출물의 CI 저장

## Summary

P3가 분리한 자동 제품 게이트와 prod 빌드 뒤에 운영 세트 검증·저장을 연결한다. 새 문서 검사 CLI를 만들지 않고 CI에서 기존 아티팩트 읽기·스키마 함수를 재사용한다. 구현은 sas-wiki 내부, 로컬 커밋까지다.

## User Story

위키 유지보수자로서 테스트를 통과한 같은 커밋의 prod summary·feeds를 한 세트로 찾고, PR·다른 커밋·재실행의 파일을 섞지 않고 후속 릴리즈에서 사용하고 싶다.

## Problem → Solution

현재 CI는 coverage → build에서 끝나므로 생성 파일이 보관되지 않는다. 업로드만 붙이면 부분 누락이나 잘못된 환경·커밋을 배제하지 못한다. 두 파일의 봉투와 세대·스키마를 확인한 뒤 불변 artifact 한 개에 저장한다.

## Metadata

- Complexity: Medium. 기존 워크플로·도우미를 사용하는 작은 전달 경계다.
- Source PRD: ../prd.md, 계약 C8–C10 및 C1–C7의 최종 정합.
- PRD Phase: P4 delivery-pipeline. P1–P3 complete, 기준 커밋 8136306.
- Estimated Files: workflow·README·기존 CI 계약·새 CI 세트 계약·PRD·이 계획·research, 약 7개.
- 브랜치: feat/wiki-document-harness. `/workspace/sas-wiki`만 수정한다.
- 사용자 최신 지시로 남은 PRD는 자율 진행한다. 중대한 문제·목표 변경만 확인받는다. 오케스트레이션 없이 기존 승인 방식대로 계획·구현·검수를 직접 한다.

## UX Design

웹 UI 변경은 없다. CI 실행 화면의 artifact가 추가된다.

| 접점      | 현재                         | 목표                                          |
| --------- | ---------------------------- | --------------------------------------------- |
| CI        | format → coverage → build    | 같은 단계 → prod 세트 확인 → 한 artifact 저장 |
| PR        | 생성 가능성 확인             | merge 커밋의 검증용 세트도 저장               |
| main push | 빌드 후 종료                 | 성공 커밋의 릴리즈 후보 세트를 식별 가능      |
| 재실행    | 보관 없음                    | run_attempt로 이름을 구분하고 덮어쓰지 않음   |
| 로컬      | test·build·수동 test:harness | 유지. 원격 업로드·배포는 실행하지 않음        |

## Mandatory Reading

| 우선 | 파일:부분                                                                                                | 이유                                               |
| ---- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| P0   | ../contract.md:C1–C10, ../prd.md:P4                                                                      | 책임·완료·수정 경계                                |
| P0   | .github/workflows/ci.yml:verify                                                                          | 트리거·이력·권한·단계 순서                         |
| P0   | scripts/lib/artifact.mjs:readArtifact                                                                    | missing/unreadable/malformed/환경/버전 판정 재사용 |
| P0   | scripts/lib/schema-validator.mjs:loadSchema·validateItem                                                 | 기존 strict 검증 재사용                            |
| P0   | scripts/schema/summary.schema.json·feeds.schema.json                                                     | 두 파일의 실제 wire 봉투                           |
| P0   | package.json:build·build-dev, scripts/lib/generator.mjs                                                  | 환경·출력 경로·같은 sourceCommit                   |
| P1   | `harness/wiki-documents/__tests__/ci-pipeline.contract.test.mjs`                                         | 기존 CI 계약·SHA 고정                              |
| P1   | `harness/wiki-documents/__tests__/test-selection.contract.test.mjs·git-hooks.contract.test.mjs`          | 수동 회귀를 CI/훅에 연결하지 않음                  |
| P1   | README.md:문서 검사·테스트·Git 훅·CI                                                                     | 명령과 산출물 사용 안내                            |
| P2   | 부모 rules.md·decisions.md의 R-B1/B2·R-N14/N15                                                           | kebab·직접 **tests**·테스트 종류                   |
| P2   | `/workspace/scripts/wiki-dev-server/__tests__/wikiSetup.contract.source-scan.test.ts:자체 validate 단언` | 부모에 남는 확정 호환성 영향. 읽기만 함            |

## Discovery and Traces

| 범주/흐름      | 근거                                            | 확인한 사실                                                                      |
| -------------- | ----------------------------------------------- | -------------------------------------------------------------------------------- |
| 유사 구현·설정 | ci.yml:verify                                   | 한 job, 전체 이력 checkout, frozen 설치, format·coverage·build, 20분 상한        |
| 명명·테스트    | ci-pipeline.contract·git-hooks.contract         | 하네스 kebab, contract 종류, 같은 분야의 직접 **tests**                          |
| 오류           | artifact:readArtifact                           | 실패를 stale 사유로 반환. CI에서 assert로 실패시켜야 함                          |
| 로그           | summary·feeds CLI                               | 생성 결과는 stderr, CI 실패는 0 아닌 종료 코드                                   |
| 데이터·의존성  | artifact→payloads, schema-validator, schema 2개 | 기존 모듈로 봉투·세대·strict shape 확인 가능. 새 패키지 불필요                   |
| 진입·상태 변경 | PR/main → verify → cache/*.prod.json → upload   | 문서·ID·커밋·부모 포인터를 변경하지 않음                                         |
| 계약           | C8, 기존 artifact-set/build 체인 회귀           | 같은 prod 환경·sourceCommit, 생성 실패는 성공으로 취급하지 않음                  |
| 부모 소비처    | wikiSetup 계약의 validate 존재 검사             | 새 포인터 연결 시 충돌. 다른 runtime 소비처의 validate 직접 호출은 발견하지 않음 |

Serena 도구가 제공되지 않아 관련 경로를 직접 조회했다. 부모 인덱스는 main 97f207cfcfa6be9365bff7ae67d2422f9072f342이며 수정하지 않는다.

## External Documentation

[research.md](research.md)의 공식 GitHub 문서·해당 릴리즈의 소스를 따른다. 핵심은 파일 하나의 누락을 업로드 옵션으로 보장할 수 없다는 점, 두 파일은 zip 한 개로 묶는 점, run_id·attempt·SHA의 의미, 전체 SHA 고정이다.

## Strategic Design

1. 기존 verify job의 build 다음에 `Verify prod artifact pair`라는 작은 inline Node 단계를 추가한다. 새 CLI나 package 명령을 만들지 않는다.
2. 기존 `readArtifact`와 `SCHEMA_VERSION`을 artifact.mjs에서, `loadSchema`·`validateItem`을 schema-validator.mjs에서 import한다. GITHUB_SHA가 40자리 소문자 hex인지 먼저 확인한다.
3. summary·feeds 각각 `cache/<종류>.prod.json`을 읽는다. fresh 여부(존재·JSON·prod·버전), 현재 GITHUB_SHA와 sourceCommit, 실제 해당 스키마를 확인한다. 두 generatedAt도 기존 생성 계약대로 같아야 한다. 문서·ID 이력을 다시 감사하지 않는다.
4. 바로 다음 upload 단계는 success()일 때만 실행하고 actions/upload-artifact의 v7.0.2 공식 SHA를 사용한다. archive:true, overwrite:false, if-no-files-found:error를 명시한다. 입력은 두 prod 파일만이다.
5. 이름은 `wiki-prod-${{ github.event_name }}-${{ github.sha }}-${{ github.run_id }}-${{ github.run_attempt }}`다. 보관 기간은 저장소 설정을 따른다. PR 검증용 세트와 main push 릴리즈 후보를 README에서 구분한다. 다운로드·릴리즈 발행·배포 연결은 추가하지 않는다.
6. CI의 문서 정책은 coverage에 포함된 실제 가드가 담당한다. test:harness는 수동이며 build에도 호출하지 않는다. pre-commit·pre-push·빌드 명령·의존성은 P3 결과를 유지한다.

### Alternatives Considered

| 안                                    | 판단                                                                  |
| ------------------------------------- | --------------------------------------------------------------------- |
| 업로드만 추가                         | 부분 누락·잘못된 봉투를 배제하지 못함                                 |
| 별도 검증 CLI·새 package 명령         | C9와 충돌하고 CI 전달 경계를 불필요하게 확대                          |
| 세트 검사를 build 안에 추가           | 검증은 호출자가 담당한다는 책임과 두 단계 build 계약을 흐림           |
| 작은 inline 단계에서 기존 함수 재사용 | 선택. CI에만 필요한 전달 경계를 검증하며 실제 명령을 테스트할 수 있음 |
| 디렉토리 전체 업로드·덮어쓰기         | dev·보고·이전 실행의 혼입 위험. 정확한 두 파일과 실행별 이름 사용     |

## Patterns to Mirror

- ci.yml의 실제 `fetch-depth: 0`, `persist-credentials: false`, `contents: read`, `pnpm run test:coverage` → `pnpm run build`를 유지한다.
- artifact.mjs의 `readArtifact({ expect: expected, path: artifactFile })` 결과에서 fresh와 reason을 확인한다. 새 JSON/환경 판정기를 복제하지 않는다.
- 기존 회귀의 `spawnSync`·임시 디렉터리·try/finally 정리를 따른다. test-utils는 실제 두 소비처가 생길 때만 분리한다.

## Files to Change

| 파일                                                                              | 작업          | 이유                                                   |
| --------------------------------------------------------------------------------- | ------------- | ------------------------------------------------------ |
| .github/workflows/ci.yml                                                          | UPDATE        | build 후 봉투/세대 확인과 업로드                       |
| `harness/wiki-documents/__tests__/ci-pipeline.contract.test.mjs`                  | UPDATE        | 기존 순서·권한을 유지하고 새 단계를 연결               |
| `harness/wiki-documents/__tests__/ci-artifacts.contract.test.mjs`                 | CREATE        | 실제 inline shell 실행·세트 정상/실패와 저장 설정 계약 |
| README.md                                                                         | UPDATE        | 산출물 구성·이름·main/PR·만료와 별도 부모 호환성 작업  |
| docs/prds/wiki-document-harness/{prd.md,P4.delivery-pipeline/plan.md,research.md} | UPDATE/CREATE | 계획·상태·공식 근거·검수 결과                          |

## NOT Building

새 lint·타입 전환·의존성 갱신·문서/ID 수정·독립 validation CLI·부모 변경·포인터 갱신·원격 push·PR·릴리즈·다운로드/배포 연결은 하지 않는다. UI·DB·브라우저 QA 대상은 없다.

## Step-by-Step Tasks

### Task 1: 저장 계약의 RED

- ACTION: 새 수동 CI 계약을 작성한다.
- IMPLEMENT: 실제 workflow에서 verify inline shell을 추출하고 격리 디렉터리에 실제 artifact/payload/schema-validator 모듈과 schema를 복사해 실행한다. 유효 세트와 각 파일 누락·malformed·버전/환경/세대/shape 오류·빈 SHA·다른 generatedAt을 대조한다. 업로드의 정확한 입력·순서·SHA·success 조건·이름·비덮어쓰기·zip을 확인한다.
- MIRROR/IMPORTS: node:child_process·fs·os·path, vitest. 기존 ci-pipeline 계약의 workflow 조회.
- GOTCHA: 단계가 아직 없더라도 파일 수집 실패 대신 각 테스트에서 명확한 RED를 낸다. 테스트용 세트는 빈 배열도 허용되는 실제 유효 봉투로 만들며 임의 mock 성공 명령을 실행하지 않는다.
- VALIDATE: 새 계약의 실제 실패를 확인하고 RED만 커밋한다.

### Task 2: 전달 연결의 GREEN

- ACTION: 위 Strategic Design의 두 CI 단계를 구현한다.
- IMPLEMENT: 직접 기존 함수 import와 assert 사용. 실제 실패를 continue-on-error/always로 삼키지 않는다. 기존 CI 계약과 README를 갱신한다.
- MIRROR/IMPORTS: Node assert, scripts/lib/artifact.mjs, scripts/lib/schema-validator.mjs. 기존 SHA 고정·읽기 권한.
- GOTCHA: GITHUB_SHA는 셸 코드에 표현식으로 끼우지 않고 환경에서 읽는다. PR merge SHA와 head SHA를 혼동하지 않는다. 업로드를 실제로 실행하는 로컬 테스트는 만들지 않는다.
- VALIDATE: 새 계약과 기존 CI·수집·훅·문서 안내 회귀를 실행하고 5차원 직접 검수 후 GREEN 커밋한다.

### Task 3: 정리·최종 완전성 검수

- ACTION: 이 페이즈를 한 번 정리·재검수하고 전체 PRD 결과를 정리한다.
- IMPLEMENT: 기존 P1–P3 책임과 명명·테스트 분류·보고·하한이 유지되는지 C1–C10을 대조한다. 부모 호환성 영향은 README의 지속 안내에 남긴다. PRD 전체 9차원+추가 3관점 감사도 직접 수행한다.
- MIRROR: sas-prp-task·sas-audit-code의 기준을 승인한 직접 실행 방식으로 적용한다.
- GOTCHA: 검사 중 파일·인덱스·HEAD를 바꾸지 않는다. 전체 검사와 build의 같은 HEAD를 구분해 기록한다. GitHub 원격 실행·업로드 성공으로 로컬 검증을 과장하지 않는다.
- VALIDATE: format, 자동 coverage, 수동 harness, 실제 prod/dev build와 같은 HEAD·스키마 검사를 완료한다. 중복 실행은 새 변경·실패가 있을 때만 한다. 로컬 커밋 후 P4 complete로 전환한다.

## Requirement → Verification

| 계약         | 검증                                                                   |
| ------------ | ---------------------------------------------------------------------- |
| C1–C3        | 기존 수집·훅·CI 계약, 전체 자동/수동 비중첩. 새 계약은 수동            |
| C4–C7        | 기존 실제 가드·회귀·기능 coverage, wiki/ID diff 0·하한 유지            |
| C8 순서·실패 | build 후 verify 후 success upload의 실제 배선·inline 실패/정상 대조    |
| C8 한 세트   | 두 파일 존재·prod·버전·schema·현재 SHA·generatedAt, 정확한 업로드 경로 |
| C8 실행 식별 | event+SHA+run_id+attempt, archive와 비덮어쓰기, main 후보 안내         |
| C9           | 독립 CLI 없음·부모/의존성/문서 무변경·로컬 커밋만                      |
| C10          | 계획 완전성 검수·공식 근거·최종 결과와 PRD 상태                        |

## Testing Strategy and Validation Commands

- 새 수동 회귀는 실제 workflow의 shell을 실행한다. 누락 2방향, JSON·봉투·세대·shape·시각 오류 각각을 정상 세트와 대조한다. Node 자식은 10초·SIGKILL로 제한한다.
- 순서·권한·SHA·이름·입력·success 조건은 수동 CI 계약으로 잠근다. upload 네트워크는 실행하지 않는다.
- `pnpm exec vitest run --config vitest.harness.config.js harness/wiki-documents/__tests__/ci-artifacts.contract.test.mjs` — RED/GREEN.
- `pnpm run test:harness --maxWorkers=2` — 수동 회귀 전체.
- `pnpm run test:coverage --maxWorkers=4` — 자동 제품 검사와 기존 하한.
- `pnpm run format:check`, `git diff --check` — CI 포맷과 공백.
- `pnpm run build`, `pnpm run build-dev` — 같은 고정 HEAD의 두 환경 산출물. 실제 pair 단계에 prod 파일·GITHUB_SHA를 주어 확인하며 dev 파일은 별도로 같은 env/HEAD/schema인지 확인한다.
- 부모 상태와 인덱스·wiki/ID·lockfile diff를 확인한다. 로컬 git hook은 커밋에서 유지한다.

## Acceptance Criteria

- [x] 같은 검증 커밋에서 생성한 prod 두 파일만 한 artifact에 저장하도록 연결했다.
- [x] 누락·잘못된 JSON/버전/환경/커밋/shape를 실패시키며 업로드로 넘기지 않는다.
- [x] PR·main·재실행을 구분하고 기존 세트를 덮어쓰지 않는다.
- [x] test:harness는 수동이고 pre-commit/pre-push·기능 생성의 책임이 유지된다.
- [x] 전체 검사·커버리지 하한·실제 빌드와 포맷이 통과했다.
- [x] 부모/포인터·wiki·ID·의존성을 바꾸거나 원격 실행하지 않았다.

## Completion Checklist

- [x] RED/GREEN·정리 검수·필요한 로컬 커밋과 PRD 결과 기록.
- [x] 계약 C1–C10 최종 대조·전체 감사·잔여 영향과 미검증 범위 기록.
- [x] README의 현행 안내와 CI 입력이 같고 artifact 사용에 대화 문맥이 필요하지 않음.

## Risks

| 위험                                | 대응                                                                         |
| ----------------------------------- | ---------------------------------------------------------------------------- |
| 한 파일만 있는 세트를 성공으로 저장 | 양쪽 파일의 실제 판정 단계를 먼저 실행                                       |
| PR merge·재실행 혼입                | 플랫폼 SHA와 event/run/attempt 이름·메타데이터 확인                          |
| 오래된 dev·보고 파일 포함           | 두 prod 경로만 명시, overwrite=false                                         |
| 실제 원격 액션 미실행               | 설정·shell은 로컬 검증. GitHub 실행/업로드 검증은 push 후 확인할 한계로 보고 |
| 부모의 옛 validate 존재 계약        | 부모는 수정하지 않고 README에 별도 조치 위치 기록                            |

## Notes and Plan Completeness Review

공식 근거의 부분 누락·zip·불변성·run/attempt/SHA·SHA 고정을 위 설계와 실패 테스트에 반영했다. 내부 관행이 있는 명명·테스트 배치·권한·워크플로를 유지하며 새 lint·패키지는 도입하지 않는다.

직접 완전성 검수에서 C8의 부분 누락·재실행·PR merge SHA와 C9의 새 CLI 금지를 함께 대조했다. C1–C10 중 최종 페이즈가 확인해야 하는 책임은 위 검증표로 모두 연결했다. 초기 단순 업로드 안의 부분 누락 보호 부족을 계획에서 해소했다. 계약 목표 변경은 없고 사용자 최신 자율 진행 지시로 별도 확인을 반복하지 않는다. 연구·계획·검수는 직접 수행했으며 다른 에이전트를 호출한 것으로 표시하지 않는다.

## 구현·검증·전체 PRD 감사 결과

- 연구·계획 완전성 검수 → RED 12건 → GREEN → 정리와 재검수 → 전체 감사 보완을 직접 수행했다. 독립 에이전트·Claude 실행으로 표시하지 않는다. 계약 목표는 바꾸지 않았다.
- workflow에 기존 함수로 실제 prod 세트를 확인하는 inline 단계와 공식 SHA의 upload 단계를 연결했다. 전달 입력의 검사이며 문서 감사·독립 CLI를 다시 만들지 않았다. 저장 범위·이름·성공 조건·zip·비덮어쓰기는 실제 workflow를 읽는 계약으로 확인했다.
- 이 페이즈의 정리에서 세트 순서 단언의 소유를 ci-artifacts 계약으로 모았다. 새 fixture 지원은 한 테스트 파일 안에 두고 새 의존성·test-utils·lint를 만들지 않았다.
- 전체 감사에서 세 곳의 이전 테스트 파일 기준 경로 계산을 실제 자원 URL로 바꿨다. 기능 파싱의 가용성 사례 하나는 정책 회귀에서 scripts 자동 테스트로 되돌리고 정상 문서·날짜·stray 상태를 확인하도록 보완했다. 사용하지 않는 검사 호출과 단언 뒤 파일 쓰기, 옛 검사 소유 주석도 제거했다. 관련 기능 20건과 정책 회귀 26건을 먼저 통과한 뒤 별도 fix(audit) 커밋으로 남겼다.
- 최종 검증 HEAD는 cd4c168d70a94ef8379cd07c5d5c0c4cfea86cad다. 파일·인덱스·HEAD를 고정한 자동 검사 100파일 1,029건과 수동 하네스 36파일 279건이 모두 통과했다. coverage는 statements/branches/functions/lines 순서로 89.32/83.18/94.32/90.38%이며 기존 하한 86/76/92/89를 유지한다. 전체 포맷과 diff 공백 검사도 통과했다.
- 같은 HEAD의 실제 prod/dev 빌드가 성공했고 실제 CI의 확인 shell을 생성한 prod 파일에 그대로 실행해 통과했다. 두 환경 모두 해당 env·현재 sourceCommit·스키마·같은 generatedAt을 확인했다. sourceCommit 외 summary/feeds JSON은 구현 전 기준선과 동일하다(prod 문서/피드 61/1, dev 67/6). 본문의 동일성은 P3 기준선 비교와 이후 기능 불변으로 확인했다.
- wiki·기존 ID·lockfile·pre-commit은 P3 이전 기준 3b22c4c 이후 diff가 없다. 부모 파일·인덱스·커밋을 바꾸지 않았고 gitlink는 main 97f207cfcfa6be9365bff7ae67d2422f9072f342를 유지했다. 실제 원격 CI·upload·push·PR·릴리즈 실행은 하지 않았다.

### 전체 감사의 범위와 결과

P1–P4의 실제 가드·정책/기능 분리·자동/수동 수집·Git 수명·보고·훅·CI·테스트 및 README/계약을 대상으로 9차원과 추가 3관점을 직접 적용했다. 아래는 최종 상태이며 테스트 통과만으로 완전성을 대신하지 않고 C1–C10을 별도로 대조했다.

| 관점                          | 최종 상태·근거                                                                                                                                                                                                                                                                                                                                                     |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1. 중복·저가치 코드           | 준비 중복·중복 순서 단언·미사용 호출·로드 래퍼를 제거했다. 정책 알고리즘과 파서/renderer를 복제하지 않았다.                                                                                                                                                                                                                                                        |
| 2. 보안                       | 새 시크릿·권한 확대·셸 표현식 삽입·불특정 파일 업로드 없음. 공식 SHA, contents:read, 자격 증명 비보존과 두 파일만 저장하는 경계를 확인했다.                                                                                                                                                                                                                        |
| 3. 정확성·신뢰성              | 전체 이력·ID 우선순위·draft·rename/삭제·전체 피드·보고 실패를 승계했다. 생성·검사 경계와 실제 inline 실패/정상 대조·세트 일치가 통과했다.                                                                                                                                                                                                                          |
| 4. 컨벤션·표준                | 부모 명명·종류·직접 `__tests__`·공유 도우미 소유와 GitHub 공식 액션/플랫폼 의미를 적용했다. 새 린트·패키지·언어 전환은 없다.                                                                                                                                                                                                                                       |
| 5. 유지보수성                 | 이전 파일을 경로 기준으로 삼던 결합 세 곳을 수정했다. README에서 운영 설명과 부모 별도 조치에 임시 문서를 요구하지 않는다.                                                                                                                                                                                                                                         |
| 6. 성능·자원                  | 실제 가드가 snapshot과 성공 Git 질의를 공유한다. 기능 경로의 전체 ID 감사는 0이며, 실패 비캐시·자식의 유한 종료와 원인 전달을 검증했다.                                                                                                                                                                                                                            |
| 7. 테스트·검증                | 기능 사례의 자동 집행 복원 후 전체 검사·coverage·실제 build·CI shell이 통과했다. 임시 fixture에서 실제 가드 무력화·빈 입력·보고/훅 실패를 검출한다.                                                                                                                                                                                                                |
| 8. 의존성·환경                | 의존성은 바꾸지 않았다. 기존 감사 low 1·moderate 7·high 3·critical 0을 유지한다. high의 nanoid/source-map-js/vite는 개발 도구의 전이 의존성이다. 버전 갱신은 이번 범위가 아니다.                                                                                                                                                                                   |
| 9. 문서화                     | 명령·분류·판정·보고·CI 세트·main/PR/재실행·부모 영향과 원격 미검증 범위를 README와 계획에 반영했다.                                                                                                                                                                                                                                                                |
| 추가: 테스트 배치·회귀 유효성 | 발견 1건을 수정했다. 파싱 가용성은 자동, 판정기의 동작·설정 계약은 수동이다. C5의 정상/위반·사유와 기능 보호를 대조했다.                                                                                                                                                                                                                                           |
| 추가: 정적 분석 책임 경계     | 기존 원문 품질 가드의 린트 이전 과제 1건은 유지한다. 기존 legacy-sweep/정적 import 가드의 경로만 승계했으며 새 품질 가드를 만들지 않았다. 향후 ESLint no-restricted-syntax·import-x/no-restricted-paths와 필요한 커스텀 룰로 옮길 수 있다. 이번 계약 C9는 린트 도입을 별도로 정했으므로 원래 보호를 삭제하거나 새 린트를 설치하지 않았다. 새로운 억제 주석은 없다. |
| 추가: 산출물 자기완결성       | 미발견. 장기 운영 안내에 계획 문서를 열어야만 실행 가능한 절차를 두지 않았다. 옛 파일 좌표·이전 검사 소유와 임시 PRD 의존 문구는 감사에서 수정했다.                                                                                                                                                                                                                |

### 감사 발견의 처리

별도 상시 검수 문서를 늘리지 않고 이 계획에 발견·조치와 증거를 모았다. 좌표는 최종 검증 HEAD 기준이다.

| File:Line                                                                         | Severity   | Issue                                      | Fix                                                                                                             |
| --------------------------------------------------------------------------------- | ---------- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `scripts/lib/__tests__/fail-closed.verify.test.mjs:195`                           | Medium     | 기능 가용성 사례가 수동 정책 회귀에 포함됨 | 자동으로 복원하고 문서·날짜·stray 결과 단언. 수정 완료                                                          |
| `harness/wiki-documents/__tests__/document-invariants.grandfathering.test.mjs:14` | Low        | 이동 전 테스트 파일을 자원 좌표로 사용     | 실제 repo URL로 교체. 수정 완료                                                                                 |
| `harness/wiki-documents/__tests__/document-report.pruning.test.mjs:14`            | Low        | 테스트 위치를 거쳐 보고 스키마 계산        | 실제 스키마 URL로 교체. 수정 완료                                                                               |
| `harness/wiki-documents/__tests__/document-state.projection.test.mjs:36`          | Low        | 제거된 테스트를 거쳐 스키마 경로 계산      | 실제 스키마 디렉터리 URL로 교체. 수정 완료                                                                      |
| `harness/wiki-documents/__tests__/document-integrity.payloads.test.mjs:160`       | Low        | 쓰지 않는 추가 검사 호출 등 준비 코드      | 추가 호출·단언 뒤 쓰기를 제거. 수정 완료                                                                        |
| harness/test-utils/tmp-git-vault.mjs:189                                          | Low        | 제거된 검사 소유를 현재형으로 설명         | 실제 fixture의 필수 meta 제공 이유를 직접 설명. 수정 완료                                                       |
| `scripts/__tests__/legacy-sweep.test.mjs:80`                                      | Low (기존) | 원문 코드 품질 가드의 정적 분석 이전 과제  | C9의 별도 린트 도입 때 ESLint 기본·커스텀 룰로 이전. 이번에는 기존 보호를 유지하며 새 가드·억제를 추가하지 않음 |

새 미해결 구현 결함은 발견하지 않았다. 기존 개발 의존성 경고·합의상 별도인 린트 이전·부모의 옛 validate 존재 단언은 이번 구현의 완료와 구분한다. 부모 영향은 README에 지속 안내를 두었고, 실제 원격 업로드는 push 후 GitHub에서 확인해야 한다. 브라우저 E2E·시각 recipe·뮤테이션 러너는 이 저장소에 없으며 해당 트랙은 실행한 것으로 표시하지 않는다.

### 완료 후 독립 감사와 보완

사용자의 별도 리뷰 요청으로 `main...d8dec90`의 변경을 세 독립 리뷰 세션에서 나누어 감사했다. 설정된 전문 reviewer 모델은 계정에서 지원되지 않아 같은 감사 기준을 기본 역할의 독립 세션에 전달했다. 기본 9차원과 테스트 배치·정적 분석 책임 경계·산출물 자기완결성을 확인했다. 구현·보안의 새 차단 결함은 발견하지 못했으나 아래 Low 3건은 앞선 직접 검수에서 놓쳤다. 사용자의 수정 승인 후 보완했다.

| 발견                                                                        | 수정·폐쇄 근거                                                                                                                                                                                                                                                                                                                             |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 새 제목 테스트의 명명·원문 검사 분류가 C2와 다름                            | 실제 `derive` 동작 6건은 `scripts/lib/__tests__/derive.filenameTitle.test.mjs`로 옮기고, 스키마 검사 1건은 `wikiDocSchema.contract.source-scan.test.mjs`로 분리했다. 두 파일 모두 자동 수집하며 실제 동작을 원문 검사로 분류하지 않는다.                                                                                                   |
| `scripts/lib/derive.mjs` 주석이 제거된 모듈과 필터 전제를 현재형으로 설명함 | 기능 경로의 환경별 투영, 하네스의 정책 감사, 생성 전 문서 집행의 실제 책임을 설명하도록 고쳤다. 런타임 동작은 바꾸지 않았다.                                                                                                                                                                                                               |
| 정상 이력 두 회귀가 `inspectVault`의 불변식을 중복 검사함                   | `document-integrity.payloads.test.mjs`에 기존 13커밋 이력과 예제 저장소를 매개변수 두 사례로 보존했다. 이미 전체 스키마·불변식을 집행하는 `inspectVault` 결과에 같은 검사를 다시 적용하지 않고 정상 반환과 보고 오류 부재를 확인한다. 기존 공용 Git 준비·정리를 재사용하고 `document-invariants.vault.test.mjs`의 중복 실행 틀을 제거했다. |

최초 독립 감사 중 일부 집중 테스트는 자식 Git·Node 실행의 sandbox EPERM으로 막혔다. 승인된 실행 환경에서 관련 Git 러너 5건과 하네스 44건을 재실행해 모두 통과했고 환경 제한임을 확인했다. 수정 후에는 다음 관련 범위만 실행했다.

- 자동 검사: `derive.filenameTitle`·`wikiDocSchema.contract.source-scan`·`runtimeSeparation`의 3파일 12건 통과.
- 수동 회귀: `document-integrity.payloads`·`document-integrity.wiring`·`test-selection.contract`의 3파일 12건 통과. 두 정상 이력, 스키마·불변식 위반 주입, 전체 피드 집행과 실제 자동/수동 수집을 확인했다.
- 변경 파일의 포맷과 diff 공백 검사 통과. 기능 코드 변경은 주석뿐이고 수집 설정·의존성·문서 입력·제품 커버리지 하한은 그대로이므로 기존 전체 검사·빌드 결과를 이번 집중 실행 결과로 대체하지 않는다.
- 커밋 전 의존성 감사를 다시 실행했다. 기존 low 1·moderate 7·high 3·critical 0으로 같으며 패키지·락파일은 변경하지 않았다.
- 발견을 제기한 독립 리뷰어들이 staged 수정과 관련 구현을 읽기 전용으로 재검수했다. 명명·주석 2건과 테스트 중복 1건 모두 PASS로 폐쇄했고 신규 문제를 발견하지 못했다.

합의한 목표를 바꾸는 수정이 아니므로 contract와 페이즈 완료 상태는 유지한다. 별도 상시 감사 문서는 추가하지 않고 이곳에 처리 내역을 모았다. 수정은 sas-wiki 내부이며 원격 push·PR·CI 업로드는 실행하지 않는다.
