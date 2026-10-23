# PRD 아카이브

모든 phase가 끝난 PRD 폴더를 `docs/prds/_archive/`로 옮긴다. 아카이브된 PRD는 더 이상 인용하지
않으므로, 옮기기 직전에 `sas-memory-manager` 에이전트가 PRD의 결정 가운데 앞으로도 필요한 것을
메모리에 편입한다. 이 영역에서 이 스킬이 직접 하는 일은 후보 찾기, 보고, 편입 요청, 폴더
이동뿐이다. 무엇을 기록할지는 에이전트의 판단이다.

## 스캔

`docs/prds/` 아래(`_archive/` 제외)에서 아래를 모두 만족하는 폴더가 후보다.

- `prd.md`가 있다.
- `## Implementation Phases` 표에 phase 행이 1개 이상 있고 전부 `complete`다. 표가 없거나
  읽을 수 없으면 후보가 아니다.
- PRD의 feature 브랜치(`feat/{feature}` 등)가 남아 있고 기본 브랜치에 머지되지 않았으면 후보가
  아니다. 모든 phase가 끝나도 PR 단계가 남은 상태다. 머지 판정은 `references/branches.md`의
  기준을 쓴다. 브랜치가 없거나 머지됐으면 후보다.
- `docs/prds/_archive/{feature}/`가 아직 없다. 있으면 "이전 아카이브와 충돌"로 보고하고
  사용자 판단에 맡긴다.

phase가 하나라도 남은 PRD는 후보가 아니므로 보고에 올리지 않는다. 진행 중인 작업이지 남겨
둔 잔해가 아니기 때문이다. `docs/qa/dev/`의 recipe·rubric은 회귀 검증 자산이라 대상이 아니다.

## 보고 예

```markdown
① PRD 아카이브

- 완료 PRD 2개: login-flow (P1·P2 complete), payments (P1~P3 complete)
```

## 실행 (컨펌 뒤)

```text
1. 메모리 관리 호출(references/memory.md)에 완료 PRD 경로들을 더해 결정 편입을 요청한다.
2. 에이전트가 끝나면 PRD 폴더를 옮긴다. docs/prds/_archive/ 가 없으면 먼저 만든다:
   git mv docs/prds/{feature} docs/prds/_archive/{feature}
   이동 뒤 원본 경로가 사라졌고 대상에 파일이 모두 있는지 확인한다. 불일치면 멈추고 보고한다.
3. git 상태를 보고한다. 커밋하지 않는다.
```
