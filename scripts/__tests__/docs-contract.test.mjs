// @vitest-environment node
//
// P6 · 문서↔코드 결속 — 경로·봉투(PT) · 열거(EN) · 라벨 어휘(LB) · 요약 시퀀스(SQ)
//      tdd §3.2~§3.5 · plan Task 2·3·7 · D-D · 규범 I
//
// ── 무엇을 결속하고 무엇을 결속하지 않는가 (규범 I — 이 phase 의 진짜 산출물) ───────────────
// 결속 대상은 **넷뿐**이다: ① 열거 ② 경로·봉투 키 ③ 어휘(라벨·enum) ④ 시퀀스.
// **산문은 결속하지 않는다.** 이유는 취향이 아니라 실측이다 — 낡은 서술의 모집단에는
//   `scripts/wiki/`(22줄) · `vitest.config.ts`(6줄) · 부재 인프라 서술(8줄)이 있는데, 그중
//   _"`scripts/wiki/build.mjs` 미구현"_ 은 **역사 서술로 정당**하고 _"사용: node scripts/wiki/seed…"_
//   는 **현재형 거짓**이다. **같은 토큰, 반대 판정** — 기계가 가를 수 없다. 산문에 가드를 걸면
//   거짓양성 공장이 된다. 그 자리는 §4 원장과 리뷰가 진다.
//
// ── 마커 규약과 **전이기 폴백** (OQ-P6-5 · ★ 이 파일의 유일한 설계 재량) ────────────────────
// 문서 쪽 결속면은 HTML 주석 마커(`<!-- contract:<name> -->` … `<!-- /contract:<name> -->`)로 고정한다.
// 절 제목·줄번호로 구간을 잡으면 Task 3(전면 개정)이 가드를 **조용히 공허하게** 만든다
// (구간을 못 찾음 → 빈 집합 → `0 === 0` 통과).
//
// ★ 마커는 **아직 없다**(RED). 그래서 각 결속 케이스는 마커가 없으면 **README 전문에서 해당 어휘가
//   실제로 등장하는 줄만 골라** 비교한다(locator 폴백). 이유:
//     · 마커 부재 자체는 **PT0·EN0** 이 명시적 red 로 잡는다(빈 집합 통과가 아니다).
//     · 폴백이 없으면 PT1~PT5·EN1~EN6 이 전부 "마커 없음" 이라는 **같은 이유**로 red 가 되어,
//       "지금 문서의 어느 서술이 어긋났는가" 라는 이 phase 의 진짜 정보가 사라진다.
//     · 폴백은 **좁히는 방향**이다 — 어휘가 있는 줄만 본다. 마커가 생기면 구간이 권위가 되고
//       폴백 경로는 죽는다(그때부터 구간 밖 서술은 결속되지 않는다 — 그것이 계약면의 정의다).
//
// ── 이 파일의 GREEN 은 **문서가 만든다** ────────────────────────────────────────────────────
// PT·EN·LB·SQ 가 red 면 **틀린 쪽은 문서다.** 코드는 P1~P5 가 실측·검증했다 — 코드를 문서에 맞추면
// 계약이 뒤집힌다. **EN2 만 예외**다(`invariants.mjs:1` 헤더 주석은 코드가 아니라 문서다).
//
// ── RED/green 현황 (작성 시점 실측) ────────────────────────────────────────────────────────
//   🔴RED  PT0(마커 부재) · PT1(경로가 env 분리 전) · PT2("5종" · 목록 없음) · PT3(producer 미기재)
//          PT4(문서 `schemaVersion: 1` vs 코드 3) · PT5(옛 경로 7회 잔존)
//          EN0(마커 5종 부재) · EN1(표 8행, 코드 7종) · EN2("8종" ×2) · EN4(미기재)
//          EN5(Importance 3종 — `fix` 누락) · EN6(exit 2 미문서화) · LB1(팬텀 1 · 누락 3) · LB2
//   ✅green EN3 · EN7 · SQ1 · SQ2(pin — 회귀 방지 못) · LB0 · SQ0(pair) · LB3(감도 증명)
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { artifactPath, feedsArtifactPath, reportPath } from '../lib/artifact.mjs'
import { loadSchema, validateItem } from '../lib/schema-validator.mjs'
import { cleanup, initVault } from './helpers/tmp-git-vault.mjs'

