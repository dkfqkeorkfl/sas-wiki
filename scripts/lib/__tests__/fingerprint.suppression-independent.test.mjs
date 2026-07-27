// @vitest-environment node
//
// P5 · Task 8 — 억제를 **지문 입력에서 뺀다** (D-H · R1) — tdd §3.8 (SU1~SU4)
//
// ★ 이 파일은 **P4 Task 1(FP1~FP6)을 정면으로 뒤집는다.** §4 원장 ⑦~⑫ 가 뒤집히는 지점을 1:1 로
//   지목하고, §4.5 ㉑ 이 **Task 8 커밋에서** `fingerprint.ignore-input.test.mjs` 를 재작성하도록
//   규정한다. 그 원장을 읽지 않고 이 절만 구현하면 **두 파일이 정반대를 단언하는 상태**가 된다.
//   Task 8 이전에 저쪽을 손대도 안 된다 — 이유 없이 red 인 구간이 길게 생긴다.
//
// 왜 뒤집는가(Gradle Incremental Build 규범 · T1): _"산출에 영향을 주지 않는 속성을 입력으로 등록하지
//   말라 — 그러지 않으면 필요 없을 때도 태스크가 실행된다."_ 억제는 summary 산출물을 **바꾸지 않고**
//   (B14 실측 · D-B 로 `generatedAt` 까지 무관해진다) 오직 서빙 시점 필터로만 작동한다. 그런데 지금은
//   지문 입력이라 **억제 한 줄 편집이 전량 재생성 23~26초**를 부른다(B10) — D12 의 _"저장만으로 즉시
//   반영되는 싼 연산"_ 과 정반대다.
//
// ★ **한 묶음이다**: 지문에서 빼는 것과 소비자의 post-suppression 첫 페이지 캐시를 제거하는 것은
//   분리 불가다(P4 가 억제를 지문에 넣은 진짜 이유가 그 캐시였다). 캐시 축은 **CS4~CS6** 이 문다.
//
// RED 사유:
//   · SU1·SU2·SU3 — **RED(flip)**. 오늘 `fingerprint.mjs:39-42` 가 억제 파일 **바이트**를 먹는다.
//   · SU4 — **RED**. 오늘 `fingerprint.mjs:7` 이 `'./ignore.mjs'` 를 import 한다. **CX 지목 = CX-A**.
//
// ★ 규범 A: 기대 지문을 `computeInputsFingerprint` 로 만들어 같은 함수와 비교하면 **완전히 공허**하다.
//   그래서 전 케이스가 **차등 비교**(한 축만 바꿔 같음/다름)이고 리터럴 해시를 박지 않는다(브리틀).
//   그 대가는 SU4 트립와이어가 갚는다.
// ★ 규범 B: "안 변한다" 앞에 **"문서를 바꾸면 변한다"** 앵커를 반드시 둔다 — 없으면 지문 계산이
//   통째로 죽은 구현이 전 케이스를 통과한다.
// ★ 규범 F: 실 `ignore-feeds.json`·`wiki/**`·`scripts/**` 를 건드리지 않는다(`scriptsDir` seam 주입).
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterAll, describe, expect, it } from 'vitest'

import { computeInputsFingerprint } from '../fingerprint.mjs'
import { loadIgnoreFeeds } from '../ignore.mjs'
import { cleanup } from '../../__tests__/helpers/tmp-git-vault.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const LIB_DIR = path.resolve(HERE, '..')
const SCRIPTS_DIR = path.resolve(HERE, '..', '..')
const FINGERPRINT_SOURCE = path.join(LIB_DIR, 'fingerprint.mjs')
const IGNORE_SOURCE = path.join(LIB_DIR, 'ignore.mjs')
const GIT_WALK_SOURCE = path.join(LIB_DIR, 'git-walk.mjs')
const SCHEMA_DIR = path.join(SCRIPTS_DIR, 'schema')

/** 억제 파일명·엔트리 — **리터럴**이다(규범 A). 프로덕션 상수에서 가져오면 SU4 가 공허해진다. */
const IGNORE_FILE = 'ignore-feeds.json'
const FEED_ID = '0123456789ab'
const IGNORE_WHEN = '2026-07-28T00:00:00Z'
const IGNORE_ONE = `[{"id":"${FEED_ID}","when":"${IGNORE_WHEN}"}]`
const IGNORE_EMPTY = '[]'
/** 스키마 위반 — `id` 가 12hex 가 아니다(ignore-feeds.schema.json pattern 위반). */
const IGNORE_BROKEN = '[{"id":"not-12hex","when":"nope"}]'

/** 히스토리 좌표 — 전 케이스가 이 **동일 값**을 쓴다(다른 축이 움직인 게 아니라는 앵커). */
const COMMIT_ONE = '1111111111111111111111111111111111111111'
const ID_A = '0192a000-0000-7000-8000-0000000000aa'

const tmps = []
afterAll(() => cleanup(...tmps))

function track(dir) {
  tmps.push(dir)
  return dir
}

/** 생성기 소스 루트를 흉내 낸 tmp — 실 `scripts/` 를 입력으로 삼지 않는다(P3·P4 계승). */
function makeScriptsDir() {
  const root = track(mkdtempSync(path.join(tmpdir(), 'wiki-su-scripts-')))
  mkdirSync(path.join(root, 'lib'), { recursive: true })
  mkdirSync(path.join(root, 'schema'), { recursive: true })
  writeFileSync(path.join(root, 'summary.mjs'), "export const kind = 'summary'\n")
  writeFileSync(path.join(root, 'lib', 'ignore.mjs'), "export const kind = 'ignore'\n")
  writeFileSync(path.join(root, 'schema', 'summary.schema.json'), '{ "title": "wiki_summary" }\n')
  return root
}

