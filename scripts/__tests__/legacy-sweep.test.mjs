// @vitest-environment node
//
// P6 · 레거시 접두사 부재 가드 + 예외 양방향 (LS0~LS9) — tdd §3.1 · plan Task 1·4·5 · D-A·D-B·D-H
//
// ── 이 파일이 존재하는 이유 (지우기 전에 읽어라) ─────────────────────────────────────────────
// D6 이 커밋 접두사 3종(`cwiki`/`uwiki`/`feed`) 규약을 폐지했다. 폐지된 규약의 흔적은 **실행되지
// 않으므로 어떤 테스트도 red 를 내지 않는다** — 조용히 남아 다음 사람에게 죽은 규칙을 가르친다.
// 실측 baseline(`d363cf4`): 추적 전역 **177줄 / 33파일**.
//
// ★ **이 리포에는 pre-commit 훅도 CI 도 없다**(실측: `.husky` 없음 · `prepare` 없음 ·
//   `core.hooksPath` 미설정). 그래서 가드가 살 자리는 **vitest 안뿐**이고(plan D-A), 훅을 새로
//   설치하면 그 사실을 계약으로 삼은 `README.md:248` 이 **거짓이 된다**. 훅을 만들지 마라.
//
// ── RED/green 현황 (작성 시점 실측) ────────────────────────────────────────────────────────
//   LS1  🔴RED   — 프로덕션 소스 주석 3줄이 지금 거짓을 말한다(feed.mjs:51 · invariants.mjs:17·19)
//   LS2  🔴RED   — 예외 밖 코드 줄이 100+ 남아 있다(픽스처 커밋 메시지·`it` 제목)
//   LS0·LS7·LS8·LS9  이 파일과 헬퍼가 생기는 순간 green — **부재 가드의 자기 감도 증명**이 본분이다
//   LS3·LS4·LS5      pair — GREEN 이후 **항상** 통과해야 한다
//   LS6              pin  — 지금도 green(실 히스토리 실측). 예외 E5·E6 의 **존재 이유**를 잰다
//
// ── 왜 "0건" 이 아니라 "예외 밖 0건" 인가 (D-B) ────────────────────────────────────────────
// 무엇의 부재를 강제하려면 **그것을 이름으로 적어야** 한다. 부재 가드 자신 · grandfathering 케이스 ·
// 배포 히스토리를 만든 시더가 전부 그 자리다. 그래서 목표를 「등록된 예외를 제외한 0건 **+ 예외의
// 양방향 강제**」로 정의한다 — k8s `hack/verify-prometheus-imports.sh` 가 허용목록 이탈(exit 2)과
// **죽은 허용목록**(exit 1)을 서로 다른 코드로 가르는 것과 같은 구조다. 죽은 예외가 red 가 아니면
// 예외 목록 자체가 새 드리프트 표면이 된다(rustc `ui_tests.rs` 가 실제로 겪고 증축한 경로).
//
// ── 세 방향을 세 케이스가 나눠 진다 (규범 K — 방향을 먼저 적는다) ──────────────────────────
//   LS2  단방향(과다만)  — 남아 있으면 red. **"스캐너가 아무것도 안 봤다" 는 통과시킨다**
//   LS0  그 반대 방향     — 코퍼스 비공허(H3). k8s #125950 `Ran 0 of 740 Specs … SUCCESS!` 형 배제
//   LS3  단방향(과소만)  — 죽은 예외가 있으면 red. **넓은 예외는 통과시킨다**
//   LS5  그 반대 방향     — 정확 경로·glob 금지(H2). gitleaks shipped config 26개 중 4개 미앵커 형
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { cleanup, commit, initVault } from './helpers/tmp-git-vault.mjs'

// 규범 C10 — 신설 헬퍼를 named import 하면 부재 시 ESM 링크가 파일을 통째로 죽여 **collection
//   error** 가 되고, 러너 요약이 그것을 "테스트 0건 = 실패 0건" 으로 **PASS 오보고**한다(§7.3).
//   그래서 붙들었다가 **케이스별로 되던진다** + seam 존재를 먼저 단언한다.
const scanModule = await import(new URL('./helpers/tracked-scan.mjs', import.meta.url).href).then(
  (module) => module,
  (error) => ({ loadError: error }),
)

/** 헬퍼 seam. 부재면 **이 케이스만** 죽는다(collection error 아님). */
function trackedScan() {
  if (scanModule.loadError) throw scanModule.loadError
  return scanModule
}

