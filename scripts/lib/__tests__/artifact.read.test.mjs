// @vitest-environment node
//
// P4 · Task 4 — 독자 전면 불신 `readArtifact() -> Fresh | Stale` (D-E · R4) — tdd §3.4 (RD0~RD11)
//
// RED 사유(전 케이스 · **미구현**): `scripts/lib/artifact.mjs` 와 `readArtifact` export 가 **없다**.
//   지연 import + 케이스별 되던지기 + **seam 존재 선단언**(규범 C10)으로, 부재가 collection error 로
//   접혀 rtk 에 PASS 로 오보고되는 것을 막는다(tdd §7.3).
//
// ★ **이 절이 이 phase 에서 공허해지기 가장 쉽다**(tdd §2.3 규범 C). `producer` 스탬프·`env` 표지·
//   `schemaVersion` 검사는 **평소엔 항상 통과하는 방어층**이라, 정상 경로만 도는 테스트로는 그것이
//   구현돼 있는지조차 알 수 없다. 그래서 각 층을 **커밋된 적대적 픽스처**로 개별 발동시키고,
//   §6 CX2~CX6·CX9 가 각 층을 개별로 깨서 red 를 확인한다. **어느 층이 CX 에서 red 0 이면 그 층은 장식이다.**
//
// ★ 이 함수가 fsync 생략을 비준한다(R4). Windows/WSL 에서 libuv 의 rename 은
//   `MoveFileExW(MOVEFILE_REPLACE_EXISTING)` 단독 호출이고 MS 문서가 그 조합에 **원자성을 명시하지
//   않는다** — 즉 안전은 쓰기 측이 아니라 **읽기 측 불신**에 걸려 있다. 나중에 누가 "최적화" 라며
//   이 불신을 걷어내려 하면 이 파일이 그 방어 근거다(F-25).
//
// 규범 A: 픽스처의 `producer`·`schemaVersion`·`env`·지문 기대값은 전부 **리터럴**이다. 프로덕션
//   상수에서 유도하면 상수와 픽스처가 함께 드리프트해 완전히 공허해진다. 그 대가는 **RD10** 이 갚는다
//   (픽스처 ↔ 코드 상수 대조 — 픽스처를 장식이 아니게 만드는 유일한 고리).
import { chmodSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterAll, describe, expect, it } from 'vitest'

import { buildSummary } from '../payloads.mjs'
import { cleanup } from '../../__tests__/helpers/tmp-git-vault.mjs'
import {
  artifactFixturePath,
  copyArtifactFixture,
  readArtifactFixtureText,
} from '../../__tests__/helpers/artifact-fixtures.mjs'

const loaded = await import(new URL('../artifact.mjs', import.meta.url).href).catch((error) => ({
  __loadError: error instanceof Error ? error.message : String(error),
}))

/**
 * **`throw 하지 않는다` 계열 전용 seam 가드**(규범 C10).
 *
 * `read()` 자신이 미구현 시 throw 하므로, 그것을 확인하지 않고 "throw 없음" 을 단언하면 「미구현
 * sentinel throw」가 「실패 경로 throw」로 위장해 RED 가 **공허하게 green** 이 된다(P3 에서 GN8·AT5 가
 * 실제로 그렇게 통과했다).
 */
function expectSeamPresent() {
  expect(loaded.__loadError, 'scripts/lib/artifact.mjs 로드').toBeUndefined()
  expect(typeof loaded.readArtifact, 'readArtifact export').toBe('function')
}

function read(input) {
  if (loaded.__loadError !== undefined) {
    throw new Error(
      `[RED] scripts/lib/artifact.mjs 가 아직 없다 (P4 Task 4 미구현): ${loaded.__loadError}`,
    )
  }
  if (typeof loaded.readArtifact !== 'function') {
    throw new Error('[RED] artifact.mjs 에 readArtifact export 가 아직 없다')
  }
  return loaded.readArtifact(input)
}

