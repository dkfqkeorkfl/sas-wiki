// @vitest-environment node
//
// **`wiki.mjs` 의 새 호출 계약 — `--file <절대경로>` 하나로 md 파일 1건을 파싱한다** (C-1~C-5 · 🔴RED)
//
// ── 무엇이 바뀌는가 ───────────────────────────────────────────────────────────────────────────
// 오늘 `wiki.mjs` 는 발행 아티팩트를 읽어 명부 인덱스를 세우고(경로 집합 + 비활성 스텁), 요청 경로가
//   명부에 있는지 판정하고, active 면 문서 이력을 라이브 git 워크로 걷어 5키를 조립한다 — 인자도
//   `--vault`·`--path`·`--env`·`--summary`·`--ignore` 다섯이다. 그 상태 있는 부분 전부가
//   **소비자(서버 층)로 이동**하고, 이 CLI 에는 **「md 파일 하나를 파싱한다」**만 남는다.
//
// ⇒ 새 계약: `wiki.mjs --file <절대경로>` → **정확 3키** `{md, meta, status}` · exit 0.
//   나머지 2키(`feed`·`path`)는 **호출자가 얹는다** — 그래서 5키가 아니라 3키다.
//
// ── 소멸한 `--summary` 원장의 승계 ───────────────────────────────────────────────────────────
// 삭제된 `wiki.summary-arg.test.mjs` 의 SUM-1/SUM-2 가 나누던 「인자 계약 위반 = exit 2 · 런타임
//   실패 = exit 1」은 각각 C-2(필수 `--file` 미지정)와 C-5(파일 부재)가 이어받는다. SUM-3의 상대
//   경로 해석과 SUM-4의 여러 인자 검증 순서는 `--file <절대경로>` 하나만 남으면서 대상 자체가 사라졌다.
//
// ── 관측 층 ──────────────────────────────────────────────────────────────────────────────────
// **프로세스 경계만** 본다 — exit code · stdout · stderr. 실 spawn 이다.
//
// 규범 A: 기대 md 본문·meta·status·종료코드·경로 조각은 전부 **리터럴**이다.
//   🔴 특히 **`lib/parse.mjs` 를 import 해 그 반환값과 비교하지 않는다.** 새 `wiki.mjs` 는 사실상 그
//   함수의 얇은 래퍼가 되므로, 그 함수로 기대값을 만들면 「CLI 가 파서의 결과를 낸다」는 자기참조
//   동어반복이 되어 **파서가 통째로 틀려도 통과**한다. 픽스처를 이 파일이 리터럴로 쓰고, 기대값도
//   이 파일이 리터럴로 소유한다.
// 규범 B: 부재 단언(「그 인자를 더 이상 안 받는다」)마다 **같은 케이스 안에** 양성 대조를 둔다.
// 규범 D: 헬퍼(`runCli`)는 사실만 캔다 — `expect` 를 담지 않는다.
// 규범 P(사유 뒤바뀜 금지): 인자 계약 위반은 오늘도 exit 2 다 — **사유가 다를 뿐**이다. 그래서
//   exit code 만 무는 케이스는 red 와 green 을 구분하지 못한다. **stderr 어휘를 함께** 문다.
//
// ★ exit code 분담(승계): 호출 계약 위반 = **2**(`main()` 이 종료를 소유) · 런타임 실패 = **1**
//   (최상위 catch). 이 분담은 이 phase 에서도 **그대로 유지**된다 — C-5 가 그 등가를 고정한다.
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { cleanup } from './helpers/tmp-git-vault.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const WIKI = path.resolve(HERE, '..', 'wiki.mjs')

/** 종료코드 — `argparse`/`clap` 관례(사용법 오류 = 2 · 런타임 실패 = 1). 리터럴이다. */
const EXIT_ARG_CONTRACT = 2
const EXIT_RUNTIME = 1

/** 새 계약의 stdout 키 — **정확 3키**를 정렬 배열로 문다(규범 N: 개수 단언 단독 금지). */
const CHILD_KEYS = ['md', 'meta', 'status']

/**
 * 픽스처 원문 — 이 파일이 **리터럴로 소유**한다(규범 A). 아래 기대값 3개가 이 원문의 짝이다.
 * `type: company` 는 `meta` 를 실어 「meta 가 그대로 나온다」를 관측 가능하게 하려는 것이다.
 */
const DOC_SOURCE = [
  '---',
  'title: 파일 계약 문서',
  'type: company',
  'status: active',
  'meta:',
  '  exchange: "KRX"',
  '  sector: "테스트"',
  '  ticker: "000000"',
  '---',
  '',
  '## 정의',
  '',
  '파일 계약 본문이다.',
  '',
].join('\n')

/** 머리말(`---` 블록)이 **없는** 파일 — 파싱 실패 갈래(C-3)의 입력이다. */
const BROKEN_SOURCE = '머리말이 없다.\n'