const HERE = path.dirname(fileURLToPath(import.meta.url))
/** sas-wiki 리포 루트 — `scripts/__tests__` 의 두 단계 위. cwd 무관(`import.meta.url` 파생). */
const REPO_ROOT = path.resolve(HERE, '..', '..')
/** ★ H1 — 가드 자신의 면제 경로를 **구조적으로** 유도한다(문자열로 손으로 적지 않는다). */
const SELF_PATH = path.relative(REPO_ROOT, fileURLToPath(import.meta.url))

/**
 * ★★ **이 파일에서 원시 레거시 토큰을 담는 유일한 줄이 바로 아래다** — 예외 E1 의 표적.
 *
 * 부재 가드는 자기 표적을 이름으로 부를 수밖에 없다(D-B). 그래서 그 이름을 **한 줄에 가두고**
 * 스캔 패턴·히스토리 기대를 전부 이 줄에서 파생시킨다 — 면제 줄이 늘어난 만큼 사각지대가 커진다.
 * 토큰을 문자열로 쪼개 스캐너를 속이지 않는다(H1 은 **경로 면제**로 푼다 — 그것이 구조적 해법이다).
 *
 * `commits` 는 실 히스토리 실측(2026-08-01 · `git log HEAD --format=%s`)이고 LS6 이 그 값을 잰다.
 */
const LEGACY_PREFIX_FACTS = [{ commits: 7, prefix: 'cwiki' }, { commits: 6, prefix: 'uwiki' }] // prettier-ignore

const LEGACY_TOKENS = LEGACY_PREFIX_FACTS.map((fact) => fact.prefix)
/** 스캔 패턴 — 단어 경계로 묶어 `cwikix` 같은 우연 매치를 배제한다. */
const LEGACY_PREFIX_RE = new RegExp(String.raw`\b(${LEGACY_TOKENS.join('|')})\b`)
/** 커밋 subject 접두사 형 — LS6 이 실 히스토리를 셀 때만 쓴다. */
const legacySubjectRe = (prefix) => new RegExp(`^${prefix}: `)

/** Tier P = 프로덕션 소스(`scripts/**\/*.mjs` − `__tests__`). **주석까지** 문다(LS1). */
const isProductionSource = (rel) =>
  rel.startsWith('scripts/') && rel.endsWith('.mjs') && !rel.includes('__tests__/')

/**
 * `it('<marker>…')` 블록의 줄 범위(1-based, 양끝 포함). 못 찾으면 `null`.
 *
 * 왜 텍스트가 아니라 **범위**인가: `build.convention-scope.test.mjs` 에는 CN1 밖에도
 * `commitAt(vault, '…: 삼성 생성', '2026-01-01T00:00:00Z')` 와 **바이트 동일한 줄이 5개 더** 있다
 * (실측 :101·:121·:153·:188·:213). 텍스트 술어로는 CN1 의 것만 고를 수 없고, 넓히면 H2 위반이다.
 */
function itBlockRange(lines, marker) {
  const start = lines.findIndex((line) => line.includes(`it('${marker}`))
  if (start === -1) return null
  const end = lines.findIndex((line, index) => index > start && line === '  })')
  return end === -1 ? null : { end: end + 1, start: start + 1 }
}

/** 파일 전문을 줄 배열로(레지스트리 술어 입력 — 사실만 캔다, 규범 D). */
function readLines(rel) {
  return readFileSync(path.join(REPO_ROOT, rel), 'utf8').split('\n')
}