const HERE = path.dirname(fileURLToPath(import.meta.url))
/** 트립와이어(RD11) 전용 — 소스를 **읽기만** 한다. */
const SUMMARY_SOURCE = path.resolve(HERE, '..', '..', 'summary.mjs')

// ── 커밋 픽스처가 선언한 값 — 전부 **리터럴**이다(규범 A) ──────────────────────────────────────
const PRODUCER = 'sas-wiki/summary'
const SCHEMA_VERSION = 2
const ENV = 'dev'
const FINGERPRINT = 'b5f0c1d2e3a49876'
/** `fingerprint-tampered.json` 의 값 — 유효본과 **마지막 한 글자**만 다르다(부분 비교 우회 배제). */
const FINGERPRINT_TAMPERED = 'b5f0c1d2e3a49877'
const DOC_ID = '0192a000-0000-7000-8000-0000000000aa'

/** 정상 기대치 — 이 조합에서 `valid.json` 은 Fresh 여야 하고, 적대 픽스처는 각자 한 층씩 걸려야 한다. */
const EXPECT_DEV = {
  env: ENV,
  inputsFingerprint: FINGERPRINT,
  producer: PRODUCER,
  schemaVersion: SCHEMA_VERSION,
}

// ── stale 사유 리터럴(§3.0 seam) ────────────────────────────────────────────────────────────────
const MISSING = 'missing'
const UNREADABLE = 'unreadable'
const MALFORMED = 'malformed'
const PRODUCER_MISMATCH = 'producer-mismatch'
const SCHEMA_VERSION_MISMATCH = 'schema-version-mismatch'
const FINGERPRINT_MISMATCH = 'fingerprint-mismatch'
const ENV_MISMATCH = 'env-mismatch'

const tmps = []
afterAll(() => {
  for (const dir of tmps) {
    try {
      chmodSync(dir, 0o700)
    } catch {
      // 권한 복구는 최선 노력이다 — 실패해도 정리 자체를 막지 않는다.
    }
  }
  cleanup(...tmps)
})

function makeTmp() {
  const dir = mkdtempSync(path.join(tmpdir(), 'wiki-rd-'))
  tmps.push(dir)
  return dir
}

/** 픽스처를 읽어 stale 사유를 캔다(케이스 본문이 짧아지도록 — 단언은 각 케이스가 한다). */
function readFixture(name, expectation = EXPECT_DEV) {
  return read({ expect: expectation, path: artifactFixturePath(name) })
}

const IS_ROOT = typeof process.getuid === 'function' && process.getuid() === 0

describe('readArtifact — 대조군 (RD0 · 🔴RED 미구현)', () => {
  it('RD0: 유효 아티팩트 + 맞는 기대치 → `fresh: true` 이고 **원본 payload** 를 그대로 준다', () => {
    // ★ 이 대조군이 없으면 **"무조건 stale"** 인 구현이 RD1~RD8 을 전부 통과한다 — 그리고 dev 는
    //   매 요청 18초 재생성을 돌면서도 테스트는 전부 green 인 상태가 된다.
    expectSeamPresent()

    const result = readFixture('valid.json')

    expect(result.fresh).toBe(true)
    expect(result.payload.docs.map((doc) => doc.id)).toEqual([DOC_ID])
    expect(result.payload.inputsFingerprint).toBe(FINGERPRINT)
    // 봉투는 **검증자이지 필터가 아니다** — 읽은 것을 깎지 않는다(OQ-P4-4=A · `producer`·`env` 도 남는다).
    expect(result.payload.producer).toBe(PRODUCER)
    expect(result.payload.env).toBe(ENV)
  })
})

