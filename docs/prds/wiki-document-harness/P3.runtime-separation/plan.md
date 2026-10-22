# Plan: 기능 처리와 문서 검사 분리

## Summary

생성·조회가 작성 규칙과 전체 ID 이력을 감사하는 결합을 제거한다. 같은 파서·가시성·렌더·피드 해석을 재사용하는 하네스 검사로 기존 판정과 진단을 보존한 뒤 validate CLI와 실행 참조를 제거한다. 이 문서는 사용자 승인 후 실행한 계획이다. 구현·검증 결과는 아래에 기록한다.

## User Story

위키 유지보수자로서 문서 오류는 자동 제품 테스트에서 확인하고, 생성·조회 명령은 요청한 데이터를 처리하며, 검사기를 수정할 때만 수동 회귀를 실행하고 싶다.

## Problem → Solution

현재 summary 생성과 feeds의 문서 해석은 `loadHeadDocState → judgeDocs`를 호출한다. build에서 validate만 빼도 스키마·중복·ID 변경·삭제 ID 재사용 감사가 계속 실행된다. 문서 상태의 수집·투영을 기능으로 남기고 감사 정책을 하네스로 이동해 이 결합을 없앤다.

## Metadata

- Complexity: Large. 기능·정책·회귀·문서·실행 연결이 함께 바뀐다.
- Source PRD: ../prd.md
- PRD Phase: P3 runtime-separation
- Dependency: P1·P2 complete
- Repository: `/workspace/sas-wiki`, `feat/wiki-document-harness`
- Research baseline: `3b22c4cbf808ceccc926284dc701aa25c13633cd`
- Estimated Files: 기존 직접 관련 파일 약 60개와 정책 모듈·회귀의 이동/분할. 아래 소비처 대응표가 범위를 정한다.
- 적용 환경: Node v24.16.0, Git 2.51.1, Vitest 4.1.10. 매니페스트 하한 Node 22.13.0과 기존 의존성을 유지한다.
- 진행 방식: 조사·계획·직접 완전성 검수 → 사용자 확인 → RED/GREEN/REFACTOR·구현 검수. 오케스트레이션 없이 직접 수행한다.

## UX Design

웹 UI 변경은 없다. 작성자·개발자의 명령 동작이 바뀐다.

| Touchpoint        | Before                                 | After                                         |
| ----------------- | -------------------------------------- | --------------------------------------------- |
| 문서 오류         | test의 가드와 별도 validate에서 검사   | test의 실제 문서 가드에서 검사                |
| summary·feeds     | 공통 HEAD 상태를 만들며 전량 문서 감사 | 기능에 필요한 수집·가시성·이력·변환만 수행    |
| wiki              | 지정 파일 한 개 파싱                   | 유지                                          |
| build / build-dev | validate → summary → feeds             | summary → feeds. 실행 전 검사는 호출자의 책임 |
| pre-push          | test → validate                        | test, 실패하면 push 차단                      |
| CI                | format → coverage → validate → build   | format → coverage → build. 산출물 저장은 P4   |
| 검사기 개발       | test:harness                           | 유지. 새 정책 회귀도 수동 실행                |

## Mandatory Reading

모든 경로는 별도 표시가 없으면 sas-wiki 기준이다. 줄 번호는 조사 시점의 탐색 좌표이고 구현·주석의 영구 인용은 파일:심볼로 쓴다.

| Priority | File                                                                                  | Lines / Section                                         | Why                                         |
| -------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------- |
| P0       | ../contract.md                                                                        | C1–C10                                                  | 책임·전체 규칙·실패·작업 범위               |
| P0       | scripts/validate.mjs                                                                  | buildContent 58–140, 정책 273–345, 보고 400–465         | 이전 순서·심각도·진단·보고 실패             |
| P0       | scripts/lib/head-state.mjs                                                            | loadHeadDocState·findDraftPublicIdCollisions            | 수집과 감사의 실제 결합                     |
| P0       | scripts/lib/doc-gate.mjs                                                              | judgeDocs 전체                                          | 사유 우선순위·ID 이력·삭제 재사용           |
| P0       | scripts/lib/parse-vault.mjs                                                           | parseVault·memoize·assertHistoryIntegrity               | 공유 파싱·억제 위생·Git 캐시                |
| P0       | scripts/lib/git-walk.mjs                                                              | collectFeedItems·buildResolveContext·resolveDocRef      | 전체 피드와 사유 분류·빈 페이지 관용        |
| P0       | scripts/lib/generator.mjs, scripts/summary.mjs, scripts/feeds.mjs                     | 생성기·CLI·러너 구성                                    | 기능 경계·출력·고속 워크/해석 예산          |
| P0       | `harness/wiki-documents/__tests__/document-rules.guard.test.mjs`                      | 전체                                                    | 실제 파일·두 환경·보고·빈 입력 집행         |
| P0       | scripts/lib/invariants.mjs                                                            | 전체                                                    | 커밋 규약·참조·불변식                       |
| P1       | scripts/lib/git.mjs                                                                   | getFileHistory·readFrontmatterFieldChange·makeGitRunner | 값 도출과 감사·자식 종료                    |
| P1       | scripts/lib/derive.mjs, payloads.mjs, ignore.mjs, feed-survival.mjs                   | 공개 함수                                               | 유지할 기능 구현                            |
| P1       | scripts/wiki.mjs, scripts/lib/artifact.mjs                                            | wiki·캐시 소비 검증                                     | 단일 파일 처리와 필요한 경계 검증           |
| P1       | package.json, .husky/pre-push, .github/workflows/ci.yml                               | 실행 명령                                               | 삭제할 CLI의 실제 소비자                    |
| P1       | 아래 소비처 대응표의 테스트·지원 코드                                                 | 해당 describe·import                                    | 실질 보호 승계·자동 기능 검사 유지          |
| P1       | vitest.config.js, vitest.harness.config.js                                            | 수집·환경·coverage                                      | P2 분리와 제품 분모 보존                    |
| P2       | /workspace/docs/prds/convention-harness-unification/rules.md, decisions.md            | R-B1·B2·B4, R-N13–18·N26·N27, 5절                       | 읽기 전용 부모 규칙                         |
| P2       | `/workspace/scripts/wiki-dev-server/__tests__/wikiSetup.contract.source-scan.test.ts` | 272–281                                                 | 상위 소비자의 validate 존재 고정. 수정 금지 |

## Discovery and Traces

### 현재 구현의 근거

