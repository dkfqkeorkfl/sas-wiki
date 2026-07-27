// @vitest-environment node
//
// P4 · Task 1 — 억제 파일을 지문 입력으로 (D-C) — tdd §3.1 (FP1~FP6)
//
// RED 사유(전 케이스 공통 · **미구현**): `computeInputsFingerprint` 의 입력 범위가
//   `env + sourceCommit + <scriptsDir>/**/*.mjs + <scriptsDir>/schema/*.json + <vaultDir>/wiki/**/*.md`
//   뿐이고 **vault 루트의 `ignore-feeds.json` 이 빠져 있다**(plan B5 격리 실측: 억제 파일을 고쳐도
//   지문 불변). 그래서 소비자 캐시 키를 지문으로 갈아도 **D12(억제 즉시 반영)는 여전히 깨진 채**다 —
//   이 파일이 그 구멍의 단위 증명이다. 종단 증명은 `summary.artifact.test.mjs`(FP7).
//
// 확정 사항(tdd §2.6 · 2026-07-27):
//   · **OQ-P4-2 = a** — 지문은 **바이트 그대로**이고 **부재 = 빈 입력**이다(파싱 금지 · FP4·FP5).
//     `'[]'` 리터럴을 먹이는 우회는 실제 파일이 `[]\n` 이면 깨지는 **개행 하나짜리 계약**이라 기각됐고,
//     `JSON.parse` 후 재직렬화는 지문을 스키마 검증에 결합시켜 데이터 오타 하나가 D-F ③(지문 계산
//     실패 → 500)을 상시 발동시킨다.
//
// ★ 이 절이 이 phase 에서 **자기참조 공허성 위험이 가장 높다**(tdd §2.3 규범 A):
//   기대 지문을 `computeInputsFingerprint` 로 만들어 같은 함수 결과와 비교하면 **완전히 공허**하다.
//   그래서 전 케이스가 **차등 비교**(같은 입력 → 같음 / 한 축만 바꿈 → 다름)이고 **리터럴 해시를
//   박지 않는다**(브리틀). 그 대가는 FP6 트립와이어가 갚는다.
//
// ★ 규범 F: 실 `sas-wiki/ignore-feeds.json` 과 `wiki/**` 는 **읽지도 쓰지도 않는다.** 억제 엔트리는
//   tmp vault 에서만 만든다(선례: `scripts/lib/__tests__/git-walk.test.mjs:70-73`).
//   실 `scripts/**` 도 고치지 않는다 — `scriptsDir` seam 에 tmp 를 주입한다(P3 §10.1 절대금지 6).
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterAll, describe, expect, it } from 'vitest'

import { computeInputsFingerprint } from '../fingerprint.mjs'
import { cleanup } from '../../__tests__/helpers/tmp-git-vault.mjs'

// `ignore.mjs` 는 존재하지만 `IGNORE_FEEDS_FILE` export 는 아직 없다 → namespace 수입으로 붙들어
//   부재를 **케이스별**(FP6) red 로 만든다. named import 였다면 파일 전체가 collection error 가 되고
//   rtk 가 그것을 PASS 로 오보고한다(tdd §7.3).
import * as ignoreModule from '../ignore.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
/** 트립와이어(FP6) 전용 — 소스를 **읽기만** 한다. */
const FINGERPRINT_SOURCE = path.resolve(HERE, '..', 'fingerprint.mjs')
const IGNORE_SOURCE = path.resolve(HERE, '..', 'ignore.mjs')

/** 억제 파일명 — **리터럴**이다. 프로덕션 상수에서 가져오면 FP6 이 자기참조로 공허해진다. */
const IGNORE_FILE = 'ignore-feeds.json'

/** 히스토리 좌표 리터럴 — 전 케이스가 이 **동일 값**을 쓴다(다른 축이 움직여 달라진 게 아니라는 앵커). */
const COMMIT_ONE = '1111111111111111111111111111111111111111'

const ID_A = '0192a000-0000-7000-8000-0000000000aa'
/** 억제 엔트리 id — feed 커밋해시 12hex 형태(ignore-feeds.schema.json). 리터럴이다. */
const FEED_ID = '0123456789ab'

const tmps = []
afterAll(() => cleanup(...tmps))

function track(dir) {
  tmps.push(dir)
  return dir
}

/** 생성기 소스 루트를 흉내 낸 tmp — 지문의 `scripts` 축을 고정하되 실 `scripts/` 를 건드리지 않는다. */
function makeScriptsDir() {
  const root = track(mkdtempSync(path.join(tmpdir(), 'wiki-fpi-scripts-')))
  mkdirSync(path.join(root, 'lib'), { recursive: true })
  mkdirSync(path.join(root, 'schema'), { recursive: true })
  writeFileSync(path.join(root, 'summary.mjs'), "export const kind = 'summary'\n")
  writeFileSync(path.join(root, 'lib', 'ignore.mjs'), "export const kind = 'ignore'\n")
  writeFileSync(path.join(root, 'schema', 'summary.schema.json'), '{ "title": "wiki_summary" }\n')
  return root
}