// ────────────────────────────────────────────────────────────────────────────────────────────
// 예외 레지스트리 — **판정 권위는 여기 하나뿐이다**(스캐너에 예외 술어를 흩뿌리지 않는다).
//
// 규범 H — 각 엔트리는 **4요소**를 갖는다. 하나라도 없으면 등재하지 않는다:
//   ① `path`     정확 경로. glob·정규식 금지(LS5 가 강제)
//   ② `covers`   그 파일 안에서 **어떤 줄**이 면제되는지. 파일 통째 면제 금지
//   ③ `why`      "왜 이것은 레거시가 아닌가" 한 문장
//   ④ `liveness` ★ 그 예외가 **여전히 필요함**을 독립적으로 관측하는 방법(죽으면 LS3 red)
//
// ★ ④가 이 규범의 핵심이다. 「죽은 예외 = red」를 *선언*하는 것과 *관측 가능하게 만드는 것*은 다르다.
//   E5 의 liveness 는 "그 줄이 아직 있다" 가 아니라 **「실 히스토리에 legacy 접두사 커밋이 여전히
//   있다」**(LS6)여야 한다 — 전자는 동어반복이고 후자는 예외의 **존재 이유**를 잰다.
//
// ★ 기존 LG1(`feeds.env-leak.verify.test.mjs`)의 **술어형 예외**
//   (`/not\.(toMatch|toContain)|LEGACY_PREFIX_RE/`)는 H2 위반이다 — 경로가 아니라 정규식이라 넓다.
//   **그 형태를 복제하지 않는다**(§4.1-②).
// ────────────────────────────────────────────────────────────────────────────────────────────
const EXCEPTIONS = [
  {
    covers: (hit) => hit.text.includes('LEGACY_PREFIX_FACTS'),
    id: 'E1',
    liveness: () => {
      // 상수가 선언돼 있고 **스캔 패턴으로 실제 사용된다**(선언만 남고 안 쓰이면 예외가 무의미하다).
      const source = readFileSync(path.join(REPO_ROOT, SELF_PATH), 'utf8')
      return source.includes('pattern: LEGACY_PREFIX_RE') && LEGACY_TOKENS.length > 0
    },
    path: SELF_PATH,
    why: '부재 가드는 자기 표적을 이름으로 부를 수밖에 없다(D-B). 토큰을 한 줄에 가뒀다.',
  },
  {
    covers: (hit, lines) => {
      const range = itBlockRange(lines, 'CN1:')
      return range !== null && hit.line >= range.start && hit.line <= range.end
    },
    id: 'E2',
    liveness: (lines) =>
      lines.some((line) => line.includes("it('CN1:")) &&
      lines.some((line) => line.includes('buildContent(')),
    path: 'scripts/__tests__/build.convention-scope.test.mjs',
    why: 'grandfathering 케이스의 **정체가 legacy 접두사**다. 다른 접두사로 바꾸면 CN2 와 같은 케이스가 된다(D-C).',
  },
  {
    covers: (hit) => hit.text.includes('not.toMatch('),
    id: 'E3',
    liveness: (lines) =>
      // 앞선 앵커 2줄이 살아 있어야 FO8 의 부재 단언이 공허하지 않다(규범 B).
      lines.some((line) => line.includes('expect(message).not.toBeNull()')) &&
      lines.some((line) => line.includes('toMatch(/분리/)')),
    path: 'scripts/lib/__tests__/invariants.feed-only.test.mjs',
    why: '부재 단언은 표적을 이름으로 적을 수밖에 없다(FO8 — 진단 메시지가 없는 컨벤션을 안내하지 않는다).',
  },
  {
    covers: (hit) => hit.text.includes('const LEGACY_PREFIX_RE'),
    id: 'E4',
    liveness: (lines) => lines.filter((line) => line.includes("it('LG1:")).length === 2,
    path: 'scripts/__tests__/feeds.env-leak.verify.test.mjs',
    why: 'P2 가 세운 **hidden 층 LG1 가드**의 표적 명명. 층이 다르므로 LS 로 흡수하지 않는다(§4.1-②).',
  },
  {
    covers: (hit) => /\bmessage: '/.test(hit.text),
    id: 'E5',
    liveness: () => realHistoryPrefixCounts().total > 0,
    path: 'scripts/__tests__/helpers/seed-example-vault.mjs',
    why: '★ 이 시더가 **배포된 예제 vault(`test`·`main`)를 실제로 만들었다**. 히스토리 재작성 금지와 lockstep 이다(OQ-P6-1 = a).',
  },
  {
    covers: (hit, lines) => {
      const ranges = [
        itBlockRange(lines, '예제 커밋 17건이 '),
        itBlockRange(lines, '커밋은 신규 파일을 정확히 1개 만든다'),
      ]
      return ranges.some(
        (range) => range !== null && hit.line >= range.start && hit.line <= range.end,
      )
    },
    id: 'E6',
    liveness: (lines) =>
      // E5 가 살아 있어야 성립하는 계약이다(레지스트리 내 상호참조).
      existsSync(path.join(REPO_ROOT, 'scripts/__tests__/helpers/seed-example-vault.mjs')) &&
      lines.some((line) => line.includes('seeded.examples')),
    path: 'scripts/__tests__/seed-example-vault.test.mjs',
    why: 'E5 를 검사하는 계약. E5 없이는 성립하지 않는다(OQ-P6-1 = a).',
  },
  {
    covers: (hit) => hit.text.includes('const SUBJECTS'),
    id: 'E8',
    liveness: (lines) => lines.some((line) => line.includes("it('FS2:")),
    path: 'scripts/lib/__tests__/feed.prefix-closure.test.mjs',
    why: '★ 접두사 **무관성**을 증명하려면 옛 접두사를 입력으로 쓸 수밖에 없다(FS2 — 치환 안전성의 근거). E1 과 같은 형태로 한 줄에 가뒀다.',
  },
]

