---
name: sas-codex-chat
description: 전담 서브에이전트도 cc-suite 명령(`/cc-suite:*`)도 맞지 않는 자유형식 리서치·질의를 Codex CLI(`codex exec`)에 직접 위임한다. 읽기전용 조사·질의·분석 전용이며 코드·파일 수정은 대상이 아니다.
allowed-tools: Bash
---

# sas-codex-chat

자유형식 리서치·질의를 Codex CLI에 위임하고, 실행·감시·이어가기를 맡는 헬퍼다. 어떤 모델과 effort로 부를지는 호출하는 쪽이 정한다.

## 구조

호출 하나에 프로세스 셋이 역할을 나눠 맡는다.

```text
호출자
 └─ 감시자: 감시 시간(기본 15분)까지만 살고 끝난다
     └─ 러너: 감시자가 끝나도 계속 돈다(최대 2시간)
         └─ Codex CLI: 실제로 조사한다
```

감시자와 러너는 파일 두 개로 소통한다.

```text
Codex CLI ─ 출력 한 줄마다 ─▶ 러너
                              ├─ 기록 ─▶ 로그 파일   사람이 읽는 전체 기록
                              └─ 갱신 ─▶ 상태 파일   진행 상황과 최종 결과
                                         ▲
                                         └─ 1초마다 읽음 ─ 감시자 ─▶ 호출자에게 JSON 한 줄
```

감시자는 한 번 지켜보는 동안 1초마다 다음을 확인한다. 위에서부터 먼저 해당하는 것 하나를 따른다.

```text
 ├ 상태 파일에 결과가 있다       → 그 결과(completed·failed·timed_out)를 출력하고 끝
 ├ 러너가 결과 없이 죽었다       → failed를 출력하고 끝
 ├ 감시 시간이 찼다              → 감시 시작 뒤 Codex 출력이 새로 늘었으면 running,
 │                                 늘지 않았으면 stalled를 출력하고 끝
 └ 모두 아니다                   → 1초 뒤 다시 확인
```

| 이름      | 정체                                    | 하는 일                                                                                                                                                                                               | 사는 시간                                                       |
| --------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| 감시자    | 호출자가 실행한 `codex-chat.mjs`        | 새 호출이면 러너를 띄운다. 상태 파일을 읽는다. 결과가 나오거나 감시 시간이 차면 JSON 한 줄을 출력하고 끝낸다.                                                                                         | 감시 시간까지. `--attach`를 할 때마다 새로 뜬다.                |
| 러너      | 같은 파일을 `--worker`로 다시 실행한 것 | Codex CLI를 띄운다. 출력이 올 때마다 로그와 상태 파일을 갱신하고, 감시 시간마다 로그에 `Check:` 줄을 남긴다. 끝나면 결과를 상태 파일에 적는다. 안전망 시간(2시간)이 지나면 Codex CLI를 강제 종료한다. | Codex CLI가 끝날 때까지(최대 2시간). 감시자가 끝나도 계속 돈다. |
| Codex CLI | `codex exec`                            | 실제 조사와 답변                                                                                                                                                                                      | 일이 끝날 때까지                                                |

감시자는 한 번 지켜보고 끝난다. 호출자는 그 종료 알림으로 깨어나 계속 지켜볼지(`--attach`로 감시자를 새로 띄운다) 멈출지(`--stop`) 정한다. 별도 감시 명령이나 모니터는 필요 없다.

## 명령

| 형식                                                  | 하는 일                                                |
| ----------------------------------------------------- | ------------------------------------------------------ |
| `codex-chat.mjs --model <값> [옵션] -- "<prompt>"`    | 새 호출. 러너를 띄우고 감시 시간 동안 지켜본다.        |
| `codex-chat.mjs --attach <log-file> [--tick-ms <값>]` | 이미 도는 호출에 감시자를 새로 붙여 한 번 더 지켜본다. |
| `codex-chat.mjs --stop <log-file>`                    | 도는 호출을 멈춘다(러너와 Codex CLI가 함께 종료된다).  |

`--resume <thread_id>`는 Codex 대화를 이어 가는 입력이고, `--attach`는 도는 호출에 감시자를 새로 붙이는 명령이다. 서로 다르다.

## 입력

