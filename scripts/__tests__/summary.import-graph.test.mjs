// @vitest-environment node
//
// P4 · Task 2 — 판정 경로에서 렌더 툴체인을 뗀다 (D-A) — tdd §3.2 (IG1~IG6)
//
// RED 사유:
//   · IG1·IG6 — **RED(오늘 YES)**. `summary.mjs` 가 `parse-vault` 를 정적으로 물고(`summary.mjs:10`),
//     그 사슬이 `derive → render` 로 이어진다(실측: 정적 도달 20모듈 · render 도달 YES).
//     `export function summary(vault, env)` 도 `buildWirePayload` 를 정적으로 문다 → `runSummaryGenerator`
//     만 고쳐서는 끊기지 않는다. OQ-P4-1 = **A**(`summary()` 를 `lib/summary-endpoint.mjs` 로 이동,
//     재export 없음)가 확정됐으므로 GREEN 은 그 이동까지 해야 여기가 green 이 된다.
//   · IG3·IG4·IG5 — **RED(헬퍼 부재)**. 신설 파서 `helpers/static-import-graph.mjs` 가 없다.
//     (작성 시점에 함께 신설하므로 실행 시엔 green 이 될 수 있다 — 그 경우 §3 과의 차이를 보고한다.)
//   · IG2 — **pin(지금도 green)**. `wiki.mjs` 는 본문 HTML 을 실제로 렌더하므로 도달이 **정상**이다.
//
// ★ 왜 벽시계가 아니라 구조인가(tdd §2.4 규범 E): "판정이 몇 초냐" 는 9p 마운트·호스트 부하 의존
//   수치라 임계값을 CI 게이트로 걸면 flaky 하고, 그러면 다음 사람이 **가드를 무력화한다**. 여기서 재는
//   것은 규칙 자체다 — "판정 경로는 렌더 툴체인을 **정적** import 하지 않는다".
//
// ★ 관측 층 분리(tdd §7.5): 이 파일은 **구조만** 문다. "정적으로 안 물었다" 만 단언하면 **아예
//   재생성을 못 하는 구현**도 통과하는데, 그 기능 축은 아래 넷이 이미 문다 — 그것이 IG 의
//   **짝 가드**다(tdd §3.2 · §10.3-4 ②). REFACTOR 때 "IG 와 무관" 이라며 지우지 말 것:
//     · `summary.generator.test.mjs`  GN3(클린 vault → status/excludedCount 실재) · RG1(2회차도 갱신)
//     · `summary.cli-exit.test.mjs`   XC1(exit 0 · 아티팩트 존재) · XC7(exit 3 이어도 산출물 존재)
//   (초판 헤더는 FR1 을 `feeds.verify.test.mjs` 로 적었으나 실제 위치는 `summary.generator.test.mjs`
//    다 — 짝을 못 찾으면 지정이 없는 것과 같으므로 실측 위치로 정정한다.)
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterAll, describe, expect, it } from 'vitest'

import { cleanup } from './helpers/tmp-git-vault.mjs'

// 파서 부재가 파일 전체를 죽이는 collection error 가 되지 않도록 지연 import 로 붙든다(tdd §7.3).
//   rtk 는 collection error 를 PASS 로 오보고하므로, 부재는 **케이스별 명시 실패**여야 한다.
const parser = await import(
  new URL('./helpers/static-import-graph.mjs', import.meta.url).href
).catch((error) => ({ __loadError: error instanceof Error ? error.message : String(error) }))

function graph() {
  if (parser.__loadError !== undefined) {
    throw new Error(
      `[RED] scripts/__tests__/helpers/static-import-graph.mjs 가 아직 없다: ${parser.__loadError}`,
    )
  }
  for (const name of ['importChain', 'staticImportClosure', 'staticRelativeImports']) {
    if (typeof parser[name] !== 'function') {
      throw new Error(`[RED] static-import-graph.mjs 에 ${name} export 가 아직 없다`)
    }
  }
  return parser
}

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SCRIPTS_DIR = path.resolve(HERE, '..')