describe('readArtifact — 부재·읽기 실패 (RD1·RD8·RD8b · 🔴RED 미구현)', () => {
  it('RD1: 존재하지 않는 경로 → stale(`missing`) · **throw 없음**', () => {
    expectSeamPresent() // 규범 C10 — 미구현 throw 가 "실패 경로 throw" 로 위장하는 것을 막는다
    const absent = path.join(makeTmp(), 'no-such-artifact.json')

    let result
    expect(() => {
      result = read({ expect: EXPECT_DEV, path: absent })
    }, 'readArtifact 는 모든 실패를 stale 로 접는다 — throw 하지 않는다').not.toThrow()

    expect(result.fresh).toBe(false)
    expect(result.reason).toBe(MISSING)
    expect(result.payload).toBeUndefined() // stale 은 본문을 흘리지 않는다
  })

  it('RD8b: 경로가 **디렉토리**다(EISDIR) → stale(`unreadable`) · **throw 없음**', () => {
    // ★ `unreadable` 층의 **항상 실행되는** 케이스다. RD8(EACCES)은 root 에서 skip 되는데, 그러면
    //   CI 가 root 로 돌 때 이 사유의 커버리지가 **0 인 채 green** 으로 보인다 — 이 리포가 반복해 온
    //   공허 가드 형태다. `readFileSync(<디렉토리>)` 는 uid 와 무관하게 EISDIR 이라 root 도 뚫지 못한다.
    //   실제로도 도달 가능한 상태다: `cache/summary.dev.json` 자리에 디렉토리가 만들어지면(도구 오조작·
    //   부분 복원) 독자는 그것을 stale 로 접고 재생성해야지 dev 를 죽이면 안 된다.
    //   ☞ **짝은 아래 RD8(EACCES)** 이고 그쪽은 root 에서 skip 되는 **Deprioritize** 다(§10.3-4 ③).
    //     이 케이스를 지우면 root CI 에서 `unreadable` 커버리지가 0 이 된다 — 함께 읽을 것.
    expectSeamPresent()
    const asDirectory = makeTmp() // 파일이 아니라 디렉토리 자체를 준다

    let result
    expect(() => {
      result = read({ expect: EXPECT_DEV, path: asDirectory })
    }, 'readArtifact 는 모든 읽기 실패를 stale 로 접는다 — throw 하지 않는다').not.toThrow()

    expect(result.fresh).toBe(false)
    expect(result.reason).toBe(UNREADABLE)
  })

  it.skipIf(IS_ROOT)('RD8: 권한 없는 파일(EACCES) → stale(`unreadable`) · **throw 없음**', () => {
    // RD8b 의 **보너스**다(EACCES 특화). root 는 `chmod 000` 을 우회하므로 그 환경에서만 skip 되고,
    //   사유는 §8-11 에 기록한다(조용한 skip 금지). 층 자체의 커버리지는 RD8b 가 항상 보장한다.
    //
    // ★ REFACTOR 분류(tdd §10.3-4 ③) = **Deprioritize**. Delete 가 아닌 이유: EACCES 는 EISDIR 과
    //   **다른 errno 경로**이고(권한 대 파일종류), 실제로 더 흔한 형태다 — 지우면 그 축이 사라진다.
    //   Archive 도 아니다(기능이 없어진 게 아니라 **환경에 따라 실행 여부가 갈릴 뿐**이다). 그래서
    //   비-root 에서는 항상 돌고, root CI 에서만 빠지며 그 사실이 §8-11 에 수치로 남는다.
    //   ☞ **짝은 위의 RD8b(EISDIR)** 다 — uid 와 무관하므로 root 에서도 반드시 실행된다.
    //     즉 이 케이스가 skip 돼도 `unreadable` 사유의 커버리지는 0 이 되지 않는다.
    expectSeamPresent()
    const dir = makeTmp()
    const copied = copyArtifactFixture('valid.json', dir)
    chmodSync(copied, 0o000)

    let result
    expect(() => {
      result = read({ expect: EXPECT_DEV, path: copied })
    }).not.toThrow()

    expect(result.fresh).toBe(false)
    expect(result.reason).toBe(UNREADABLE)
  })
})

