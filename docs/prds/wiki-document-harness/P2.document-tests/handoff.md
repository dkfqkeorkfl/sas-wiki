# P2 적용 인계

P1 조사는 완료했다. P2는 아래 신규 파일의 보호 경로 적용을 기다리는 상태다. 기존 validate·Vitest 설정·Git 훅·CI·기존 하네스 파일은 아직 변경하지 않았다.

## 변경안

| Draft                           | Target                                                            | Responsibility                            |
| ------------------------------- | ----------------------------------------------------------------- | ----------------------------------------- |
| /tmp/wiki-policy-change/draft-1 | harness/test-utils/inspect-document.mjs                           | 작성 title·시점 문서 규칙·실제 파일 수집  |
| /tmp/wiki-policy-change/draft-2 | harness/test-utils/inspect-vault.mjs                              | 기존 무결성 게이트·실패 전 진단, CLI 없음 |
| /tmp/wiki-policy-change/draft-3 | harness/wiki-documents/**tests**/wiki-documents.guard.test.mjs    | 실제 작성 규칙·dev·prod 집행              |
| /tmp/wiki-policy-change/draft-4 | harness/validation-regression/**tests**/document-rules.test.mjs   | 작성 규칙 검출력의 수동 회귀              |
| /tmp/wiki-policy-change/draft-5 | harness/validation-regression/**tests**/vault-validation.test.mjs | 임시 Git vault의 무결성 검사 수동 회귀    |

새 경로 5개를 추가한다. 기존 보호 파일 3개를 덮어쓰거나 삭제하지 않는다. 문서 내용과 ID도 바꾸지 않는다. 검사 보고서는 기존 gitignore 대상 logs에 기록한다.

## 검증

- 스크래치패드의 import·repo/schema 기준 경로만 조정한 사본으로 95개 테스트 통과: 작성 규칙 76개, 임시 Git vault 16개, 실제 문서 집행 3개.
- 실제 dev 67개·prod 61개, 제외 0·미해석 피드 참조 0. 작성 규칙·엄격 링크 검사 통과.
- Git 명령이 영구 대기하지 않도록 검사 전용 runner에 120초 개별 호출 제한을 넣은 최종 초안으로 재검증했다.
- 검사기가 항상 빈 위반 목록을 반환하도록 바꾼 임시 사본은 76개 중 65개 실패, 11개 통과. 무력화된 검사기를 검출한다.
- 변경안 5개 Prettier 검사 통과.
- 실제 보호 경로에 적용한 통합 검증·최종 전체 테스트·커버리지는 아직 수행하지 않았다.
- 의존성 버전을 바꾸지 않았다. 현재 감사 결과는 개발 의존성 11건(high 3, moderate 7, low 1)이며 이번 재배치 범위에서 업그레이드하지 않았다.

## 사용자 적용 명령

기존 protect-paths가 `harness/` 셸 접근·쓰기를 차단하므로 사용자가 직접 실행한다. 각 draft는 위 표와 동일한 파일이며, 적용 명령을 실행하면 원래 scratch draft는 이동된다.

```sh
!mkdir -p /workspace/sas-wiki/harness/test-utils /workspace/sas-wiki/harness/wiki-documents/__tests__ /workspace/sas-wiki/harness/validation-regression/__tests__ && \
mv -- /tmp/wiki-policy-change/draft-1 /workspace/sas-wiki/harness/test-utils/inspect-document.mjs && \
mv -- /tmp/wiki-policy-change/draft-2 /workspace/sas-wiki/harness/test-utils/inspect-vault.mjs && \
mv -- /tmp/wiki-policy-change/draft-3 /workspace/sas-wiki/harness/wiki-documents/__tests__/wiki-documents.guard.test.mjs && \
mv -- /tmp/wiki-policy-change/draft-4 /workspace/sas-wiki/harness/validation-regression/__tests__/document-rules.test.mjs && \
mv -- /tmp/wiki-policy-change/draft-5 /workspace/sas-wiki/harness/validation-regression/__tests__/vault-validation.test.mjs && \
git -C /workspace/sas-wiki add -- harness/test-utils harness/wiki-documents harness/validation-regression
```

## 이어서 할 일

실제 경로의 import·실제 문서 집행을 확인하고 P2를 완료한다. P3에서 자동/수동 테스트 수집과 실패 전달 회귀를 구성한다. P4에서 기존 검사기 소비처를 이전하고 validate를 제거하며, Git 훅·CI·빌드를 연결한 뒤 전체 검증한다. 수동 회귀를 CI·Git 훅에 넣지 않는다. push는 하지 않는다.