// 규범 C10 — 헬퍼 부재가 **collection error** 가 되면 러너 요약이 PASS 로 오보고한다(§7.3).
const slugModule = await import(new URL('./helpers/github-slug.mjs', import.meta.url).href).then(
  (module) => module,
  (error) => ({ loadError: error }),
)

function markdownHelpers() {
  if (slugModule.loadError) throw slugModule.loadError
  return slugModule
}

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, '..', '..')
const README = readFileSync(path.join(REPO_ROOT, 'README.md'), 'utf8')
const README_LINES = README.split('\n')

/** 프로덕션 **소스 텍스트**를 읽는다 — 상수를 import 하지 않는다(규범 A · §7.5 트립와이어 층). */
const readSource = (rel) => readFileSync(path.join(REPO_ROOT, rel), 'utf8')

const unique = (values) => [...new Set(values)]
const captures = (text, pattern) => [...text.matchAll(pattern)].map((match) => match[1])

/**
 * 문서 쪽 결속면. 마커가 있으면 그 구간, 없으면 **어휘가 등장하는 줄만**(전이기 폴백 — 파일 헤더).
 *
 * @param {string} marker `contract:<name>` 의 `<name>`
 * @param {string[]} locators 폴백에서 줄을 고르는 앵커 문자열(기대값이 아니라 **위치 탐색용**이다)
 */
function docScope(marker, locators) {
  const { extractMarkerBlock } = markdownHelpers()
  const block = extractMarkerBlock(README, marker)
  if (block !== null) return { lines: block, via: 'marker' }
  return {
    lines: README_LINES.filter((line) => locators.some((needle) => line.includes(needle))),
    via: 'fallback',
  }
}

const scopeText = (scope) => scope.lines.join('\n')

// ────────────────────────────────────────────────────────────────────────────────────────────
// PT — 산출물 경로·봉투 결속 (D-D 유형 1). 마커: `contract:artifacts`
// ────────────────────────────────────────────────────────────────────────────────────────────
/** 경로 비교는 **`<env>` 형으로 정규화**한다 — 헬퍼에 리터럴 `'<env>'` 를 넣어 코드 쪽도 같은 형으로. */
const ENV_PLACEHOLDER = '<env>'
/** 리터럴 기대(규범 A). 코드에서도 문서에서도 유도하지 않는다 — 둘이 **함께 틀린** 상태를 배제한다. */
const EXPECTED_ARTIFACT_PATHS = [
  'cache/feeds.<env>.json',
  'cache/summary.<env>.json',
  'logs/summary.report.<env>.json',
  'logs/summary.report.<env>.txt',
]
const EXPECTED_SCHEMA_FILES = [
  'body.schema.json',
  'feeds-artifact.schema.json',
  'feeds.schema.json',
  'ignore-feeds.schema.json',
  'report.schema.json',
  'summary.schema.json',
  'wiki-doc.schema.json',
]

/** `logs/summary.report.<env>.{json,txt}` 같은 brace 표기를 펼친다(문서 표기 자유도를 남긴다). */
function expandBraces(token) {
  const match = token.match(/^(.*)\{([^}]+)\}(.*)$/)
  if (!match) return [token]
  return match[2].split(',').map((part) => `${match[1]}${part.trim()}${match[3]}`)
}

function documentedArtifactPaths(scope) {
  return unique(
    captures(scopeText(scope), /((?:cache|logs)\/[A-Za-z0-9.<>{},*_-]+)/g)
      .flatMap((token) => expandBraces(token))
      .map((token) => token.replace(/\.$/, '')),
  ).sort()
}

