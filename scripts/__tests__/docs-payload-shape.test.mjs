// @vitest-environment node
//
// fix(audit) · README 「반환 데이터형」 ↔ wire 계약 결속 — 봉투 키(SP·FP·WP) · 죽은 앵커(AN) ·
//              매핑표(MP) · 죽은 불변식 참조(IV)
//
// ── 무엇이 틀렸나 (사후 감사 · P1~P6 종료 후) ────────────────────────────────────────────────
// README `## 반환 데이터형` 은 서두에서 _"예시는 이 리포의 예제 vault 를 `--env dev` 로 돌린 **실제
// 출력**"_ 이라고 **선언한다**. 그 선언이 거짓이다 — P2~P5 가 wire 계약을 세 번 바꾸는 동안 이 절만
// 갱신되지 않았다. 실측(`node scripts/summary.mjs --env dev` · `node scripts/feeds.mjs
// --env dev` · `node scripts/wiki.mjs --env dev --path "company/삼성전자"`):
//   ① summary 예시 `schemaVersion: 1` → 실제 **3**            (SP2)
//   ② summary 예시·표가 6키 → 실제 7키(`env` 누락)  (SP1·SP3)
//   ④ feeds 예시 `schemaVersion: 1` → 실제 **3**              (FP2)
//   ⑤ feeds 예시와 스키마 required 집합이 어긋난다 (FP1)
//   ⑥⑦⑧ `docs[]` 의 `anchor`·`anchorText` — P2(D10)가 제거한 **죽은 필드**가 예시·표·산문에 잔존 (FP3·FP4·AN1)
//   ⑨ 매핑표가 없는 필드 `docs[].anchor` 를 산출물로 적는다   (MP1)
//   ⑧-b 그 산문이 **함께 제거된 불변식 6번**을 참조한다 — README 자신이 다른 절에서 _"6번이 없는
//       것은 오타가 아니다"_ 라고 적어놓고 여기선 그 6번을 가리킨다  (IV1)
// wiki 절(README:490~525)은 실측 7키가 **일치한다** — 드리프트는 summary·feeds 두 절에 있다.
// 따라서 WP1·WP2 는 `pin`(회귀 방지)이 본분이다.
//
// ── ★ 앵커는 **반만 죽었다** (이 파일에서 가장 틀리기 쉬운 지점) ─────────────────────────────
// 이 작업은 _"README 에서 `anchor` 라는 낱말을 0건으로 만드는 것"_ 이 **아니다.**
//   · 죽음: feeds `docs[]`(docRef) 스코프의 `anchor`·`anchorText` — P2 가 기능째 제거했다.
//   · 생존: wiki 응답 `headings[].anchor` — **현역**이고 `body.schema.json` 이
//           `required:["anchor","level","text"]` 로 **강제한다**.
// 그래서 부재 단언(AN1)에는 **위험 실재 앵커**(WP2)를 짝지운다. 낱말만 훑어 지우는 미래의 오수정은
// WP2 에서 red 가 된다 — 부재만 단언하는 가드는 "다 지우면 통과" 라는 최악의 GREEN 을 허용한다.
//
// ── 결속 방향 (규범 A 의 예외 조항) ─────────────────────────────────────────────────────────
// 기대값은 **코드·스키마에서 유도해 문서와 대조**한다 — 이 가드의 본분이 그것이다. 금지되는 것은
// *문서에서 유도해 문서와 대조*하는 자기참조다. 상수는 **import 하지 않고 소스 텍스트로 읽는다**
// (`docs-contract.test.mjs:63` 선례) — import 하면 상수가 틀려도 양쪽이 함께 틀려 가드가 공허해진다.
//
// ── ★ 메인에게: GREEN 에서 README 에 해야 할 일 (이 파일은 README 를 고치지 않는다) ──────────
// [1] **마커 3개를 넣는다.** 열림/닫힘 각 1개. 최소 span 이 계약이다(좁히면 가드가 얇아진다).
//     · `<!-- contract:summary-payload -->` … `<!-- /contract:summary-payload -->`
//         → `### summary 반환값` 바로 다음 줄부터 `### feeds 반환값` 직전까지.
//           **최소**: 봉투 jsonc 예시 + 키 설명표를 **둘 다** 포함해야 한다(SP1·SP3 이 각각 문다).
//     · `<!-- contract:feeds-payload -->` … `<!-- /contract:feeds-payload -->`
//         → `### feeds 반환값` 바로 다음 줄부터 `### wiki 반환값` 직전까지.
//           **최소**: 봉투 예시 + `items[]` 예시 + `docs[]` 표 + 그 아래 산문까지. 산문을 구간 밖으로
//           빼면 AN1(앵커 어휘 사망)이 산문을 놓친다.
//     · `<!-- contract:wiki-payload -->` … `<!-- /contract:wiki-payload -->`
//         → `### wiki 반환값` 바로 다음 줄부터 절 끝(`---`) 직전까지.
//           **최소**: ① active 문서 예시 블록(= 살아 있는 `headings[].anchor` 가 있는 곳).
// [2] **값·키를 고친다.** ①②④⑤: 두 예시의 `schemaVersion` 1 → 3, summary 예시·표에 `producer`·
//     `env` 추가, feeds 예시와 스키마 required 집합 일치.
// [3] **죽은 앵커를 지운다.** ⑥⑦⑧⑨: feeds 예시 `docs[]` 를 `[{ "id": … }]` 로, `docs[]` 표에서
//     `anchor`·`anchorText` 두 행 삭제, 그 아래 앵커 3문단(README:476·478·480) 삭제, 매핑표
//     (README:627)의 `docs[].anchor, docs[].anchorText` 행 삭제. **`headings[].anchor` 는 건드리지 않는다.**
// [4] **③ 거짓 서술은 사람이 고친다 — 이 파일은 결속하지 않는다.** README:378 _"계약 버전. 파괴적
//     교체에만 +1 (필드 추가로는 안 올린다)"_ 은 **거짓**이다: 이 리포는
//     strict(`additionalProperties:false`) 검증이라 필드 추가도
//     소비자에겐 파괴적이다. 그런데 이 문장을 정규식으로 박제하면 다음 사람이 문장을 다듬는 순간
//     **거짓양성**이 된다(규범 I — 산문은 결속하지 않는다). 그러니 결속 대신 여기 인수인계로 남긴다.
//     GREEN 에서 문장을 사실로 고칠 것: 필드 추가도 strict 소비자에겐 파괴적이라 +1 대상이다.
//
// ── 전이기 폴백 (마커가 아직 없다) ──────────────────────────────────────────────────────────
// 마커 부재는 `*0` 케이스가 **명시적 red** 로 문다. 나머지 케이스는 마커가 없으면 `###` 절 경계로
// 구간을 잡는다(폴백). 폴백이 없으면 SP1~WP2 가 전부 "마커 없음" 이라는 **같은 이유**로 red 가 되어
// _"지금 문서의 어느 값이 어긋났는가"_ 라는 이 감사의 진짜 정보가 사라진다. 폴백 구간은 [1] 이
// 지시한 마커 span 과 **동일**하므로 GREEN 전후로 판정이 바뀌지 않는다. 마커가 생기면 구간이
// 권위가 되고 폴백 경로는 죽는다.
//
// ── RED/green 현황 (작성 시점 실측 · `npx vitest run scripts/__tests__/docs-payload-shape.test.mjs`) ──
//   🔴RED  SP0·FP0·WP0(마커 3종 부재) · SP1(missing env)
//          SP2(문서 1 vs 소스 3) · SP3(표 1행 누락) · FP1(feeds required mismatch)
//          FP2(문서 1 vs 소스 3) · FP3(docs[0] 유령 anchor,anchorText) · FP4(표 유령 2행)
//          AN1(feeds 구간 anchor 6줄 · 전문 anchorText 4줄) · MP1(매핑표 유령 행)
//          IV1(README:480 이 없는 불변식 6 참조)
//   ✅green WP1(wiki 7키 일치 — pin) · WP2(살아 있는 headings[].anchor — AN1 의 짝)
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

