# CI 운영 산출물 저장의 기술 근거

## 저장 방식과 버전

KEY_INSIGHT: 공식 upload-artifact의 조사 시점 최신 릴리즈는 v7.0.2다. 릴리즈가 가리키는 공식 저장소 커밋은 `cf430e030ddbb5b0abf93d22962f4752f3646cd9`다. 태그를 실행 참조로 쓰지 않고 이 SHA로 고정할 수 있다.

APPLIES_TO: 새 업로드 단계의 actions/upload-artifact 참조.

GOTCHA: v7의 archive=false는 파일 하나만 허용한다. 두 JSON 파일을 한 세트로 보관하려면 archive=true를 사용한다. 이 액션은 Node 24를 사용하며, 워크플로의 제품 Node 설정과 액션 자체 런타임은 구분한다.

근거: [공식 릴리즈](https://github.com/actions/upload-artifact/releases/tag/v7.0.2), [공식 커밋](https://github.com/actions/upload-artifact/commit/cf430e030ddbb5b0abf93d22962f4752f3646cd9), [v7.0.2 action.yml](https://github.com/actions/upload-artifact/blob/v7.0.2/action.yml).

## 부분 누락과 세트의 검증

KEY_INSIGHT: if-no-files-found의 기본값은 warn이다. error로 설정하면 검색 결과가 0개일 때 액션이 실패한다. 공식 구현은 filesToUpload.length가 0인지 검사하므로, 두 경로 중 하나만 있는 상황까지 거부한다는 보장은 없다. 이는 소스에서 도출한 판단이다.

APPLIES_TO: 업로드 전 두 파일을 각각 읽고 실제 봉투를 확인하는 CI 단계.

GOTCHA: 업로드 옵션을 문서 세트 무결성 검사로 대신 사용하지 않는다. 액션 입력은 정확한 두 파일로 제한하고, 앞 단계에서 두 파일의 JSON·schemaVersion·env·sourceCommit·스키마를 확인한다.

근거: [옵션 문서](https://github.com/actions/upload-artifact/blob/v7.0.2/README.md#customization-if-no-files-are-found), [공식 업로드 구현](https://github.com/actions/upload-artifact/blob/v7.0.2/src/upload/upload-artifact.ts).

## 재실행·커밋·PR 식별

KEY_INSIGHT: run_id는 재실행해도 같고 run_attempt는 재실행마다 증가한다. github.sha는 이벤트가 지정한 커밋이며 pull_request에서는 일반적으로 PR merge 브랜치의 merge 커밋이다. checkout의 기본 ref도 해당 이벤트의 ref/SHA다.

APPLIES_TO: 이름 `wiki-prod-<event>-<sha>-<run_id>-<run_attempt>`, 파일 sourceCommit과 GITHUB_SHA 비교, main push와 PR 결과의 사용 안내.

GOTCHA: PR 산출물의 SHA를 PR head SHA라고 안내하지 않는다. 릴리즈용 후보는 main push의 성공 실행으로 식별한다. artifact는 불변이고 overwrite=false가 기본이므로 재실행 이름을 구분하며 기존 세트를 덮어쓰지 않는다. 보관 기간은 저장소 설정을 따른다.

근거: [GitHub context](https://docs.github.com/en/actions/reference/workflows-and-actions/contexts#github-context), [PR 이벤트](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#pull_request), [checkout 입력](https://github.com/actions/checkout/blob/v7.0.1/action.yml), [이름·불변성과 보관 설정](https://github.com/actions/upload-artifact/blob/v7.0.2/README.md).

## 실행 권한과 공급망

KEY_INSIGHT: GitHub는 워크플로 의존성 잠금을 지원하며, 이를 채택하지 않은 경우 공식 저장소의 전체 SHA 참조를 권고한다. 태그는 이동할 수 있다. 권한은 필요한 최소 범위로 제한한다.

APPLIES_TO: 기존 저장소의 전체 SHA 고정 관행과 contents:read, persist-credentials:false를 유지한다. 이 페이즈에서 새 잠금 체계를 도입하거나 기존 액션을 전수 갱신하지 않는다.

근거: [GitHub secure use](https://docs.github.com/en/actions/reference/security/secure-use#using-third-party-actions).