| Category / Trace | File:Symbol / 조사 위치                                       | 확인한 사실·계획                                                                             |
| ---------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| 유사 구현·진입   | wiki.mjs:wiki, feeds.mjs:feeds                                | 단일 파일 파싱과 커서 워크를 기존대로 재사용                                                 |
| 데이터 흐름      | generator:runSummaryGenerator → parseVault → loadHeadDocState | 동적 import와 stdout JSON은 유지하고 중간 감사 제거                                          |
| 데이터 흐름      | git-walk:buildResolveContext → loadHeadDocState               | 라이브 feeds도 같은 결합이 있으므로 생성기만 수정해서는 부족                                 |
| 상태 변경        | generator의 writeFileAtomic, validate의 writeReport           | 캐시 생성은 기능, 검사 보고서는 하네스. wiki·ID 변경 없음                                    |
| 정책             | head-state 68–99, doc-gate:judgeDocs                          | 스키마·중복·불변·삭제 재사용과 prod draft/public 충돌 검사                                   |
| 정책 순서        | validate:buildContent 75–135                                  | 보고 → 커밋 규약 → 제외 → deadlink → 미해석 참조 → 억제·payload 스키마 → 불변식 → stale 경고 |
| 오류             | git-walk:readBlobId 289–303                                   | 실제 객체 부재만 정상 처리. 권한·I/O·timeout은 원인과 ref로 전파                             |
| 로깅             | 실제 guard의 onReport·경고 루프                               | 경로·사유·SHA와 실패 전 보고 유지. 옛 CLI stdout의 축자 계약은 제거 가능                     |
| 데이터 모양      | head-state 반환·parseVault의 gate/stats/wire                  | 외부 payload와 내부 검사 재료를 구분. 검사 전용 gate·wire.ignore 소비 제거                   |
| 테스트           | 실제 guard + document-enforcement + test-selection            | 실제 문서는 자동, 검사기 오류 주입은 수동. 이동 후에도 실제 수집을 검증                      |
| 설정·의존성      | package·두 Vitest config                                      | 새 패키지·린트 없음. 기존 86/76/92/89 유지                                                   |
| 환경·전체 이력   | parse-vault:assertHistoryIntegrity                            | shallow/partial로 틀린 이력을 만들지 않도록 생성의 필요 전제도 유지                          |

### 읽기 전용 실험

`/tmp/sas-wiki-p3-profile.mjs`에서 주입한 Git 러너로 parseVault의 실제 호출을 기록하고, 기존 buildContent로 검증된 출력 기준선을 만들었다. 보고서·캐시·문서는 쓰지 않았다. dev/prod 출력은 각각 `/tmp/sas-wiki-p3-baseline-<env>.json`에 있다. 임시 파일은 영구 회귀 자산을 대신하지 않는다.

| 환경 | 문서 | 피드 전량 | 제외 | 파싱의 실제 Git 호출 | 그중 ID blame |
| ---- | ---- | --------- | ---- | -------------------- | ------------- |
| dev  | 67   | 6         | 0    | 305                  | 67            |
| prod | 61   | 1         | 0    | 281                  | 61            |

두 파싱 모두 문서 이력 `log --follow`는 67회였다. prod에서 draft 문서의 이력이 피드 해석에 필요할 수 있으므로 이 수를 0으로 만드는 최적화는 하지 않는다. 현재 러너의 동일 질의 캐시도 유지한다. 위 프로브가 출력한 `parseMs` 100,924/98,137은 파싱에 뒤이은 기존 무결성 검사까지 포함하므로 **순수 파싱 시간이나 개선 목표로 사용하지 않는다**.

첫 샌드박스 실행은 첫 ID blame에서 측정용 30초 제한에 걸렸다. 동일한 읽기 전용 명령을 승인된 샌드박스 밖 실행으로 비교하니 126ms에 통과했다. 따라서 이 실패를 제품의 실제 hang으로 판정하지 않았다. 이후 프로파일은 5분 외부 상한 아래 두 환경 모두 성공했다.

별도의 짧은 Node 프로브에서는 SIGTERM을 처리하는 자식에 250ms 제한·SIGKILL을 주어 255ms 뒤 ETIMEDOUT/SIGKILL을 관측했다. 부모 타이머는 동기 호출 반환 전에 실행되지 않았다. 이는 시간 제한 설계의 근거이며 저장소 테스트 통과의 증거는 아니다.

## External Documentation

[research.md](research.md)에 공식 문서와 설치된 버전의 유지보수 소스를 정리했다. 핵심은 동기 자식의 자체 종료 제한, Vitest 타이머의 한계, 실제 수집/계측 구분, 값 도출과 ID 감사의 서로 다른 Git 질의다.

## Strategic Design

### 기능 경로

1. `head-state.mjs`는 파일 수집·파싱과 환경별 상태 투영을 소유한다. `collectHeadDocuments(vaultDir)`로 파일 목록·parsedDocs·strayDocPaths를 한 번 얻고, `createHeadDocState(snapshot, env, excluded = [])`로 기존 반환 좌표를 만든다. excluded는 이미 계산된 데이터이며 검사기를 호출하지 않는다. 일반 `loadHeadDocState`는 감사 없이 이 두 함수를 조합한다.
2. prod draft 가시성, disable 처리, 파일명 제목, 본문 렌더, Git 유래 created/updated, rename/삭제에 따른 피드 해석을 유지한다. 원문 파싱·파일 I/O 오류는 경로·원인과 함께 전파한다.
3. `parseVault(vaultDir, env, { runGit, headState } = {})`로 기능 입력을 명시한다. 생산 스키마 인자와 검사 전용 gate·wire.ignore·stale 위생 계산을 제거한다. 공유 기능 결과는 wire·stats와 처리 context(runGit·headState·derived)로 반환한다. 별도 검증 모드나 `validate: false` 스위치를 만들지 않는다.
4. 생성기는 이 결과로 기존 payload를 만든다. 자동 문서 감사 결과인 excluded/status/partial을 만들기 위해 검사를 되살리지 않는다. summary의 감사 전용 `--max-excluded`와 해당 exit 3·항상 clean이 될 반환 플래그를 제거한다. 더 이상 유효하지 않은 옵션은 인자 오류로 드러낸다. payload 필드·stdout JSON·명시 --out·파일 쓰기 오류·env 오류는 보존한다.
5. 명시한 억제 목록을 읽는 feeds는 입력 스키마 검증과 적용을 계속 수행한다. summary는 억제 목록을 읽지 않는다. 읽는 캐시의 스키마·환경·세대 확인은 기능 경계에 남기며 전량 문서 감사로 취급하지 않는다.

### 검사 경로

`harness/wiki-documents/`에 아래 책임으로 이전한다. 기존 함수 내용을 먼저 승계하고 파서·렌더·payload·피드 해석을 새로 구현하지 않는다.

| 목표 모듈               | 책임·API                                                                                                                                                                              |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| document-state.mjs      | doc-gate의 judgeDocs·사유와 prod draft/public 중복 판정. auditHeadDocState(snapshot, env, {runGit, schemaDir})가 공통 상태 투영에 제외 결과를 전달                                    |
| document-invariants.mjs | 기존 checkCommitConventions·checkFeedResolution·checkInvariants와 진단                                                                                                                |
| document-report.mjs     | 기존 report schema 형태·JSON/TXT 원자 쓰기·진단 포맷. report schema 파일은 기존 scripts/schema 경로 유지                                                                              |
| document-integrity.mjs  | inspectVault({vault, env, snapshot, runGit, schema, deadlinks = 'warn', reportDir, onReport})가 감사 상태를 공유 parseVault에 주입하고 전체 정책을 집행. CLI·argv·독립 실행 경로 없음 |
| document-rules.mjs      | 기존 title·TREND/REPORT 작성 규칙 그대로 유지                                                                                                                                         |

실제 guard가 한 실행의 원문 snapshot과 Git 러너를 준비하고 파일별 작성 검사·dev/prod 무결성에 공유한다. 파일 누락·빈 wiki는 실패하고 prod 문서 0은 허용한다. 환경별로 파싱/파생·피드 결과를 한 번 만들며 정책별로 다시 생성하지 않는다. dev에서 전체 작성 규칙을 검사하고 prod에서 가시성 이후 참조·산출물과 draft/public 충돌을 확인한다. inspectVault의 성공 반환은 기존처럼 `{ body, feeds, report, stats, summary }`이며 실제 집행의 제외 허용치는 0이다. 제외 상태의 파생·진단 회귀는 auditHeadDocState와 공유 파싱 결과를 관측하며 집행 허용치를 높이지 않는다. deadlink의 기존 warn/ignore/error 정책은 내부 검사 옵션과 회귀로 보존하고 CLI 옵션은 남기지 않는다.

