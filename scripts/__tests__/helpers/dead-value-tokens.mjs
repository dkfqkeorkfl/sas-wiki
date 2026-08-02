// v3 P1 · Task 10 — 잔재 판정 토큰 **데이터 모듈**. **`expect` 금지**(규범 D · 판정하지 않는다).
//
// ★ 왜 조각을 이어 붙이는가(이 파일의 존재 이유): 판정 토큰을 **리터럴로 적으면 스캐너가 자기
//   자신을 문다**. 그러면 가드는 영원히 red 이고, 그 red 의 "자연스러운 수리" 가 **자기 파일 제외**다
//   — 그 형태가 이 리포에서 `docs-contract.test.mjs` 의 PT3 을 가렸다(plan Task 10 GOTCHA).
//   조각 이어 붙이기는 우회가 아니라 **면제 0 을 구조적으로 가능하게 하는 유일한 수단**이다:
//   소스에는 `inputs` 와 `Fingerprint` 만 있고 이어진 토큰은 **런타임에만** 존재한다.
//   ☞ 면제 목록이 1 이라도 생기면 `dead-values.guard.test.mjs` 의 DV6 이 red 가 된다(규범 H).
//
// ★ 맨단어 `producer` 는 **판정 토큰이 아니다**(plan Task 10 GOTCHA · 실측 16줄이 동시성
//   producer/consumer 패턴이다). 그래서 아래 목록에 없다.
//   (vitest 기본 include 는 `*.test.mjs` 만 잡으므로 helpers/*.mjs 는 테스트로 수집되지 않는다 — 의도.)

/** 이어 붙이기 전 조각들. **이 배열이 유일한 정의처다**(스펙 본문에 토큰을 다시 적지 않는다). */
const TOKEN_PARTS = [
  ['inputs', 'Fingerprint'],
  ['compute', 'Inputs', 'Fingerprint'],
  ['ARTIFACT_', 'PRO', 'DUCER'],
  ['FEEDS_ARTIFACT_', 'PRO', 'DUCER'],
  ['REPORT_', 'PRO', 'DUCER'],
  ['PRO', 'DUCER'],
  ['FEEDS_', 'PRO', 'DUCER'],
  ['sas-wiki/', 'sum', 'mary'],
  ['sas-wiki/', 'fee', 'ds'],
  ['sas-wiki/', 'rep', 'ort'],
  ['pro', 'ducer-mismatch'],
]

/** 판정 토큰 11종(런타임 조립). 순서는 위 배열 그대로다 — 진단 메시지의 좌표계다. */
export const DEAD_VALUE_TOKENS = TOKEN_PARTS.map((parts) => parts.join(''))

/**
 * 이름으로 꺼내 쓰는 통로 — 스펙 본문이 값을 리터럴로 적지 않아도 되게 한다.
 *
 * ★ **키 이름에도 판정 토큰을 쓰지 않는다**(맨단어 하나가 그대로 토큰인 것이 있다). 키가 토큰을
 *   담으면 이 파일이 스캔에 걸려 DV3 이 영원히 red 가 되고, 그 red 의 "수리" 가 자기 제외다.
 *   그래서 표지 계열은 `STAMP` 로 부른다.
 */
export const TOKEN = {
  CORRELATION_FIELD: DEAD_VALUE_TOKENS[0],
  FEEDS_STAMP_VALUE: DEAD_VALUE_TOKENS[8],
  MISMATCH_REASON: DEAD_VALUE_TOKENS[10],
  REPORT_STAMP_VALUE: DEAD_VALUE_TOKENS[9],
  SUMMARY_STAMP_VALUE: DEAD_VALUE_TOKENS[7],
}

/** 삭제되는 계산 모듈이 리포에서 유일하게 쓰던 내장 모듈 지정자(같은 이유로 조각이다). */
export const CRYPTO_SPECIFIER = ['node:', 'cry', 'pto'].join('')

/** 센티넬 — **살아 있어야 하는** 토큰이다(읽기가 죽어 전부 빈 문자열인 것을 배제 · DV2). */
export const SENTINEL_TOKEN = 'schemaVersion'

/** 정규식 특수문자 이스케이프(토큰에 `/`·`-` 가 있다). */
function escape(token) {
  return token.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 판정 토큰 전체를 한 번에 훑는 교대 패턴 — 파일 1회 통과로 끝낸다(스캔 비용). */
export function deadValuePattern() {
  return new RegExp(DEAD_VALUE_TOKENS.map(escape).join('|'), 'u')
}

/** 히트 한 줄에 어떤 토큰들이 들어 있는지 — 진단 메시지용(판정하지 않는다). */
export function tokensInLine(text) {
  return DEAD_VALUE_TOKENS.filter((token) => text.includes(token))
}
