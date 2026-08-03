// @vitest-environment node
//
// P5 · Task 2·5 — 두 번째 발행 아티팩트의 **순수부** (D-C·D-D) — tdd §3.2 (FA1~FA4)
//
// 무엇이 생기는가: `cache/feeds.<env>.json`(내부 아티팩트)과 그 봉투 조립기·스키마, 그리고 리포트가
//   `readArtifact` 를 탈 수 있게 하는 발행 표지 3종이다. 이 파일은 **파일시스템도 git 도 보지 않는다**
//   — 경로 파생 함수와 봉투 조립 함수와 스키마 파일, 셋 다 순수하게 관측 가능하다(tdd §7.5).
//   실제 발행(3종 · 순서 · 3중 신선도)은 `summary.artifact-set.test.mjs`(FA5~FA12)가 문다.
//
// RED 사유(전부 **미구현**):
//   · FA1 — `artifact.mjs` 에 `feedsArtifactPath` 가 없다(오늘 `artifactPath` 하나뿐 · §2.5).
//
// ★★ v3 P2 · U2 통합(tdd §4.4 삭제 원장) — **FA3·FA3b·FA4 는 여기서 사라진다.** 이 파일의 나머지
//   주제(경로 슬롯 분리 = FA1)는 그대로다. 삭제가 아니라 **승계**이며 승계처가 원장에 있다:
//     · FA3 (아티팩트 봉투 6키) → 층 ③은 `dead-values.guard.test.mjs` **KY2(=LZ3)** 가, 층 ②는
//       `lib/__tests__/payloads.test.mjs` **KY4(=LZ2)** 가 각각 **파일과 반환값**으로 문다.
//       (이 자리의 `buildFeedsArtifact` 는 `buildFeeds` 로 **통합**됐다 — 함수 자체가 없다.)
//     · FA3b (`buildFeeds` ⟂ `buildFeedsArtifact` 분리) → **근거 ①② 가 둘 다 소멸**했다:
//       ① wire 에 `env` 가 없다 → D22 가 wire 에도 `env` 를 남긴다  ② 아티팩트는 억제 전 전량이다
//       → D20 이 캐시 빌드에도 `--ignore` 를 붙인다. 근거가 사라진 분리는 계약이 아니다.
//     · FA4 (`feeds-artifact.schema.json` 거동) → **OQ-P2-5 (a)** 로 파일이 폐지되고
//       `feeds.schema.json` 으로 단일화됐다. 승계처 = **LZ4**(properties) · **LZ5**(required) ·
//       **LZ7**(커서 정의) · **SC1·PT2**(파일 부재 자체).
//
// ★ 왜 named import 가 아니라 namespace import 인가(tdd §7.3): 없는 export 를 named 로 물면 ESM 링크가
//   **파일을 통째로 죽여** collection error 가 되고, `rtk` 는 그것을 PASS 로 오보고한다. 그래서 모듈
//   전체를 받아 케이스별로 "그 export 가 아직 없다" 를 **명시 실패**로 만든다.
//
// 규범 A: 기대 키 집합·env 값·경로 조각은 **리터럴**이다. 프로덕션 상수를 import 해
//   기대값을 만들면 공허한 단언이 된다. 정확 경로 형태의 고정은
//   **PL9** 한 곳이 맡는다 — FA1 은 **성질**만 문다(둘이 같은 것을 두 번 물지 않는다 · P4 AR1↔㉖ 선례).
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const artifactModule = await import(new URL('../artifact.mjs', import.meta.url).href)

function feedsArtifactPath(vaultDir, env) {
  if (typeof artifactModule.feedsArtifactPath !== 'function') {
    throw new Error('[RED] scripts/lib/artifact.mjs 에 feedsArtifactPath export 가 아직 없다')
  }
  return artifactModule.feedsArtifactPath(vaultDir, env)
}

const posix = (value) => value.split(path.sep).join('/')

describe('feeds 아티팩트 경로 — summary 와 다른 슬롯 (FA1 · 🔴RED 함수 부재)', () => {
  it('FA1: env 별로 갈리고 `cache/` 하위이며 **summary 아티팩트와 다른 파일**이다', () => {
    const dev = feedsArtifactPath('/v', 'dev')
    const prod = feedsArtifactPath('/v', 'prod')

    expect(dev).not.toBe(prod)
    expect(posix(dev)).toContain('/cache/')
    expect(posix(prod)).toContain('/cache/')
    expect(path.basename(dev)).toContain('dev')
    expect(path.basename(prod)).toContain('prod')

    // ★ 이 절이 핵심이다 — 같은 파일에 쓰면 두 산출물이 서로를 덮어쓴다(그러면 3중 신선도가 무의미).
    expect(dev).not.toBe(artifactModule.artifactPath('/v', 'dev'))
    expect(prod).not.toBe(artifactModule.artifactPath('/v', 'prod'))
  })
})