// 기대값 3종(리터럴) — 머리말 뒤 빈 줄은 벗겨지고 본문 끝은 개행 하나로 정규화된다.
const EXPECTED_MD = '## 정의\n\n파일 계약 본문이다.\n'
const EXPECTED_META = { exchange: 'KRX', sector: '테스트', ticker: '000000' }
const EXPECTED_STATUS = 'active'

/**
 * **소멸하는 5인자** — 이 CLI 가 더 이상 받지 않아야 하는 것들. 값은 오늘 유효했던 형태 그대로 준다
 * (형식 오류로 죽는 것이 아니라 **인자 자체가 사라져서** 죽는다는 것을 관측하기 위함이다).
 */
const RETIRED_OPTIONS = [
  ['--vault', '/tmp'],
  ['--path', 'company/삼성전자'],
  ['--env', 'dev'],
  ['--summary', 'cache/summary.dev.json'],
  ['--ignore', 'ignore-feeds.json'],
]

const tmps = []

let DOC = ''
let BROKEN = ''
let NO_SUCH_FILE = ''

/**
 * 절대 스크립트 경로로 실행한다(cwd 무관 재현).
 *
 * 이 계약은 git 을 전혀 타지 않으므로 git identity 주입이 필요 없다 — 필요해지면 그것 자체가
 * 「파일 하나를 파싱한다」를 넘어섰다는 신호다.
 *
 * 규범 D: `expect` 를 두지 않는다 — spawn 결과를 그대로 돌려준다.
 */
function runCli(args) {
  return spawnSync(process.execPath, [WIKI, ...args], { encoding: 'utf8' })
}

beforeAll(() => {
  const dir = mkdtempSync(path.join(tmpdir(), 'wiki-file-arg-'))
  tmps.push(dir)
  DOC = path.join(dir, 'doc.md')
  BROKEN = path.join(dir, 'broken.md')
  // 만들지 않는다 — 「명부엔 있으나 디스크에 없는 문서」의 `--file` 형태다(C-5).
  NO_SUCH_FILE = path.join(dir, '없는-문서.md')
  writeFileSync(DOC, DOC_SOURCE)
  writeFileSync(BROKEN, BROKEN_SOURCE)
})

afterAll(() => cleanup(...tmps))

describe('`--file <절대경로>` 는 md 1건을 3키로 낸다 (C-1 · 🔴RED 오늘 unknown option)', () => {
  it('C-1: exit 0 이고 stdout 이 정확 3키 `{md, meta, status}` 다', () => {
    // 🔴 오늘 `--file` 은 미선언 옵션이라 `parseArgs`(strict)가 던지고 **exit 2 · stdout 침묵**이다.
    // ★ exit code 만 물면 「exit 2 를 기대하는 케이스가 exit 2 로 통과」하는 자기충족이 된다 —
    //   그래서 이 케이스는 **stdout 3키와 그 값**까지 문다.
    const res = runCli(['--file', DOC])

    expect(res.status).toBe(0)

    const payload = JSON.parse(res.stdout)
    // 규범 N: 개수가 아니라 **정렬 배열 정확 일치**다. `toHaveProperty` 류로 내리면 옛 5키가 남아
    //   있어도 통과해 「호출자가 나머지 2키를 얹는다」는 분담이 관측되지 않는다.
    expect(Object.keys(payload).toSorted()).toEqual(CHILD_KEYS)
    expect(payload.md).toBe(EXPECTED_MD)
    expect(payload.meta).toEqual(EXPECTED_META)
    // `status` 의 권위는 **파일 머리말**이다(아티팩트가 아니다) — 이 CLI 는 아티팩트를 모른다.
    expect(payload.status).toBe(EXPECTED_STATUS)
  })
})

describe('`--file` 미지정은 인자 계약 위반이다 (C-2 · 🔴RED 오늘은 다른 사유로 exit 2)', () => {
  it('C-2: exit 2 · stdout 침묵 · stderr 가 `--file` 을 말한다', () => {
    // ★★ **exit code 단독으로 물면 안 된다.** 오늘도 인자 없이 부르면 exit 2 인데 **사유가 다르다** —
    //   오늘의 사유는 「`--summary` 가 필수인데 없다」이고, 착륙 후의 사유는 「`--file` 이 없다」다.
    //   두 상태가 같은 종료코드를 공유하므로 red↔green 을 가르는 것은 **stderr 어휘**뿐이다.
    const missing = runCli([])

    expect(missing.status).toBe(EXIT_ARG_CONTRACT)
    expect(missing.stdout).toBe('')

    // 계약(🔴 오늘 red — 오늘 stderr 는 `--summary` 를 말한다)
    expect(missing.stderr).toContain('--file')
    // 사유 뒤바뀜 방지: 소멸한 인자가 여전히 실패 사유를 말하고 있으면 계약이 절반만 옮겨진 것이다.
    expect(missing.stderr).not.toContain('--summary')

    // ── 앵커(양성 대조 · 케이스 내): 같은 CLI 에 `--file` 을 주면 exit 0 이고 파싱 가능한 JSON 이다
    //    → 「무엇을 줘도 exit 2」인 과잉 구현을 배제한다.
    const supplied = runCli(['--file', DOC])
    expect(supplied.status).toBe(0)
    expect(JSON.parse(supplied.stdout).status).toBe(EXPECTED_STATUS)
  })
})