describe('결속 — 산출물 경로·봉투 (PT · D-D 유형 1)', () => {
  it('PT0: README 에 `contract:artifacts` 마커가 열림/닫힘 각 1개이고 구간이 비어 있지 않다', () => {
    // 🔴 왜 지금 red 인가: 마커가 **아직 없다**(Task 3 이 넣는다). 이 케이스가 없으면 이하 결속이
    //   전부 "빈 구간 vs 빈 집합" 으로 **조용히 통과**한다 — 규범 I 부속 규칙의 심장이다.
    const { extractMarkerBlock } = markdownHelpers()
    const block = extractMarkerBlock(README, 'artifacts')

    expect(block, 'README 에 `<!-- contract:artifacts -->` … `<!-- /contract:artifacts -->` 를 넣어라').not.toBeNull() // prettier-ignore
    expect(documentedArtifactPaths({ lines: block })).toHaveLength(4)
  })

  it('PT1: 문서화된 산출물 경로 == 경로 헬퍼 4종 == 리터럴 (양방향)', () => {
    // 🔴 왜 지금 red 인가: README 는 env 분리 **이전** 경로를 말한다 — `cache/summary.json`(5회) ·
    //   `logs/summary.report.*`. 실제 계약은 `cache/summary.<env>.json` · **`cache/feeds.<env>.json`**
    //   (신규) · `logs/summary.report.<env>.{json,txt}` 다. GREEN: 원장 ⑭ 의 7지점을 마커 구간으로.
    const fromCode = [
      artifactPath('/v', ENV_PLACEHOLDER),
      feedsArtifactPath('/v', ENV_PLACEHOLDER),
      reportPath('/v', ENV_PLACEHOLDER, 'json'),
      reportPath('/v', ENV_PLACEHOLDER, 'txt'),
    ]
      .map((full) => path.relative('/v', full))
      .sort()

    // 앵커: 코드 쪽 4개가 **서로 다르다**(한 함수가 같은 값을 4번 내는 것을 배제).
    expect(unique(fromCode)).toHaveLength(4)
    expect(fromCode).toEqual(EXPECTED_ARTIFACT_PATHS)

    const scope = docScope('artifacts', ['cache/', 'logs/summary.report'])
    expect(documentedArtifactPaths(scope), `문서 결속면(${scope.via})`).toEqual(
      EXPECTED_ARTIFACT_PATHS,
    )
  })

  it('PT2: 문서화된 스키마 파일 목록 == `scripts/schema/*.json` 7종 (양방향)', () => {
    // 🔴 왜 지금 red 인가: README:49 는 _"frontmatter 1종 + 산출물 3종 + 억제목록 1종"_ = **5종**이라
    //   적고 **파일 목록이 없다**. 실제는 **7종**이다.
    const onDisk = readdirSync(path.join(REPO_ROOT, 'scripts/schema'))
      .filter((name) => name.endsWith('.json'))
      .sort()

    // 앵커: 디스크 목록이 비어 있지 않고, P3·P4 가 더한 2종이 **둘 다** 있다(리터럴 대조).
    expect(onDisk).toEqual(EXPECTED_SCHEMA_FILES)
    expect(onDisk).toContain('feeds-artifact.schema.json')
    expect(onDisk).toContain('report.schema.json')

    const scope = docScope('artifacts', ['.schema.json'])
    const documented = unique(captures(scopeText(scope), /([a-z][a-z-]*\.schema\.json)/g)).sort()
    expect(documented, `문서 결속면(${scope.via}) — 스키마 파일 목록을 마커 구간에 적어라`).toEqual(
      EXPECTED_SCHEMA_FILES,
    )
  })

  it('PT3: 문서화된 `producer` == `payloads.mjs` 소스의 3종 (양방향)', () => {
    // 🔴 왜 지금 red 인가: README 에 producer 표지가 **한 번도 나오지 않는다**(신규 계약 9개 중 하나).
    //   아티팩트 신선도 판정이 `producer` 불일치를 stale 로 접는데, 그 어휘가 문서에 없다.
    const fromSource = captures(
      readSource('scripts/lib/payloads.mjs'),
      /export const \w*PRODUCER = '([^']+)'/g,
    ).sort()

    // 앵커: 셋이 **서로 다르다**(세 발행물이 같은 표지를 쓰면 3중 신선도가 무의미하다).
    expect(unique(fromSource)).toHaveLength(3)
    expect(fromSource).toEqual(['sas-wiki/feeds', 'sas-wiki/report', 'sas-wiki/summary'])

    const scope = docScope('artifacts', ['sas-wiki/summary', 'sas-wiki/feeds', 'sas-wiki/report'])
    const documented = unique(captures(scopeText(scope), /\b(sas-wiki\/[a-z][a-z-]*)\b/g)).sort()
    expect(documented, `문서 결속면(${scope.via})`).toEqual(fromSource)
  })

  it('PT4: 문서화된 `schemaVersion` == 소스 == 리터럴 3 (3중 대조)', () => {
    // 🔴 왜 지금 red 인가: README:282·361 의 예시 봉투가 **`"schemaVersion": 1`** 이다. 소스는 3.
    // ★ 리터럴 축이 없으면 "문서와 소스가 **함께 2로 틀린**" 상태를 통과시킨다(규범 A).
    const fromSource = captures(readSource('scripts/lib/payloads.mjs'), /SCHEMA_VERSION = (\d+)/g)
    expect(fromSource).toEqual(['3'])

    const scope = docScope('artifacts', ['schemaVersion'])
    const documented = unique(captures(scopeText(scope), /schemaVersion["`]?\s*[:=]\s*`?(\d+)/g))
    expect(documented, `문서 결속면(${scope.via})`).toEqual(['3'])
  })

  it('PT5: README 전문에 env 분리 **이전** 경로가 0회다 (팬텀 방향)', () => {
    // 🔴 왜 지금 red 인가: `cache/summary.json` **5회**(:5·:44·:50·:153·:163) + `logs/summary.report.*`
    //   계열 **2회**(:51·:153). 이것들은 P3·P5 가 env 로 갈라놓은 뒤로 **존재하지 않는 경로**다.
    // ★ 앵커가 먼저다: 새 형이 **실재해야** 한다 — 문서에서 경로 서술을 통째로 지워 통과하는 길을 막는다.
    const newForm = README.match(/cache\/summary\.(?:<env>|dev|prod)\.json/g) ?? []
    expect(newForm.length, 'env 분리 이후 경로가 README 에 한 번도 안 나온다').toBeGreaterThanOrEqual(1) // prettier-ignore

    const stale = []
    README_LINES.forEach((line, index) => {
      if (/cache\/summary\.json/.test(line)) stale.push(`README.md:${index + 1} cache/summary.json`)
      if (/logs\/summary\.report\.(?:json|txt|\*)/.test(line)) stale.push(`README.md:${index + 1} logs/summary.report.*`) // prettier-ignore
    })
    expect(stale, 'env 없는 옛 경로 서술 — 복붙하면 없는 파일을 가리킨다').toEqual([])
  })
})

// ────────────────────────────────────────────────────────────────────────────────────────────
// EN — 열거형 결속: **양방향 + 순서** (D-D 유형 2)
//
// ★ 집합 동등성만으로는 부족하다. README 가 불변식을 **번호로 상호참조**하기 때문이다
//   (_"엔드포인트는 **8번**(id 유일성)만 검사"_). 재번호매김은 그 상호참조를 **조용히** 무효화한다.
// ────────────────────────────────────────────────────────────────────────────────────────────
const EN_MARKERS = ['invariants', 'reason-codes', 'feed-ref-reasons', 'importance', 'exit-codes']

/** `invariants.mjs` 가 **실제로 방출하는** 불변식 번호(소스 텍스트에서 — import 아님). */
function emittedInvariantNumbers() {
  return unique(captures(readSource('scripts/lib/invariants.mjs'), /불변식 (\d+):/g))
    .map(Number)
    .sort((a, b) => a - b)
}

const EN_ENUM_CONTRACTS = [
  {
    documented: (scope) =>
      scope.lines
        .map((line) => line.match(/^\|\s*(\d+)\s*\|/))
        .filter(Boolean)
        .map((match) => Number(match[1])),
    expected: [1, 2, 3, 4, 5, 7, 8],
    fromCode: () => {
      const emitted = emittedInvariantNumbers()
      // 앵커 ①: 코드 집합의 크기가 7. ②: **6이 없다**(구멍이 실재한다 — 표를 7행으로 줄이는 근거).
      expect(emitted).toHaveLength(7)
      expect(emitted).not.toContain(6)
      return emitted
    },
    id: 'EN1',
    locators: ['| 1   |', '| 2   |', '| 3   |'],
    marker: 'invariants',
    title: '불변식 번호 == 방출 번호 == 리터럴 [1,2,3,4,5,7,8] (순서까지)',
  },
  {
    documented: (scope) => unique(captures(scopeText(scope), /`([A-Z][A-Z_]{3,})`/g)),
    expected: [
      'NO_FRONTMATTER',
      'MISSING_TYPE',
      'SCHEMA_VIOLATION',
      'DUPLICATE_PATH',
      'DUPLICATE_ID',
      'ID_TAMPERED',
      'DELETED_ID_REUSE',
    ],
    fromCode: () => {
      const fromSource = captures(
        readSource('scripts/lib/doc-gate.mjs').split('export function')[0],
        /'([A-Z][A-Z_]+)'/g,
      )
      // 앵커: `ID_TAMPERED`·`DELETED_ID_REUSE` 가 **마지막 두 개**다(깊은 티어 전용 순서 의미).
      expect(fromSource.slice(-2)).toEqual(['ID_TAMPERED', 'DELETED_ID_REUSE'])
      return fromSource
    },
    id: 'EN3',
    locators: ['NO_FRONTMATTER'],
    marker: 'reason-codes',
    title: 'README 제외 사유 == `doc-gate.mjs` 의 `REASON_CODES` 7종 순서 (양방향)',
  },
  {
    documented: (scope) =>
      unique(captures(scopeText(scope), /`([a-z]+(?:-[a-z]+)*)`/g)).filter(
        (token) => token.includes('-') || token === 'deleted' || token === 'unresolved',
      ),
    expected: ['deleted', 'draft-excluded', 'invalid-excluded', 'unresolved'],
    fromCode: () => {
      const fromSource = captures(
        readSource('scripts/lib/feed-survival.mjs'),
        /'([a-z][a-z-]*)'/g,
      ).slice(0, 4)
      // 앵커: `invalid-excluded` 가 포함된다 — fail-open 사유의 이름이 사라지면 극성 서술이 무너진다.
      expect(fromSource).toContain('invalid-excluded')
      return fromSource
    },
    id: 'EN4',
    locators: ['`deleted`', '`draft-excluded`', '`invalid-excluded`', '`unresolved`'],
    marker: 'feed-ref-reasons',
    title: 'README 피드 참조 생존 사유 == `FEED_REF_REASONS` 4종 순서 (양방향)',
  },
  {
    documented: (scope) => unique(captures(scopeText(scope), /`(normal|highlight|breaking|fix)`/g)),
    expected: ['normal', 'highlight', 'breaking', 'fix'],
    fromCode: () => {
      const schema = loadSchema(path.join(REPO_ROOT, 'scripts/schema/feeds.schema.json'))
      const fromSchema = schema.definitions.feedItem.properties.importance.enum
      // ★ 앵커는 **선언이 아니라 거동**이다: 검증기가 `fix` 봉투를 통과시키고 `bogus` 를 거부한다.
      const envelope = (importance) => ({
        generatedAt: '2023-11-14T22:13:20.000Z',
        inputsFingerprint: '0123456789abcdef',
        items: [{ body: '', docs: [], id: 'abcdef012345', importance, keywords: [], title: 'x', ts: '2026-01-01T00:00:00Z' }], // prettier-ignore
        nextCursor: null,
        schemaVersion: 3,
        sourceCommit: '9e0a3a0c8072f436503c5065ca4b4b863cd434fb',
      })
      expect(validateItem(envelope('fix'), schema, '$feeds')).toEqual([])
      expect(validateItem(envelope('bogus'), schema, '$feeds').length).toBeGreaterThan(0)
      return fromSchema
    },
    id: 'EN5',
    locators: ['Importance'],
    marker: 'importance',
    title: 'README `Importance` 허용값 == `feeds.schema.json` enum 4종 순서',
  },
  {
    documented: (scope) => unique(captures(scopeText(scope), /exit(?:\s+code)?\s+([1-9])/g)).sort(),
    expected: ['1', '2', '3'],
    fromCode: () => {
      const fromSource = unique(
        ['scripts/feeds.mjs', 'scripts/summary.mjs', 'scripts/validate.mjs', 'scripts/wiki.mjs']
          .map((rel) => readSource(rel))
          .flatMap((source) => captures(source, /process\.exit(?:Code)?(?:\(|\s*=\s*)(\d)/g)),
      ).sort()
      // 앵커: `2` 가 **세 엔드포인트 전부**에서 나온다(한 파일만 보고 통과하는 것 배제).
      for (const rel of ['scripts/feeds.mjs', 'scripts/summary.mjs', 'scripts/wiki.mjs']) {
        expect(readSource(rel), rel).toMatch(/process\.exitCode = 2/)
      }
      return fromSource
    },
    id: 'EN6',
    locators: ['exit '],
    marker: 'exit-codes',
    title: 'README 종료 코드 == 프로덕션 소스의 종료 코드 집합 {1,2,3}',
  },
]

describe('결속 — 열거형 (EN · D-D 유형 2 · 양방향 + 순서)', () => {
  it('EN0: 열거 마커 5종이 전부 실재하고 각 구간이 비어 있지 않다', () => {
    // 🔴 왜 지금 red 인가: 마커가 아직 없다. **arm 5개를 다 둔다** — 하나만 두면 나머지 4개가
    //   빈 집합으로 통과한다(PT0 과 동형).
    const { extractMarkerBlock } = markdownHelpers()
    const missing = EN_MARKERS.filter((name) => extractMarkerBlock(README, name) === null)
    expect(missing, 'Task 3 이 넣어야 할 결속 마커').toEqual([])

    for (const name of EN_MARKERS) {
      const block = extractMarkerBlock(README, name)
      expect(block.filter((line) => line.trim().length > 0).length, name).toBeGreaterThanOrEqual(1)
    }
  })

  it.each(EN_ENUM_CONTRACTS)(
    '$id: $title',
    ({ documented, expected, fromCode, locators, marker }) => {
      const fromCodeValues = fromCode()
      expect(fromCodeValues).toEqual(expected)

      const scope = docScope(marker, locators)
      expect(documented(scope), `문서 결속면(${scope.via})`).toEqual(expected)
    },
  )

  it('EN2: `invariants.mjs` 헤더의 "N종" == 방출 번호 개수 == README 제목의 "N종"', () => {
    // 🔴 왜 지금 red 인가: 코드 헤더도 README 제목도 **"8종"** 인데 실제 방출은 7종이다.
    // ★ 이것이 **결정 가능한 주석**의 유일한 자리다(규범 I 의 경계 사례 — 숫자는 역사 서술이 아니다).
    //   그래서 §10.1-4 의 "코드가 아니라 문서를 고친다" 규칙에서 **EN2 만 예외**다.
    const count = emittedInvariantNumbers().length
    expect(count).toBe(7)

    const inSource = captures(readSource('scripts/lib/invariants.mjs'), /불변식 (\d+)종/g)
    expect(inSource.length, '헤더 주석에 "불변식 N종" 서술이 있다').toBeGreaterThanOrEqual(1)
    expect(unique(inSource)).toEqual([String(count)])

    const inReadme = captures(README, /^#{2,4}\s+불변식 (\d+)종\s*$/gm)
    expect(inReadme).toEqual([String(count)])
  })

  it('EN7: README `--env` 허용값이 dev·prod 2종이고 fail-closed 를 서술한다 (pin)', () => {
    // ✅ 오늘도 green(README:141·149). 누출 방어선의 **문서면**이다 — 거동은 `cli.env-enum.test.mjs`
    //   가 이미 문다(여기서 거동을 재검증하지 않는다 — 층을 섞지 않는다, §7.5).
    const envRow = README_LINES.find((line) => line.includes('`--env`') && line.includes('|'))
    expect(envRow, 'README 공통 계약 표에 `--env` 행이 있다').toBeDefined()
    expect(unique(captures(envRow, /`(dev|prod)`/g)).toSorted()).toEqual(['dev', 'prod'])

    expect(README).toMatch(/fail-closed/)
    expect(README).toMatch(/생략하면 `prod`|미지정 시 prod|미지정.*prod/)
  })
})

// ────────────────────────────────────────────────────────────────────────────────────────────
// LB — 경고 라벨 어휘 (D-D 유형 3) · **실측 드리프트의 진앙**
//
// ★ plan 리서치 (나)의 이 리포 실물 사례: ESLint `checkRuleFiles` 는 **단방향**이라 고아 문서를 못
//   잡고, rustc `tidy` 는 그 약점 때문에 stage 4(_"error code E0999 exists, but is not emitted"_)까지
//   증축했다. 여기 `off-convention` 팬텀이 정확히 그 결함이다.
// ────────────────────────────────────────────────────────────────────────────────────────────
const EXPECTED_LABELS = ['deadlink', 'unpublished-feed', 'unresolved', 'warning']
const PHANTOM_LABEL = 'off-convention'
const LABEL_RE = /\[wiki\]\s+([a-z][a-z-]*):/g

const labelsIn = (source) => unique(captures(source, LABEL_RE)).sort()

function withMissingDeadlinkLabelFixture(callback) {
  const vault = initVault()
  try {
    const original = readSource('scripts/validate.mjs')
    const mutated = original
      .split('\n')
      .filter((line) => !line.includes('[wiki]   deadlink:'))
      .join('\n')
    const copy = path.join(vault, 'validate.copy.mjs')
    writeFileSync(copy, mutated, 'utf8')
    return callback({ copy, original })
  } finally {
    cleanup(vault)
  }
}

describe('결속 — 경고 라벨 어휘 (LB · D-D 유형 3)', () => {
  it('LB0: `validate.mjs` 소스에서 뽑은 라벨 집합이 비어 있지 않다 (pair · H3)', () => {
    // 추출 정규식이 안 맞아 빈 집합이 되면 LB1 이 `∅ == ∅` 로 통과한다. 그 구멍을 먼저 막는다.
    expect(labelsIn(readSource('scripts/validate.mjs')).length).toBeGreaterThanOrEqual(1)
  })

  it('LB1: 코드 라벨 == README 라벨 == 리터럴 4종 (양방향)', () => {
    // 🔴 왜 지금 red 인가: 코드는 **4종**을 방출하는데(`unresolved:`·`unpublished-feed:`·`deadlink:`·
    //   `warning:`) README:242 는 **`off-convention:` + `warning:`** 만 적는다 — **팬텀 1 · 누락 3**.
    //   단방향 검사로는 절반을 놓친다: 포함만 보면 팬텀을 못 잡고, 팬텀만 보면 누락을 못 잡는다.
    const fromSource = labelsIn(readSource('scripts/validate.mjs'))
    expect(fromSource).toEqual(EXPECTED_LABELS)

    const scope = docScope('warning-labels', ['[wiki]   '])
    expect(labelsIn(scopeText(scope)), `문서 결속면(${scope.via})`).toEqual(EXPECTED_LABELS)
  })

  it('LB2: 팬텀 라벨 `off-convention` 이 프로덕션 0회 · README 0회다', () => {
    // 🔴 왜 지금 red 인가: README **2지점**(:242 라벨 예시 · :528 동작 서술). ★ :528 은 _"어느 것도
    //   아니면 `off-convention` 으로 집계된다"_ 인데 **그 집계 자체를 P2 가 제거**했다 —
    //   라벨 토큰만 지우고 문장을 남기면 **여전히 거짓**이다(원장 ⑬: 문장 전체 삭제).
    // ★ 앵커 먼저(규범 B): 실제 라벨 4종이 프로덕션에 각 ≥1회 — 추출·grep 이 죽어서 0인 것을 배제.
    const validateSource = readSource('scripts/validate.mjs')
    for (const label of EXPECTED_LABELS) {
      expect(validateSource, label).toContain(`[wiki]   ${label}:`)
    }

    const production = ['scripts/feeds.mjs', 'scripts/summary.mjs', 'scripts/validate.mjs', 'scripts/wiki.mjs'] // prettier-ignore
    for (const rel of production) {
      expect(readSource(rel), `${rel}: 팬텀 라벨`).not.toContain(PHANTOM_LABEL)
    }

    const phantomLines = README_LINES.map((line, index) => (line.includes(PHANTOM_LABEL) ? `README.md:${index + 1}` : null)).filter(Boolean) // prettier-ignore
    expect(phantomLines, '프로덕션이 한 번도 내지 않는 라벨을 문서가 안내한다').toEqual([])
  })

  it('LB3: 라벨 추출기의 감도 — 소스에서 1종을 지우면 3종이 된다 (H8)', () => {
    // ★ Semgrep 은 룰마다 **true positive + true negative 둘 다** 요구한다. 이것이 없으면 LB1 은
    //   "항상 같은 상수 두 개를 비교" 하는 케이스일 수 있다 — 감도가 0이어도 green 이다.
    // ★ **실 소스를 조작하지 않는다**(규범 F): tmp 사본에서만 변이한다.
    withMissingDeadlinkLabelFixture(({ copy, original }) => {
      const after = labelsIn(readFileSync(copy, 'utf8'))
      expect(after).toEqual(['unpublished-feed', 'unresolved', 'warning'])
      expect(after).not.toContain('deadlink')
      // 앵커: 원본은 여전히 4종이다(변이가 원본을 건드리지 않았다).
      expect(labelsIn(original)).toEqual(EXPECTED_LABELS)
    })
  })
})

// ────────────────────────────────────────────────────────────────────────────────────────────
// SQ — 요약 줄 필드 시퀀스 (D-D 유형 4) · **키·순서만 문다. 값은 안 문다.**
// ────────────────────────────────────────────────────────────────────────────────────────────
const EXPECTED_SUMMARY_KEYS = ['docs', 'body', 'feeds', 'prune', 'prunedFeeds', 'unresolved', 'warnings'] // prettier-ignore

/** `reportStats` 템플릿의 키 시퀀스(소스 텍스트) — 함수 밖 `key=` 표기를 주워 담지 않게 구간을 자른다. */
function reportStatsKeys() {
  const source = readSource('scripts/validate.mjs')
  const start = source.indexOf('function reportStats')
  return captures(source.slice(start, source.indexOf('\n}', start)), /(\w+)=\$\{/g)
}

describe('결속 — 요약 줄 필드 시퀀스 (SQ · D-D 유형 4)', () => {
  it('SQ0: `reportStats` 템플릿에서 뽑은 키 시퀀스 길이가 7이다 (pair)', () => {
    // 파서가 죽으면 SQ1 이 공허하다. 추출 자체의 비공허성을 먼저 못박는다.
    expect(reportStatsKeys()).toHaveLength(7)
  })

  it('SQ1: README 예시 요약 줄의 키 시퀀스 == 소스 == 리터럴 (값은 안 문다) (pin)', () => {
    // ✅ 오늘도 green. ★ **값은 결속하지 않는다** — vault 상태에 따라 달라지고 README 스스로 그것을
    //   면책한다(:244). 실제로 지금 README 예시는 `feeds=5 prunedFeeds=1` 인데 실측은
    //   `feeds=6 prunedFeeds=0` 이다. 그 차이는 **결함이 아니라 데이터**다(그래서 SQ2 가 면책 문장을
    //   pin 한다). 키와 순서는 **계약**이므로 문다.
    const fromSource = reportStatsKeys()
    expect(fromSource).toEqual(EXPECTED_SUMMARY_KEYS)

    const exampleLine = README_LINES.find((line) => /^\[wiki\] docs=/.test(line.trim()))
    expect(exampleLine, 'README 에 요약 줄 예시가 있다').toBeDefined()
    expect(captures(exampleLine, /(\w+)=/g)).toEqual(EXPECTED_SUMMARY_KEYS)
  })

  it('SQ2: README 가 "값은 vault 에 따라 달라진다" 면책을 예시와 같은 절에 담는다 (pin)', () => {
    // ✅ 오늘도 green(:244). ★ 이 문장이 사라지면 SQ1 의 "값 불결속" 결정이 **문서에서 근거를 잃는다**
    //   — 그러면 다음 사람이 값까지 결속하려 들고, 그 순간 가드가 vault 데이터에 묶여 부서진다.
    const exampleIndex = README_LINES.findIndex((line) => /^\[wiki\] docs=/.test(line.trim()))
    const disclaimerIndex = README_LINES.findIndex((line) => /vault 상태에 따라 달라진다/.test(line)) // prettier-ignore
    expect(exampleIndex).toBeGreaterThanOrEqual(0)
    expect(disclaimerIndex).toBeGreaterThanOrEqual(0)

    // 같은 절 = 예시와 면책 사이에 heading 이 없다.
    const between = README_LINES.slice(
      Math.min(exampleIndex, disclaimerIndex),
      Math.max(exampleIndex, disclaimerIndex),
    )
    expect(between.filter((line) => /^#{1,6}\s+/.test(line))).toEqual([])
  })
})
