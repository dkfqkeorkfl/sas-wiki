import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { feedsArtifactPath, reportPath } from '../lib/artifact.mjs'
import { loadSchema, validateItem } from '../lib/schema-validator.mjs'
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
const readSource = (rel) => readFileSync(path.join(REPO_ROOT, rel), 'utf8')
const unique = (values) => [...new Set(values)]
const captures = (text, pattern) => [...text.matchAll(pattern)].map((match) => match[1])
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
const ENV_PLACEHOLDER = '<env>'
const EXPECTED_ARTIFACT_PATHS = [
  'cache/feeds.<env>.json',
  'cache/summary.<env>.json',
  'logs/summary.report.<env>.json',
  'logs/summary.report.<env>.txt',
]
const EXPECTED_SCHEMA_FILES = [
  'body.schema.json',
  'feeds.schema.json',
  'ignore-feeds.schema.json',
  'report.schema.json',
  'summary.schema.json',
  'wiki-doc.schema.json',
]
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
const EN_MARKERS = ['feed-ref-reasons', 'importance', 'exit-codes']

const EN_ENUM_CONTRACTS = [
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
        // v3 P2 · D22 — wire 봉투에 `env` 가 남는다(캐시 최소 검증의 유일한 판별축).
        env: 'dev',
        generatedAt: '2023-11-14T22:13:20.000Z',
        items: [{ body: '', docs: [], id: 'abcdef012345', importance, keywords: [], title: 'x', ts: '2026-01-01T00:00:00Z' }], // prettier-ignore
        nextCursor: null,
        // v3 P1 · D29 — 계약 번호 리셋(§4.3 ②). 스키마는 값을 pin 하지 않는다(`minimum: 1`).
        schemaVersion: 1,
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
    expected: ['1', '2'],
    fromCode: () => {
      const fromSource = unique(
        ['scripts/feeds.mjs', 'scripts/summary.mjs', 'scripts/wiki.mjs']
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
describe('결속 — 산출물 경로·봉투 (PT · D-D 유형 1)', () => {
  it('PT0: README 에 `contract:artifacts` 마커가 열림/닫힘 각 1개이고 구간이 비어 있지 않다', () => {
    // 🔴 왜 지금 red 인가: 마커가 **아직 없다**(Task 3 이 넣는다). 이 케이스가 없으면 이하 결속이
    //   전부 "빈 구간 vs 빈 집합" 으로 **조용히 통과**한다 — 규범 I 부속 규칙의 심장이다.
    const { extractMarkerBlock } = markdownHelpers()
    const block = extractMarkerBlock(README, 'artifacts')

    expect(block, 'README 에 `<!-- contract:artifacts -->` … `<!-- /contract:artifacts -->` 를 넣어라').not.toBeNull() // prettier-ignore
    expect(documentedArtifactPaths({ lines: block })).toHaveLength(4)
  })

  it('PT1: 문서화된 산출물 경로 == 경로 헬퍼 3종 + summary 리터럴 == 리터럴 (양방향)', () => {
    // 🔴 왜 지금 red 인가: README 는 env 분리 **이전** 경로를 말한다 — `cache/summary.json`(5회) ·
    //   `logs/summary.report.*`. 실제 계약은 `cache/summary.<env>.json` · **`cache/feeds.<env>.json`**
    //   (신규) · `logs/summary.report.<env>.{json,txt}` 다. GREEN: 원장 ⑭ 의 7지점을 마커 구간으로.
    //
    // ★ v3 P4 · D27(tdd §4.3) — **축 교체**. summary 원소는 `artifact.mjs` 의 `artifactPath()` 에서
    //   왔었으나 그 함수가 **사라졌다**(경로를 파생하던 유일한 프로덕션 호출자 `wiki.mjs` 가
    //   `--summary` 명시 인자로 바뀌었다). 「코드가 그 경로를 소유한다」는 축은 여기서 사라지고
    //   **리터럴 조립**(규범 A)으로 대체된다 — 그 자리는 **실행 층**(`PL10` · `summary.artifact.test.mjs`)
    //   이 진다. ★ README 표(`:62-70`)는 **무변경**이다: 그 경로는 여전히 발행되며
    //   `package.json` 의 `build`·`build-dev` 가 `--out` 으로 넘긴다.
    const fromCode = [
      path.join('/v', 'cache', `summary.${ENV_PLACEHOLDER}.json`),
      feedsArtifactPath('/v', ENV_PLACEHOLDER),
      reportPath('/v', ENV_PLACEHOLDER, 'json'),
      reportPath('/v', ENV_PLACEHOLDER, 'txt'),
    ]
      .map((full) => path.relative('/v', full))
      .sort()

    // 앵커: 4개가 **서로 다르다**(한 함수가 같은 값을 4번 내는 것을 배제).
    expect(unique(fromCode)).toHaveLength(4)
    expect(fromCode).toEqual(EXPECTED_ARTIFACT_PATHS)

    const scope = docScope('artifacts', ['cache/', 'logs/summary.report'])
    expect(documentedArtifactPaths(scope), `문서 결속면(${scope.via})`).toEqual(
      EXPECTED_ARTIFACT_PATHS,
    )
  })

  it('PT2: 문서화된 스키마 파일 목록 == `scripts/schema/*.json` **6종** (양방향 · 🔴RED(flip) v3 P2)', () => {
    // 🔴 왜 지금 red 인가(v3 P2 · OQ-P2-5 (a)): `feeds-artifact.schema.json` 이 **아직 디스크에 있다**.
    //   그 파일은 `feeds.schema.json` 과 동형이 되는 순간 「합치지 않은 이유」를 설명할 수 없어 폐지된다.
    const onDisk = readdirSync(path.join(REPO_ROOT, 'scripts/schema'))
      .filter((name) => name.endsWith('.json'))
      .sort()

    // 앵커: 디스크 목록이 비어 있지 않고, 살아남는 2종이 **둘 다** 있다(리터럴 대조).
    expect(onDisk).toHaveLength(EXPECTED_SCHEMA_FILES.length) // 규범 N
    expect(onDisk).toEqual(EXPECTED_SCHEMA_FILES)
    expect(onDisk).toContain('feeds.schema.json')
    expect(onDisk).toContain('report.schema.json')
    expect(onDisk, 'feeds-artifact.schema.json 이 아직 살아 있다').not.toContain('feeds-artifact.schema.json') // prettier-ignore

    const scope = docScope('artifacts', ['.schema.json'])
    const documented = unique(captures(scopeText(scope), /([a-z][a-z-]*\.schema\.json)/g)).sort()
    expect(documented, `문서 결속면(${scope.via}) — 스키마 파일 목록을 마커 구간에 적어라`).toEqual(
      EXPECTED_SCHEMA_FILES,
    )
  })

  it('PT4(=CV1·CV2): 문서화된 `schemaVersion` == 소스 == 리터럴 1 (3중 대조)', () => {
    // 🔴 왜 지금 red 인가(v3 P1 · D29 · §4.3 ②·④): 내부 wire 계약 번호를 **1 로 리셋**한다. 소스는
    //   아직 3이고 README 서술도 3이다 — 둘이 **함께** 내려와야 이 케이스가 green 이 된다.
    // ★ 리터럴 축이 없으면 "문서와 소스가 **함께 틀린**" 상태를 통과시킨다(규범 A).
    const fromSource = captures(readSource('scripts/lib/payloads.mjs'), /SCHEMA_VERSION = (\d+)/g)
    // 앵커: 추출 결과가 **정확히 1건**이다(정규식이 죽어 빈 배열이 된 채 통과하는 것을 배제).
    expect(fromSource).toHaveLength(1)
    expect(fromSource).toEqual(['1'])

    const scope = docScope('artifacts', ['schemaVersion'])
    const documented = unique(captures(scopeText(scope), /schemaVersion["`]?\s*[:=]\s*`?(\d+)/g))
    expect(documented, `문서 결속면(${scope.via})`).toEqual(['1'])
  })

  it('CV3: README 「계약 버전의 의미」 절에 **뒤집힌 발동 조건 문장이 없다**', () => {
    // 🔴 왜 지금 red 인가: README 가 _"첫 소비자가 붙는 시점에"_ 리셋한다고 적는다 — **D29 는 그
    //   전에, 지금** 리셋한다. 발동 조건이 정반대라 그대로 두면 문서가 결정을 거스른다(D42 대상).
    // ★ 규범 I — 산문은 결속하지 않는다. 여기서 무는 것은 **이 한 토큰**뿐이고, 절의 나머지 서술은
    //   §4 원장과 리뷰가 진다.
    const start = README_LINES.findIndex((line) => /^#+\s*계약 버전의 의미/.test(line))
    const rest = README_LINES.slice(start + 1)
    const end = rest.findIndex((line) => /^#{1,4}\s/.test(line))
    const section = rest.slice(0, end === -1 ? rest.length : end).join('\n')

    // 앵커: 그 절이 **실제로 파싱됐다**(못 찾아서 빈 문자열로 통과하는 것을 배제).
    expect(start, 'README 「계약 버전의 의미」 절 제목을 찾지 못했다').toBeGreaterThan(-1)
    expect(section.trim().length, '절 본문이 비었다').toBeGreaterThan(0)

    expect(section, '뒤집힌 발동 조건 서술이 남아 있다').not.toContain('첫 소비자가 붙는 시점에')
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

  it('EN7: README `--env` 허용값이 dev·prod 2종이고 fail-closed 를 서술한다 (pin)', () => {
    // ✅ 오늘도 green(README:141·149). 누출 방어선의 **문서면**이다 — 거동은 `cli.env-enum.test.mjs`
    //   가 이미 문다(여기서 거동을 재검증하지 않는다 — 층을 섞지 않는다, §7.5).
    const envRow = README_LINES.find((line) => line.includes('`--env`') && line.includes('|'))
    expect(envRow, 'README 공통 계약 표에 `--env` 행이 있다').toBeDefined()
    expect(unique(captures(envRow, /`(dev|prod)`/g)).toSorted()).toEqual(['dev', 'prod'])

    // ★ `--env` 가 fail-closed 라는 서술은 **`### 공통 계약` 절 안**에서 찾는다 — README 전문
    //   검색은 무관한 절의 우연한 재사용(예: `draft-excluded` 사유표의 "fail-closed 가 우선")만으로도
    //   채워져, `--env` 자신의 설명이 지워져도 조용히 통과한다.
    const start = README_LINES.findIndex((line) => line.trim() === '### 공통 계약')
    expect(start, 'README `### 공통 계약` 절 제목을 찾지 못했다').toBeGreaterThanOrEqual(0)
    const rest = README_LINES.slice(start + 1)
    const end = rest.findIndex((line) => /^#{1,6}\s/.test(line))
    const scope = (end === -1 ? rest : rest.slice(0, end)).join('\n')
    expect(scope.trim().length, '`### 공통 계약` 절 본문이 비었다').toBeGreaterThan(0)

    expect(scope).toMatch(/fail-closed/)
    expect(scope).toMatch(/생략하면 `prod`|미지정 시 prod|미지정.*prod/)
  })
})