/**
 * git 없는 문서 트리 1건 + (선택) 억제 파일. 지문은 파일 **내용**만 읽으므로 git 이 필요 없다.
 *
 * `ignore` 를 생략하면 **파일 자체를 만들지 않는다**(FP4 의 "부재" 입력).
 */
function makeVault({ ignore } = {}) {
  const root = track(mkdtempSync(path.join(tmpdir(), 'wiki-fpi-vault-')))
  mkdirSync(path.join(root, 'wiki', 'company'), { recursive: true })
  writeFileSync(
    path.join(root, 'wiki', 'company', '정상.md'),
    `---\ntitle: 정상\ntype: concept\nstatus: active\nid: "${ID_A}"\n---\n\n## 정의\n\n본문 문단이다.\n`,
  )
  if (ignore !== undefined) writeFileSync(path.join(root, IGNORE_FILE), ignore, 'utf8')
  return root
}

const writeIgnore = (vaultDir, text) =>
  writeFileSync(path.join(vaultDir, IGNORE_FILE), text, 'utf8')

/** 억제 목록 바이트 — **리터럴**이다(구현이 어떻게 섞는지는 묻지 않는다). */
const EMPTY_LIST = '[]'
const ONE_ENTRY = `[{"id":"${FEED_ID}","when":"2026-07-27T00:00:00Z"}]`
/** 스키마 위반(배열이 아니다) — `loadIgnoreFeeds` 는 이걸 보면 throw 한다. */
const SCHEMA_VIOLATION = '{"nope":1}'

const base = (scriptsDir, vaultDir) => ({
  env: 'dev',
  scriptsDir,
  sourceCommit: COMMIT_ONE,
  vaultDir,
})

describe('지문 입력 — 억제 파일 내용 (FP1~FP3 · 🔴RED 억제 파일이 입력 밖)', () => {
  it('FP1: 억제 목록만 바꾸면 지문이 **달라진다** (D-C 의 심장)', () => {
    // 앵커: `env`·`sourceCommit`·`scriptsDir` 이 두 호출에서 **동일 리터럴**이다 — 다른 축이 움직여
    //   달라진 것이 아니다. 이 세 축이 같다는 사실이 곧 "억제가 입력이 됐다" 의 증거다.
    const scriptsDir = makeScriptsDir()
    const vaultDir = makeVault({ ignore: EMPTY_LIST })
    const input = base(scriptsDir, vaultDir)
    const before = computeInputsFingerprint(input)

    writeIgnore(vaultDir, ONE_ENTRY)

    expect(computeInputsFingerprint(input)).not.toBe(before)
  })

  it('FP2: 억제를 원래 바이트로 **원복**하면 지문이 돌아온다 (mtime·이력을 먹지 않는다)', () => {
    // FP1 만 있으면 "아무 파일이나 만지면 달라지는" 구현(예: 디렉토리 mtime 해싱)도 통과한다.
    //
    // ☞ tdd §3.1 은 FP2 를 "FP1 에 이어" 라고 적었는데, 케이스는 독립이어야 하므로(공유 상태 금지)
    //   **중간 상태를 실제로 관측했다**는 앵커를 안에 둔다. 그것이 없으면 "억제를 아예 안 읽는"
    //   현행 구현에서 이 케이스가 공허하게 green 이다(실측으로 확인했다).
    const scriptsDir = makeScriptsDir()
    const vaultDir = makeVault({ ignore: EMPTY_LIST })
    const input = base(scriptsDir, vaultDir)
    const before = computeInputsFingerprint(input)

    writeIgnore(vaultDir, ONE_ENTRY)
    expect(computeInputsFingerprint(input)).not.toBe(before) // 앵커: 중간 상태가 실재했다

    writeIgnore(vaultDir, EMPTY_LIST)

    expect(computeInputsFingerprint(input)).toBe(before)
  })

  it('FP3: vault 루트의 **무관 파일**은 지문을 흔들지 않는다 (과잉 무효화 방지)', () => {
    // ★ 앵커가 **케이스 안에** 있다(규범 B): 같은 절차로 억제 파일을 바꾸면 **변한다**. 그 앵커가
    //   없으면 "vault 루트 전체를 먹는" 구현이 통과하고, 그러면 README 한 줄에 18초 재생성이 돈다.
    const scriptsDir = makeScriptsDir()
    const vaultDir = makeVault({ ignore: EMPTY_LIST })
    const input = base(scriptsDir, vaultDir)
    const before = computeInputsFingerprint(input)

    writeFileSync(path.join(vaultDir, 'README.md'), '# 리포 설명\n', 'utf8')
    writeFileSync(path.join(vaultDir, 'notes.json'), '{"memo":"잡무"}\n', 'utf8')

    expect(computeInputsFingerprint(input)).toBe(before)

    // 앵커: 억제 파일은 **같은 절차로** 지문을 움직인다(파서가 죽어서 "안 변한" 것이 아니다).
    writeIgnore(vaultDir, ONE_ENTRY)
    expect(computeInputsFingerprint(input)).not.toBe(before)
  })
})