/** 실 히스토리의 legacy 접두사 커밋 수 — **읽기 전용**(규범 F: 실 데이터를 조작하지 않는다). */
function realHistoryPrefixCounts() {
  const subjects = execFileSync('git', ['-C', REPO_ROOT, 'log', 'HEAD', '--format=%s'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'safe.directory',
      GIT_CONFIG_VALUE_0: REPO_ROOT,
    },
    maxBuffer: 16 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  }).split('\n')

  const byPrefix = {}
  for (const { prefix } of LEGACY_PREFIX_FACTS) {
    byPrefix[prefix] = subjects.filter((subject) => legacySubjectRe(prefix).test(subject)).length
  }
  const total = Object.values(byPrefix).reduce((sum, count) => sum + count, 0)
  return { byPrefix, commits: subjects.filter(Boolean).length, total }
}

/**
 * ★ H9 — 실패 메시지가 **고치는 법을 지목**한다.
 *
 * 구현자가 가드를 의심해 무력화하는 경로를 막는 것이 목적이다(이 리포에는 그 전력이 있다). 그래서
 * ① `경로:줄` ② 위반 텍스트 ③ **두 갈래 조치**를 전부 담는다 — LS7 이 이 형식을 계약으로 문다.
 */
function formatViolations(hits) {
  return [
    `레거시 접두사 토큰 ${hits.length}건 — 등록된 예외 밖이다:`,
    ...hits.map((hit) => `  - ${hit.path}:${hit.line}  ${hit.text}`),
    '  → 두 갈래 중 하나를 고른다:',
    '     (a) 픽스처·제목이면 접두사를 `chore:` 등 컨벤션 무관 값으로 **치환**한다.',
    '     (b) 부재 가드가 표적을 이름으로 부를 수밖에 없는 자리면 **예외 레지스트리에 등재**한다',
    '         — 규범 H 4요소(정확 경로·줄 술어·사유·liveness 앵커)를 채우고 메인 세션 컨펌을 받는다.',
  ].join('\n')
}

/** 추적 전역 스캔 결과(Tier T 원본 — 예외 미적용). 케이스마다 새로 캔다(공유 상태 금지). */
function scanTierT() {
  const { listTracked, scanTracked } = trackedScan()
  const { files, skipped } = listTracked(REPO_ROOT)
  const tierT = files.filter((rel) => !isProductionSource(rel))
  const scan = scanTracked({
    files: tierT,
    pattern: LEGACY_PREFIX_RE,
    repoRoot: REPO_ROOT,
    stripComments: true,
  })
  return { ...scan, skipped, tierTFiles: tierT.length, trackedFiles: files.length }
}

/** 예외를 적용해 남은 위반과, 엔트리별 제거 건수를 함께 돌려준다(양방향의 두 입력). */
function applyExceptions(hits, registry = EXCEPTIONS) {
  const removedById = Object.fromEntries(registry.map((entry) => [entry.id, 0]))
  const remaining = []
  const linesCache = new Map()

  for (const hit of hits) {
    const entry = registry.find((candidate) => candidate.path === hit.path)
    if (entry === undefined) {
      remaining.push(hit)
      continue
    }
    if (!linesCache.has(entry.path)) linesCache.set(entry.path, readLines(entry.path))
    if (entry.covers(hit, linesCache.get(entry.path))) removedById[entry.id] += 1
    else remaining.push(hit)
  }
  return { remaining, removedById }
}

function expectNoLegacyOutsideRegistry(hits, registry = EXCEPTIONS) {
  const { remaining } = applyExceptions(hits, registry)
  expect(
    remaining.map((hit) => `${hit.path}:${hit.line}`),
    formatViolations(remaining),
  ).toEqual([])
}

function withLegacyOffenderFixture(callback) {
  const vault = initVault()
  try {
    writeFileSync(path.join(vault, 'clean-a.mjs'), "export const a = 'chore: 정상'\n", 'utf8')
    writeFileSync(path.join(vault, 'clean-b.md'), '# 정상 문서\n', 'utf8')
    writeFileSync(
      path.join(vault, 'offender.mjs'),
      `export const seed = '${LEGACY_TOKENS[0]}: 문서 생성'\n`,
      'utf8',
    )
    commit(vault, 'chore: 감도 증명 픽스처')
    return callback(vault)
  } finally {
    cleanup(vault)
  }
}

