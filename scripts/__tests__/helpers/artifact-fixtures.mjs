// P4 · Task 4 — 커밋된 **적대적** 아티팩트 픽스처 로더 (D-E · R4).
//
// DAMP 경계: 이 파일은 **좌표와 바이트만** 준다(`expect` 없음 · tdd §2.3 규범 D). "무엇이 stale 이고
//   왜 그런가" 는 `artifact.read.test.mjs` 본문이 단언하고, 기대값(`producer`·`schemaVersion`·`env`·
//   지문)은 그 스펙에 **리터럴**로 적힌다(규범 A).
//   (vitest 기본 include 는 `*.test.mjs` 만 잡으므로 helpers/*.mjs 는 테스트로 수집되지 않는다 — 의도.)
//
// 왜 tmp 생성이 아니라 **커밋된 파일**인가(R4): 미래의 두 번째 언어 소비자(Rust)가 같은 바이트로
//   같은 판정을 내는지 대조할 기준이 필요하다(F-23). 런타임에 조립하면 그 기준이 사라진다.
//   JSON-Schema-Test-Suite 패턴 — 소비자가 이미 이 리포를 서브모듈로 갖고 있어 새 메커니즘이 0 이다.
//
// ★ `truncated.json` 은 **실제로 `JSON.parse` 를 깨뜨린다**(문자열 한가운데서 절단). 유효 JSON 을
//   "절단" 이라 부르면 RD2 는 장식이다(plan Task 4 GOTCHA). 그래서 이 로더는 **파싱하지 않는 통로**
//   (`readFixtureText`)를 반드시 함께 제공한다.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const ARTIFACT_FIXTURE_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'fixtures',
  'artifact',
)

/** 픽스처 절대 경로. 존재 여부는 확인하지 않는다(부재도 스펙이 관측할 사실이다). */
export function artifactFixturePath(name) {
  return path.join(ARTIFACT_FIXTURE_DIR, name)
}

/** 픽스처 **바이트**(utf8 텍스트). 파싱하지 않는다 — `truncated.json` 은 파싱되지 않는 것이 계약이다. */
export function readArtifactFixtureText(name) {
  return fs.readFileSync(artifactFixturePath(name), 'utf8')
}

/**
 * 픽스처를 **tmp 로 복사**해 경로를 돌려준다.
 *
 * 권한 변조(RD8 EACCES) 같은 파괴적 관측은 커밋된 원본에 하면 안 된다 — 워킹트리가 더러워지고
 * 다음 케이스가 그 잔재를 본다. 복사본에만 한다.
 */
export function copyArtifactFixture(name, destDir, destName = name) {
  const dest = path.join(destDir, destName)
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.copyFileSync(artifactFixturePath(name), dest)
  return dest
}
