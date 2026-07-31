// @vitest-environment node
//
// P6 · 배관 — 거짓 서술 트립와이어와 스캔 무해성 (PL14·PL16·PL17) — tdd §3.9 · plan Task 8 · F-26
//
// ── 왜 "주석 한 줄" 에 테스트를 다는가 ──────────────────────────────────────────────────────
// 규범 I 는 **산문을 결속하지 않는다**고 못박았다. 여기 세 케이스는 그 규범의 **경계 사례**이고,
// 셋 다 "역사 서술인가 현재형 지시인가" 가 기계적으로 결정 가능하다는 공통점이 있다:
//   PL14  `.prettierignore` 의 사유 주석 — **왜 이 경로를 무시하는가**를 말한다. 근거가 거짓이면
//         다음 사람이 무시 규칙을 지운다(그리고 서브모듈 워킹트리가 포매터에 오염된다)
//   PL17  `usage()` **반환 문자열** — 역사 서술이 아니라 **현재형 지시**다. 복붙하면 실패한다
//   PL16  스캔이 워킹트리를 건드리지 않는다 — 서술이 아니라 **행동**이다
//
// 나머지 `scripts/wiki/` 20줄 · `vitest.config.ts` 6줄 등은 **역사 서술**이므로 대상이 아니다(§9).
//
// ── RED/green 현황 (작성 시점 실측) ────────────────────────────────────────────────────────
//   PL14  🔴RED — `.prettierignore:5` 가 _"commit hashes are document ids"_ 라 적는다. D1 이 폐기했다
//   PL17  🔴RED — `usage()` 가 `scripts/wiki/seed-example-vault.mjs` 를 안내한다(P5 이관 전 경로)
//   PL16  pin   — 스캔 무해성. 지금도 green
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const scanModule = await import(new URL('./helpers/tracked-scan.mjs', import.meta.url).href).then(
  (module) => module,
  (error) => ({ loadError: error }),
)

function trackedScan() {
  if (scanModule.loadError) throw scanModule.loadError
  return scanModule
}

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, '..', '..')

const read = (rel) => readFileSync(path.join(REPO_ROOT, rel), 'utf8')

/** ★ D1 이 폐기한 정체성 모델의 **영문 원문**. 리터럴이다(규범 A). */
const FALSE_ID_CLAIM = 'commit hashes are document ids'