function withBinaryTrackedFixture(callback) {
  const vault = initVault()
  try {
    writeFileSync(path.join(vault, 'text.mjs'), 'export const a = 1\n', 'utf8')
    writeFileSync(path.join(vault, 'blob.bin'), Buffer.from([0x41, 0x00, 0x42]))
    commit(vault, 'chore: 바이너리 포함 픽스처')
    return callback(vault)
  } finally {
    cleanup(vault)
  }
}

describe('레거시 스윕 — 코퍼스 비공허 (LS0 · H3)', () => {
  it('LS0: 추적 스캔이 실제로 파일을 봤다 — 아는 파일이 코퍼스에 포함돼 있다', () => {
    // ★ 전 LS 케이스의 앵커. 이것이 없으면 "위반 0건" 과 "아무것도 안 봄" 이 같은 관측을 낸다
    //   (k8s #125950: `Ran 0 of 740 Specs … SUCCESS!` 로 모든 PR 이 green 이었다. 이 리포에도
    //    `toBe(17)` 선례가 있다). 하한은 **리터럴**로 적는다(실측 162 · `.mjs` 131) — 프로덕션
    //    상수에서 유도하면 코퍼스가 통째로 비어도 기대값이 함께 0이 된다(규범 A).
    const { listTracked } = trackedScan()
    expect(typeof listTracked).toBe('function')

    const { files } = listTracked(REPO_ROOT)

    expect(files.length).toBeGreaterThanOrEqual(150)
    expect(files.filter((rel) => rel.endsWith('.mjs')).length).toBeGreaterThanOrEqual(60)
    expect(files).toContain('README.md')
    expect(files).toContain('scripts/lib/feed.mjs')
  })
})

describe('레거시 스윕 — Tier P: 프로덕션 소스는 주석까지 문다 (LS1 · CX-6A)', () => {
  it('LS1: 프로덕션 소스에 레거시 접두사 토큰이 주석 포함 0줄이다(예외 없음)', () => {
    // 🔴 왜 지금 red 인가: 프로덕션 주석 **3줄**이 현재 동작을 틀리게 서술한다 —
    //   `feed.mjs:51`      "`cwiki:`/`uwiki:` 는 **정상 컨벤션**이므로" (D6 이후 정상은 `feed:` 하나)
    //   `invariants.mjs:17` "vault 커밋(cwiki/uwiki/feed)은"           (D26 이후 접두사 무관)
    //   `invariants.mjs:19` "'cwiki 인데 신규 0개' 같은 위반으로"       (그 규칙 자체가 없다)
    // GREEN: 위 3줄을 접두사 무관 문언으로 교정하면 green 이 된다(§4.4 (현) 분류 · Task 4).
    //
    // ★ Tier P 만 주석까지 무는 이유(규범 I): 실측상 프로덕션 주석은 **역사 서술을 담지 않는다**
    //   (3줄 전부 현재형 거짓). 반면 테스트 주석 37줄 중 11줄은 정당한 역사 서술이라 토큰을 지우면
    //   문장이 뜻을 잃는다 → 그쪽은 LS2 가 **코드 줄만** 문다.
    const { listTracked, scanTracked } = trackedScan()
    const { files } = listTracked(REPO_ROOT)
    const production = files.filter((rel) => isProductionSource(rel))

    // 앵커 ①: 대상 파일이 실재한다. ②: 아는 파일이 **필터에서 빠지지 않았다**(0건의 정체를 가른다).
    expect(production.length).toBeGreaterThanOrEqual(20)
    expect(production).toContain('scripts/lib/feed.mjs')
    expect(production).toContain('scripts/lib/invariants.mjs')

    const { hits } = scanTracked({
      files: production,
      pattern: LEGACY_PREFIX_RE,
      repoRoot: REPO_ROOT,
      stripComments: false,
    })

    expect(
      hits.map((hit) => `${hit.path}:${hit.line}`),
      formatViolations(hits),
    ).toEqual([])
  })
})