const SUMMARY = path.join(SCRIPTS_DIR, 'summary.mjs')
const WIKI = path.join(SCRIPTS_DIR, 'wiki.mjs')
/** (P5 · Task 3 · D-E) `feeds` 도 아티팩트 소비자가 된다 → 같은 게이트를 여기에도 세운다(FC1). */
const FEEDS = path.join(SCRIPTS_DIR, 'feeds.mjs')
const DERIVE = path.join(SCRIPTS_DIR, 'lib', 'derive.mjs')
/** 렌더 툴체인의 입구 — 6.9초 import 의 정체(plan B1). 경로는 **리터럴**이다. */
const RENDER = path.join(SCRIPTS_DIR, 'lib', 'render.mjs')
/** 렌더로 이어지는 상류 — IG1 이 red 일 때 "어디를 끊어야 하는가" 를 가리킨다. */
const PARSE_VAULT = path.join(SCRIPTS_DIR, 'lib', 'parse-vault.mjs')

const tmps = []
afterAll(() => cleanup(...tmps))

/** 파서 자신을 시험하기 위한 1파일 tmp 소스 — 실 리포를 건드리지 않는다(규범 F). */
function writeProbe(source) {
  const dir = mkdtempSync(path.join(tmpdir(), 'wiki-ig-probe-'))
  tmps.push(dir)
  const file = path.join(dir, 'probe.mjs')
  writeFileSync(file, source, 'utf8')
  return file
}

/** 실패 메시지에 사슬을 싣는다 — "무엇이 도달했는가" 가 아니라 "어디를 끊어야 하는가" 를 말한다. */
function describeChain(closure, target) {
  const chain = graph().importChain(closure, target)
  if (chain === null) return '(도달하지 않음)'
  return chain.map((file) => path.relative(SCRIPTS_DIR, file)).join(' → ')
}

describe('정적 import 그래프 — 판정 경로 (IG1·IG6 · 🔴RED 오늘 도달 YES)', () => {
  it('IG1: `summary.mjs` 의 정적 전이 폐쇄에 `lib/render.mjs` 가 **없다**', () => {
    // ★ 이 phase 의 핵심 게이트. 위험 실재 앵커는 **IG2** 다 — 같은 파서가 `wiki.mjs` 에서는 도달을
    //   실제로 검출한다. 그 행이 없으면 "항상 빈 집합" 파서가 이 단언을 공허하게 만족시킨다.
    const closure = graph().staticImportClosure(SUMMARY)

    // 앵커: 폐쇄가 비어 있지 않다(파서가 죽어서 "도달 안 함" 이 된 것이 아니다).
    expect(closure.files.length).toBeGreaterThan(1)
    expect(closure.files, `정적 사슬: ${describeChain(closure, RENDER)}`).not.toContain(RENDER)
  })

  it('IG6: `summary.mjs` 의 정적 폐쇄에 `lib/parse-vault.mjs` 가 **없다** (상류 지목)', () => {
    // IG1 과 함께 red → green 으로 움직인다. 여기가 red 인 동안은 "어디를 동적으로 바꿔야 하는지" 가
    //   메시지에 그대로 나온다(재생성 분기에서만 `await import('./lib/parse-vault.mjs')`).
    const closure = graph().staticImportClosure(SUMMARY)

    expect(closure.files.length).toBeGreaterThan(1)
    expect(closure.files, `정적 사슬: ${describeChain(closure, PARSE_VAULT)}`).not.toContain(
      PARSE_VAULT,
    )
  })
})

// ── P5 · Task 3 (D-E) — `feeds.mjs` 도 판정 경로가 된다 (tdd §3.3 FC1 · 🔴RED 오늘 도달 YES) ────
//
//   RED 사유: 오늘 `feeds.mjs:10` 이 `buildWirePayload` 를 정적으로 물고 그 사슬이
//     `parse-vault → derive → render` 로 이어진다(실측 M5: `node_modules` 308 · render 1).
//     전환 후 신선도는 `lib/generator.mjs`(OQ-P5-1=A)에서 오고, 그 재생성 분기는 **동적** import 라
//     정적 폐쇄가 렌더-free 를 유지한다.
//   ★ 이 게이트만으로는 부족하다(규범 G · D-J): 동적 import 는 정적 그래프에 안 잡히므로 게이트가
//     green 인 채 툴체인이 실제로 로드되는 상태가 성립한다(CX-J′). 런타임 짝은 **TR3** 이다.
//   앵커: 같은 파서가 `wiki.mjs` 에서는 도달을 실제로 검출한다(IG2) — 아래 describe 가 그것이다.
describe('정적 import 그래프 — feeds 판정 경로 (FC1 · 🔴RED 오늘 도달 YES)', () => {
  it('FC1: `feeds.mjs` 의 정적 폐쇄에 `parse-vault`·`render`·`derive` 가 **없다**', () => {
    const closure = graph().staticImportClosure(FEEDS)

    // 앵커: 폐쇄가 비어 있지 않다(파서가 죽어서 "도달 안 함" 이 된 것이 아니다).
    expect(closure.files.length).toBeGreaterThan(1)
    expect(closure.files, `정적 사슬: ${describeChain(closure, PARSE_VAULT)}`).not.toContain(
      PARSE_VAULT,
    )
    expect(closure.files, `정적 사슬: ${describeChain(closure, RENDER)}`).not.toContain(RENDER)
    expect(closure.files, `정적 사슬: ${describeChain(closure, DERIVE)}`).not.toContain(DERIVE)
  })
})