보고는 확인 가능한 제외·prune·미해석 사실을 얻은 뒤 정책 throw보다 먼저 알리고 기존 경로에 쓴다. 보고 쓰기 오류도 성공으로 처리하지 않는다. 정책과 쓰기가 함께 실패하면 양쪽 원인을 관측할 수 있어야 한다. 파싱 자체가 실패하면 만들 수 없는 보고서를 가장하지 않고 경로·원인을 전달한다.

### Git 비용과 멈춤 방지

- parse-vault의 성공 질의 메모를 `git.mjs:memoizeGitRunner`로 추출한다. parseVault와 실제 검사 실행이 공유하므로 새 파일을 만들지 않는다. 캐시는 한 실행·한 vault 상태에 한정하고 입력 stdin·encoding을 키에 포함한다. 실패는 캐시하지 않는다. 전역/디스크 신선도 캐시는 도입하지 않는다.
- 생성기와 문서 감사의 이력 러너에는 기존 feeds 해석 백스톱과 같은 600,000ms를 사용한다. 이는 새 속도 목표가 아니라 넉넉한 비상 상한이다. 상수는 Git 모듈에 한 곳으로 옮긴다. 신규 값이 필요한 경우 실측·영향을 확인하고 이 계획을 갱신한다.
- `makeGitRunner`에 종료 신호 전달을 추가해 이력 처리의 유한 호출은 SIGKILL을 지정한다. 기존 feeds의 5,000ms 커서 워크 예산·처리 의미와 pre-commit의 호출 정책은 유지한다. 모든 호출자의 기본값을 일괄 바꾸지 않는다.
- Git 실패를 문서 없음이나 빈 결과로 바꾸지 않는다. 주입 러너는 호출자가 제한·수명을 소유한다. 테스트의 자식 CLI/Vitest도 유한 timeout과 종료 상태 확인을 사용한다.
- 느린 정상 작업, Git 명령 한 개의 멈춤, 전체 테스트 예산을 구별한다. CI의 현재 20분은 이전 단일 워커 전체 검사 실측 약 26분과 다르므로 P4에서 CI 실행 환경을 확인해 판단한다. P3에서 무작정 전역 시간 제한을 늘리지 않는다.

### Alternatives Considered

| 안                             | 결과                                                  | 판단          |
| ------------------------------ | ----------------------------------------------------- | ------------- |
| CLI 호출만 삭제                | 수정은 작지만 head-state에서 감사가 계속됨            | C6 미충족     |
| 실행 경로에 검증 on/off 옵션   | 검사 정책이 기능 내부에 남고 호출자별 분기 증가       | 채택하지 않음 |
| 파서·피드 해석을 하네스에 복제 | 역할은 분리되나 가시성·렌더·참조가 쉽게 갈림          | 채택하지 않음 |
| 수집·투영 공유, 감사만 하네스  | 실제 책임과 재사용을 함께 유지. 테스트 이전 범위는 큼 | 권장          |

## Patterns to Mirror

실제 코드에서 확인한 패턴이다. 아래 import는 이전 전 원형이며 새 위치에서는 Files to Change에 따라 상대 경로를 조정한다.

```js
// scripts/lib/generator.mjs:runSummaryGenerator — 무거운 파싱의 동적 로드 유지
const { parseVault } = await import('./parse-vault.mjs')
```

```js
// scripts/lib/git-walk.mjs:collectFeedItems — 이미 계산한 상태를 주입해 재사용
export function collectFeedItems(vaultDir, { env, headState: injectedHeadState, runGit } = {}) {
  const resolvedRunGit = runGit ?? makeGitRunner(vaultDir)
  const { context, stats } = buildResolveContext(vaultDir, resolvedRunGit, env, injectedHeadState)
```

```js
// scripts/lib/git-walk.mjs:readBlobId — 실제 부재 밖 오류는 원인 보존
throw new Error(`feed 문서 blob 을 읽지 못했습니다(${ref}): ${message}${stderr}`, {
  cause: error,
})
```

```js
// scripts/validate.mjs:buildContent — 진단을 검사 실패 전에 전달
onReport(reportPayload, reportWrite)
checkCommitConventions(gate.commits, gate.runGit, WIKI_PREFIX)
```

```js
// harness/wiki-documents/__tests__/document-rules.guard.test.mjs — 환경별 실제 집행
it.each(['dev', 'prod'])(
  '%s 문서·이력·참조·산출물의 무결성을 지킨다',
```

명명·배치는 C2 및 부모 rules/decisions를 그대로 따른다. 하네스 모듈·주제는 kebab-case, 새 일반 기능 테스트 주제·도우미는 camelCase다. 테스트는 해당 대상의 `__tests__/` 바로 아래, 실제 전체 집행은 `.guard`, 검사기의 입력/출력 동작은 일반 `.test`, 설정·연결 약속은 `.contract`다. 원문 검사 종류는 부모 기준을 적용한다. 새 테스트 파일과 수정하는 제목에 phase/history 표기를 넣지 않는다. 한 테스트 파일은 800줄 이하로 유지하며 번호 조각으로 나누지 않는다.

## Files to Change

### 기능·정책·실행 파일

| File                                                                                          | Action           | Responsibility                                                                                    |
| --------------------------------------------------------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------- |
| scripts/lib/head-state.mjs                                                                    | UPDATE           | 원문 수집/상태 투영 공개, 감사·스키마 의존 제거                                                   |
| scripts/lib/parse-vault.mjs                                                                   | UPDATE           | 상태/러너 주입, 기능 결과만 조립, 불필요한 억제·위생/전량 커밋 수집 제거                          |
| scripts/lib/generator.mjs                                                                     | UPDATE           | 새 파싱 API·bounded runner·처리 context 사용, 감사 상태 반환 제거                                 |
| scripts/summary.mjs                                                                           | UPDATE           | 감사 옵션·exit 3·상태 통지 제거, 기능 stdout·out·실패 보존                                        |
| scripts/feeds.mjs, scripts/lib/git.mjs                                                        | UPDATE           | 해석 러너의 메모/백스톱 공유·종료 신호. 커서 워크 예산 유지                                       |
| scripts/lib/git-walk.mjs                                                                      | UPDATE           | raw/audited 상태 주입과 진단 유지, 이전 API 주석 정정                                             |
| scripts/lib/derive.mjs, draft.mjs, ignore.mjs, summary-endpoint.mjs                           | UPDATE           | 이전 감사/명령을 설명하는 주석·파싱 API의 실제 참조만 정정                                        |
| scripts/lib/doc-gate.mjs                                                                      | MOVE             | harness/wiki-documents/document-state.mjs. 소유 변경 후 scripts 재export 없음                     |
| scripts/lib/invariants.mjs                                                                    | MOVE             | harness/wiki-documents/document-invariants.mjs. 기능 소비자 0 확인 후 이전                        |
| scripts/validate.mjs                                                                          | REMOVE / EXTRACT | 정책을 document-integrity/document-report에 승계하고 argv·main·usage·엔트리 제거                  |
| scripts/schema/report.schema.json                                                             | UPDATE           | 검사 보고서 소유 설명 정정, 데이터 형태 유지                                                      |
| `harness/wiki-documents/__tests__/document-rules.guard.test.mjs`                              | UPDATE           | 원문·러너 공유, 새 inspector 호출, 기존 실제 집행·보고 보존                                       |
| `harness/wiki-documents/__tests__/document-enforcement.test.mjs`                              | UPDATE           | 새 inspector seam을 fixture stub으로 격리, 기존 무력화/실패 전달 유지                             |
| `harness/wiki-documents/__tests__/git-hooks.contract.test.mjs, ci-pipeline.contract.test.mjs` | UPDATE           | validate 단계 제거에 맞춘 수동 연결 계약                                                          |
| package.json, .husky/pre-push, .github/workflows/ci.yml                                       | UPDATE           | validate 명령·build/훅/CI 호출 제거. 그 밖의 설치·권한·checkout 유지                              |
| README.md                                                                                     | UPDATE           | 현재 검사 책임·명령·보고·생성 선행 조건을 실제 동작과 함께 갱신                                   |
| vitest.config.js                                                                              | UPDATE IF NEEDED | 새 scripts/test-utils만 제품 계측에서 제외. include/floor 유지. 기능 코드를 지원 코드로 빼지 않음 |

