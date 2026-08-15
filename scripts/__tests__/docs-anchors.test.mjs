// @vitest-environment node
//
// P6 · README 절간 앵커 정합 (AC0~AC7) — tdd §3.6 · plan Task 3 · R-4·R-5b
//
// ── 왜 이 가드가 **Task 3 보다 먼저** 서야 하는가 (착륙 순서가 계약이다) ───────────────────
// README 제목 `### 불변식 8종` 을 `7종` 으로 바꾸는 순간 `](#불변식-8종)` 링크 **5개**가 동시에
// 깨진다(실측 :98·:234·:256·:266·:395). 마크다운 앵커는 **깨져도 아무 도구가 red 를 내지 않는다** —
// 클릭하면 아무 데도 가지 않을 뿐이다. 그래서 §5.1 [3] 은 "AC 가드가 green 임을 확인한 **뒤에**
// README 를 뜯는다" 를 순서로 못박았다. 그물을 치고 나서 지붕을 뜯는다.
//
// ── ★ 프로덕션 슬러거를 **쓰지 않는다** (R-4 가 경고한 거짓양성의 정체) ────────────────────
// 가장 자연스러운 오구현은 "이미 리포에 슬러거가 있으니 그걸 쓰자"(`parse.mjs:slugifyHeading`)다.
// 그것은 위키링크 앵커용이고 `-+ → -` 축약이 있어 GitHub 과 **8개 heading 에서 갈린다**. 특히 현
// README 에 **실재하는 링크 `#dev--prod`(2건)를 MISS 로 오판**한다 — 즉 그 선택은 가드를 세우자마자
// 거짓양성 2건을 만든다. **AC3 이 그 차이를 계약으로 못박는다**(주석이 아니라 실행되는 단언이라야
// 다음 사람이 "왜 또 만들었나" 며 되돌리지 못한다).
//
// ── 방향(규범 K) ────────────────────────────────────────────────────────────────────────────
// AC1 은 **단방향**이다 — 링크 → heading 만 본다. 고아 heading(링크가 없는 절)은 정상이므로 반대
// 방향은 의미가 없다(억지로 만들면 "모든 절에 링크를 달아라" 가 된다). 그 대신 **슬러거 자신의
// 감도**(AC2·AC3)와 **입력 위생**(AC4·AC5·AC6)이 짝이다.
//
// ── RED/green 현황 (작성 시점 실측) ────────────────────────────────────────────────────────
//   AC0·AC1·AC3·AC4·AC6·AC7  pin  — **지금도 green**(깨진 앵커 0 · heading 36 전부 유일).
//   AC2·AC5                        헬퍼가 생기는 순간 green — 슬러거·펜스 처리의 **감도 증명**이 본분.
//   ★ CX-6I(제목만 바꾸고 링크 5개는 안 고침) · CX-6J(프로덕션 슬러거로 교체)가 물림을 증명한다.
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

// ★ 유일하게 프로덕션 슬러거를 부르는 자리 — **쓰기 위해서가 아니라 다름을 관측하기 위해서**다(AC3).
import { slugifyHeading } from '../lib/parse.mjs'

// 규범 C10 — 헬퍼 부재를 collection error 가 아니라 케이스 실패로 만든다(§7.3).
const slugModule = await import(new URL('./helpers/github-slug.mjs', import.meta.url).href).then(
  (module) => module,
  (error) => ({ loadError: error }),
)

function anchors() {
  if (slugModule.loadError) throw slugModule.loadError
  return slugModule
}

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, '..', '..')
const README_PATH = path.join(REPO_ROOT, 'README.md')

const readReadme = () => anchors().readMarkdown(README_PATH)