describe('지문 입력 — 부재와 파싱 무결합 (FP4·FP5 · 🔴RED · OQ-P4-2=a)', () => {
  it('FP4: 억제 파일 **부재**와 `[]` **존재**는 서로 다른 지문이다 (부재 = 빈 입력)', () => {
    // OQ-P4-2 = a. 대가(파일을 **처음 만들 때** 재생성 1회)는 실 vault 에 이미 `[]` 가 있어
    //   발생하지 않는다. `'[]'` 를 대신 먹이는 (b) 는 실제 파일이 `[]\n` 이면 깨진다.
    const scriptsDir = makeScriptsDir()
    const absent = makeVault()
    const empty = makeVault({ ignore: EMPTY_LIST })

    // 앵커: **vault 정체성 자체는 입력이 아니다** — 같은 내용의 다른 tmp 디렉토리는 같은 지문을 낸다.
    //   이 앵커가 없으면 "경로가 달라서 지문이 달라졌다" 와 구분되지 않아 아래 단언이 공허해진다.
    expect(computeInputsFingerprint(base(scriptsDir, makeVault()))).toBe(
      computeInputsFingerprint(base(scriptsDir, absent)),
    )

    expect(computeInputsFingerprint(base(scriptsDir, empty))).not.toBe(
      computeInputsFingerprint(base(scriptsDir, absent)),
    )
  })

  it('FP5: 스키마 위반 억제 파일도 **throw 없이** 먹는다 (지문 ↔ 파싱 결합 배제)', () => {
    // ★ 위험 실재 앵커(규범 B): **같은 vault 로 `loadIgnoreFeeds` 는 throw 한다** — "검증이라는
    //   위험이 실재" 함을 먼저 보인다. 지문이 파싱에 결합되면 데이터 오타 하나가 D-F ③(지문 계산
    //   실패 → 500)을 상시 발동시킨다.
    //
    // ☞ tdd §3.1 은 FP5 를 "throw 없음 + 16-hex" 로만 적었는데, 그 둘은 **오늘도 참**이다(억제 파일을
    //   아예 안 읽으니까) — 즉 그대로 쓰면 공허하게 green 이다. 그래서 "그 바이트를 실제로 먹었다"
    //   (= `[]` 와 다른 지문)를 함께 문다. 이것이 없으면 이 케이스는 장식이다.
    const scriptsDir = makeScriptsDir()
    const vaultDir = makeVault({ ignore: EMPTY_LIST })
    const input = base(scriptsDir, vaultDir)
    const valid = computeInputsFingerprint(input)

    writeIgnore(vaultDir, SCHEMA_VIOLATION)

    // 앵커: 이 vault 는 실제로 "신뢰할 수 없는 억제 목록" 이다(로더가 거부한다).
    expect(() => ignoreModule.loadIgnoreFeeds(vaultDir)).toThrow()

    const tainted = computeInputsFingerprint(input) // throw 하지 않는다
    expect(tainted).toMatch(/^[0-9a-f]{16}$/)
    expect(tainted).not.toBe(valid) // 바이트를 **먹었다** — 파싱하지 않고
  })
})

describe('지문 입력 — 경로 소유권 트립와이어 (FP6 · 🔴RED export 부재)', () => {
  it('FP6: `ignore.mjs` 가 파일명을 소유하고 `fingerprint.mjs` 는 리터럴을 재기입하지 않는다', () => {
    // ★ 규범 A 의 대가를 갚는 자리. `WIKI_PREFIX` ↔ `head-state.mjs` 선례와 **동형**이다
    //   (`fingerprint.mjs:23-25` 의 경고 주석: "여기서 다시 적으면 조용히 빈 배열").
    //   리터럴이 두 곳에 생기면 파일명이 바뀔 때 한쪽만 따라가고, 지문은 **조용히** 억제를 못 보게 된다.
    expect(ignoreModule.IGNORE_FEEDS_FILE).toBe(IGNORE_FILE)

    const fingerprintSource = readFileSync(FINGERPRINT_SOURCE, 'utf8')
    const ignoreSource = readFileSync(IGNORE_SOURCE, 'utf8')

    // 앵커(규범 B): 소유자 쪽에는 그 문자열 리터럴이 **있다** — "아무 데도 없어서" 통과하는 것을 배제.
    expect(countLiteral(ignoreSource, IGNORE_FILE)).toBeGreaterThan(0)
    expect(countLiteral(fingerprintSource, IGNORE_FILE)).toBe(0)
  })
})

/** 소스 텍스트의 **문자열 리터럴** 등장 횟수(작은따옴표·큰따옴표). 산문 주석은 세지 않는다. */
function countLiteral(source, value) {
  let count = 0
  for (const quote of ["'", '"']) {
    const needle = `${quote}${value}${quote}`
    let index = source.indexOf(needle)
    while (index !== -1) {
      count += 1
      index = source.indexOf(needle, index + needle.length)
    }
  }
  return count
}