describe('readArtifact — 쓰레기·절단 (RD2 · 🔴RED 미구현)', () => {
  it('RD2: `JSON.parse` 가 깨지는 파일 → stale(`malformed`)', () => {
    // ★ 앵커(비공허성): 그 픽스처가 **실제로** 파싱을 깨뜨린다. 유효 JSON 을 "절단" 이라 부르면
    //   이 케이스는 장식이다(plan Task 4 GOTCHA). rename 원자성이 문서 보장되지 않는 환경(R4)에서
    //   반쪽 파일은 **가정이 아니라 실제 조건**이다.
    expectSeamPresent()
    expect(() => JSON.parse(readArtifactFixtureText('truncated.json'))).toThrow()

    const result = readFixture('truncated.json')

    expect(result.fresh).toBe(false)
    expect(result.reason).toBe(MALFORMED)
  })
})

describe('readArtifact — 발행자 스탬프 (RD3·RD4 · 🔴RED 미구현)', () => {
  it('RD3: `producer` 가 **위조**된 파일 → stale(`producer-mismatch`)', () => {
    // 이 층이 없으면 그 경로의 **아무 JSON 이나** 아티팩트가 된다(D-D (a)).
    expectSeamPresent()

    const result = readFixture('producer-forged.json')

    expect(result.fresh).toBe(false)
    expect(result.reason).toBe(PRODUCER_MISMATCH)
  })

  it('RD4: `producer` 키가 **아예 없는** 파일 → 같은 사유로 stale', () => {
    // 부재와 위조를 **둘 다** 문다. `!==` 비교만 하면 `undefined !== 'sas-wiki/summary'` 로 우연히
    //   통과하지만, `payload.producer?.startsWith(...)` 류로 쓰면 부재가 조용히 통과한다.
    expectSeamPresent()

    const result = readFixture('producer-absent.json')

    expect(result.fresh).toBe(false)
    expect(result.reason).toBe(PRODUCER_MISMATCH)
  })
})

describe('readArtifact — 버전·지문·env (RD5~RD7 · 🔴RED 미구현)', () => {
  it('RD5: 미지 `schemaVersion` → stale(`schema-version-mismatch`) · **hard-fail 아님**', () => {
    // ★ 「호환 분기 금지」의 물질화(지배 원칙 3): 옛/새 계약을 동시에 지원하지 않고, 미지 버전은
    //   **stale → 재생성**으로 접는다(TypeScript `buildInfo.version !== version` 선례).
    //   throw 하면 미지 버전 파일 하나가 dev 를 통째로 죽인다.
    expectSeamPresent()

    let result
    expect(() => {
      result = readFixture('schema-version-next.json')
    }, '미지 버전은 hard-fail 이 아니라 stale 이다').not.toThrow()

    expect(result.fresh).toBe(false)
    expect(result.reason).toBe(SCHEMA_VERSION_MISMATCH)
  })

  it('RD6: 지문이 **한 글자** 다른 파일 → stale(`fingerprint-mismatch`)', () => {
    // 전체 재작성이 아니라 1글자 변조다 — prefix 비교·부분 비교로 우회하는 구현을 배제한다.
    expectSeamPresent()
    // 앵커: 픽스처가 실제로 "한 글자만" 다르다(픽스처가 통째로 다르면 이 케이스의 의미가 사라진다).
    expect(FINGERPRINT_TAMPERED).not.toBe(FINGERPRINT)
    expect(FINGERPRINT_TAMPERED.slice(0, -1)).toBe(FINGERPRINT.slice(0, -1))

    const result = readFixture('fingerprint-tampered.json')

    expect(result.fresh).toBe(false)
    expect(result.reason).toBe(FINGERPRINT_MISMATCH)
  })

  it('RD7: 파일 안 `env` 가 기대와 다르다 → stale(`env-mismatch`)', () => {
    // ★ D-G ③ — 지문(①)과 경로(②)를 **우회당해도** 잡히는 유일한 층이다. 이 파일은 producer·
    //   schemaVersion·지문이 전부 맞고 **env 만** 다르다(층 분리).
    expectSeamPresent()

    const result = readFixture('env-mismatch.json')

    expect(result.fresh).toBe(false)
    expect(result.reason).toBe(ENV_MISMATCH)
  })
})