/**
 * ★ AC2 의 리터럴 코퍼스. **프로덕션에서 유도하지 않는다**(규범 A) — 유도하면 슬러거가 틀려도
 * 기대가 함께 틀린다.
 *
 * `expected: null` = **`TODO: 사용자 확인`**. 그 문자의 GitHub 처리를 우리가 검증하지 못했고
 * (현재 링크 대상이 아니다) 추측으로 기대를 채우지 않는다 — 소유는 **P4 H6-1**(GitHub 실렌더 육안)
 * 이다. 값을 단언하지 않되 **코퍼스에는 남긴다**: 언젠가 그 문자가 링크 대상이 되면 여기가 출발점이다.
 *
 * ★ `expected: null` 항목도 `pin` 은 갖는다 — **오늘 `githubSlug()` 가 실제로 내는 값**의 회귀
 * 방지용이다(GitHub 이 진짜 그 값으로 렌더한다는 보증은 아니다). 이 pin 이 없으면 이 세 항목은
 * `githubSlug(text) === githubSlug(text)` 라는 자기비교만 남아 — 슬러거가 이 문자들에서 깨져도
 * (예: 빈 문자열·예외·다른 문자로 치환) 조용히 통과한다.
 */
const SLUG_CORPUS = [
  { expected: 'dev--prod', note: '★ README 에 실재하는 링크 `#dev--prod`(2건)가 이 값을 검증한다', text: 'dev / prod' }, // prettier-ignore
  { expected: '불변식-8종', note: '한글 + 숫자 — 링크 5건이 걸려 있다', text: '불변식 8종' },
  { expected: 'feeds', note: '구두점 없는 단일 토큰', text: 'feeds' },
  { expected: '게이트는-언제-도는가', note: '공백 1자 → 하이픈 1개', text: '게이트는 언제 도는가' },
  { expected: 'sas-wiki', note: '하이픈은 **보존**된다(축약 금지)', text: 'sas-wiki' },
  { expected: null, note: 'TODO: 사용자 확인 — U+2014 em dash. 현재 링크 대상 아님(P4 H6-1)', pin: '문서--위키의-단위', text: '문서 — 위키의 단위' }, // prettier-ignore
  { expected: null, note: 'TODO: 사용자 확인 — U+003D. 현재 링크 대상 아님(P4 H6-1)', pin: '각주--출처', text: '각주 = 출처' }, // prettier-ignore
  { expected: null, note: 'TODO: 사용자 확인 — U+2192. GitHub 정규식 범위 미확인(P4 H6-1)', pin: 'feed-커밋-메시지--피드-필드', text: 'feed 커밋 메시지 → 피드 필드' }, // prettier-ignore
]

/** ★ AC6 의 allowlist — 현 README heading 에 실제로 등장하는 구두점 **전수**(실측 5종). */
const HEADING_PUNCTUATION_ALLOWLIST = ['-', '—', '=', '→', '/']

describe('README 앵커 — 코퍼스 비공허 (AC0 · H3)', () => {
  it('AC0: 링크와 heading 이 실제로 파싱됐다', () => {
    // 하한은 **리터럴**이다(실측 heading 36 · 링크 15 · distinct 9). 파서가 죽으면 AC1 이
    //   "0개 링크가 전부 해석됐다" 로 **조용히 통과**한다 — 부재 가드의 전형적 공허다.
    const { extractAnchorLinks, extractHeadings } = anchors()
    expect(typeof extractHeadings).toBe('function')

    const markdown = readReadme()
    expect(extractHeadings(markdown).length).toBeGreaterThanOrEqual(30)
    expect(new Set(extractAnchorLinks(markdown)).size).toBeGreaterThanOrEqual(9)
  })
})

describe('README 앵커 — 링크가 전부 절에 닿는다 (AC1 pin · CX-6I)', () => {
  it('AC1: 모든 `](#slug)` 가 heading slug 집합에 있다', () => {
    // ✅ 오늘도 green(깨진 앵커 0 — 실측). **Task 3 전면 개정의 안전망**이다.
    // ★ 실패 메시지가 링크·슬러그·근접 후보를 담는다(H9) — "어디가 깨졌나" 를 찾느라 README 를
    //   훑게 만들면 구현자는 가드를 끄는 쪽을 고른다.
    const { extractAnchorLinks, extractHeadings, githubSlug } = anchors()
    const markdown = readReadme()
    const slugs = extractHeadings(markdown).map((heading) => githubSlug(heading))
    const known = new Set(slugs)

    const missing = [...new Set(extractAnchorLinks(markdown))]
      .filter((slug) => !known.has(slug))
      .map((slug) => {
        const near = slugs.filter((candidate) => candidate.includes(slug.split('-')[0]))
        return `](#${slug}) → 없음. 근접 후보: ${near.length > 0 ? near.join(', ') : '없음'}`
      })

    expect(
      missing,
      '깨진 절간 링크 — 제목을 바꿨으면 그 제목을 가리키는 링크도 **같은 커밋에서** 고쳐라.\n' +
        '  (실측: `### 불변식 8종` 제목 한 줄이 링크 5개를 동시에 물고 있다)',
    ).toEqual([])
  })
})