### 기존 테스트의 소비처 대응

파일의 기존 이름은 찾기 위한 좌표다. 옛 파일을 통째로 수동화하지 않고 describe/판정별로 나눈다. 새 하네스 파일은 모두 `harness/wiki-documents/__tests__/` 바로 아래에 둔다. 새 기능 검증은 scripts 대상 옆의 자동 범위에 둔다.

| 기존 파일·항목                                                                                                                          | 이전/갱신할 실질 보호                                                                                                                                                                             |
| --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lib/__tests__/doc-gate.test.mjs`                                                                                                       | document-state.test.mjs로 이전. 사유·우선순위·결정성·정상/위반·빈 입력 보존                                                                                                                       |
| `lib/__tests__/head-state.draft-id-collision.test.mjs + __tests__/validate.draft-id-collision.test.mjs`                                 | document-state.draft-id-collision.test.mjs로 정책·dev/prod 진단 이전. load/help 존재만 확인하는 옛 CLI seam 제거                                                                                  |
| `lib/__tests__/invariants.test.mjs, invariants.feed-only.test.mjs, invariants.grandfathering.test.mjs`                                  | document-invariants 관련 책임별 회귀로 이전. A+D/정상 rename/이관 이전 면제·각 불변식 보존. 정책 설명을 확인하는 원문 검사는 새 소유 경로에 맞춤                                                  |
| `__tests__/build.immutability-gate.test.mjs, immutability.verify.test.mjs`                                                              | document-state.id-history.test.mjs로 ID 변경·최초 등록·따옴표/줄 변경 경계 통합. 독립 조건 누락 없이 중복만 합침                                                                                  |
| `__tests__/validate.cli.test.mjs`                                                                                                       | CLI argv/help/폐기 옵션 제거. shallow/partial·schema 위반·진단·무오염·보고 스키마·쓰기 실패·실패 전 관측은 document-integrity/report 회귀로 승계                                                  |
| `__tests__/validate.deadlinks.test.mjs`                                                                                                 | document-integrity.deadlinks.test.mjs. 기본 warn·ignore/error·동명 충돌·검사 순서 보존. 옛 argv/help만 제거                                                                                       |
| `__tests__/validate.exclusion.test.mjs`                                                                                                 | document-integrity.exclusion.test.mjs. 제외 0·사유·원인 SHA·기존 오류 순서 보존. 허용치 CLI 파싱 폐기                                                                                             |
| `__tests__/build.conventions.test.mjs, build.convention-scope.test.mjs`                                                                 | 규약/이관 예외는 수동 document-invariants 회귀. 정상 삭제·rename의 피드 결과는 자동 기능 검사로 유지                                                                                              |
| `__tests__/build.doc-exclusion.test.mjs`                                                                                                | 감사 상태의 제외 전파·invalid-excluded/SHA는 수동 inspector 회귀. FEED_REF_REASONS 값·정상 피드 생존 기능 검증은 자동에 유지                                                                      |
| `__tests__/build.feed-survival.test.mjs`                                                                                                | 정책 실패/보고는 수동. normal/fix·draft/삭제/disable·unpublished 진단의 실제 피드 기능은 collectFeedItems/생성기 자동 테스트에서 유지                                                             |
| `__tests__/build.env-filter.test.mjs, build.env-parity.test.mjs`                                                                        | validate parseArgs 블록 제거. 정상 draft 이중 신호·혼합 feed·disable·prod 0·이관 등가는 자동 생성/파싱 테스트에 유지. 위반 draft의 정책 판정은 수동으로 이전                                      |
| `__tests__/build.frontmatter-id.test.mjs, lib/__tests__/derive.unique-frontmatter-id.test.mjs`                                          | UUIDv7을 실제 payload로 전달하는 검증은 자동 유지. ID 부재·중복 차단은 수동 검사 회귀로 이전                                                                                                      |
| `__tests__/build.ignore-feeds.test.mjs, build.ignore-mediation.verify.test.mjs`                                                         | 명시 억제·문서/본문 보존은 실제 feeds 생성의 자동 검증. malformed/stale의 inspector 판정은 수동으로 분리                                                                                          |
| `__tests__/build.smoke.test.mjs, build.vault.test.mjs, build.vault-root.test.mjs, build.uuidv7-e2e.test.mjs`                            | 정상 생성·rename/prune·실제 field·sourceCommit·결정성은 자동 유지하며 파싱/생성기로 전환. report/검사 전용 단언만 수동으로 이전                                                                   |
| `__tests__/build.contract-shape.test.mjs, lib/__tests__/build.wire-payload.test.mjs`                                                    | 실제 출력 모양/파싱 등가는 자동 유지. inspector와의 공유 엔진 비교만 수동으로 분리. 내부 gate/wire.ignore 키의 소멸에 맞춤                                                                        |
| `lib/__tests__/fail-closed.verify.test.mjs`                                                                                             | isDraft·Git 오류 전파·실제 생존 기능 자동 유지. frontmatter/삭제 ID 재사용 정책 블록은 수동 이전                                                                                                  |
| `lib/__tests__/git-walk.ref-resolution.test.mjs, feed.prefix-closure.test.mjs`                                                          | 실제 참조 해석·사유/SHA·접두사 무관한 feed 해석은 자동 유지. checkFeedResolution/checkCommitConventions 단언만 하네스로 옮겨 scripts의 하네스 import 제거                                         |
| `__tests__/serving.exclusion.test.mjs, serving.drift-inversion.test.mjs`                                                                | 정상 서빙·draft prune·본문은 자동 유지. 위반 문서를 자동 정제한다는 옛 보장 대신 기능이 ID 감사하지 않음을 관측. 같은 위반을 inspector가 실패시키는 짝은 수동 회귀에 둠                           |
| `__tests__/serving.cost-tier.test.mjs, serving.cost-profile.test.mjs`                                                                   | 항상 깊은 감사를 강제하던 단언 갱신. 자동에서 실제 기능 결과가 있으면서 blame·삭제 ID 감사 호출 0임을 확인. 필요한 log/피드 조회가 살아 있음을 짝지음                                             |
| `__tests__/summary.generator.test.mjs, summary.cli-exit.test.mjs`                                                                       | partial/excludedCount/max-excluded/exit 3 제거. 정상 생성·명시 out·stdout·인자·쓰기/런타임 오류·항상 계산은 자동 유지                                                                             |
| `__tests__/summary.suppression-independence.test.mjs`                                                                                   | summary의 억제 독립·명시 feeds의 오류는 자동 유지. validate 오류 arm만 inspector 수동 회귀로 승계                                                                                                 |
| `__tests__/cli-contract.test.mjs, cursor.cli-contract.test.mjs, lib/__tests__/cli-env.probe.test.mjs`                                   | 삭제 명령의 기본 vault/enum seam만 제거. summary·feeds·wiki의 argv/stdout/격리·커서 보호는 자동 유지                                                                                              |
| `__tests__/hooks.plumbing.test.mjs`                                                                                                     | 실제 .husky/pre-push를 임시 vault·로컬 bare remote에서 실행하는 자동 통합으로 교체. pnpm shim이 fixture의 실제 guard만 실행해 자기 전체 suite 재귀 방지. 중복 ID면 remote 불변·정상 수정이면 성공 |
| `__tests__/build.entry-guard.test.mjs, build.v3p1-plumbing.test.mjs`                                                                    | 없어진 validate export/존재·3단 체인 기대 제거. 실제 2단 생성·실패 시 후속 미실행·환경별 파일·읽기 오류 검증은 자동 유지                                                                          |
| `__tests__/build.p3-plumbing.test.mjs, build.p5-plumbing.test.mjs`                                                                      | doc-gate/validate 존재·보고의 CLI 호출 고정 제거. 실제 캐시 출력·무오염은 자동 유지. report 경로·필드는 수동 계약/회귀로 이전                                                                     |
| `__tests__/summary.artifact-set.test.mjs, generator.multi-writer.test.mjs`                                                              | summary/feeds의 같은 sourceCommit·generatedAt·원자 쓰기·동시 생성 기능 자동 유지. report를 필수 3번째 빌드 산출물로 묶지 않음                                                                     |
| `__tests__/dead-values.guard.test.mjs`                                                                                                  | 실제 스키마/제품 payload·죽은 값 검사는 자동 유지. SC4·LZ6 inspector 스키마 주입 검출은 수동 승계. 옛 validate 경로만 제거                                                                        |
| `__tests__/legacy-sweep.test.mjs`                                                                                                       | 추적 파일/예외 liveness와 실제 레거시 토큰 검출 보존. 이동한 정책 경로·테스트 예외 원장을 정확히 갱신하고 포괄 제외 추가 금지                                                                     |
| `__tests__/docs-contract.test.mjs, docs-payload-shape.test.mjs`                                                                         | 제품 endpoint/payload/enum 문서 정합은 자동 유지. 검사 라벨/보고/불변식 문서 계약은 해당 하네스 수동 계약으로 분리. 옛 CLI 문자열을 살리기 위한 단언 제거                                         |
| `lib/__tests__/git.test.mjs, atomic-git.hardening.test.mjs, git-walk.test.mjs, feed-cursor.test.mjs, parse-vault.generated-at.test.mjs` | Git 종료·캐시·파싱 API 영향을 자동 검증. cursor·시간 값·오류 전파의 기존 기능 조건 유지                                                                                                           |
| `__tests__/helpers/tmp-git-vault.mjs, walk-feeds.mjs 등`                                                                                | 실제 소비처 변경에 필요한 API/거짓 주석만 수정. 기존 제품 fixture의 전수 개명 금지                                                                                                                |

표의 `__tests__`와 `lib/__tests__` 앞에는 scripts/를 붙인다. 삭제 대상의 import뿐 아니라 동적 import·CLI 경로·설정·스캔 원장·문서의 실행 예제를 모두 대조한다. 역사 문서의 과거 설명은 유지하며 현재 실행 안내로 오인되는 참조만 고친다.

### 새 테스트와 지원 코드의 배치

- 기능 분리 통합은 `scripts/__tests__/runtimeSeparation.test.mjs`에 두고 실제 파싱·생성·live feeds가 ID 감사 없이 의미 있는 결과를 내는지 확인한다. 하네스 코드를 import하지 않는다.
- 검사기 회귀는 위 책임별 하네스 파일에 둔다. 문서 분야 아래 validation-regression 같은 실행별 폴더를 만들지 않는다.
- 둘 이상 하네스 테스트가 공유하는 임시 Git fixture만 `harness/test-utils/git-vault.mjs`에 둔다. 기존 scripts helper를 하네스 helper로 재export하거나 서로 import하지 않는다. 필요한 최소 fixture 조작만 독립 소유하고 파서/renderer/기능 구현을 복제하지 않는다.
- 새 제품 공통 도우미가 둘 이상에서 필요하면 `scripts/test-utils/<camelCase>.mjs`, 한 파일만 쓰면 그 테스트 내부다. 새 정적 fixture가 필요할 때만 대상 옆 `__fixtures__`를 쓴다. 제품 코드·기능 변환을 test-utils에 숨기지 않는다.

## NOT Building

부모 저장소·포인터 변경, wiki 본문/기존 ID 변경, 린트·패키지 추가, 전체 기존 파일 개명, 캐시 신선도 판정, API payload 변경, 독립 검증 CLI/호환 껍데기, 실제 원격 push·릴리즈·배포는 하지 않는다. CI artifact 업로드와 최종 배포 연결 검증은 P4다.

## Step-by-Step Tasks

### Task 1: 기능/정책 경계의 RED와 승계 고정

- ACTION: runtimeSeparation 자동 테스트와 정책 수동 회귀를 먼저 준비한다.
- IMPLEMENT: 정상·ID 변경·삭제 ID 재사용 fixture에서 실제 Git 호출을 관측한다. 기능의 실제 문서/피드 결과가 존재하면서 blame·삭제 ID 감사 호출은 0이어야 한다. 정책 쪽은 같은 결함과 정상 대조군의 판정·경로·원인을 고정한다. 기존 mixed 테스트는 위 표의 실질 조건을 빠뜨리지 않게 describe별로 나눈다.
- MIRROR: serving.cost-tier의 recordingRunner, document-enforcement의 원본 가드 복사/실제 자식 Vitest.
- IMPORTS: 자동은 scripts 기능·Node·Vitest만. 수동은 하네스 inspector/state와 자기 test-utils.
- GOTCHA: 모듈 부재나 EPERM을 기대한 행동 RED로 세지 않는다. 아직 없는 모듈이 막으면 기존 seam에서 결합의 실패를 먼저 관측하고 정책 이전 뒤 새 seam에서 재확인한다.
- VALIDATE: 자동의 감사 호출 존재와 옛 체인·옵션을 원인으로 RED를 확인한다. 가드 누락/검사기 무력화/실패 전달의 수동 검출도 유지한다.

### Task 2: 감사 상태와 기능 조립 분리

- ACTION: 수집/투영을 기능에 남기고 정책 모듈·회귀를 같은 문서 분야로 옮긴다.
- IMPLEMENT: Strategic Design의 API와 제외·사유 좌표를 적용한다. raw/audited headState를 같은 git-walk·derive·payload로 처리한다. 이전 전 정책 순서·충돌·rename 예외를 지킨다. 조건 검사가 필요한 C4 규칙은 기존 inspector를 재사용한다.
- MIRROR: collectFeedItems의 기존 headState 주입, judgeDocs의 진단 우선순위, buildContent의 보고 선행.
- IMPORTS: 하네스→scripts의 파서/투영/Git/renderer/payload는 허용. scripts 기능→harness는 0. 검사 전용 모듈은 scripts에 재export하지 않음.
- GOTCHA: invalid-excluded를 draft/deleted로 오분류하지 않는다. prod의 draft/public ID 중복 검사와 dev 전체 검사를 보존한다. 이전 전에 대체 회귀·실제 guard가 도는지 확인한다.
- VALIDATE: 관련 자동 기능·수동 정책 회귀·실제 dev/prod guard. 보고 쓰기만 실패/정책도 동시 실패의 원인 관측을 확인한다.

### Task 3: Git 실행 수명과 비용 분리

- ACTION: 실행 단위 메모와 이력 러너의 유한 종료를 연결한다.
- IMPLEMENT: 기존 memoize를 Git 모듈로 추출하고 snapshot/환경 처리에 공유한다. 제한·신호는 이력 호출에만 명시한다. 필요한 날짜/rename/prune 질의는 유지한다.
- MIRROR: parse-vault:memoize의 키, feeds의 두 러너 분리, git-walk의 비-benign 오류 전파.
- IMPORTS: scripts/lib/git.mjs의 기존 execFileSync. 새 외부 런타임/타이머 라이브러리 없음.
- GOTCHA: 캐시는 커밋/파일이 바뀐 실행에 재사용하지 않는다. 성공 캐시가 실패나 stdin 차이를 숨기지 않도록 한다. 5초 워크 예산과 10분 이력 백스톱을 혼합하지 않는다.
- VALIDATE: 같은 args+input+encoding의 성공 1회, 다른 입력의 별도 실행, 실패 후 재시도, SIGTERM을 무시하는 임시 Git 프로세스의 유한 실패를 자동 테스트로 확인한다.

### Task 4: validate 제거와 실행 연결 전환

- ACTION: 대체 가드가 동작한 다음 CLI·명령·호출을 제거한다.
- IMPLEMENT: build/build-dev는 기존 env/count/ignore/out을 유지한 summary→feeds. pre-push는 test 실패를 전달. CI에서 validate 단계만 제거한다. 수동 훅/CI 계약과 자동 실제 push 기능 테스트를 함께 갱신한다. summary 감사 옵션과 상태 잔재도 제거한다.
- MIRROR: 실제 pre-push shell 시험, build 체인의 &&·원자 쓰기·실패 전달.
- IMPORTS: 기존 Node/셸/패키지 실행 도구. product 테스트의 fixture guard 실행은 별도 설정으로 전체 suite 재귀를 막음.
- GOTCHA: 위반 문서의 build 실패를 요구하지 않는다. 문서 오류는 test의 실제 가드가 잡고, 생성 처리에 필요한 Git/파싱/I/O/명시 억제 오류는 build가 실패한다. 실제 외부 remote에 push하지 않는다.
- VALIDATE: scoped build 테스트의 정상 두 환경/2단계 실패/파일 생성, fixture 원격의 push 차단과 성공, 실제 수집과 수동 명령의 간접 호출 부재를 확인한다.

### Task 5: 가이드·전체 검증·구현 완전성 검수

- ACTION: 실행 안내를 실제 상태에 맞추고 GREEN/REFACTOR 검수와 PRD 반영을 한다.
- IMPLEMENT: README의 validate 절·예제·책임표·게이트 설명·ID 안내·보고·3단 빌드 설명을 갱신한다. 문서 정합 테스트의 정책/제품 책임도 승계한다. 부모 validate 존재 고정 영향은 이 계획에 남기고 수정하지 않는다.
- MIRROR: P2의 실제 수집·수동 회귀·제품 coverage·완료 근거 기록.
- IMPORTS: 기존 도구만.
- GOTCHA: 추적 파일 스캔 전에 새 이동 파일을 sas-wiki에서만 stage하고 검토한다. 전체 테스트 중 HEAD를 바꾸거나 Git fixture를 서로 공유하지 않는다. 삭제/이동으로 coverage 값이 바뀌어도 floor를 낮추거나 실제 기능을 분모에서 빼지 않는다.
- VALIDATE: 아래 명령·검사 보존표와 최종 diff를 대조한다. 통과 후 P3만 complete. P4 미진입, push 없음.

## Requirement → Verification

| Contract / 판정                                   | 구현·검증 대응                                                                                                            |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| C1·C2                                             | 같은 분야의 정책·직접 `__tests__`, 실제 가드만 .guard, 의미별 이름. 기능 자동 검사를 수동에 흡수하지 않음                 |
| C3                                                | 기존 실제 list 비교로 test=coverage·수동과 비중첩·누락 없음·빈 수집 실패. 하네스가 실제 wiki를 검사하지 않는 fixture 격리 |
| C4                                                | inspectDocument의 전체 기존 회귀, 실제 파일 가드. 문서/ID diff 0                                                          |
| C5 frontmatter/type/schema/UUIDv7/created·updated | document-state 정상·위반·사유 우선순위 + 실제 dev 전체 집행                                                               |
| C5 path·ID 중복/변경/삭제 재사용/stray            | 이전 회귀의 독립 조건·경로·사유·invalidExcludedRefs/SHA 보존. prod draft/public 충돌 포함                                 |
| C5 A+D·rename·이관 예외                           | document-invariants 회귀와 실제 이력 가드. 정상 rename/재생성 새 ID 통과                                                  |
| C5 deadlink/anchor·동명 충돌                      | 기본 경고와 설정별 판정·동명 실패·우선순위 회귀. SHA가 필요한 feed와 구분                                                 |
| C5 unresolved·억제 malformed/stale                | 전체 feed 검사와 SHA·경로 진단, 명시 억제 기능 자동/위생 정책 수동 분리                                                   |
| C5 schema·불변식·count 이전 전체 feed             | 기존 payload/body·tree/tag/sourceCommit/ID의 모든 위반 짝 + window 밖 결함 검출                                           |
| C5 Git/전체 이력                                  | shallow·partial·Git 실패의 원인·복구 안내 보존, 정상 full/빈 prod 대조                                                    |
| C6                                                | 실제 summary/feeds에서 ID 감사 호출 0과 비어 있지 않은 정상 출력. wiki 단일 파일 유지. inspector에서 동일 기능 사용       |
| C6 공유·멈춤                                      | snapshot·성공 Git 메모·환경별 처리 재사용·실패 비캐시·유한 자식 종료 시험                                                 |
| C7                                                | 실패 전 보고·경로/원인/SHA·쓰기 실패 전파·경고 성공·기존 제품 coverage 86/76/92/89                                        |
| C8의 P3 부분                                      | pre-commit 불변, test 단일 pre-push, CI coverage→build, 실제 prod/dev 쌍. 업로드는 P4                                     |
| C9                                                | validate 파일·package 명령·현재 실행 참조·호환 CLI 없음, 부모/문서/ID/의존성 변경 없음                                    |
| C10                                               | 계획 커버리지 검수 후 사용자 확인, 목표 변경은 조율. 이 문서의 파일/API는 구현 제약 발견 시 이유와 함께 갱신              |

## Testing Strategy

| 검사        | 입력                                                | 기대 결과                                                                          |
| ----------- | --------------------------------------------------- | ---------------------------------------------------------------------------------- |
| 기능 분리   | 정상·ID 변경/삭제 재사용의 실제 Git fixture         | 기능은 전량 감사 호출 없이 처리. 위반 처리 결과는 자동 정제 보장으로 고정하지 않음 |
| 검사 승계   | 같은 정상/위반 fixture                              | 정책은 정상 통과, 위반 실패와 기존 사유·경로·필요한 SHA                            |
| 일치        | 이전 전 정상 baseline·정상 seed의 두 환경           | 생성 데이터 의미·API 키·문서·body·피드 순서/가시성 일치                            |
| 시간/캐시   | 입력이 같은/다른 러너·실패 러너·종료 신호 무시 자식 | 성공 공유, 실패 비캐시, 원인 유지, 제한 후 종료                                    |
| 집행 연결   | 가드 stub 실패·검사기 no-op·빈 wiki·빈 수집         | 실제 자식 Vitest 실패. prod 0문서는 통과                                           |
| 게이트/생성 | 로컬 bare remote·실제 hook, 실제 두 단계 build      | 위반이면 push 차단, 정상 성공. 생성의 기능 오류는 실패·후속 미실행                 |

baseline은 sourceCommit을 제외한 실제 필드·내용·순서로 비교하고, 새 실행의 sourceCommit은 그 실행 HEAD와 별도 대조한다. generatedAt은 고정 SOURCE_DATE_EPOCH 또는 동일 fixture 이력으로 통제하며 다른 필드를 무차별 제거하지 않는다. 현재 실제 vault가 불변이라는 전제로 baseline 파일이 없으면 구현 전 코드에서 다시 얻는다.

Edge cases: 전체 wiki 부재, prod 0, malformed frontmatter, 중복 ID의 입력 순서, 첫 ID 등록·따옴표 정정, rename과 동일 경로 재생성, draft/public 충돌, disable, 억제된 feed·window 밖 feed, shallow/partial·Git 부재·권한/I/O, 보고만 실패/정책 동시 실패, 캐시 입력·encoding 차이, 자식 신호 종료. 네트워크 API·브라우저·DB는 해당 없다.

## Validation Commands

아래는 **구현 단계에서 실행할 명령**이다. 계획 작성만으로 통과했다고 표시하지 않는다. 추적 파일 스캔의 대상이 staging까지 반영됐는지 먼저 확인하고 전체 실행 중 커밋하지 않는다.

```bash
pnpm exec prettier --check docs/prds/wiki-document-harness/P3.runtime-separation/plan.md docs/prds/wiki-document-harness/P3.runtime-separation/research.md docs/prds/wiki-document-harness/prd.md
git diff --check
```

구현 중에는 관련 자동/수동 테스트만 경로로 선택한다. 새 테스트의 이름·분할을 확정한 뒤 각 Task의 실행 목록과 결과를 이 문서에 갱신한다. 별도 lint/typecheck 명령을 만들지 않는다. 설정 또는 공용 파서·Git 실행기 변경의 영향은 최종 전체 실행으로 확인한다.

```bash
pnpm exec vitest list --filesOnly --json
pnpm exec vitest list --coverage --filesOnly --json
pnpm exec vitest list --config vitest.harness.config.js --filesOnly --json
pnpm run test:harness --maxWorkers=1
pnpm run test:coverage --maxWorkers=1 --coverage.reportOnFailure
pnpm run build
pnpm run build-dev
git diff --check
```

EXPECT: 두 자동 수집 집합이 같고 수동과 교집합이 없으며 역할별 파일이 누락되지 않음. 전체 테스트·기존 coverage floor 통과. 실제 prod/dev summary·feeds가 생성되고 환경별 sourceCommit·generatedAt이 일치. 검사 보고서는 테스트가 생성하고 build에서 요구하지 않음. build 결과는 읽기 권한 안내에 따라 필요한 메타/필드만 검증하며 UI 확인을 요구하지 않음.

테스트 중에는 부하·활동·종료 상태를 확인하고 동기 프로세스 정지를 단순 Vitest timeout으로 해결하지 않는다. sandbox에서 stdin Git이 멈추면 동일 최소 명령을 허용된 실행 환경에서 비교한 뒤 제품 실패와 구분한다. 전체 suite를 반복하는 것은 새 변경·실패·미해결 우려가 있을 때만 한다.

## Acceptance Criteria

- [x] 기존 C5의 조건·예외·심각도·진단마다 대체 검사와 회귀가 있다.
- [x] 기능 경로에서 전체 문서 스키마/중복/ID 불변/삭제 ID 재사용/커밋 규약/deadlink/전체 불변식을 집행하지 않는다.
- [x] 기능에 필요한 가시성·이력·파싱·렌더·명시 억제·입력/캐시 경계 검증을 보존한다.
- [x] validate CLI·명령·현재 실행 참조·호환 wrapper가 없고 summary 감사 옵션도 없다.
- [x] 실제 문서 가드와 scripts 기능은 자동, 검사기 회귀·설정 계약은 수동이다.
- [x] 보고·원인·SHA·쓰기 실패·빈 입력의 보호와 기존 제품 coverage floor를 유지한다.
- [x] 실제 운영/개발 빌드가 생성만 하며 검증한 정상 입력의 의미를 보존한다.
- [x] sas-wiki 안에서만 로컬 커밋하며 부모 포인터·wiki 문서·기존 ID를 바꾸거나 push하지 않는다.

## Completion Checklist

- [x] 위 소비처 표의 실질 단언을 승계하고 삭제 이유가 분명하다.
- [x] 새 경로·제목·test-utils 소유·800줄 제한이 부모 규칙 및 C2와 맞다.
- [x] scripts→harness import나 기능 파서/renderer의 복제가 없다.
- [x] 자동 검사기를 무력화했을 때 수동 회귀가 실제 실패한다.
- [x] GREEN 뒤와 REFACTOR 뒤 5차원 직접 감사·완전성 검수를 수행하고 결과를 근거와 함께 남긴다.
- [x] README·PRD·현재 계획이 일치하며 P4를 완료로 처리하지 않는다.

## Risks

| Risk                                                   | Likelihood / Impact        | Mitigation                                                             |
| ------------------------------------------------------ | -------------------------- | ---------------------------------------------------------------------- |
| mixed 테스트를 전부 수동으로 옮겨 제품 보호 감소       | 높음 / 높음                | describe별 승계표·자동 수집·실제 기능 출력 검증                        |
| raw/audited 상태가 draft·invalid·deleted를 다르게 해석 | 중간 / 높음                | 상태 투영/피드 해석 공용, prod 충돌·rename·stray 짝                    |
| 제거 과정의 보고·실패 원인 유실                        | 중간 / 높음                | 실패 전 보고·복합 실패·실제 child 종료코드 시험                        |
| coverage 분모 이동으로 보호를 확보한 것처럼 보임       | 중간 / 높음                | 기능 코드는 계속 scripts, 정책만 이전, 하한 유지·수동 검출력 별도 확인 |
| 자식 Git 정지를 테스트 시간 제한으로만 처리            | 중간 / 높음                | 프로세스 자체 제한·종료 신호·정상 지연과 환경 문제 구분                |
| 부모가 삭제된 validate 존재를 요구                     | 확정 / 포인터 갱신 시 실패 | 아래 영향 기록. 부모 파일 수정/포인터 갱신 금지                        |

## Parent Consumer Impact

부모 `/workspace/scripts/wiki-dev-server/__tests__/wikiSetup.contract.source-scan.test.ts`의 “sas-wiki가 자체 validate 스크립트를 소유한다” 항목은 package.scripts.validate에 scripts/validate.mjs가 포함되는지 검사한다. 이번 기능 브랜치를 부모에 연결하면 이 단언은 목표 설계와 충돌한다. 부모의 해당 항목을 실제 자동 문서 가드·test 소유 확인으로 바꾸는 작업이 별도로 필요하다.

현재 부모 인덱스는 sas-wiki main `97f207cfcfa6be9365bff7ae67d2422f9072f342`를 가리킨다. 이를 바꾸지 않는다. 이 영향 보고는 수정 완료를 뜻하지 않는다. 부모의 보호된 eslint-rules는 셸 조회가 차단되어 조사하지 않았으며, 이 계획이 부모 전수 호환성을 보증하지 않는다.

## Notes

research.md의 공식 근거로 동기 Git의 자체 종료·Vitest 타이머 한계·파일 수집/계측·rename 이력 의미를 확인했다. 기존 파서/renderer를 공유하고 정책만 이전하는 선택은 내부 호출 조사와 C6에 근거한다. 600,000ms는 기존 해석 백스톱을 재사용하며 외부 표준값이 아니다.

계획의 새 모듈명·함수명은 합의 목표를 구현하는 현재 방법이다. 구현에서 바뀌면 이유·영향을 이 문서에 반영하고 책임/범위/외부 동작의 변경이면 먼저 사용자와 조율한다. contract.md의 목표는 구현에 맞춰 자동 수정하지 않는다.

사용자가 요청한 대로 이 계획과 조사를 확인받은 뒤 구현에 진입한다. Claude 전용 Skill/Agent 호출은 수행한 것으로 표시하지 않으며 기존 승인된 Codex 직접 대체 방식으로 조사·완전성 검수를 수행한다.

### 계획 완전성 검수

준거는 PRD의 P3 Scope/Success signal, contract C1–C10 중 이번 페이즈의 관할, 부모의 명명·배치·종류 규칙, sas-prp-plan과 prp-plan의 계획 체크리스트다. 구현의 정확성·전체 테스트 통과·P4 산출물 저장·부모 전수 호환성을 이번 계획 검수의 통과로 주장하지 않는다.

직접 검수에서 초기 초안의 inspector deadlink 옵션/반환 계약 누락과 git-walk 단위 소비처 표기를 보강했다. 현재 목표·소비처·작업·검증 대응은 위 Requirement → Verification 표로 모두 연결했다. 연구의 네 가지 핵심은 Strategic Design 및 Testing Strategy에 반영했다. 새 명명/린트 규칙을 도입하지 않고 기존 부모 컨벤션을 적용하므로 거버넌스의 새 선택 항목은 없다. 기능/정책 분리는 기존 C6의 적용 방법이다.

계획 커버리지의 미판정 항목은 없다. 구현 전 확인할 사용자 항목은 이 계획대로 진행할지이며, 구현 검증 체크박스는 실행 전이라 모두 미완료로 둔다. 검수는 Codex가 직접 수행했으며 독립 에이전트 검수로 표시하지 않는다.

계획 산출물 3개의 Prettier·상대 링크·diff 공백 검사는 통과했다. 이 단계에서는 새 구현 테스트나 전체 suite를 실행하지 않았다. 기존 buildContent의 두 환경 성공은 위 기준선 조사에만 사용했다. 커밋 전 pnpm audit는 기존 의존성의 high 3·moderate 7·low 1을 보고했으며 의존성 파일을 바꾸지 않았다. 패키지 수정은 이번 계획 작성의 범위에 포함하지 않는다.

## 구현 및 최종 검수 결과

- 승인된 Codex 직접 실행 방식으로 RED → GREEN → REFACTOR와 두 차례 5차원 검수를 수행했다. 다른 에이전트·Claude Skill 실행으로 표시하지 않는다.
- 실제 파일 수집과 환경별 투영은 scripts/lib/head-state, 기능 조립은 parse-vault·기존 빌더가 소유한다. document-state·document-integrity·document-invariants·document-report로 정책과 보고를 이전했다. 독립 검증 CLI나 호환 래퍼는 없다.
- 실제 가드는 snapshot을 한 번 파싱하고 두 환경의 성공 Git 질의를 공유한다. 일반 파싱·생성과 라이브 feeds의 전체 ID 감사 호출 0, 실패 비캐시, 입력/encoding 구분, SIGTERM 무시 자식의 SIGKILL 종료를 회귀로 확인했다.
- 삭제한 validate의 argv/help/전용 stdout·exit 테스트는 제거했다. 정책 검출·사유 우선순위·이력/stray·draft 충돌·전체 피드/200건 밖 참조·보고와 쓰기 실패는 같은 분야의 수동 회귀로 승계했다. 정상 생성·억제·표시·페이징·출력/에러의 실질 기능 검사는 자동에 남겼다. 이동한 기존 원문 가드의 정확한 경로와 살아 있는 예외 좌표도 갱신했다.
- 계획의 내부 파일 분해는 회귀별 책임에 따라 더 나눴다. 여러 회귀가 쓰는 fixture 지원만 harness/test-utils에 두고 사용하지 않는 사본은 남기지 않았다. 예제 저장소 준비 중복은 기존 seed-example-vault에 통합했고, scripts의 두 테스트 지원 모듈은 공유 기능만 사용한다. 새 경로는 부모 이름·종류 규칙과 800줄 이내를 지킨다. 서로 다른 가족의 테스트 도우미를 import하지 않는다.
- 공통 억제 로더의 JSON/읽기 오류에 실제 파일 경로와 cause를 붙였다. 기존 오류 실패 동작을 유지하며 잘못된 억제 파일을 수정할 위치를 알 수 있게 했다. REFACTOR에서는 무시되는 옛 인자·미구현 시절의 로드 래퍼·죽은 주석을 정리했다.
- 고정 상태의 최종 자동 검사 100파일·1,028건과 수동 하네스 35파일·268건이 통과했다. 기존 제품 coverage 하한 86/76/92/89와 scripts 기능 분모를 유지했다. 정확한 수치는 PRD 결과에 기록한다. 검사 도중 사본 삭제와 실행을 겹쳐 인덱스 ENOENT를 만든 중간 실패는 상태를 고정한 전체 재실행으로 해소했다.
- 실제 prod/dev 빌드와 구현 전 기준선 JSON을 비교했다. sourceCommit만 당시 HEAD로 바꾸어 대조했으며 summary·feeds·body의 모든 JSON 값과 순서가 같다. dev 문서/피드 67/6, prod 61/1이다. generatedAt 등 다른 필드를 제거하지 않았다. null-prototype 내부 맵은 wire JSON으로 직렬화해 비교했다.
- 포맷과 diff 공백 검사가 통과했다. wiki·기존 ID·의존성 파일·pre-commit은 변경하지 않았고 부모 인덱스는 main 97f207cfcfa6be9365bff7ae67d2422f9072f342를 유지했다. 감사의 기존 high 3·moderate 7·low 1은 의존성 변경 없이 유지된다.
- 계약 C1–C10의 P3 관할 항목과 소비처 표를 재대조했다. 정확성·중복·죽은 코드·정리 부채·임시 대응의 최종 미니 검수에서 미해결 구현 결함을 발견하지 않았다. 부모의 validate 존재 단언은 여전히 별도 호환성 작업이며 이번 범위에서 수정하지 않는다. CI의 운영 세트 저장과 최종 배선 검증은 P4로 넘긴다.