// 규범 C10 — 헬퍼 부재가 **collection error** 가 되면 러너 요약이 "테스트 0건 = PASS" 로 오보고한다.
//   `docs-contract.test.mjs:47` 과 같은 지연 로드 형태를 그대로 쓴다.
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
const README_PATH = path.join(REPO_ROOT, 'README.md')

/** README 원문 — 헬퍼 경유(규범: 중복 구현 금지)라 **지연**이다(위 C10 과 한 몸). */
let readmeCache = null
function readme() {
  if (readmeCache === null) readmeCache = markdownHelpers().readMarkdown(README_PATH)
  return readmeCache
}

/** 프로덕션 **소스 텍스트**를 읽는다 — 상수를 import 하지 않는다(규범 A). */
const readSource = (rel) => readFileSync(path.join(REPO_ROOT, rel), 'utf8')
/** 스키마는 **JSON 으로** 읽는다 — 문서에서 유도하면 자기참조가 된다. */
const readSchema = (name) =>
  JSON.parse(readFileSync(path.join(REPO_ROOT, 'scripts/schema', name), 'utf8'))

const unique = (values) => [...new Set(values)]
const sorted = (values) => [...values].sort()
const captures = (text, pattern) => [...text.matchAll(pattern)].map((match) => match[1])

// ────────────────────────────────────────────────────────────────────────────────────────────
// 결속면(scope) — 마커 우선, 없으면 `###` 절 경계 폴백(파일 헤더 「전이기 폴백」)
// ────────────────────────────────────────────────────────────────────────────────────────────
/** 폴백 경계. 헤더 [1] 이 지시하는 마커 span 과 **같은 구간**이다(GREEN 전후 판정 동일). */
const SCOPE_BOUNDS = {
  'feeds-payload': { from: '### feeds 반환값', to: '### wiki 반환값' },
  'summary-payload': { from: '### summary 반환값', to: '### feeds 반환값' },
  'wiki-payload': { from: '### wiki 반환값', to: '## 문서 작성법' },
}

/**
 * `offset` 은 `lines[0]` 의 **README 0-based 줄 인덱스**다 — 실패 메시지가 구간 상대 위치가 아니라
 * `README.md:<줄>` 을 찍게 하려고 함께 돌려준다(상대 위치는 다음 사람이 세어야 한다 = 행동 불가).
 *
 * @param {'summary-payload'|'feeds-payload'|'wiki-payload'} marker
 * @returns {{ lines: string[], offset: number, via: 'marker'|'fallback' }}
 */