describe('정적 import 그래프 — 위험 실재 앵커 (IG2 · 🟢pin)', () => {
  it('IG2: `wiki.mjs` 의 정적 폐쇄에는 `lib/render.mjs` 가 **있다** (도달을 실제로 검출한다)', () => {
    // ★ `wiki` 는 본문 HTML 을 실제로 렌더하므로 도달이 **정상**이다 — 이 행은 IG1 의 앵커이지
    //   `wiki.mjs` 에 대한 요구가 아니다. `feeds.mjs` 는 **P5 소관**이라 여기서 걸지 않는다(§8-2 기록만).
    const closure = graph().staticImportClosure(WIKI)

    expect(closure.files).toContain(RENDER)
  })
})

describe('정적 import 그래프 — 파서 자신의 비-공허성 (IG3~IG5 · 🔴RED 헬퍼 부재)', () => {
  it('IG3: 동적 `await import(…)` **만** 있는 소스 → 빈 목록 (오탐 금지)', () => {
    // ★ 오탐하면 Task 2 를 제대로 해도 IG1 이 red 가 되고, 구현자가 가드를 의심해 무력화한다
    //   (이 리포에서 3회 반복된 실패형). 동적 import 는 D-A 가 **의도적으로 남기는** 형태다.
    const source = [
      'export async function load() {',
      "  const mod = await import('./x.mjs')",
      '  return mod',
      '}',
      "const another = await import('../lib/render.mjs')",
      'export { another }',
    ].join('\n')

    expect(graph().staticRelativeImports(source)).toEqual([])
  })

  it('IG4: 같은 자리에 정적 `import x from "./x.mjs"` → 검출한다 (IG3 의 짝)', () => {
    // IG3 만 있으면 "아무것도 못 찾는 고장난 파서" 가 통과한다.
    const source = ["import x from './x.mjs'", 'export { x }'].join('\n')

    expect(graph().staticRelativeImports(source)).toEqual(['./x.mjs'])
  })

  it('IG4b: 부작용 import(`import "./x.mjs"`)와 여러 줄 import 도 검출한다', () => {
    // CX10 의 변이가 정확히 부작용 import 형태다(`import './lib/render.mjs'`) — 그 형태를 놓치면
    //   반증이 red 를 못 만들고 IG1 은 장식이 된다. 여러 줄 형태는 이 리포의 실제 스타일이다.
    const source = ["import './side.mjs'", 'import {', '  a,', '  b,', "} from './multi.mjs'"].join(
      '\n',
    )

    expect(graph().staticRelativeImports(source)).toEqual(['./side.mjs', './multi.mjs'])
  })

  it('IG5: 패키지·내장 지정자는 **무시**한다 (상대경로만)', () => {
    // 패키지를 폐쇄에 넣으면 `node_modules` 로 새어 나가 단언이 무의미해진다.
    const source = [
      "import fs from 'node:fs'",
      "import { unified } from 'unified'",
      "import { visit } from 'unist-util-visit'",
      "import local from './local.mjs'",
    ].join('\n')

    expect(graph().staticRelativeImports(source)).toEqual(['./local.mjs'])
  })

  it('IG5b: 폐쇄가 파일을 실제로 따라간다 (tmp 2파일 사슬)', () => {
    // 지정자 파싱(IG3~IG5)과 **전이 폐쇄**는 다른 층이다. 폐쇄가 한 단계도 안 내려가면 IG1 이
    //   "진입점만 보고" 통과할 수 있다.
    const entry = writeProbe("import './leaf.mjs'\n")
    const leaf = path.join(path.dirname(entry), 'leaf.mjs')
    writeFileSync(leaf, "export const kind = 'leaf'\n", 'utf8')

    expect(graph().staticImportClosure(entry).files).toEqual([entry, leaf].sort())
  })
})