describe('readArtifact — 진단 채널 (RD9 · pair)', () => {
  it('RD9: 서로 다른 실패 모드는 서로 다른 `reason` 을 낸다 (전부 `stale` 로 뭉개지 않는다)', () => {
    // ★ 사유를 뭉개면 "왜 재생성됐는지" 를 영원히 모른다 — P3 F5(제외 사유의 관측 채널)와 같은 축이고,
    //   REFACTOR 때 `readArtifact` 를 평평한 early-return 사슬로 두라는 이유이기도 하다(§10.3-3).
    //
    // ☞ RD3·RD4 는 **같은 사유가 계약**이므로(위조·부재 둘 다 producer-mismatch) 여기서 제외한다 —
    //   tdd §3.4 의 "RD1~RD8 중복 0" 을 문자 그대로 읽으면 RD4 와 모순된다.
    //   `unreadable` 은 **EISDIR**(RD8b)로 관측한다 — root 에서도 실행돼야 7개가 항상 7개다.
    expectSeamPresent()
    const dir = makeTmp()

    const reasons = [
      read({ expect: EXPECT_DEV, path: path.join(dir, 'no-such.json') }).reason,
      read({ expect: EXPECT_DEV, path: dir }).reason,
      readFixture('truncated.json').reason,
      readFixture('producer-forged.json').reason,
      readFixture('schema-version-next.json').reason,
      readFixture('fingerprint-tampered.json').reason,
      readFixture('env-mismatch.json').reason,
    ]

    expect(reasons).not.toContain(undefined)
    expect(reasons).toHaveLength(7) // 실패 모드 7종이 환경과 무관하게 항상 관측된다
    expect(new Set(reasons).size).toBe(reasons.length)
  })
})

describe('픽스처 ↔ 코드 상수 대조 (RD10 · 🔴RED 미구현)', () => {
  it('RD10: 커밋 픽스처의 `schemaVersion`·`producer` 가 **코드가 발행하는 값**과 같다', () => {
    // ★ plan CX 9 를 케이스로 승격한 자리 — **픽스처를 장식이 아니게 만드는 유일한 고리**다.
    //   규범 A 때문에 픽스처는 리터럴인데, 그러면 상수만 올리고 픽스처를 안 고쳐도 아무도 모른다.
    //   여기가 그때 red 가 되어 "리터럴 픽스처를 함께 갱신하라" 고 말한다(PR5 트립와이어와 동형).
    expectSeamPresent()

    const published = buildSummary({
      docs: [],
      generatedAt: '2026-07-27T00:00:00.000Z',
      inputsFingerprint: FINGERPRINT,
      sourceCommit: '9a1b2c3d4e5f60718293a4b5c6d7e8f901234567',
      tags: {},
      tree: [],
    })
    const fixture = JSON.parse(readArtifactFixtureText('valid.json'))

    expect(fixture.schemaVersion).toBe(published.schemaVersion)
    expect(fixture.producer).toBe(loaded.ARTIFACT_PRODUCER)
    // 앵커: 대조가 **리터럴 기대치와도** 맞는다(양쪽이 함께 드리프트해 서로만 맞는 것을 배제).
    expect(fixture.schemaVersion).toBe(SCHEMA_VERSION)
    expect(fixture.producer).toBe(PRODUCER)
  })
})

describe('독자 단일화 트립와이어 (RD11 · 🔴RED 로컬 독자 2개가 살아 있다)', () => {
  it('RD11: `summary.mjs` 의 로컬 독자 2개가 사라지고 `readArtifact` 를 쓴다', () => {
    // D-E "생성기 자신도 이 함수를 쓴다 — 독자가 둘이 되지 않게". 독자가 둘이면 한쪽만 불신을
    //   갖추고 다른 쪽은 옛 파일을 그대로 믿는 상태가 조용히 성립한다.
    const source = readFileSync(SUMMARY_SOURCE, 'utf8')

    // 앵커(규범 B): 부재 단언 앞에 **존재** 단언 — 대체자가 실제로 배선됐다.
    expect(source).toContain('readArtifact')
    expect(source).not.toContain('readFreshCache')
    expect(source).not.toContain('readMatchingReport')
  })
})