function docScope(marker) {
  const { extractMarkerBlock } = markdownHelpers()
  const lines = readme().split('\n')
  const block = extractMarkerBlock(readme(), marker)
  if (block !== null) {
    const open = lines.findIndex((line) => line.includes(`<!-- contract:${marker} -->`))
    return { lines: block, offset: open + 1, via: 'marker' }
  }

  const { from, to } = SCOPE_BOUNDS[marker]
  const start = lines.findIndex((line) => line.startsWith(from))
  if (start === -1) return { lines: [], offset: 0, via: 'fallback' }
  const rest = lines.slice(start + 1)
  const end = rest.findIndex((line) => line.startsWith(to))
  return {
    lines: end === -1 ? rest : rest.slice(0, end),
    offset: start + 1,
    via: 'fallback',
  }
}

const scopeText = (scope) => scope.lines.join('\n')

// ────────────────────────────────────────────────────────────────────────────────────────────
// jsonc 예시 블록 → 구조. 정규식으로 키를 훑지 않는 이유: 예시가 **여러 개**인 절에서 정규식은
//   블록 경계를 모른 채 키를 섞는다(summary 절만 예시 5개다). 구조로 읽으면 그 혼선이 원천 차단된다.
// ────────────────────────────────────────────────────────────────────────────────────────────
/** 주석·트레일링 콤마 제거는 **문자열 인식**으로 한다 — 순진한 치환은 `"https://…"` 를 잘라먹는다. */
function normalizeJsonc(text) {
  let out = ''
  let inString = false
  let escaped = false
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (inString) {
      out += char
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') {
      inString = true
      out += char
      continue
    }
    if (char === '/' && text[index + 1] === '/') {
      while (index < text.length && text[index] !== '\n') index += 1
      out += '\n'
      continue
    }
    if (char === '/' && text[index + 1] === '*') {
      index += 2
      while (index < text.length && !(text[index] === '*' && text[index + 1] === '/')) index += 1
      index += 1
      continue
    }
    if (char === ',') {
      let ahead = index + 1
      while (ahead < text.length && /\s/.test(text[ahead])) ahead += 1
      if (text[ahead] === '}' || text[ahead] === ']') continue
    }
    out += char
  }
  return out
}

