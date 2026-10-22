# Plan: current checks

## Summary

validate와 기존 테스트의 소비처를 조사하고 검사별 이전 위치를 확정한다.

## User Story

문서 유지보수자로서 기존 검사를 빠뜨리지 않고 새 테스트 체계로 옮기기 위해 이전 대응표를 확인한다.

## Problem → Solution

검사·CLI·원문 계약의 혼재 → 규칙·실행 책임·소비처를 기록한 대응표.

## Metadata

- Complexity: Medium
- Source PRD: ../prd.md
- PRD Phase: P1.current-checks
- Estimated Files: 3 documents

## UX Design

내부 구조 변경이며 화면 변경은 없다.

## Mandatory Reading

| File                                      | Why                                    |
| ----------------------------------------- | -------------------------------------- |
| scripts/validate.mjs                      | buildContent의 검사 순서·진단·CLI 경계 |
| scripts/lib/parse-vault.mjs               | 생성기와 검사가 공유하는 파싱 계층     |
| scripts/lib/head-state.mjs                | 가시성·제외 판정                       |
| package.json                              | build·test 명령                        |
| .husky/pre-push, .github/workflows/ci.yml | 강제 실행 경로                         |
| ../prd.md                                 | 확정 범위·수동 하네스 실행             |

## Patterns to Mirror

- `parseVault(vaultDir, env, schemaDir)`는 gate·stats·wire를 반환한다. 전체 검사에서는 한 환경당 이 결과를 한 번 만든다.
- `buildContent`는 진단을 검사 전에 작성하고 구체 경로·SHA를 오류에 포함한다. 이전해도 진단을 보존한다.
- 테스트는 임시 Git vault에 오류를 주입한다. 실제 문서를 변이하지 않는다.

## Files to Change

- CREATE ../check-migration.md: 규칙·소비처 대응표.
- UPDATE ../prd.md: phase 상태와 기술 조사 결과.

## Step-by-Step Tasks

1. ACTION: validate의 모든 검사와 보고 채널을 읽고 목록화한다. VALIDATE: 모든 throw-게이트와 report 경로에 대응표 행이 있다.
2. ACTION: 함수 import·프로세스 실행·설정·문서·상위 소비자 계약을 조사한다. VALIDATE: `rg -l 'validate\\.mjs|buildContent' scripts` 결과를 분류한다.
3. ACTION: 순수 CLI 계약과 유지할 문서 규칙을 구분한다. GOTCHA: 프로세스 계약 제거가 실질 검사를 제거하는 이유가 되지 않는다.
4. ACTION: 새 배치·수집 경계를 기록한다. VALIDATE: test와 test:harness 수집 범위가 겹치지 않는다.

## Testing Strategy

실행 코드 변경 없는 조사 phase다. 단언 복제 테스트를 만들지 않고 소스 한두 지점을 직접 재현하고 대응표를 대조한다.

## Validation Commands

`rg -l 'validate\\.mjs|buildContent' scripts`, `pnpm exec prettier --check docs/prds/wiki-document-harness`, `git diff --check`.

## Acceptance Criteria

- 기존 규칙과 소비처가 대응표에 있다.
- CLI 제거와 유지할 검사의 경계가 명확하다.
- 보호 경로와 외부 소비자 계약을 기록한다.

## Notes

SAS Research: 생략 — 기존 내부 코드의 위치·소비처 조사만 수행한다. Codex 직접 조사·검수이며 별도 에이전트 감사를 수행했다고 간주하지 않는다.