- **prompt** (필수): 자유 텍스트 질문·조사 과제.
- **model** (`resume` 없는 신규 호출이면 필수): `sol`·`솔`·`luna`·`루나` 중 하나, 또는 실제 모델 슬러그. 별명으로 주면 `~/.codex/models_cache.json`에서 그 접미사로 끝나는 슬러그를 찾아 쓴다. `resume` 호출에서는 생략하면 기존 세션의 모델을 그대로 쓴다.
- **effort** (선택, 기본 `high`): 신규 호출과 `--resume` 모두 `codex exec`의 `model_reasoning_effort` 값으로 매번 전달한다. 생략하면 이전 대화의 effort를 상속하지 않고 `high`를 적용한다. 이어가기에서는 기존 작업의 effort를 `--effort`에 명시적으로 다시 전달한다. 사용자 지시나 해당 작업의 기준에 따라 변경할 때는 변경한 값을 전달한다. 기존 값이 불명확하면 이전 호출 정보나 해당 작업의 effort 기준으로 확인하며, 러너 기본값에 맡기지 않는다.
- **timeout-ms** (선택, 기본 `7200000` = 2시간): Codex CLI가 이 시간 안에 끝나지 않으면 러너가 강제 종료하고 `timed_out`으로 기록한다. 한 번의 실행에 적용되는 안전망이며, 감시 시간과는 별개다.
- **tick-ms** (선택, 기본 `900000` = 15분): 감시자가 한 번에 지켜보는 최대 시간(감시 시간).
- **log-file** (선택): 스크래치패드 안의 경로. 호출마다 새로 만든다. 생략하면 임시 폴더에 만들고 출력의 `logFile`로 알려 준다.
  - 첫 줄에 `Started pid=<러너 pid>`, 시각이 붙은 줄에 모델·제한 시간·`Thread: <id>`·감시 시간마다 러너가 남기는 `Check:`·종료 사유, 그 밖의 줄에 Codex 출력이 쌓인다.
  - 옆의 `<log-file>.state.json`에 상태와 결과가 남는다. `--attach`·`--stop`은 이 로그 경로로 호출을 찾는다.
- **resume** (선택): 이어갈 대상의 thread_id. 있으면 그 세션을 이어가고, 없으면 새로 시작한다. "가장 최근 것" 같은 암묵적 지정은 지원하지 않는다. 여러 호출이 동시에 돌 수 있어 엉뚱한 세션을 이어갈 위험이 있기 때문이다. thread_id는 직전 호출의 출력이나 로그의 `Thread:` 줄에서 받아 호출한 쪽이 들고 있어야 한다.

## 진행 절차

1. 새 호출을 **`run_in_background: true`로 한 번만** 띄운다. 이 명령(감시자)이 러너를 띄우고 직접 지켜본다.

   ```bash
   node ".claude/skills/sas-codex-chat/scripts/codex-chat.mjs" \
     --model luna --effort high --log-file "<스크래치패드>/codex-chat-1.log" \
     -- "AWS Lambda의 Node.js 런타임 지원 종료 일정을 조사해줘"
   ```

   이어가기에 필요한 threadId와 적용한 effort를 함께 유지한다. 이어가기는 threadId를 `--resume`에, effort를 `--effort`에 명시한다.

   ```bash
   node ".claude/skills/sas-codex-chat/scripts/codex-chat.mjs" \
     --resume 01a10718-a9fb-7e30-ae5d-4533576f18db --effort high --log-file "<스크래치패드>/codex-chat-2.log" \
     -- "방금 조사한 것에 Python 런타임도 같이 비교해줘"
   ```

   prompt에 `$`·백틱이 들어 있으면 셸이 먼저 실행하므로 따옴표 친 heredoc으로 넘긴다.

2. 종료 알림이 오면 그 출력의 JSON 한 줄을 읽고 `status`대로 처리한다.

   | status               | 뜻                                      | 할 일                                                                                                                                                                         |
   | -------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | `running`            | 이번 감시 시간에 새 Codex 출력이 있었다 | 같은 로그로 `--attach`를 다시 띄운다.                                                                                                                                         |
   | `stalled`            | 이번 감시 시간에 새 출력이 없었다       | `hint`를 보고 판단한다. 더 기다리면 `--attach`, 멈추려면 `--stop`.                                                                                                            |
   | `completed`          | 끝났다                                  | `rawOutput`이 결과다.                                                                                                                                                         |
   | `failed`·`timed_out` | 실패했거나 시간 안에 끝나지 않았다      | `errorMessage`와 있으면 `lastActivity`로 원인을 보고, 재시도·후순위는 호출한 쪽의 실패 규칙으로 정한다(이 스킬은 정하지 않는다). 이어가기는 `threadId`를 `--resume`에 넣는다. |