describe('슬러거 감도 — 리터럴 코퍼스 (AC2 · H8)', () => {
  it('AC2: 알려진 heading 이 알려진 slug 로 간다(검증 불가 문자는 단언하지 않는다)', () => {
    const { githubSlug } = anchors()

    // 앵커: 값이 검증된 항목이 **4개 이상**이다(코퍼스가 TODO 만 남아 공허해지는 것을 배제).
    const asserted = SLUG_CORPUS.filter((entry) => entry.expected !== null)
    expect(asserted.length).toBeGreaterThanOrEqual(4)

    for (const entry of asserted) {
      expect(githubSlug(entry.text), `${entry.text} — ${entry.note}`).toBe(entry.expected)
    }

    // `TODO: 사용자 확인` 항목: GitHub 실렌더 값은 단언하지 않는다(그 판정은 P4 H6-1 소유). 대신
    //   **오늘의 근사 출력을 pin** 한다 — `githubSlug(text) === githubSlug(text)` 같은 자기비교는
    //   슬러거가 이 문자에서 깨져도(예외·빈 문자열·다른 치환) 조용히 통과한다.
    for (const entry of SLUG_CORPUS.filter((item) => item.expected === null)) {
      expect(githubSlug(entry.text), entry.note).toBe(entry.pin)
      expect(entry.note).toMatch(/TODO: 사용자 확인/)
    }
  })
})

describe('슬러거 오용 배제 — 프로덕션 슬러거는 답이 다르다 (AC3 pin · CX-6J)', () => {
  it('AC3: `parse.mjs:slugifyHeading` 은 `dev / prod` 를 다르게 슬러그한다', () => {
    // ✅ 오늘도 green. ★ **R-4 가 경고한 "거짓양성 2건" 의 정체를 계약으로 못박는다.**
    //   프로덕션 슬러거는 `-+ → -` 축약이 있어 `dev--prod` 를 `dev-prod` 로 만든다. 그것으로 앵커를
    //   검사하면 README 에 **실재하는** 링크 `#dev--prod` 2건이 MISS 로 뜬다 — 문서는 멀쩡한데
    //   가드가 거짓말을 하는 상태다. 그때 사람이 고르는 것은 대개 "가드를 끈다" 이다.
    const { extractHeadings, githubSlug } = anchors()

    // ★ `slugifyHeading` 의 **정확한 출력값**은 여기서 pin 하지 않는다 — 그 함수는 우리가 소유하지
    //   않는 프로덕션 위키링크 슬러거다. 값을 pin 하면 그 함수가 (이 파일과 무관한 이유로) 개선되는
    //   순간 이 케이스가 역방향으로 깨진다(역방향 결합). 대신 **우리가 소유한 `githubSlug` 의 값**과
    //   **둘이 다르다는 사실**만 문다 — 그것이 "프로덕션 슬러거를 앵커 검사에 쓰지 마라"는 AC3 의
    //   실제 계약이다. 두 슬러거가 언젠가 이 입력에서 일치하게 되면(즉 `slugifyHeading` 이 GitHub 과
    //   같은 결과를 내도록 고쳐지면) 이 단언이 **의도대로** red 가 되어 그 사실을 알린다.
    expect(githubSlug('dev / prod')).toBe('dev--prod')
    expect(slugifyHeading('dev / prod')).not.toBe(githubSlug('dev / prod'))

    // 앵커: 그 차이가 **실제 README 에서 오판을 만든다**(이론적 차이가 아니라 관측된 결함이다).
    const markdown = readReadme()
    const productionSlugs = new Set(extractHeadings(markdown).map((h) => slugifyHeading(h)))
    expect(markdown).toContain('](#dev--prod)')
    expect(productionSlugs.has('dev--prod')).toBe(false)
  })
})