describe('레거시 스윕 — Tier T: 추적 전역 − 예외 (LS2 · CX-6B)', () => {
  it('LS2: 예외 레지스트리 밖에 레거시 접두사 코드 줄이 0건이다', () => {
    // 🔴 왜 지금 red 인가: 픽스처 커밋 메시지·`it` 제목이 **100줄 넘게** 옛 접두사를 입력으로 쓴다
    //   (실측 코드 132줄 중 예외 밖 ≈109 + README 8줄). GREEN: 접두사를 `chore:` 등으로 치환하고
    //   제목·필터 변수를 **함께** 고친다(§4.3 — 제목만 남으면 거짓 문서다).
    //
    // ★ 방향(규범 K): **단방향(과다만)** 이다. "스캐너가 아무것도 안 봤다" 는 이 케이스가 통과시킨다
    //   — 그 방향은 LS0(코퍼스 비공허)과 LS8(건너뛴 목록)이 진다.
    const scan = scanTierT()

    // 앵커 ①: 줄을 실제로 읽었다. ②: 예외를 **끄면** hits 가 나온다 — 레지스트리가 코퍼스를 통째로
    //   삼킨 상태(= 예외가 너무 넓어 전부 면제)를 배제한다.
    expect(scan.scannedLines).toBeGreaterThan(0)
    expect(scan.tierTFiles).toBeGreaterThan(0)

    expectNoLegacyOutsideRegistry(scan.hits, EXCEPTIONS)
  })
})

describe('예외 양방향 — 죽은 예외는 실패다 (LS3 pair · CX-6E)', () => {
  it('LS3: 레지스트리의 모든 엔트리가 실제로 줄을 면제하고 있고, 존재 이유가 살아 있다', () => {
    // ★ D-B 의 심장. 이것이 없으면 예외 목록이 **새 드리프트 표면**이 된다 — 표적이 사라진 뒤에도
    //   목록에 남아 다음 위반을 조용히 덮는다(rustc 가 `ui_tests.rs` 에 역방향 단언을 증축해야 했던
    //   이유이고, Vitess #20261 은 검사 자체가 dead code 였다 — _"it validated nothing"_).
    //
    // ★ 방향(규범 K): **단방향(과소만)**. 예외가 **너무 넓은 것**은 통과시킨다 → LS5 가 그 방향을 진다.
    const scan = scanTierT()
    const { removedById } = applyExceptions(scan.hits)

    // 앵커: 전체 제거 건수의 합이 0이 아니다(스캔이 죽어 모든 엔트리가 동시에 0인 상태 배제).
    const totalRemoved = Object.values(removedById).reduce((sum, count) => sum + count, 0)
    expect(totalRemoved).toBeGreaterThan(0)

    // 하한 앵커(scannedLines 관례와 같은 방향 · G1): `itBlockRange` 는 텍스트 기반 블록 파싱이라
    //   포맷이 바뀌면(마커 문구 변경·닫는 줄 들여쓰기 변경 등) 조용히 무너질 수 있다 — E2·E6 의
    //   `covers()` 가 그 결과에 기대므로, 파싱이 **오늘 알려진 마커에서 실제로 무언가 찾는다**를
    //   직접 못박는다. 이게 없으면 파싱이 null 을 내도 "면제 0건" 이라는 간접 신호(위 dead 판정)로만
    //   드러나 itBlockRange 자체가 원인이라는 진단이 안 남는다.
    const cn1Range = itBlockRange(readLines('scripts/__tests__/build.convention-scope.test.mjs'), 'CN1:') // prettier-ignore
    expect(cn1Range, 'itBlockRange 가 CN1 블록을 못 찾았다(E2 커버리지가 조용히 변질된다)').not.toBeNull() // prettier-ignore
    const seedVaultLines = readLines('scripts/__tests__/seed-example-vault.test.mjs')
    const seedRangeA = itBlockRange(seedVaultLines, '예제 커밋 17건이 ')
    const seedRangeB = itBlockRange(seedVaultLines, '커밋은 신규 파일을 정확히 1개 만든다')
    expect(seedRangeA, 'itBlockRange 가 E6 첫 마커를 못 찾았다(커버리지가 조용히 변질된다)').not.toBeNull() // prettier-ignore
    expect(seedRangeB, 'itBlockRange 가 E6 둘째 마커를 못 찾았다(커버리지가 조용히 변질된다)').not.toBeNull() // prettier-ignore

    const dead = EXCEPTIONS.filter((entry) => removedById[entry.id] === 0).map((entry) => entry.id)
    expect(
      dead,
      `죽은 예외 ${dead.join(', ')} — 더 이상 아무 줄도 면제하지 않는다.\n` +
        '  → 표적이 사라졌다는 뜻이므로 **예외 목록에서 지워라**(방치하면 다음 위반을 덮는다).',
    ).toEqual([])

    const stale = EXCEPTIONS.filter((entry) => !entry.liveness(readLines(entry.path))).map(
      (entry) => entry.id,
    )
    expect(
      stale,
      `예외 ${stale.join(', ')} 의 **존재 이유**가 관측되지 않는다(규범 H ④).\n` +
        '  → 근거가 사라졌으면 예외를 지우고, 근거가 옮겨갔으면 liveness 앵커를 갱신하라.',
    ).toEqual([])
  })
})