3. 결과(`completed`·`failed`·`timed_out`)를 받기 전에는 턴을 끝내지 않는다. `running`이거나 `stalled`에서 더 기다리기로 했으면 다음 `--attach`를 띄워 두고, 멈추기로 했으면 `--stop`을 부른다. 지켜보는 사람이 없어도 러너와 Codex CLI는 끝까지 돌고 결과는 상태 파일에 남지만, 받을 사람이 없어진다.
4. 중간에 포기하면 `--stop <log-file>`을 부르고, 남은 codex 프로세스가 없는지 확인한다. `errorMessage`가 `SIGTERM`·`SIGKILL`로 종료했음을 말하는 `failed`(종료 코드 1)는 의도한 중단의 결과이므로 실패로 다루지 않는다.

## 출력

표준출력 JSON 한 줄.

- 감시 시간이 찼는데 작업이 계속 도는 경우: `status`(`running`·`stalled`), `logFile`, `pid`(러너의 pid. Codex CLI의 pid는 상태 파일의 `codexPid`), `threadId`, `elapsedSeconds`, `hint`.
  - `hint.outputLines`·`hint.newOutputLines`: 지금까지와 이번 감시 시간에 늘어난 Codex 출력 줄 수.
  - `hint.lastActivity`: 마지막 활동의 `kind`(`command`·`tool`·`search`·`message`·`reasoning`·`error`·`event`·`other`·`output`), 앞부분 `text`(200자), `secondsAgo`.
  - `hint.cpuPercent`·`rssMB`·`processes`: 러너와 그 아래 프로세스(Codex CLI 포함)가 이번 감시 시간에 쓴 CPU, 메모리, 프로세스 수.
- 끝난 경우: `status`(`completed`·`timed_out`·`failed`), `threadId`, `elapsedSeconds`, `rawOutput`(Codex의 최종 응답 본문), `logFile`. `timed_out`·`failed`에는 `errorMessage`와 `lastActivity`도 있고, Codex가 응답을 남기지 못했으면 `rawOutput`은 비어 있다. Codex를 부르기 전에 끝난 실패(prompt·model 검증, 상태 파일 없음 등)에는 `status`와 `errorMessage`만 있으므로, 없는 필드는 읽기 전에 확인한다.
- 종료 코드: `running`·`stalled`·`completed`는 0, 그 밖은 1.

CPU는 Codex CLI가 명령을 돌리는 중인지는 알려 주지만, 모델이 서버에서 오래 추론하는 중이면 거의 0이라 멈춤과 구분되지 않는다. 멈춤 판정은 `hint` 전체를 보고 호출자가 한다.

## 범위

읽기전용 조사·질의·분석만 한다. 코드·파일을 실제로 고치는 일은 대상이 아니다 — 그건 `/cc-suite:implement`의 몫이다.

- 로컬 명령: 신규 호출·이어가기 모두 매번 `sandbox_mode="read-only"`를 명시해 파일 쓰기를 막는다. `codex exec resume`에는 샌드박스 지정 플래그가 따로 없어 그냥 두면 전역 설정(워크스페이스 쓰기 등)으로 새는 걸 실측으로 확인했기 때문이다.
- MCP 도구: 이 설정이 닿지 않는다. 쓰기 기능이 있는 MCP 도구가 Codex에 연결돼 있으면 조사 중 호출될 수 있다.

## 제약

- `codex` CLI가 설치돼 있지 않거나 인증돼 있지 않으면, 스크립트가 그 사실을 `failed`로 그대로 보고하고 멈춘다. 설치·로그인 안내는 하지 않는다.
- model 별명 해석에 실패하면(캐시 파일을 못 읽음, 해당 접미사의 모델이 없음) 코덱스를 부르지 않고 바로 `failed`로 보고한다.
- 동시에 여러 번 불러도 서로 막지 않는다 — 호출마다 독립된 `codex exec` 프로세스다.
- 러너와 Codex CLI는 호출자와 따로 돌기 때문에 호출자가 사라져도 남을 수 있다. 2시간 안전망과 `--stop`으로 정리한다.