describe('앵커 입력 위생 (AC4·AC5·AC6)', () => {
  it('AC4: heading 텍스트가 전부 유일하다 (pin)', () => {
    // ✅ 오늘도 green(36/36). 중복이면 GitHub 이 `-1` 접미사를 붙여 slug 가 갈린다 — 우리 근사는
    //   그 접미사를 만들지 않으므로 **중복 heading 이 생기는 순간 근사가 틀려진다**.
    //   (같은 문제를 프로덕션은 `withDedupSuffix` 로 푼다 — 여기서는 **금지**로 푼다.)
    const { extractHeadings } = anchors()
    const headings = extractHeadings(readReadme())

    expect(headings.length).toBeGreaterThanOrEqual(30)
    const duplicates = headings.filter((heading, index) => headings.indexOf(heading) !== index)
    expect(duplicates, 'heading 중복 — GitHub 은 두 번째부터 `-1` 접미사를 붙인다').toEqual([])
  })

  it('AC5: 코드펜스 안의 `#` 줄을 heading 으로 세지 않는다', () => {
    // ★ 앵커가 실재한다: `README.md:189` 에 bash 주석 `# 1페이지 → items: …` 가 **실제로 있다**.
    //   펜스를 안 보면 heading 수가 부풀고 slug 집합이 오염되어 AC1 이 조용히 넓어진다.
    const { extractHeadings } = anchors()
    const markdown = readReadme()

    const fenceBlind = markdown.split('\n').filter((line) => /^#{1,6}\s+/.test(line)).length
    const parsed = extractHeadings(markdown).length

    expect(parsed).toBeLessThan(fenceBlind)
    // 리터럴 코퍼스로 감도를 직접 보인다(실 README 수치에 의존하지 않는 true positive/negative).
    expect(extractHeadings('# 진짜\n\n```bash\n# 가짜 주석\n```\n\n## 진짜2\n')).toEqual([
      '진짜',
      '진짜2',
    ])
  })

  it('AC6: heading 구두점이 allowlist 5종을 넘지 않는다 (pin)', () => {
    // ✅ 오늘도 green(실측 정확히 5종). ★ **OQ-P6-2 = b(자작 슬러거)의 미래 방어**다 — 새 구두점이
    //   들어오면 근사가 갈릴 수 있는데, 그때 **조용히 통과하지 않고 red** 가 난다(실패 방향이 안전).
    const { extractHeadings } = anchors()
    const used = new Set()
    for (const heading of extractHeadings(readReadme())) {
      for (const char of heading) {
        if (!/[\p{L}\p{N}\s]/u.test(char)) used.add(char)
      }
    }

    expect(used.size).toBeGreaterThan(0) // 앵커: 구두점이 실제로 있다(빈 집합의 공허한 통과 배제)
    const unknown = [...used].filter((char) => !HEADING_PUNCTUATION_ALLOWLIST.includes(char))
    expect(
      unknown,
      `heading 에 새 구두점 ${unknown.map((c) => JSON.stringify(c)).join(', ')} 이 들어왔다.\n` +
        '  → AC2 코퍼스에 그 문자를 추가하고, GitHub 실렌더에서 링크가 실제로 점프하는지\n' +
        '     육안 확인하라(P4 H6-1). 확인 전에는 `expected: null`(TODO: 사용자 확인)로 둔다.',
    ).toEqual([])
  })

  it('AC7: 외부 링크(`](http…`)는 검사 대상이 아니다 (pin · 범위 못)', () => {
    // ★ 다음 사람이 "왜 외부 링크는 안 보나" 로 범위를 넓히는 것을 막는다 — 네트워크 의존은
    //   비결정적이고 느리며, 이 가드의 주제(문서 내부 정합)와 축이 다르다. 결정을 **주석이 아니라
    //   실행되는 단언**으로 남긴다.
    const { extractAnchorLinks } = anchors()

    expect(extractAnchorLinks('[안](#내부-절) 과 [밖](https://example.com/#조각)')).toEqual([
      '내부-절',
    ])
    expect(extractAnchorLinks('[문서](./OTHER.md)')).toEqual([])
  })
})
