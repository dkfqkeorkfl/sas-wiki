# 검사 이전 대응표

## 실제 문서 집행

| Existing owner                   | Rule                                                              | New execution                            |
| -------------------------------- | ----------------------------------------------------------------- | ---------------------------------------- |
| parseVault / git                 | Git 가용성·shallow/partial 거부                                   | wiki-documents dev·prod 검사             |
| checkCommitConventions           | 같은 커밋 문서 추가·삭제에 따른 ID 소실 검사                      | wiki-documents 환경 검사                 |
| judgeDocs / gateExcluded         | 필수 type·schema·UUIDv7·경로·ID 중복·ID 변경·삭제 ID 재사용·stray | wiki-documents, 제외 허용치 0            |
| collectDeadlinks / gateDeadlinks | 대상 문서·앵커 누락·동명 충돌                                     | wiki-documents, 실제 문서 링크 엄격 검사 |
| checkFeedResolution              | SHA와 경로가 포함된 미해석 피드 진단                              | wiki-documents 환경 검사                 |
| loadIgnoreFeeds                  | 억제 목록 파싱·스키마                                             | wiki-documents 환경 검사                 |
| validatePayloads                 | summary·feeds·body 생산 스키마                                    | wiki-documents 환경 검사                 |
| checkInvariants                  | feed 참조·본문·트리·태그·세대·ID 유일성                           | wiki-documents 환경 검사                 |
| reportIgnoreHygiene              | 대응 피드 없는 억제 항목 진단                                     | 테스트 진단; 기존 경고 의미 유지         |
| 현재 문서 하네스                 | 작성용 title 금지·TREND/REPORT 날짜·type·asOf·기준일              | wiki-documents 작성 규칙 검사            |
| writeReport / onReport           | 게이트 이전의 제외·prune·참조 진단                                | 테스트용 공유 검사 함수에서 보존         |

파싱·가시성·문서 제외 판정은 생성기의 기존 응답 의미를 구성하므로 런타임에서 없애지 않는다. 생성·조회는 문서 전체의 집행 검사를 호출하지 않는다.

## 소비처 분류

- `scripts/__tests__/build.*`: 문서 규칙 검출 회귀와 실제 생성기 기능을 구분한다. 함수 호출만 쓰는 검사기 회귀는 validation-regression으로 이전한다. 실제 생성기 동작은 scripts에 남긴다.
- `validate.cli`, `validate.exclusion`, `validate.deadlinks`: CLI 인자·종료코드 계약은 명령 제거와 함께 삭제한다. 실질 규칙·게이트 순서·진단은 새 함수 호출 회귀로 보존한다.
- `cli-contract`, `cursor.cli-contract`, `dead-values.guard`: validate 전용 케이스를 분리하고 summary·feeds·wiki 계약은 유지한다.
- `docs-contract`: validate CLI stdout·인자·제거된 보고 명령의 원문 고정은 정리한다. 실제 세 endpoint와 산출물 계약은 유지한다.
- `ci.plumbing`, `hooks.plumbing`: 자동 게이트 배선 계약은 수동 validation-regression으로 이전한다. 훅의 실제 실패 전달을 프로세스로 검증한다.
- `summary.*`, `build.*` 중 생성기·CLI 기능을 포함한 테스트는 검증기 import를 제거하거나 필요한 비교를 생산자 출력 단언으로 바꾼다. 제품 테스트에서 보호 폴더의 도우미를 import하지 않는다.
- `scripts/__tests__/helpers/`: 이번 변경이 사용하는 공유 자산은 scripts/test-utils로 이동하고 직접 소비처를 갱신한다. 전용 함수는 해당 테스트 안으로 넣는다.

## CLI 제거 경계

제거: parseArgs·main·CLI 직접 실행 guard·help·stdout 라벨·CLI 오류코드·--out 옵션 계약. 독립 실행 가능한 옛 CLI를 새 이름으로 옮겨 남기지 않는다.

유지: 검사 로직·오류 경로/SHA·검사 전 진단·불변식·실제 문서 dev/prod 집행. fixture 회귀는 실제 집행과 같은 함수·규칙을 호출한다.

## 외부 소비자

`/workspace/scripts/wiki-dev-server/__tests__/wikiSetup.contract.source-scan.test.ts`에는 sas-wiki의 `validate` 명령 존재를 고정하는 계약이 있다. 생산자의 문서 검사 진입점이 `test`로 바뀌므로 해당 소비자 계약도 변경 대상이다. 프론트엔드 제품 동작 변경은 필요 없다. 상위 저장소의 독립 변경은 이번 sas-wiki 커밋에 넣지 않는다.

## 보호 경로

`**/harness/**`는 기존 protect-paths 정책으로 셸 접근·쓰기가 차단된다. 현재 세 파일을 직접 읽거나 수정하는 우회는 하지 않는다. 새 하네스 파일은 스크래치패드 변경안으로 준비하고 사용자 직접 적용을 안내한다. 보호된 원본을 Read로 확인할 수 없는 기존 파일의 부분 수정은 시도하지 않는다.
