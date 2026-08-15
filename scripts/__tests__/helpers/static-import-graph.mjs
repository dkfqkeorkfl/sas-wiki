// P4 · Task 2 — **정적** import 그래프 파서 (규범 E: 벽시계 대신 구조를 잰다).
//
// DAMP 경계: 이 파일은 **사실만 캔다**(`expect` 없음 · tdd §2.3 규범 D). "무엇이 도달하면 안 되는가"는
//   `summary.import-graph.test.mjs` 본문이 단언한다.
//   (vitest 기본 include 는 `*.test.mjs` 만 잡으므로 helpers/*.mjs 는 테스트로 수집되지 않는다 — 의도.)
//
// ★ 이 파서의 정확성이 곧 IG1 의 정당성이다(tdd §2.4 주의 2). **동적 `await import(...)` 를 정적으로
//   오탐하면 Task 2 를 제대로 해도 red 가 나고, 그러면 구현자가 가드를 의심해 무력화한다** — 이 리포에서
//   "새 가드 자체가 결함원" 이 3회 반복된 바로 그 형태다. 그래서 파서 자신의 비-공허성을 IG3(동적 무시)·
//   IG4(정적 검출)·IG5(패키지·내장 무시) 가 **테스트로** 문다.
//
// 무엇을 세는가(D-A 가 만드는 경계와 정확히 일치시킨다):
//   · 센다   — **줄 시작**의 정적 `import … from '<상대경로>'` · 부작용 `import '<상대경로>'`
//   · 안 센다 — 동적 `await import('…')`(어느 위치든) · 패키지/내장(`'node:fs'`·`'unified'`) ·
//               문자열 안에 들어 있는 import 흉내
//
// 상대경로만 따라가는 이유: 패키지·내장을 폐쇄에 넣으면 `node_modules` 로 새어 나가 단언이 무의미해진다.
import fs from 'node:fs'
import path from 'node:path'

/**
 * 주석(줄·블록)을 걷어낸 코드만 남긴다 — 따옴표 상태를 추적하는 문자 스캐너다(정규식 치환이
 * 아니다). 정규식 두 방(블록 먼저 → 줄 나중)을 순서대로 쏘면 두 맹점이 생긴다: ① 문자열·템플릿
 * 리터럴 안의 슬래시-슬래시 쌍·슬래시-별표 쌍도 주석으로 오인해 그 뒤 실제 코드를 지운다. ② 줄 주석
 * 안에 우연히 슬래시-별표 쌍이 있으면 블록 주석 시작으로 오인해 다음 별표-슬래시 쌍까지 실제
 * 코드를 통째로 삼킨다 — 이 리포에서 같은
 * 형태의 스캐너가 실제로 16파일 773줄을 이렇게 놓쳤다(선례: `feeds.env-leak.verify.test.mjs`·
 * `docs-contract.test.mjs` 의 `codeOnly`/`stripComments`, 같은 규칙을 이 파일 안에 지역 구현한다 —
 * 파편화된 스캐너를 한 모듈로 통합하는 것은 이 phase 범위가 아니다).
 *
 * 그래서 이 스캐너는 **줄 주석을 블록 주석보다 먼저 판정**하고, 홑따옴표·겹따옴표·백틱 문자열
 * 안에서는 어떤 주석 판정도 하지 않는다(역슬래시 이스케이프 포함). 미종료 블록 주석은 EOF 까지
 * 소거한다(자바스크립트의 실제 동작과 같다).
 *
 * ★ 한계(정직하게 적어 둔다): 정규식 리터럴은 문자열로 취급하지 않는다 — 완전한 판별에는 JS
 *   렉서가 필요하고 그건 이 파서의 몫이 아니다(이 리포의 실제 소스에 그런 형태가 없음을 전제한다).
 */
function codeOnly(text) {
  let out = ''
  let quote = null
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (quote) {
      out += char
      if (char === '\\') {
        out += text[index + 1] ?? ''
        index += 1
        continue
      }
      if (char === quote) quote = null
      continue
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char
      out += char
      continue
    }
    if (char === '/' && text[index + 1] === '/') {
      while (index < text.length && text[index] !== '\n') index += 1
      continue
    }
    if (char === '/' && text[index + 1] === '*') {
      const close = text.indexOf('*/', index + 2)
      index = close === -1 ? text.length : close + 1
      continue
    }
    out += char
  }
  return out
}