describe('예외 하드닝 — 자기면제는 구조적으로 (LS4 pair · H1)', () => {
  it('LS4: 가드 자신의 면제 경로가 `import.meta.url` 유도값과 일치한다', () => {
    // ★ rustc 는 같은 문제를 `file!()` 로 푼다 — 경로를 손으로 적으면 파일을 옮기는 순간 면제가
    //   빗나가고, 그때 가드는 **자기 자신을 offender 로 세며** 판정이 뒤집힌다(리서치 프로브 실패 사례).
    // ★ 토큰을 문자열로 쪼개 스캐너를 속이는 우회를 쓰지 않는 이유이기도 하다 — 면제는 **경로**로 푼다.
    const self = EXCEPTIONS.find((entry) => entry.id === 'E1')

    expect(self.path).toBe(path.relative(REPO_ROOT, fileURLToPath(import.meta.url)))
    expect(self.path).toBe('scripts/__tests__/legacy-sweep.test.mjs')

    // 앵커: 면제가 무의미하지 않다 — 이 파일에 레거시 토큰이 **실제로** 있고, 정확히 1줄이다.
    const { scanTracked } = trackedScan()
    const { hits } = scanTracked({
      files: [self.path],
      pattern: LEGACY_PREFIX_RE,
      repoRoot: REPO_ROOT,
      stripComments: true,
    })
    expect(hits).toHaveLength(1)
    expect(hits[0].text).toContain('LEGACY_PREFIX_FACTS')
  })
})

describe('예외 하드닝 — 정확 경로, glob 금지 (LS5 pair · H2 · CX-6F)', () => {
  it('LS5: 모든 예외 경로가 추적 목록에 실재하고 glob 메타문자를 담지 않는다', () => {
    // ★ gitleaks 는 shipped config 26개 중 4개가 미앵커라 `gitleaks\.toml` 이 `notgitleaks.toml`
    //   까지 매치했다. 넓은 예외는 **조용히** 사각지대를 만든다 — LS3 은 그것을 통과시킨다
    //   (매치가 있으므로 "살아 있는 예외" 로 보인다). 그 방향의 유일한 소유자가 이 케이스다.
    const { listTracked } = trackedScan()
    const tracked = new Set(listTracked(REPO_ROOT).files)

    // 앵커: 레지스트리가 비어 있지 않다(0개면 아래 루프가 공허하게 통과한다).
    expect(EXCEPTIONS.length).toBeGreaterThanOrEqual(4)

    for (const entry of EXCEPTIONS) {
      expect(entry.path, `${entry.id}: 경로가 추적 목록에 없다`).toSatisfy((value) =>
        tracked.has(value),
      )
      expect(entry.path, `${entry.id}: glob 메타문자 금지(정확 경로만)`).not.toMatch(/[*?[\]]/)
      // ③ 사유 · ④ liveness 도 4요소 계약이다 — 비어 있으면 등재 자체가 무효다.
      expect(entry.why.length, `${entry.id}: 사유가 비어 있다`).toBeGreaterThan(10)
      expect(typeof entry.liveness, `${entry.id}: liveness 앵커가 없다`).toBe('function')
    }
  })
})