describe('머리말이 깨진 파일은 `null` 이다 — 던지지 않는다 (C-3 · 🔴RED 오늘 unknown option)', () => {
  it('C-3: exit 0 이고 stdout 이 `null` 이다', () => {
    // ★ 「없는 문서」와 **같은 실패 형태**다. 이 갈래를 접지 않으면 본문 접근이 TypeError 로 던져
    //   exit 1 이 되고, 소비자에서는 404 여야 할 것이 500 으로 나간다.
    // ★ 오늘 이 판정은 소멸하는 순수부 모듈(`lib/single-doc.mjs`)에 있다 — 그 모듈이 사라져도
    //   **이 성질은 남아야 한다**. 그것이 이 케이스가 존재하는 이유다.
    const broken = runCli(['--file', BROKEN])

    expect(broken.status).toBe(0)
    expect(broken.stdout.trim()).toBe('null')

    // ── 앵커(양성 대조 · 케이스 내): 같은 실행 형태로 정상 파일은 3키다 → 「무엇을 줘도 null」인
    //    구현을 배제한다.
    const ok = runCli(['--file', DOC])
    expect(ok.status).toBe(0)
    expect(Object.keys(JSON.parse(ok.stdout)).toSorted()).toEqual(CHILD_KEYS)
  })
})

describe('소멸한 5인자는 미선언 옵션이다 (C-4 · 🔴RED 오늘은 전부 유효)', () => {
  it.each(RETIRED_OPTIONS)(
    'C-4: `%s` 는 exit 2 이고 stderr 가 그 인자를 지목한다',
    (flag, value) => {
      // ★ 왜 exit code 만으로는 부족한가: 오늘도 이 argv 는 exit 2 다 — 다만 사유가 「`--file` 이
      //   미선언 옵션이다」이지 「`%s` 가 미선언 옵션이다」가 아니다(오늘 그 다섯은 전부 유효하다).
      //   그래서 **stderr 가 어느 인자를 지목하는가**를 문다. 소멸 인자를 argv **앞**에 두는 것도
      //   같은 이유다 — strict 파서는 처음 만난 미선언 옵션을 지목한다.
      const res = runCli([flag, value, '--file', DOC])

      expect(res.status).toBe(EXIT_ARG_CONTRACT)
      expect(res.stdout).toBe('')

      // 계약(🔴 오늘 red — 오늘 stderr 는 `--file` 을 지목한다)
      expect(res.stderr).toContain(flag)

      // ── 앵커(양성 대조 · 케이스 내): 같은 CLI 가 `--file` **단독**에는 exit 0 이다 → 「무엇을 줘도
      //    exit 2」로 통과하는 것을 배제한다.
      expect(runCli(['--file', DOC]).status).toBe(0)
    },
  )
})

describe('파일이 실제로 없으면 런타임 실패다 (C-5 · 🟡등가 pin)', () => {
  it('C-5: 인자 계약 위반 = exit 2 · 파일 부재 = exit 1 로 갈린다', () => {
    // ★★ **이 케이스는 「고쳐야 할 결함」이 아니라 「지켜야 할 등가」다.**
    //   명부에는 있는데 디스크에 파일이 없는 문서는 **오늘도** 읽기에서 던져 exit 1 → 소비자 500 이
    //   된다(파일 읽기에 try/catch 가 없다). 이 phase 는 그 동작을 **바꾸지 않는다** — 새 방어층
    //   (try/catch·`null` 접기·404 변환)을 만들면 관측 가능한 계약이 조용히 달라진다.
    //   그래서 이 케이스의 목적은 **미래에 누가 그 방어를 넣으면 red 가 되는 것**이다.
    //   🔴 다만 오늘은 argv 형태(`--file` 이 미선언 옵션) 때문에 exit **2** 가 나와 red 다 —
    //   red 사유는 「등가가 깨졌다」가 아니라 「아직 이 인자를 안 받는다」다.
    //
    //   ★ 두 사유를 **한 배열로** 대조하는 이유: 각각을 따로 물면 「무엇을 줘도 exit 2」·「무엇을
    //     줘도 exit 1」인 구현이 절반씩 통과한다. 분담 자체가 계약이다.
    const argContract = runCli([])
    const absentFile = runCli(['--file', NO_SUCH_FILE])

    expect([argContract.status, absentFile.status]).toEqual([EXIT_ARG_CONTRACT, EXIT_RUNTIME])
    // 실패를 정상 결과로 접지 않는다 — `null` 을 찍고 exit 0 으로 끝내면 소비자는 404 를 본다.
    expect(absentFile.stdout).toBe('')

    // ── 앵커(양성 대조 · 케이스 내): 같은 디렉토리의 **실재하는** 파일은 exit 0 이다 → 「경로만
    //    받으면 무조건 죽는다」를 배제한다.
    expect(runCli(['--file', DOC]).status).toBe(0)
  })
})
