// `--env` 열거 검증 — **술어와 문구**만 여기 모은다.
//
// 왜 문구까지 묶는가: 네 CLI 가 각자 같은 문장을 적어 두면 한 곳만 고쳐졌을 때 아무도 모른다. 그런데
// 이 문구는 사람이 오타를 고칠 때 읽는 **유일한 안내**라, 셋이 다르면 "어느 CLI 냐" 에 따라 설명이
// 달라지는 상태가 된다. 그래서 한 낱말로 유지한다.
//
// ★ 왜 종료까지는 묶지 않는가: 종료 배선이 CLI 마다 **다르기 때문**이다. `summary` 는 인자 파서가
//   던지고 호출부가 exit 2 로 받고, `feeds`·`wiki` 는 `main()` 바깥 `.catch` 가 exit **1** 이라
//   던지면 종료코드가 바뀐다(= 동작 변경). `validate` 는 값 부재를 다른 문구로 먼저 거른다. 그래서
//   여기는 "무엇이 잘못됐는지" 만 말하고 "어떻게 죽을지" 는 각 CLI 가 정한다.
//
// ★ 무거운 것을 정적으로 끌어오지 않는다 — 이 모듈은 import 가 **하나도 없다**. `summary.mjs` 의
//   판정 경로가 이 파일을 정적으로 물기 때문이고, 그 경로에 파싱·렌더 툴체인이 들어오는 것을
//   `summary.import-graph.test.mjs`(IG1·IG6)가 막는다.

/** `--env` 로 받을 수 있는 값. 순서가 곧 안내 문구의 순서다. */
const ALLOWED = ['dev', 'prod']

/**
 * 열거에 없는 값이면 **표준 문구**를, 유효하면 `null` 을 돌려준다.
 *
 * 미지정(`undefined`)까지 여기서 막지 않는다 — 미지정은 fail-closed(prod)로 흡수하는 것이 계약이고
 * (`cli.env-enum.test.mjs` EV6), 이 함수가 거절하는 것은 **오타뿐**이다. 다만 빈 문자열은 오타다
 * (`--env=` 는 값을 준 것이다) — 호출부가 미지정과 섞지 않도록 여기서 걸러 낸다(EV7).
 *
 * @param {unknown} value `--env` 로 실제로 들어온 값
 * @returns {string|null} 거절 사유 문구 · 유효하면 null
 */
export function envEnumError(value) {
  if (ALLOWED.includes(value)) return null
  return `알 수 없는 --env 값: "${value}" — ${ALLOWED.join('|')} 만 허용합니다`
}
