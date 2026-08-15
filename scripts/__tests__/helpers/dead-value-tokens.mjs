// v3 P1 · Task 10 — 잔재 판정 토큰 **데이터 모듈**. **`expect` 금지**(규범 D · 판정하지 않는다).
//
// ★ 왜 조각을 이어 붙이는가(이 파일의 존재 이유): 판정 토큰을 **리터럴로 적으면 스캐너가 자기
//   자신을 문다**. 그러면 가드는 영원히 red 이고, 그 red 의 "자연스러운 수리" 가 **자기 파일 제외**다
//   — 그 형태가 이 리포에서 `docs-contract.test.mjs` 의 PT3 을 가렸다(plan Task 10 GOTCHA).
//   조각 이어 붙이기는 우회가 아니라 **면제 0 을 구조적으로 가능하게 하는 유일한 수단**이다:
//   소스에는 `inputs` 와 `Fingerprint` 만 있고 이어진 토큰은 **런타임에만** 존재한다.
//   ☞ 면제 목록이 1 이라도 생기면 `dead-values.guard.test.mjs` 의 DV6 이 red 가 된다(규범 H).
//
// ★ 맨단어(접두사 없는 낱말 하나)는 **대문자든 소문자든 판정 토큰이 아니다**(plan Task 10 GOTCHA ·
//   tdd §3.7 실측 16줄이 전부 동시성 producer/consumer 패턴이었다 — `helpers/atomic-stress.mjs`·
//   `atomic.concurrency.test.mjs`·`generator.multi-writer.test.mjs`). 그래서 아래 목록에 없다.
//   그 어휘를 **tdd §4.4 무변경 pin** 이 사유와 함께 못박아 두었다(_"동시성 패턴 어휘다. 판정
//   토큰이 아니다"_) — 대문자 판(版)을 목록에 넣으면 가드가 pin 파일을 물고, 그 red 의 "자연스러운
//   수리" 가 **pin 위반**(마커 개명)이 된다. 실제로 한 번 그렇게 수리됐다.
//   ☞ 게다가 그 항목은 **중복이면서 과잉**이다: 스탬프를 담은 상수는 접두사 3종(아래 2·3·4번)이
//     이름으로, 값 3종(7·8·9번)이 값으로 이미 잡는다. 맨단어가 유일하게 더 잡는 것은 *스탬프가
//     아닌 값을 가진 동명 식별자* — 정확히 오탐이 사는 자리다.
//   (vitest 기본 include 는 `*.test.mjs` 만 잡으므로 helpers/*.mjs 는 테스트로 수집되지 않는다 — 의도.)

/** 이어 붙이기 전 조각들. **이 배열이 유일한 정의처다**(스펙 본문에 토큰을 다시 적지 않는다). */
const TOKEN_PARTS = [
  ['inputs', 'Fingerprint'], //          0
  ['compute', 'Inputs', 'Fingerprint'], // 1
  ['ARTIFACT_', 'PRO', 'DUCER'], //      2
  ['FEEDS_ARTIFACT_', 'PRO', 'DUCER'], // 3
  ['REPORT_', 'PRO', 'DUCER'], //        4
  ['FEEDS_', 'PRO', 'DUCER'], //         5
  ['sas-wiki/', 'sum', 'mary'], //       6
  ['sas-wiki/', 'fee', 'ds'], //         7
  ['sas-wiki/', 'rep', 'ort'], //        8
  ['pro', 'ducer-mismatch'], //          9
]

/**
 * 판정 토큰 10종(런타임 조립). 순서는 위 배열 그대로다 — 진단 메시지의 좌표계이자 **아래 `TOKEN`
 * 접근자의 인덱스**다. 항목을 넣거나 빼면 접근자 인덱스를 **같은 커밋에서** 재조정해야 한다 —
 * 어긋나도 형(型)은 그대로 문자열이라 **조용히 통과한다**(각 접근자가 엉뚱한 토큰을 가리킨 채로).
 */
export const DEAD_VALUE_TOKENS = TOKEN_PARTS.map((parts) => parts.join(''))

/**
 * 이름 → 그 항목을 구성하는 **조각 배열**(위 `TOKEN_PARTS` 의 원소 그대로 다시 적은 것 — 조립하지
 * 않으므로 완성 토큰 리터럴이 새로 생기지 않는다). `TOKEN` 은 숫자 위치가 아니라 이 조각 배열로
 * `TOKEN_PARTS` 를 찾는다 — `TOKEN_PARTS` 안에서 항목 순서가 바뀌어도 깨지지 않는다(위치 결속이
 * 사라진다). 항목이 통째로 없어지면(조각 신원을 못 찾으면) 아래 `resolveToken` 이 **모듈 로드
 * 시점에 throw** 한다 — 인덱스가 어긋난 채 엉뚱한 토큰을 조용히 가리키는 경로가 없다.
 */
const TOKEN_PART_SIGNATURE = {
  CORRELATION_FIELD: ['inputs', 'Fingerprint'],
  FEEDS_STAMP_VALUE: ['sas-wiki/', 'fee', 'ds'],
  MISMATCH_REASON: ['pro', 'ducer-mismatch'],
  REPORT_STAMP_VALUE: ['sas-wiki/', 'rep', 'ort'],
  SUMMARY_STAMP_VALUE: ['sas-wiki/', 'sum', 'mary'],
}

/** `signature` 와 조각 배열이 정확히 같은 `TOKEN_PARTS` 항목을 찾아 조립된 토큰을 돌려준다. */
function resolveToken(signature) {
  const index = TOKEN_PARTS.findIndex(
    (parts) =>
      parts.length === signature.length && parts.every((part, position) => part === signature[position]), // prettier-ignore
  )
  if (index === -1) {
    throw new Error(
      `[dead-value-tokens] TOKEN_PARTS 에서 조각 신원을 찾지 못했다: ${JSON.stringify(signature)}`,
    )
  }
  return DEAD_VALUE_TOKENS[index]
}

/**
 * 이름으로 꺼내 쓰는 통로 — 스펙 본문이 값을 리터럴로 적지 않아도 되게 한다.
 *
 * ★ **키 이름에도 판정 토큰을 쓰지 않는다**(맨단어 하나가 그대로 토큰인 것이 있다). 키가 토큰을
 *   담으면 이 파일이 스캔에 걸려 DV3 이 영원히 red 가 되고, 그 red 의 "수리" 가 자기 제외다.
 *   그래서 표지 계열은 `STAMP` 로 부른다.
 */
export const TOKEN = Object.fromEntries(
  Object.entries(TOKEN_PART_SIGNATURE).map(([name, signature]) => [name, resolveToken(signature)]),
)

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
