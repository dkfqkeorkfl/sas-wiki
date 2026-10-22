# 기능 처리와 검사 분리를 위한 기술 조사

## 조사 범위와 방법

동기 자식 프로세스의 제한, Vitest의 시간 제한·수집, Git의 이름 변경 추적을 확인했다. 신규 의존성이나 버전 변경은 제안하지 않는다. Context7은 월간 할당량 초과로 원문을 제공하지 못해 Exa로 공식 문서와 유지보수 저장소를 읽었다. 아래는 외부 근거이며, 저장소의 호출 관계·실험·적용 계획은 같은 폴더의 plan.md에 둔다.

## 동기 작업의 시간 제한

**KEY_INSIGHT:** Node의 `execFileSync`·`spawnSync`는 자식 종료까지 이벤트 루프를 막는다. `timeout`으로 신호를 보내더라도 자식이 기본 종료 신호를 처리하고 계속 실행하면 동기 호출이 기다릴 수 있다. 실패 시에는 종료 상태와 출력을 포함한 예외가 전달된다. [Node 22 child_process 문서](https://nodejs.org/docs/latest-v22.x/api/child_process.html#child_processexecfilesyncfile-args-options)

**APPLIES_TO:** Git 실행기에는 실행 시간 제한과 종료 신호를 명시하고, 시간 초과·권한·I/O 실패를 데이터 부재로 취급하지 않는다. 인자 배열과 shell 미사용을 유지한다.

**GOTCHA:** 시간 제한 숫자만 늘리는 것으로 멈춤을 해결했다고 판정할 수 없다. 직접 실행한 Git 프로세스에 대한 종료와 외부 실행 예산을 구별한다. 임의의 프로세스 트리나 운영체제의 모든 대기를 제어하는 보장으로 확대하지 않는다.

## Vitest 시간 제한과 동기 프로세스

**KEY_INSIGHT:** Vitest는 테스트 시간 제한을 설정할 수 있다. 설치된 버전과 같은 v4.1.10의 `withTimeout` 구현은 타이머를 설정한 뒤 테스트 함수를 호출하고, 함수 반환 뒤에도 경과 시간을 확인한다. 동기 함수가 반환하지 않는 동안 타이머만으로 그 함수를 선점한다는 근거는 없다. [Vitest testTimeout](https://vitest.dev/config/testtimeout), [Vitest v4.1.10 runner 구현](https://github.com/vitest-dev/vitest/blob/v4.1.10/packages/runner/src/context.ts)

**APPLIES_TO:** Node의 동기 호출 설명과 교차하면, Git 자식에 자체 제한을 두고 Vitest 시간 제한은 테스트의 완료 판정으로 사용하는 것이 맞다. 이는 두 출처를 결합한 추론이다.

**GOTCHA:** 테스트가 늦게 실패한 것과 자식 프로세스를 제때 종료한 것은 다르다. 오류 주입 시험에서는 종료 결과·신호·원인을 확인한다.

## 수집과 커버리지의 경계

**KEY_INSIGHT:** Vitest의 `include`는 root 기준 파일 글롭이다. include로 잡힌 테스트는 기본 커버리지 제외에도 반영된다. 제품 계측 범위는 별도 coverage 설정으로 정해야 한다. [Vitest include](https://vitest.dev/config/include), [Vitest coverage 설정](https://vitest.dev/config/coverage)

**APPLIES_TO:** 분야별 폴더에서 가드와 회귀를 함께 두되 기존 두 설정의 실제 수집으로 자동·수동을 나눈다. 정책 코드가 하네스로 이동해도 제품 커버리지 하한과 실제 기능 코드의 계측을 유지한다.

**GOTCHA:** 테스트 수 감소 자체는 품질 보존의 증거가 아니다. 검사기 회귀의 이동과 기능 테스트의 자동 유지 여부를 따로 확인해야 한다. 제품 코드가 새 test-utils에 놓이면 분모에서 빠질 수 있으므로 소유도 검수한다.

## 값 도출과 규칙 감사의 Git 사용

**KEY_INSIGHT:** `git log --follow`는 이름 변경 이전 이력을 따라가지만 한 파일에만 적용된다. `git blame`은 전체 파일 이름 변경을 따라 줄의 출처를 찾고 `--contents`로 작업 내용을 비교할 수 있다. 두 명령은 서로 다른 질문을 한다. [Git log 2.51.1 문서](https://git-scm.com/docs/git-log/2.51.1), [Git blame 문서](https://git-scm.com/docs/git-blame)

**APPLIES_TO:** 생성·수정 시각과 rename-aware 피드 참조를 구하는 이력 조회를 기능에 남긴다. ID 줄의 사후 변경을 판정하는 감사는 검사 쪽으로 옮긴다. 같은 Git 질의의 재사용은 한 실행의 동일한 저장소 상태 안에서만 한다.

**GOTCHA:** 모든 Git 호출을 없애는 것이 분리의 성공 기준은 아니다. 명령 이름만 보고 삭제 이력 조회를 제거하면 정상적인 피드 prune과 ID 재사용 감사를 함께 없앨 수 있다.

## 적용 상태와 한계

참조한 Node 동기 프로세스 API와 Git 명령은 기존 코드가 이미 사용하는 API다. shell 옵션을 켠 호출처럼 별도 제약·폐기 안내가 있는 사용법을 도입하지 않는다. Vitest는 설치된 안정 버전의 태그를 확인했으며 preview 기능이나 새로운 테스트 분류 기능에 기대지 않는다. 의존성 업그레이드·API 대체·비동기 전면 전환은 이번 조사에서 요구하지 않는다.

공식 문서는 이 프로젝트의 자동/수동 정책, 폴더명, 10분 예산을 정해 주지 않는다. 그 선택은 기존 설정·프로파일·프로젝트 합의를 근거로 계획에서 명시한다.
