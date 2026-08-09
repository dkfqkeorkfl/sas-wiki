// 발행 아티팩트 — **경로 파생**과 **독자 불신**의 소유자.
//
// `cache/` 아래의 이 파일은 "캐시" 가 아니라 **발행물**이다. 생산자의 사적 자산이라면 아무도 그
// 형태를 지킬 의무가 없지만, 여기서는 CLI 를 우회해 **파일을 직접 읽는 소비자**가 존재한다. 그래서
// 파일 그대로 서빙한다는 결정의 대가로 계약 3요소를 값으로 치른다:
//   (a) `schemaVersion` + 미지 버전 거동 — 구/신 계약을 동시에 지원하지 않고 stale 로 접는다
//   (b) 경로는 **단일 선언에서 파생** — 리터럴이 두 리포에 중복되면 이름이 바뀔 때 한쪽만 따라간다
//   (c) 독자 전면 불신             — `readArtifact`
//
// 의존 방향은 `artifact → payloads` **단방향**이다.
import fs from 'node:fs'
import path from 'node:path'

import { SCHEMA_VERSION } from './payloads.mjs'

export { SCHEMA_VERSION }

// ★ v3 P4 · D27 — `artifactPath(vaultDir, env)` 는 **여기서 사라졌다**. summary 아티팩트 경로를
//   파생하던 유일한 프로덕션 호출자는 `wiki.mjs:39`·`:44` 였고, 그 자리는 이제 **호출자가 명시하는
//   `--summary` 인자**가 소유한다(나머지 3 CLI 가 전부 `--out` 인 것과 같은 형태). 발행 측은 인자로
//   받은 경로에 쓰므로(`package.json` 의 `--out cache/summary.<env>.json`) 파생 함수가 남을 자리가 없다.
//   ★ `cache/summary.<env>.json` 이라는 **형태 자체**는 계약으로 남아 있다 — 그 고정은 PL9
//   (`build.p5-plumbing.test.mjs`)와 README `contract:artifacts` 표가 진다.
/**
 * 내부 feeds 아티팩트의 경로 — **summary 와 다른 파일**이다(D-C). 같은 파일에 쓰면 두 발행물이
 * 서로를 덮어쓴다. `cache/` 하위라는 자리는 같다 — 원자 쓰기 규율
 * (`writeFileAtomic`)과 `.gitignore` 경계를 그대로 물려받기 위해서다.
 *
 * @param {string} vaultDir vault 리포 루트
 * @param {'dev'|'prod'} env
 * @returns {string} 절대 경로
 */
export function feedsArtifactPath(vaultDir, env) {
  return path.join(path.resolve(vaultDir), 'cache', `feeds.${env}.json`)
}

/**
 * 리포트(관측 채널)의 경로 — **env 별로 갈린다**(F-29). 예전엔 `logs/summary.report.{json,txt}`
 * 단일 슬롯이라 dev·prod 교대 실행이 서로의 리포트를 덮어썼다.
 *
 * @param {string} vaultDir vault 리포 루트
 * @param {'dev'|'prod'} env
 * @param {'json'|'txt'} ext
 * @returns {string} 절대 경로
 */
export function reportPath(vaultDir, env, ext) {
  return path.join(path.resolve(vaultDir), 'logs', `summary.report.${env}.${ext}`)
}

/**
 * 아티팩트를 읽어 기대 봉투와 맞는지 판정한다. 실패는 전부 stale 로 접는다 — **throw 하지 않는다.**
 *
 * | 입력                          | 결과                       |
 * | ----------------------------- | -------------------------- |
 * | 부재                          | stale `missing`            |
 * | 권한·디렉토리 등 읽기 실패    | stale `unreadable`         |
 * | JSON 파싱 실패(절단·쓰레기)   | stale `malformed`          |
 * | `schemaVersion` ≠ 기대        | stale `schema-version-mismatch` (**hard-fail 아님**) |
 * | `env` ≠ 기대                  | stale `env-mismatch`       |
 * | 전부 통과                     | fresh(payload **원본 그대로**) |
 *
 * ★ **이 함수가 fsync 생략을 비준한다.** 쓰기 측은 `rename` 으로 갈아끼우지만, Windows/WSL 에서
 *   libuv 의 rename 은 `MoveFileExW(MOVEFILE_REPLACE_EXISTING)` 단독 호출이고 MS 문서는 그 조합에
 *   **원자성을 명시하지 않는다**. 즉 반쪽 파일·구세대 파일은 가정이 아니라 **실제로 가능한 상태**이고,
 *   안전은 쓰기 측이 아니라 **여기**에 걸려 있다. 이 불신을 "최적화" 로 걷어내면 그 순간 조용히
 *   깨진 파일을 서빙하게 된다 — 층을 지울 때는 이 문단을 먼저 반증하라.
 *
 * ★ 미지 버전을 throw 가 아니라 stale 로 접는 것도 계약이다. hard-fail 로 만들면 옛 파일 하나가
 *   dev 를 통째로 죽이는데, 그 파일은 **다시 만들면 그만인 파생 데이터**다.
 *
 * @param {{ expect: { env: string, schemaVersion: number }, path: string }} input
 * @returns {{ fresh: true, payload: object } | { fresh: false, reason: string }}
 */
export function readArtifact({ expect: expected, path: artifactFile }) {
  let raw
  try {
    raw = fs.readFileSync(artifactFile, 'utf8')
  } catch (error) {
    return stale(error?.code === 'ENOENT' ? 'missing' : 'unreadable')
  }

  let payload
  try {
    payload = JSON.parse(raw)
  } catch {
    return stale('malformed')
  }

  // 평평한 early-return 사슬이다 — 사유를 하나로 뭉개면 "왜 재생성됐는지" 를 영영 모른다.
  //   `payload?.` 는 배열·문자열·null 같은 비-객체 JSON 도 각 층에서 걸리게 한다.
  if (payload?.schemaVersion !== expected.schemaVersion) return stale('schema-version-mismatch')
  if (payload.env !== expected.env) return stale('env-mismatch')

  // 봉투는 **검증자이지 필터가 아니다** — 읽은 것을 깎지 않고 원본을 그대로 넘긴다.
  return { fresh: true, payload }
}

/** stale 은 본문을 흘리지 않는다 — 검증에 실패한 값이 호출부로 새면 불신이 무의미해진다. */
function stale(reason) {
  return { fresh: false, reason }
}