/**
 * `^import … from '<rel>'` · `^import '<rel>'` · `^export … from '<rel>'`(정적 재export)를 잡는다.
 *
 * · `^` + `m` 플래그: **줄 시작**만 — `const m = await import('./x.mjs')` 는 애초에 매칭 후보가 아니다.
 *   (`codeOnly` 가 주석을 먼저 걷어내므로 블록 주석 안의 줄시작 `import`/`export` 는 후보에서
 *   빠진다 — 이전엔 주석을 안 걷어내 오탐했다.)
 * · `import\s+`: `import(` 는 `\s+` 가 없어 걸리지 않는다(줄 시작 동적 import 방어).
 * · `[^'"()]*?`: 명세부(`{ a, b }` · `* as ns` · 기본 바인딩)를 건너뛴다. 개행을 허용하므로
 *   여러 줄에 걸친 `import {\n  a,\n} from './x.mjs'` 도 잡는다(이 리포의 실제 스타일).
 *   **괄호를 배제**하므로 `import ('…')` 같은 동적 형태로 새지 않는다.
 * · `export\s+(?:\*(?:\s+as\s+[^\s'"()]+)?|\{[^'"()]*?\})\s+from\s+`: `export { x } from './y.mjs'` ·
 *   `export * from './y.mjs'` · `export * as ns from './y.mjs'` — **정적 재export**. 이전엔 이 형태를
 *   전혀 세지 않아 금지 의존성이 재export 를 타고 폐쇄에서 빠져나갈 수 있었다.
 * · `(\.[^'"]+)`: 상대경로(`./`·`../`)만 캡처 — 패키지·내장은 첫 글자가 `.` 이 아니라 탈락한다.
 *
 * ★ 유지되는 기존 계약: 동적 `await import()` 는 여전히 안 세고, 패키지·내장(`'node:fs'`·`'unified'`)
 *   도 여전히 안 센다(D-A 경계 — `:12-17` 참조). `summary.import-graph.test.mjs` 의 IG3~IG5 가 이
 *   비-공허성을 테스트로 문다.
 */
const STATIC_IMPORT_RE =
  /^(?:import\s+(?:[^'"()]*?\s+from\s+)?|export\s+(?:\*(?:\s+as\s+[^\s'"()]+)?|\{[^'"()]*?\})\s+from\s+)['"](\.[^'"]+)['"]/gmu

/**
 * 소스 텍스트에서 **정적** 상대 import/재export 지정자를 등장 순서대로 모은다(중복 제거).
 * 주석(줄·블록) 안의 오탐은 `codeOnly` 가 앞단에서 걷어낸다.
 *
 * @param {string} source 모듈 소스 텍스트
 * @returns {string[]} 예: `['./lib/atomic.mjs', './lib/payloads.mjs']`
 */
export function staticRelativeImports(source) {
  const out = []
  for (const match of codeOnly(source).matchAll(STATIC_IMPORT_RE)) {
    if (!out.includes(match[1])) out.push(match[1])
  }
  return out
}

/**
 * 진입점에서 **정적** 상대 import 만 따라간 전이 폐쇄.
 *
 * 읽을 수 없는 파일(확장자 생략·경로 오타 등)은 폐쇄에서 조용히 빠진다 — 이 파서는 모듈 해석기가
 * 아니라 관측기이고, 이 리포는 확장자를 항상 명시한다(실측).
 *
 * @param {string} entryFile 진입점 절대 경로
 * @returns {{ files: string[], parents: Map<string, string> }}
 *   `files` = 진입점을 **포함한** 절대 경로 집합(정렬) · `parents` = 자식 → 부모(사슬 복원용)
 */
export function staticImportClosure(entryFile) {
  const entry = path.resolve(entryFile)
  const seen = new Set([entry])
  const parents = new Map()
  const queue = [entry]

  while (queue.length > 0) {
    const current = queue.shift()
    let source
    try {
      source = fs.readFileSync(current, 'utf8')
    } catch {
      continue
    }
    for (const specifier of staticRelativeImports(source)) {
      const child = path.resolve(path.dirname(current), specifier)
      if (seen.has(child)) continue
      seen.add(child)
      parents.set(child, current)
      queue.push(child)
    }
  }

  return { files: [...seen].sort(), parents }
}

/**
 * 진입점 → `target` 사슬을 복원한다(실패 메시지에 원인을 싣기 위한 것 — tdd §2.4 "원인 지목").
 *
 * @returns {string[] | null} 절대 경로 사슬(진입점부터). 도달하지 않으면 `null`.
 */
export function importChain(closure, target) {
  const absolute = path.resolve(target)
  if (!closure.files.includes(absolute)) return null
  const chain = [absolute]
  let cursor = absolute
  while (closure.parents.has(cursor)) {
    cursor = closure.parents.get(cursor)
    chain.unshift(cursor)
  }
  return chain
}
