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
 * `^import … from '<rel>'` 과 `^import '<rel>'` 를 잡는다.
 *
 * · `^` + `m` 플래그: **줄 시작**만 — `const m = await import('./x.mjs')` 는 애초에 매칭 후보가 아니다.
 * · `import\s+`: `import(` 는 `\s+` 가 없어 걸리지 않는다(줄 시작 동적 import 방어).
 * · `[^'"()]*?`: 명세부(`{ a, b }` · `* as ns` · 기본 바인딩)를 건너뛴다. 개행을 허용하므로
 *   여러 줄에 걸친 `import {\n  a,\n} from './x.mjs'` 도 잡는다(이 리포의 실제 스타일).
 *   **괄호를 배제**하므로 `import ('…')` 같은 동적 형태로 새지 않는다.
 * · `(\.[^'"]+)`: 상대경로(`./`·`../`)만 캡처 — 패키지·내장은 첫 글자가 `.` 이 아니라 탈락한다.
 */
const STATIC_IMPORT_RE = /^import\s+(?:[^'"()]*?\s+from\s+)?['"](\.[^'"]+)['"]/gmu

/**
 * 소스 텍스트에서 **정적** 상대 import 지정자를 등장 순서대로 모은다(중복 제거).
 *
 * @param {string} source 모듈 소스 텍스트
 * @returns {string[]} 예: `['./lib/atomic.mjs', './lib/fingerprint.mjs']`
 */
export function staticRelativeImports(source) {
  const out = []
  for (const match of source.matchAll(STATIC_IMPORT_RE)) {
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