const docText = (body) =>
  `---\ntitle: 정상\ntype: concept\nstatus: active\nid: "${ID_A}"\n---\n\n## 정의\n\n${body}\n`

/** git 없는 문서 트리 1건 + (선택) 억제 파일. 지문은 파일 **내용**만 읽으므로 git 이 필요 없다. */
function makeVault({ body = '본문 문단이다.', ignore } = {}) {
  const root = track(mkdtempSync(path.join(tmpdir(), 'wiki-su-vault-')))
  mkdirSync(path.join(root, 'wiki', 'company'), { recursive: true })
  writeFileSync(path.join(root, 'wiki', 'company', '정상.md'), docText(body))
  if (ignore !== undefined) writeFileSync(path.join(root, IGNORE_FILE), ignore, 'utf8')
  return root
}

const scriptsDir = makeScriptsDir()
const fingerprintOf = (vaultDir) =>
  computeInputsFingerprint({ env: 'dev', scriptsDir, sourceCommit: COMMIT_ONE, vaultDir })

describe('억제 변경은 지문을 흔들지 않는다 (SU1 · 🔴RED flip · FP1 대체 · CX-A)', () => {
  it('SU1: 억제 목록만 바꾸면 지문이 **같다** (문서를 바꾸면 달라진다)', () => {
    const vault = makeVault({ ignore: IGNORE_EMPTY })
    const before = fingerprintOf(vault)

    // ★ 앵커 필수: 같은 절차로 **문서**를 고치면 지문이 달라진다. 없으면 "지문 계산이 죽어서 늘 같은"
    //   구현이 통과한다 — 이 리포에서 가드 공허성은 3회 연속 결함원이었다.
    writeFileSync(path.join(vault, 'wiki', 'company', '정상.md'), docText('문서를 고쳤다.'))
    expect(fingerprintOf(vault)).not.toBe(before)
    writeFileSync(path.join(vault, 'wiki', 'company', '정상.md'), docText('본문 문단이다.'))
    expect(fingerprintOf(vault)).toBe(before)

    writeFileSync(path.join(vault, IGNORE_FILE), IGNORE_ONE, 'utf8')

    expect(fingerprintOf(vault)).toBe(before)
  })
})

describe('부재와 빈 배열이 같다 (SU2 · 🔴RED flip · FP4 대체)', () => {
  it('SU2: 억제 파일 **부재**와 `[]` **존재**가 같은 지문이다', () => {
    // OQ-P4-2 = a 가 수용했던 대가("부재 ≠ `[]`" · 파일 최초 생성 시 재생성 1회)가 사라진다 —
    //   억제가 입력이 아니게 되면 그 축 자체가 없다.
    const absent = makeVault()
    const empty = makeVault({ ignore: IGNORE_EMPTY })

    // 앵커: **경로는 입력이 아니다** — 같은 내용의 다른 tmp 디렉토리가 같은 지문을 낸다(FP4 계승).
    expect(fingerprintOf(makeVault())).toBe(fingerprintOf(absent))

    expect(fingerprintOf(empty)).toBe(fingerprintOf(absent))
  })
})

describe('스키마 위반 억제 파일도 지문 밖이다 (SU3 · 🔴RED flip · FP5 대체)', () => {
  it('SU3: 깨진 억제 목록이 있어도 지문이 불변이고, 검증은 **여전히 fail-loud** 다', () => {
    // 지문이 파싱·검증에 결합되면 억제 목록의 오타 하나가 "안 바뀌었나?" 라는 질문 자체를 죽인다.
    //   그 검증 책임은 `loadIgnoreFeeds`(+ `validate`·`feeds`)가 계속 진다 — SU8·FC10 이 그 극성이다.
    const clean = makeVault()
    const broken = makeVault({ ignore: IGNORE_BROKEN })

    expect(fingerprintOf(broken)).toBe(fingerprintOf(clean))

    // 앵커: 억제 **검증 자체는 살아 있다**(지문만 분리됐다).
    expect(() => loadIgnoreFeeds(broken, SCHEMA_DIR)).toThrow(/ignore-feeds\.json/u)
    expect(loadIgnoreFeeds(clean, SCHEMA_DIR)).toEqual([])
  })
})

describe('구조 트립와이어 — 의존이 끊긴다 (SU4 · 🔴RED 오늘 import 1회 · CX-A)', () => {
  it('SU4: `fingerprint.mjs` 에 `./ignore.mjs` import 도 `ignore-feeds.json` 리터럴도 **0회**다', () => {
    // FP6 은 "리터럴 0회" 만 물었다(소비는 했다). SU4 는 **import 문까지** 물어 그것을 흡수한다(§4.2 ⑫).
    const source = readFileSync(FINGERPRINT_SOURCE, 'utf8')
    const owner = readFileSync(IGNORE_SOURCE, 'utf8')
    const consumer = readFileSync(GIT_WALK_SOURCE, 'utf8')
    const count = (text, token) => text.split(token).length - 1

    // 앵커: 상수가 **죽은 게 아니라 의존이 끊긴** 것이다 — 소유자는 여전히 export 하고 소비자가 쓴다.
    expect(count(owner, IGNORE_FILE)).toBeGreaterThan(0)
    expect(count(owner, 'IGNORE_FEEDS_FILE')).toBeGreaterThan(0)
    expect(count(consumer, 'loadIgnoreFeeds')).toBeGreaterThan(0)

    expect(count(source, "'./ignore.mjs'")).toBe(0)
    expect(count(source, IGNORE_FILE)).toBe(0)
    expect(count(source, 'IGNORE_FEEDS_FILE')).toBe(0)
  })
})