/** 구간 안의 펜스 블록 원문들. */
function fencedBlocks(scope) {
  const blocks = []
  let current = null
  for (const line of scope.lines) {
    if (/^\s*(```|~~~)/.test(line)) {
      if (current === null) current = []
      else {
        blocks.push(current.join('\n'))
        current = null
      }
      continue
    }
    if (current !== null) current.push(line)
  }
  return blocks
}

/**
 * `needle` 을 포함하는 **유일한** 예시 블록을 파싱한다.
 *
 * ★ 판정하지 않는다(규범 D — 헬퍼에 `expect` 없음). 대신 부재·중복·파싱 실패를 **행동 가능한
 *   메시지**로 던진다 — 케이스가 그 메시지째 red 가 된다(조용한 빈 집합 통과를 만들지 않는다).
 */
function exampleObject(scope, marker, needle) {
  const matched = fencedBlocks(scope).filter((block) => block.includes(needle))
  if (matched.length !== 1) {
    throw new Error(
      `[${marker}] 결속면(${scope.via})에서 \`${needle}\` 를 담은 예시 블록이 ${matched.length}개다(1개여야 한다). 마커 span 을 확인하라 — 파일 헤더 [1].`,
    )
  }
  try {
    return JSON.parse(normalizeJsonc(matched[0]))
  } catch (error) {
    throw new Error(
      `[${marker}] \`${needle}\` 예시 블록이 JSON 으로 읽히지 않는다: ${error.message}\n--- 블록 ---\n${matched[0]}`,
    )
  }
}

/** 표의 **키 행** — 첫 칸이 백틱 식별자인 행만. (헤더·구분선·산문 행은 구조적으로 제외된다.) */
function tableKeyRows(scope) {
  return scope.lines
    .map((line) => line.match(/^\|\s*`([A-Za-z][A-Za-z0-9_]*)`\s*\|/))
    .filter(Boolean)
    .map((match) => match[1])
}

/**
 * 문서 키 집합 ↔ 스키마의 **양방향** 차이.
 *
 * `missing`(스키마 required 인데 문서에 없음)과 `ghost`(스키마 properties 에 없는데 문서에 있음)를
 * 나눠 돌려준다 — "다르다" 가 아니라 **어느 키가 어느 방향으로 어긋났는지** 를 실패 메시지에 싣기
 * 위해서다. optional 키(properties ∖ required)를 문서가 적는 것은 정상이므로 유령이 아니다
 * (`feeds.nextCursor` 가 그 자리다 — 이 구분이 없으면 정당한 서술이 거짓양성이 된다).
 */
function keyDiff(documented, schemaNode) {
  const required = schemaNode.required ?? []
  const allowed = Object.keys(schemaNode.properties ?? {})
  return {
    ghost: sorted(documented.filter((key) => !allowed.includes(key))),
    missing: sorted(required.filter((key) => !documented.includes(key))),
  }
}

const NO_DIFF = { ghost: [], missing: [] }

/**
 * 실패 메시지에 **어긋난 키를 직접 싣는다.**
 *
 * 비교값에만 담으면 러너가 `[ 'env', …(2) ]` 로 잘라 보여줘 다음 사람이 세 번째 키를 모른다 —
 * 이름만 red 인 단언은 수정 지시서가 아니다. 메시지 문자열은 잘리지 않으므로 여기에 싣는다.
 */
const diffMessage = (label, diff) =>
  `${label} · missing(스키마 required 인데 문서에 없다 → 추가하라)=[${diff.missing.join(', ')}]` +
  ` · ghost(스키마에 없는데 문서가 적는다 → 삭제하라)=[${diff.ghost.join(', ')}]`

/** 줄 목록도 같은 이유로 메시지에 편다. */
const lineMessage = (label, hits) => `${label} — ${hits.length}건\n${hits.join('\n')}`

/** `<파일>:<줄>  <내용>` — 실패 메시지가 그대로 수정 지시서가 되게 한다. */
function hitsWithLines(pattern) {
  return readme()
    .split('\n')
    .map((line, index) => ({ line, number: index + 1 }))
    .filter((entry) => pattern.test(entry.line))
    .map((entry) => `README.md:${entry.number}  ${entry.line.trim().slice(0, 90)}`)
}

/** `payloads.mjs` 소스가 말하는 계약 버전(문자열 — 소스 텍스트에서 캔 그대로). */
function schemaVersionFromSource() {
  return captures(readSource('scripts/lib/payloads.mjs'), /SCHEMA_VERSION = (\d+)/g)
}

// ────────────────────────────────────────────────────────────────────────────────────────────
// SP — summary 반환값 ↔ `summary.schema.json` (①②)
// ────────────────────────────────────────────────────────────────────────────────────────────
describe('결속 — summary 반환값 (SP)', () => {
  it('SP0: README 에 `contract:summary-payload` 마커가 열림/닫힘 각 1개이고 구간이 비어 있지 않다', () => {
    // 🔴 왜 지금 red 인가: 마커가 **아직 없다**(GREEN 이 넣는다 — 헤더 [1]). 이 케이스가 없으면
    //   폴백이 깨졌을 때 SP1~SP3 이 "빈 구간 vs 빈 집합" 으로 조용히 통과할 길이 열린다.
    const { extractMarkerBlock } = markdownHelpers()
    const block = extractMarkerBlock(readme(), 'summary-payload')

    expect(block, 'README `### summary 반환값` 절을 `<!-- contract:summary-payload -->` … `<!-- /contract:summary-payload -->` 로 감싸라(봉투 예시 + 키 설명표를 둘 다 포함).').not.toBeNull() // prettier-ignore
    expect(block.join('\n')).toContain('"schemaVersion"')
  })

  it('SP1: 봉투 예시의 top-level 키 == `summary.schema.json` 계약 (양방향)', () => {
    // 🔴 왜 지금 red 인가: 예시는 6키(schemaVersion·generatedAt·sourceCommit·docs·tree·tags)인데
    //   실제 출력·스키마는 **7키**다 — 발행 환경(`env`)이 빠졌다.
    const schema = readSchema('summary.schema.json')
    // 앵커: 스키마 쪽이 비어 있지 않다(빈 required 와의 `[] === []` 통과를 배제).
    // 🔴 v3 P1(§4.3 ① · KY5): 발행자 표지와 상관 토큰이 사라져 **9 → 7** 이 된다.
    // ★ 규범 N — 개수 단독은 *어느* 7키인지 말하지 않는다. **정렬 집합을 함께** 못박는다.
    expect(schema.required).toHaveLength(7)
    expect([...schema.required].sort()).toEqual([
      'docs',
      'env',
      'generatedAt',
      'schemaVersion',
      'sourceCommit',
      'tags',
      'tree',
    ])

    const scope = docScope('summary-payload')
    const documented = sorted(
      Object.keys(exampleObject(scope, 'summary-payload', '"schemaVersion"')),
    )

    expect(documented.length, `문서 결속면(${scope.via}) — 예시가 비었다`).toBeGreaterThan(0)
    const diff = keyDiff(documented, schema)
    expect(diff, diffMessage(`summary 봉투 예시(${scope.via})`, diff)).toEqual(NO_DIFF)
  })

  it('SP2(=CV2): 봉투 예시의 `schemaVersion` == `payloads.mjs` 소스 == 리터럴 1 (3중 대조)', () => {
    // 🔴 왜 지금 red 인가(v3 P1 · D29 · §4.3 ②·④): 계약 번호를 **1 로 리셋**한다 — 소스가 아직 3이다.
    // ★ 리터럴 축이 없으면 "문서와 소스가 **함께 틀린**" 상태를 통과시킨다(규범 A ·
    //   `docs-contract.test.mjs` PT4 와 같은 3중 대조).
    const fromSource = schemaVersionFromSource()
    expect(fromSource).toHaveLength(1) // 앵커: 정규식이 죽어 빈 배열이 된 것을 배제
    expect(fromSource).toEqual(['1'])

    const scope = docScope('summary-payload')
    const envelope = exampleObject(scope, 'summary-payload', '"schemaVersion"')

    expect(envelope.schemaVersion, `summary 봉투 예시(${scope.via})의 schemaVersion 을 ${fromSource[0]} 로 고쳐라`).toBe(Number(fromSource[0])) // prettier-ignore
  })

  it('SP3: 키 설명표의 행 == `summary.schema.json` 계약 (양방향)', () => {
    // 🔴 왜 지금 red 인가: 표도 예시와 같은 6행이다. 예시만 고치고 표를 두면 **같은 절 안에서
    //   두 서술이 갈린다** — 그래서 예시(SP1)와 표를 따로 문다.
    const schema = readSchema('summary.schema.json')
    const scope = docScope('summary-payload')
    const documented = sorted(unique(tableKeyRows(scope)))

    expect(documented.length, `문서 결속면(${scope.via}) — 키 설명표를 찾지 못했다(마커 span 확인)`).toBeGreaterThan(0) // prettier-ignore
    const diff = keyDiff(documented, schema)
    expect(diff, diffMessage(`summary 키 설명표(${scope.via})`, diff)).toEqual(NO_DIFF)
  })
})

// ────────────────────────────────────────────────────────────────────────────────────────────
// FP — feeds 반환값 ↔ `feeds.schema.json` (④⑤⑥⑦)
// ────────────────────────────────────────────────────────────────────────────────────────────
describe('결속 — feeds 반환값 (FP)', () => {
  it('FP0: README 에 `contract:feeds-payload` 마커가 열림/닫힘 각 1개이고 구간이 비어 있지 않다', () => {
    const { extractMarkerBlock } = markdownHelpers()
    const block = extractMarkerBlock(readme(), 'feeds-payload')

    expect(block, 'README `### feeds 반환값` 절을 `<!-- contract:feeds-payload -->` … `<!-- /contract:feeds-payload -->` 로 감싸라(봉투 예시 + items 예시 + docs[] 표 + 그 아래 산문까지).').not.toBeNull() // prettier-ignore
    expect(block.join('\n')).toContain('"importance"')
  })

  it('FP1: 봉투 예시의 top-level 키 == `feeds.schema.json` 계약 (양방향)', () => {
    // 🔴 왜 지금 red 인가: 예시와 스키마 required 집합이 같은 wire 계약으로 함께 움직여야 한다.
    // ★ `nextCursor` 는 optional 이라 **유령이 아니다** — `keyDiff` 가 required/properties 를 갈라
    //   보는 이유가 바로 이 키다(정당한 서술을 거짓양성으로 만들지 않는다).
    // ★ v3 P2(§4.5-① · D22·D48) — required 가 4 → **6종**이 된다(`env`·`nextCursor` 가산). 그래서
    //   `nextCursor` 는 더 이상 optional 이 아니고, 봉투 예시가 그것을 보여주는 것은 **계약**이다.
    const schema = readSchema('feeds.schema.json')
    expect([...schema.required].sort()).toEqual([
      'env',
      'generatedAt',
      'items',
      'nextCursor',
      'schemaVersion',
      'sourceCommit',
    ])
    expect(Object.keys(schema.properties)).toContain('nextCursor')

    const scope = docScope('feeds-payload')
    const documented = sorted(Object.keys(exampleObject(scope, 'feeds-payload', '"schemaVersion"')))

    expect(documented, '봉투 예시가 `nextCursor` 를 보여줘야 한다(required 6종)').toContain('nextCursor') // prettier-ignore
    const diff = keyDiff(documented, schema)
    expect(diff, diffMessage(`feeds 봉투 예시(${scope.via})`, diff)).toEqual(NO_DIFF)
  })

  it('FP2(=CV2): 봉투 예시의 `schemaVersion` == `payloads.mjs` 소스 == 리터럴 1 (3중 대조)', () => {
    // 🔴 왜 지금 red 인가: SP2 와 같은 리셋이 feeds 절에도 적용된다(v3 P1 · D29 · §4.3 ②·④).
    const fromSource = schemaVersionFromSource()
    expect(fromSource).toHaveLength(1) // 앵커: 정규식이 죽어 빈 배열이 된 것을 배제
    expect(fromSource).toEqual(['1'])

    const scope = docScope('feeds-payload')
    const envelope = exampleObject(scope, 'feeds-payload', '"schemaVersion"')

    expect(envelope.schemaVersion, `feeds 봉투 예시(${scope.via})의 schemaVersion 을 ${fromSource[0]} 로 고쳐라`).toBe(Number(fromSource[0])) // prettier-ignore
  })

  it('FP3: `items[]` 예시의 `docs[0]` 키 == `definitions.docRef` (양방향)', () => {
    // 🔴 왜 지금 red 인가: 예시가 `{ id, anchor, anchorText }` **3키**다. 스키마 docRef 는
    //   `required:["id"]` · `properties:{id}` **1키**다 — P2(D10)가 앵커를 계약에서 제거했고
    //   `build.contract-shape.test.mjs` AN1·AN2 가 코드·스키마 쪽을 이미 지킨다. **문서만 남았다.**
    // ★ 이 케이스는 앵커가 **되살아나도** red 다(ghost 방향) — 부재 단언이 아니라 집합 동등이다.
    const schema = readSchema('feeds.schema.json')
    const docRef = schema.definitions.docRef
    expect(docRef.required).toEqual(['id'])

    const scope = docScope('feeds-payload')
    const item = exampleObject(scope, 'feeds-payload', '"importance"')
    expect(Array.isArray(item.docs), 'items 예시에 `docs` 배열이 없다').toBe(true)
    expect(item.docs.length, 'items 예시의 `docs` 가 비어 있어 키를 대조할 수 없다').toBeGreaterThan(0) // prettier-ignore

    const diff = keyDiff(sorted(Object.keys(item.docs[0])), docRef)
    expect(diff, diffMessage(`feeds items 예시의 docs[0](${scope.via}) — ghost 는 P2 가 제거한 죽은 필드다`, diff)).toEqual(NO_DIFF) // prettier-ignore
  })

  it('FP4: `docs[]` 설명표의 키 행 == `definitions.docRef` (양방향)', () => {
    // 🔴 왜 지금 red 인가: 표에 `anchor`·`anchorText` 두 행이 남아 있다(README:473·474).
    //   예시(FP3)만 고치고 표를 두면 소비자는 표를 보고 없는 필드를 읽는다.
    const docRef = readSchema('feeds.schema.json').definitions.docRef
    const scope = docScope('feeds-payload')
    const documented = sorted(unique(tableKeyRows(scope)))

    expect(documented, 'docs[] 표에서 `id` 행을 찾지 못했다(마커 span 확인)').toContain('id')
    const diff = keyDiff(documented, docRef)
    expect(diff, diffMessage(`docs[] 설명표(${scope.via})`, diff)).toEqual(NO_DIFF)
  })
})

// ────────────────────────────────────────────────────────────────────────────────────────────
// AN — 죽은 앵커 어휘 (⑥⑦⑧). **짝은 WP2** — 부재 단언만으로는 "다 지우면 통과" 가 된다.
// ────────────────────────────────────────────────────────────────────────────────────────────
describe('죽은 앵커 어휘 (AN · 짝 = WP2)', () => {
  it('AN1: feeds 구간에 `anchor` 가 0건이고, README 전문에 `anchorText` 가 0건이다', () => {
    // 🔴 왜 지금 red 인가: feeds 구간에 앵커 서술이 6줄(README:464·473·474·476·478·480), 전문에
    //   `anchorText` 가 4줄(README:464·474·478·627) 남아 있다. 기능은 P2 가 제거했다.
    // ★ 범위가 비대칭인 이유: `anchor` 는 **wiki `headings[]` 에서 살아 있으므로** 전문 검사를 하면
    //   현역 기능을 거짓양성으로 잡는다. 그래서 `anchor` 는 **feeds 구간 한정**, `anchorText` 는
    //   살아 있는 자리가 한 곳도 없으므로 **전문**이다. 이 비대칭이 곧 계약이다.
    const scope = docScope('feeds-payload')
    // 앵커 ①: 구간이 실재한다 — 절을 통째로 지워 통과하는 길을 막는다.
    expect(scopeText(scope), `feeds 결속면(${scope.via})이 비었거나 봉투 예시가 없다`).toContain('"schemaVersion"') // prettier-ignore

    const anchorInFeeds = scope.lines
      .map((line, index) => ({ index, line }))
      .filter((entry) => /\banchor(?:Text)?\b/i.test(entry.line))
      .map((entry) => `README.md:${scope.offset + entry.index + 1}  ${entry.line.trim().slice(0, 90)}`) // prettier-ignore

    expect(anchorInFeeds, lineMessage('feeds `docs[]` 스코프의 앵커는 P2(D10)가 제거했다 — 예시·표·산문에서 지워라(`headings[].anchor` 는 건드리지 마라)', anchorInFeeds)).toEqual([]) // prettier-ignore

    const anchorTextHits = hitsWithLines(/anchorText/)
    expect(anchorTextHits, lineMessage('anchorText 는 살아 있는 자리가 한 곳도 없다 — 전부 지워라', anchorTextHits)).toEqual([]) // prettier-ignore
  })
})

// ────────────────────────────────────────────────────────────────────────────────────────────
// WP — wiki 반환값 ↔ `body.schema.json` + `single-doc.mjs` (드리프트 없음 — pin · AN1 의 짝)
// ────────────────────────────────────────────────────────────────────────────────────────────
describe('결속 — wiki 반환값 (WP · pin)', () => {
  it('WP0: README 에 `contract:wiki-payload` 마커가 열림/닫힘 각 1개이고 구간이 비어 있지 않다', () => {
    // 🔴 지금 red(마커 부재)이지만 이 절의 **값은 정확하다**(실측 7키 일치). 그래도 마커를 두는 것은
    //   ① AN1(부재)의 짝인 WP2 에 권위 있는 구간을 주고 ② 같은 계열의 재발을 대칭으로 막기 위해서다.
    const { extractMarkerBlock } = markdownHelpers()
    const block = extractMarkerBlock(readme(), 'wiki-payload')

    expect(block, 'README `### wiki 반환값` 절을 `<!-- contract:wiki-payload -->` … `<!-- /contract:wiki-payload -->` 로 감싸라(① active 문서 예시 포함).').not.toBeNull() // prettier-ignore
    expect(block.join('\n')).toContain('"headings"')
  })

  it('WP1: active 문서 예시의 키 == `wikiDocBody` 4키 + 봉투 3키 (양방향)', () => {
    // ✅ 지금 green — **pin** 이 본분이다(실측 7키가 문서와 일치한다).
    // 코드 축이 둘인 이유: 본문 4키는 `body.schema.json` 이, 봉투 3키(`path`·`breadcrumb`·`status`)는
    //   `projectSingleDoc` 이 소유한다(wiki 응답 봉투에는 스키마 파일이 없다 — 서빙 조립물이다).
    const bodyKeys = sorted(readSchema('body.schema.json').definitions.wikiDocBody.required)
    expect(bodyKeys).toEqual(['headings', 'html', 'meta', 'sources'])

    const source = readSource('scripts/lib/single-doc.mjs')
    const returnBlock = source.slice(source.lastIndexOf('  return {'))
    const projection = sorted(unique(captures(returnBlock, /^ {4}([A-Za-z][A-Za-z0-9_]*):/gm)))

    // 앵커: 봉투가 본문 4키를 **전부** 싣고, 그 위에 정확히 3키를 더한다(리터럴 축 — 규범 A).
    expect(sorted(projection.filter((key) => !bodyKeys.includes(key)))).toEqual(['breadcrumb', 'path', 'status']) // prettier-ignore
    expect(projection).toHaveLength(7)

    const scope = docScope('wiki-payload')
    const documented = sorted(Object.keys(exampleObject(scope, 'wiki-payload', '"headings"')))

    expect(documented, `wiki active 문서 예시(${scope.via}) — 실제 응답 7키와 대조`).toEqual(projection) // prettier-ignore
  })

  it('WP2: ★ 살아 있는 앵커 — `headings[].anchor` 는 스키마가 요구하고 예시가 보여준다', () => {
    // ✅ 지금 green — **AN1(부재)의 짝**이다. 이 케이스가 없으면 "README 에서 anchor 라는 낱말을
    //   전부 지운다" 는 오수정이 AN1 을 통과시킨다. 앵커는 `docs[]` 에서만 죽었고 `headings[]` 에서는
    //   **현역**이다(실측: `{"anchor":"개요","level":2,"text":"개요"}`).
    const heading = readSchema('body.schema.json').definitions.heading
    expect(heading.required).toEqual(['anchor', 'level', 'text'])

    const scope = docScope('wiki-payload')
    const doc = exampleObject(scope, 'wiki-payload', '"headings"')

    expect(doc.headings.length, 'wiki 예시에 headings 항목이 없다').toBeGreaterThan(0)
    expect(sorted(Object.keys(doc.headings[0])), `wiki headings[] 예시(${scope.via})는 살아 있는 계약이다 — 지우지 마라`).toEqual(['anchor', 'level', 'text']) // prettier-ignore
  })
})

// ────────────────────────────────────────────────────────────────────────────────────────────
// MP — 커밋 ↔ 피드 매핑표 (⑨). 마커 밖(README:618~627)이라 전문 스캔이다.
// ────────────────────────────────────────────────────────────────────────────────────────────
describe('커밋↔피드 매핑표 (MP)', () => {
  it('MP1: 매핑표가 `docs[].id` 를 산출로 적고, 없는 필드 `docs[].anchor` 는 적지 않는다', () => {
    // 🔴 왜 지금 red 인가: README:627 이 _"diff hunk ↔ heading 매핑 → `docs[].anchor`,
    //   `docs[].anchorText`"_ 라는 **존재하지 않는 산출**을 약속한다(P2 가 제거).
    // ★ 실재 짝이 먼저다: `docs[].id` 행이 **있어야** 한다 — 표를 통째로 지워 통과하는 길을 막는다.
    expect(hitsWithLines(/`docs\[\]\.id`/), '매핑표에서 `docs[].id` 행이 사라졌다(표를 지워 통과시키지 마라)').not.toEqual([]) // prettier-ignore

    const phantom = hitsWithLines(/docs\[\]\.anchor/)
    expect(phantom, lineMessage('없는 필드를 산출물로 약속하는 행이다 — 삭제하라', phantom)).toEqual([]) // prettier-ignore
  })
})

// ────────────────────────────────────────────────────────────────────────────────────────────
// IV — 죽은 불변식 번호 참조 (⑧-b)
// ────────────────────────────────────────────────────────────────────────────────────────────
describe('불변식 번호 상호참조 (IV)', () => {
  it('IV1: `[불변식](#…) N` 의 N 이 전부 불변식 표에 실재하는 번호다', () => {
    // 🔴 왜 지금 red 인가: README:480 이 _"([불변식](#불변식-7종) 6)"_ 을 가리키는데 **6번은 없다** —
    //   앵커 정합 불변식이었고 P2 가 앵커 기능과 함께 제거했다. README 자신이 :759 에서 _"6번이 없는
    //   것은 오타가 아니다"_ 라고 적어놓고 여기선 그 6번을 참조한다.
    // ★ 링크 자체(`#불변식-7종`)는 `docs-anchors.test.mjs` AC1 이 이미 문다. 여기서 무는 것은 링크
    //   **뒤의 번호**다 — 앵커가 멀쩡해도 가리키는 행이 없으면 독자는 빈손으로 표에 도착한다.
    // ★ 기대 집합을 문서(`contract:invariants` 표)에서 유도하지만 **자기참조가 아니다** —
    //   그 표는 `docs-contract.test.mjs` EN1 이 `invariants.mjs` 방출 번호에 결속해 둔 계약면이다.
    const { extractMarkerBlock } = markdownHelpers()
    const table = extractMarkerBlock(readme(), 'invariants')
    expect(table, '`contract:invariants` 마커가 사라졌다 — 번호 집합을 유도할 곳이 없다').not.toBeNull() // prettier-ignore

    const numbers = table
      .map((line) => line.match(/^\|\s*(\d+)\s*\|/))
      .filter(Boolean)
      .map((match) => Number(match[1]))
    // 앵커: 표가 7행이고 **6번 구멍이 실재한다**(리터럴 축 — 이 가드의 감도를 못박는다).
    expect(numbers).toEqual([1, 2, 3, 4, 5, 7, 8])

    const references = readme()
      .split('\n')
      .flatMap((line, index) =>
        [...line.matchAll(/\[불변식\]\(#[^)]+\)\s*(\d+)/g)].map((match) => ({
          number: Number(match[1]),
          where: `README.md:${index + 1}  …불변식 ${match[1]}`,
        })),
      )
    // 앵커: 참조가 실재한다 — 참조를 다 지워 통과하는 길을 막는다.
    expect(references.length, '불변식 번호 상호참조가 한 건도 없다').toBeGreaterThan(0)

    const dangling = references
      .filter((reference) => !numbers.includes(reference.number))
      .map((reference) => reference.where)
    expect(dangling, lineMessage(`표에 없는 불변식 번호를 가리킨다(실재 번호: ${numbers.join('·')})`, dangling)).toEqual([]) // prettier-ignore
  })
})

// ────────────────────────────────────────────────────────────────────────────────────────────
// LZ8 — v3 P2 · Task 6 「넷째 겹(텍스트)」: README `### feeds` **플래그표** ↔ CLI 옵션 계약 (양방향)
//
// 규범 I — **표 행만 결속하고 산문은 §4 원장·리뷰가 진다.** 그래서 이 케이스는 플래그표의 *행*과
//   `feeds.mjs` `parseArgs` 옵션 *키*만 대조하고, 설명 문장은 한 글자도 정규식으로 박제하지 않는다.
//
// 🔴 왜 지금 red 인가 (README:219-225 실측):
//   ① `--count` 행의 기본값 칸이 `` `50` `` 이다 — D15 로 **필수 인자**가 되므로 기본값이 없다.
//   ② `--from`·`--to` 행이 살아 있다 — D6 이 그 인자를 없앤다.
//   ③ `--ignore` 행이 없다 — D20 이 그 인자를 신설한다.
// ✅ 지금도 green 인 축(앵커): 표가 파싱되고 · `--after`·`--out` 행이 실재하며 · **양방향 대조가
//   성립한다**(표 ⊆ 옵션 · 창(window) 옵션 ⊆ 표). 이 축이 있어야 "표를 통째로 지워 통과" 가 막힌다.
// ────────────────────────────────────────────────────────────────────────────────────────────

/** 사용법 코드블록이 소유하는 공통 플래그 — 플래그표의 결속 대상이 아니다(리터럴 · 규범 A). */
const COMMON_FLAGS = ['env', 'vault']

/** `### feeds` CLI 절(=`### wiki` 직전까지). `### feeds 반환값` 과 **정확 일치로** 가른다. */
function feedsCliScope() {
  const lines = readme().split('\n')
  const start = lines.findIndex((line) => line.trim() === '### feeds')
  if (start === -1) return { lines: [], offset: 0 }
  const rest = lines.slice(start + 1)
  const end = rest.findIndex((line) => line.trim() === '### wiki')
  return { lines: end === -1 ? rest : rest.slice(0, end), offset: start + 1 }
}

/** 플래그표 행 → `{ flag, cells }`. `` | `--count` | `50` | … | `` 형태만 잡는다. */
function flagRows(scope) {
  return scope.lines
    .map((line) => line.match(/^\|\s*`--([a-z][a-z-]*)[^`]*`\s*\|(.*)$/))
    .filter(Boolean)
    .map((match) => ({ cells: match[2].split('|').map((cell) => cell.trim()), flag: match[1] }))
}

/** `feeds.mjs` **소스 텍스트**의 `parseArgs` 옵션 키. 상수를 import 하지 않는다(규범 A). */
function feedsCliOptions() {
  const source = readSource('scripts/feeds.mjs')
  const block = source.match(/options:\s*\{([\s\S]*?)\n {4}\},/)
  if (block === null) return []
  return sorted(unique(captures(block[1], /^\s{6}([a-z][a-zA-Z]*):\s*\{/gm)))
}

describe('결속 — feeds 플래그표 ↔ CLI 옵션 (LZ8 · 🔴RED(flip) v3 P2)', () => {
  it('LZ8: `--count` 에 기본값이 없고 `--from`/`--to` 가 없고 `--ignore` 가 있다 (양방향)', () => {
    const scope = feedsCliScope()
    const rows = flagRows(scope)

    // ── 앵커 ①: 표가 실제로 파싱됐다(행 수 > 0). 표를 지워 부재 단언을 자동 참으로 만드는 길을 막는다.
    expect(rows.length, 'README `### feeds` 절에서 플래그표를 찾지 못했다').toBeGreaterThan(0)
    // ── 앵커 ②: 살아남는 행이 **실재한다**.
    const documented = sorted(unique(rows.map((row) => row.flag)))
    expect(documented, '`--after` 행이 없다').toContain('after')
    expect(documented, '`--out` 행이 없다').toContain('out')

    // ── 앵커 ③(양방향 결속): 표의 모든 행이 실제 옵션이고, 창 옵션은 전부 표에 있다 ──────────
    const options = feedsCliOptions()
    expect(options.length, '`feeds.mjs` 의 parseArgs options 를 읽지 못했다').toBeGreaterThan(2)
    const ghost = documented.filter((flag) => !options.includes(flag))
    expect(ghost, `표에 있는데 CLI 가 모르는 플래그: ${ghost.join('·')}`).toEqual([])
    const undocumented = options.filter(
      (flag) => !COMMON_FLAGS.includes(flag) && !documented.includes(flag),
    )
    expect(undocumented, `CLI 가 받는데 표에 없는 플래그: ${undocumented.join('·')}`).toEqual([])

    // ── 본 축 ─────────────────────────────────────────────────────────────────────────────
    // D15 — `--count` 는 필수다. 기본값 칸에 값이 남아 있으면 독자는 "생략 가능" 으로 읽는다.
    const count = rows.find((row) => row.flag === 'count')
    expect(count, '`--count` 행이 사라졌다 — 필수 인자는 표에 남아야 한다').toBeDefined()
    expect(count.cells[0], `기본값 칸: ${count.cells[0]}`).not.toMatch(/\d/u)

    // D6 — 날짜 구간 소멸.
    expect(documented, '`--from` 행이 남아 있다').not.toContain('from')
    expect(documented, '`--to` 행이 남아 있다').not.toContain('to')

    // D20 — 억제 인자 신설.
    expect(documented, '`--ignore` 행이 없다').toContain('ignore')
  })
})