/** 워킹트리 상태 스냅샷 — 9p 소유자 보정은 자식 env 로만(프로세스 전역 변이 금지). */
function porcelain() {
  return execFileSync('git', ['-C', REPO_ROOT, 'status', '--porcelain'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'safe.directory',
      GIT_CONFIG_VALUE_0: REPO_ROOT,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

describe('배관 — `.prettierignore` 의 거짓 근거 (PL14 🔴RED · CX-6P)', () => {
  it('PL14: 무시 사유가 "커밋 해시 = 문서 id" 를 말하지 않고 실제 근거를 말한다', () => {
    // 🔴 왜 지금 red 인가: `.prettierignore:5` 가 _"Wiki entries are append-only data whose commit
    //   hashes are document ids."_ 라 적는다. **D1 이 그 모델을 폐기**했다 — 문서 id 는 frontmatter 에
    //   저작된 UUIDv7 이고 커밋 해시가 아니다. 커밋 해시가 정체성인 것은 **피드 id(12자)** 다.
    // ★ 무시 규칙 자체는 **여전히 옳다**(append-only 데이터를 포매터가 건드리면 되돌릴 수 없는 커밋이
    //   생긴다). 그래서 GREEN 은 규칙을 지우는 것이 아니라 **사유를 바로잡는 것**이다.
    const source = read('.prettierignore')

    // 앵커 ①: 무시 규칙이 살아 있다 — 주석을 지우며 규칙까지 날리는 GREEN 을 배제한다.
    expect(source.split('\n').map((line) => line.trim())).toContain('wiki')

    const offenders = source
      .split('\n')
      .map((line, index) => (line.includes(FALSE_ID_CLAIM) ? `.prettierignore:${index + 1}` : null))
      .filter(Boolean)
    expect(offenders, `폐기된 정체성 모델("${FALSE_ID_CLAIM}")`).toEqual([])

    // 앵커 ②: 교정 문언이 **실제 근거**를 담는다(문장을 통째로 지워 통과하는 길을 막는다).
    expect(source, '무시 사유에 현행 정체성 모델을 적어라').toMatch(/frontmatter|UUIDv7/i)
  })
})

describe('배관 — 스캔은 워킹트리를 건드리지 않는다 (PL16 pin)', () => {
  it('PL16: 추적 스캔 전후로 `git status --porcelain` 이 동일하고 산출물 경로가 무시된다', () => {
    // ★ 규범 F 의 기계적 확인. 스캔이 캐시·로그를 남기면 그 자체가 "테스트가 제품 데이터를 조작했다" 다.
    // ★ tdd 는 _"porcelain 이 **비어 있다**"_ 로 적었지만 여기서는 **전후 동일**로 잰다 — RED 단계에는
    //   신규 가드 파일이 untracked 로 떠 있어 "비어 있음" 이 구조적으로 불가능하고, 무엇보다 이
    //   케이스가 겨냥하는 것은 트리 청결이 아니라 **스캔의 부작용 없음**이다(§보고).
    const before = porcelain()

    const { listTracked, scanTracked } = trackedScan()
    const { files } = listTracked(REPO_ROOT)
    const scan = scanTracked({ files, pattern: /README/, repoRoot: REPO_ROOT })

    // 앵커: 스캔이 실제로 파일을 읽었다(아무것도 안 하고 "부작용 없음" 이 참이 되는 것을 배제).
    expect(scan.scannedFiles).toBeGreaterThan(0)
    expect(scan.scannedLines).toBeGreaterThan(0)

    expect(porcelain(), '스캔이 워킹트리를 바꿨다').toBe(before)

    // 산출물 경로가 추적·스캔 범위 밖임을 문서가 아니라 설정으로 확인한다(D-H 의 전제).
    const ignored = read('.gitignore')
      .split('\n')
      .map((line) => line.trim())
    for (const entry of ['node_modules', 'logs', 'cache']) expect(ignored).toContain(entry)
  })
})

describe('배관 — `usage()` 는 현재형 지시다 (PL17 🔴RED)', () => {
  it('PL17: `usage()` 가 안내하는 스크립트 경로가 실재한다', () => {
    // 🔴 왜 지금 red 인가: 시더의 `usage()` 가 `node scripts/wiki/seed-example-vault.mjs …` 를 낸다.
    //   P5 가 그 스크립트를 `scripts/__tests__/helpers/` 로 옮겼으므로 **그 경로에는 아무것도 없다** —
    //   안내대로 복붙하면 `Cannot find module` 로 죽는다.
    // ★ 규범 I 의 안전한 축소판: 같은 파일의 `scripts/wiki/` 언급 중에도 *역사 서술*은 존치한다.
    //   결속하는 것은 **반환 문자열**(사용자가 그대로 실행하는 값)뿐이다.
    const rel = 'scripts/__tests__/helpers/seed-example-vault.mjs'
    const source = read(rel)

    const usageBody = source.slice(source.indexOf('function usage()'))
    const guided = usageBody.match(/node\s+(\S+\.mjs)/)

    // 앵커: `usage()` 가 실재하고 실제로 경로를 안내한다(못 찾아서 통과하는 것을 배제).
    expect(source, `${rel} 에 usage() 가 있다`).toContain('function usage()')
    expect(guided, 'usage() 반환 문자열에서 `node <path>` 를 못 찾았다').not.toBeNull()

    expect(
      existsSync(path.join(REPO_ROOT, guided[1])),
      `usage() 가 안내하는 경로가 없다: ${guided[1]} — 복붙하면 실패한다`,
    ).toBe(true)
  })
})