describe('예외 liveness — 실 히스토리가 시더 예외의 존재 이유다 (LS6 pin · 확정대기 OQ-P6-1)', () => {
  it('LS6: 실 히스토리에 legacy 접두사 커밋이 실측 개수만큼 실재한다', () => {
    // ★ 규범 H ④의 모범. E5(시더)·E6(그 검사)의 liveness 는 "그 줄이 아직 있다" 가 아니라
    //   **"재작성 금지된 실 히스토리가 여전히 그 접두사를 담고 있다"** 여야 한다 — 전자는 동어반복이고
    //   후자는 예외의 *존재 이유*를 잰다. 히스토리가 재작성되면(=금지 위반) 예외가 죽어 red 가 되고,
    //   새 legacy 커밋이 생기면(=컨벤션 위반) 개수 초과로 red 가 된다. **양쪽 다 잡힌다.**
    //
    // ⚠️ 측정 규범: `rtk` 프록시는 `git log` 출력을 **조용히 잘라낸다**(실측: raw 73커밋 → 50커밋).
    //   그 절단이 `cwiki:` 7건을 통째로 삼켜 plan 이 "0건" 을 얻었고, 하마터면 **참인 주석을 거짓으로
    //   판정**할 뻔했다. 이 케이스는 `execFileSync` 로 git 을 직접 부르므로 프록시를 타지 않는다.
    const { byPrefix, commits, total } = realHistoryPrefixCounts()

    // 앵커: 히스토리를 실제로 읽었다(전체 커밋 수가 legacy 건수보다 많다).
    expect(commits).toBeGreaterThan(total)
    expect(total).toBeGreaterThan(0)

    for (const { commits: expected, prefix } of LEGACY_PREFIX_FACTS) {
      expect(byPrefix[prefix], `${prefix}: 접두사 커밋 수`).toBe(expected)
    }
  })
})

describe('스캐너 자기 감도 — 진단 품질과 범위 (LS7·LS8·LS9 · H9·H5·H7)', () => {
  it('LS7: 위반이 있으면 메시지가 경로:줄 · 위반 텍스트 · 두 갈래 조치를 담는다', () => {
    // ★ 감도 증명은 **tmp 사본에서만** 한다(규범 F) — 실 리포에 위반을 주입하면 워킹트리가 더러워지고,
    //   그것이 곧 "테스트가 제품 데이터를 조작했다" 가 된다. 실 리포는 읽기 전용이다.
    const { listTracked, scanTracked } = trackedScan()
    withLegacyOffenderFixture((vault) => {
      const scan = scanTracked({
        files: listTracked(vault).files,
        pattern: LEGACY_PREFIX_RE,
        repoRoot: vault,
        stripComments: true,
      })

      // 앵커: 정상 2파일은 **잡히지 않았다**(true negative). Semgrep 이 룰마다 TP+TN 을 둘 다
      //   요구하는 이유 — 전부 잡는 스캐너도 "감도 100%" 로 보인다.
      expect(scan.hits.map((hit) => hit.path)).toEqual(['offender.mjs'])

      const message = formatViolations(scan.hits)
      expect(message).toContain('offender.mjs:1')
      expect(message).toContain(LEGACY_TOKENS[0])
      expect(message).toContain('치환')
      expect(message).toContain('예외 레지스트리에 등재')
    })
  })

  it('LS8: 건너뛴 파일을 조용히 버리지 않고 `skipped` 에 실어 돌려준다', () => {
    // ★ `rg` 는 ignore·hidden·binary·symlink 4종을 **조용히** 건너뛴다. 그 조용함이 "안 봤다" 를
    //   "위반 없다" 로 위장한다. 이 케이스가 그 조용함을 시끄럽게 바꾼다.
    const { listTracked } = trackedScan()

    // ① 실 리포에는 건너뛸 것이 없다(실측: 바이너리 0 · 읽기 실패 0).
    expect(listTracked(REPO_ROOT).skipped).toEqual([])

    // ② 앵커 — 건너뛸 것이 **있으면 실제로 실린다**(①이 "기능이 죽어서 빈 배열" 인 것을 배제).
    withBinaryTrackedFixture((vault) => {
      const { files, skipped } = listTracked(vault)
      expect(files).toEqual(['text.mjs'])
      expect(skipped).toEqual([{ path: 'blob.bin', why: 'binary' }])
    })
  })

  it('LS9: 비-git 디렉토리에서는 throw 한다(빈 목록으로 접지 않는다)', () => {
    // ★ gitleaks #1450 — _"scanning zero files, which succeeds trivially"_ 로 `no leaks found` +
    //   exit 0 이 나왔다. 부재 가드에서 **에러를 green 으로 삼키는 것**은 가장 위험한 실패 형태다.
    const { listTracked } = trackedScan()
    const bare = initVault()
    try {
      // git 메타데이터를 없애 "git 이 아닌 디렉토리" 를 만든다(tmp 사본 — 실 리포 무접촉).
      rmSync(path.join(bare, '.git'), { force: true, recursive: true })

      expect(() => listTracked(bare)).toThrow()
      // 앵커: 정상 리포에서는 throw 하지 않는다(throw 가 상수 동작이 아님).
      expect(() => listTracked(REPO_ROOT)).not.toThrow()
    } finally {
      cleanup(bare)
    }
  })
})
