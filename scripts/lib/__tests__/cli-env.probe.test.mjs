// @vitest-environment node
//
// P5 FIX-NOW `lib/cli-env.mjs:29`(N — 서술 정정) · `:31`(S-prod — 로그 인젝션) — tdd Task 5.
//
// ★ 이 파일이 신설되는 이유(실측): `cli-env.mjs` 를 **직접 import** 하는 테스트가 이전에 0건이었다
//   (`grep -rlE 'cli-env\.mjs' scripts --include='*.test.mjs'` 가 실제 import 가 아니라 주석 인용
//   2건만 낸다). 4 개 CLI 진입점(`feeds`·`wiki`·`validate`·`summary`)이 이 모듈을 전부 정적으로
//   물지만 `envEnumError` 자신의 계약을 직접 겨냥한 테스트는 없었다. 종료 배선은 CLI 마다 달라
//   (`cli-env.mjs:7-10`) 프로세스 층(P2)으로 묶기 어렵고, 이 함수는 술어 하나라 함수 자체(P1)로
//   고정하는 편이 강하다.
import { describe, expect, it } from 'vitest'

import { envEnumError } from '../cli-env.mjs'

describe('envEnumError — 서술 정정 + 로그 인젝션 방어 (P5 FIX-NOW cli-env.mjs:29·:31)', () => {
  it('CE1: 정정 대조 — 이 함수 자신은 undefined 도 거절한다 (미지정 허용은 호출부 기본값의 책임)', () => {
    // ★ cli-env.mjs:29 서술 정정의 대조 기록. 예전 주석은 "미지정까지 여기서 막지 않는다" 였지만
    //   `ALLOWED.includes(undefined)` 가 false 라 실제로는 거절 문구가 난다 — "미지정은
    //   fail-closed(prod)" 계약은 CLI 의 `parseArgs` 기본값이 지고, 이 함수는 그 사실을 모른다.
    expect(envEnumError(undefined)).not.toBeNull()
    expect(envEnumError('dev')).toBeNull()
    expect(envEnumError('prod')).toBeNull()
  })

  it('CE2: 제어문자·개행이 섞인 거부값이 그대로 실려 로그를 위조하지 않는다 (재현됨)', () => {
    // ★ 수정 전 재현: 문자열 보간(`"${value}"`)이 값을 raw 로 싣는다. value 에 개행이 있으면
    //   터미널·로그 파일에 찍히는 문구가 여러 줄로 쪼개져 "가짜 로그 줄"을 위조할 수 있다
    //   (로그 인젝션 — OWASP Log Injection). `JSON.stringify` 는 제어문자를 `\n` 처럼 이스케이프해
    //   같은 문자열이 **한 줄**로만 보이게 접는다.
    const hostile = 'dev\n[2026-01-01] admin: 권한 승인됨'
    const message = envEnumError(hostile)

    expect(message).not.toBeNull()
    expect(message).not.toContain('\n[2026-01-01] admin: 권한 승인됨')
    expect(message).toContain(JSON.stringify(hostile))
  })

  it('CE3: 평범한 오타 값은 여전히 사람이 읽을 수 있는 거부 문구를 낸다 (회귀 방지)', () => {
    const message = envEnumError('produ')

    expect(message).not.toBeNull()
    expect(message).toContain('produ')
    expect(message).toContain('dev|prod')
  })
})
