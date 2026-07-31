// @vitest-environment node
//
// P6 · F-8 종결 — grandfathering 라인의 등가성과 사유 재홈 (GF1~GF3) — tdd §3.8 · plan Task 6 · D-C
//
// ── 결론이 먼저다 ───────────────────────────────────────────────────────────────────────────
// `invariants.mjs` 의 `if (statuses.length === 0) continue` 를 **무는 테스트는 원리적으로 쓸 수 없다.**
//   `statuses = []` 이면 `added`·`deleted` 가 **둘 다 빈 배열**이므로 뒤 조건
//   `added.length > 0 && deleted.length > 0` 이 **항상 false** 다. 즉 그 줄은 순수 단축(`.filter()` 2회
//   절약)이고 **관측 가능한 행동 차이가 0**이다 — 교과서적 **등가 변이(equivalent mutant)**.
//
// plan D-C 는 _"무는 케이스를 세우거나 라인을 지운다 — 둘 중 하나"_ 로 열어 뒀지만 실제로는
// **선택지가 하나뿐**이다. 열린 선택지로 두면 구현자가 "무는 케이스" 를 억지로 짜다가 **공허한
// 케이스를 하나 더 만든다**(이 리포에는 그 전력이 있다 — 감사 대응 가드가 3회 연속 결함원이었다).
//
// ── GF1 은 그 결론을 *주장*이 아니라 *관측*으로 만든다 ──────────────────────────────────────
// 두 변종(라인 있음 / 없음)을 **tmp 사본으로 나란히 로드**해 같은 입력 행렬에 돌리고 throw 여부와
// 메시지를 전량 비교한다. 이것은 **§8-7 의 전 스위트 관측을 대체하지 않는다** — 전 스위트는
// "다른 테스트가 그 줄을 무는가" 를 재고, 여기는 "그 줄이 행동을 바꾸는가" 를 잰다. 둘 다 필요하다.
// ★ 만약 여기서 차이가 관측되면 **등가성 판정이 틀린 것이므로 삭제를 중단**하고 그 케이스를 F-8 의
//   답으로 승격한다(§8-7 불일치 처리 · §12-⑥ 철회).
//
// ── RED/green 현황 (작성 시점 실측) ────────────────────────────────────────────────────────
//   GF1  측정  — 지금도 green(등가). Task 6 착륙 **후에도** green 이어야 한다(변종을 양쪽에서 만든다)
//   GF2  pair  — 지금도 green. **삭제가 보호를 줄이지 않았다**를 못박는다
//   GF3  🔴RED — 근거 주석이 아직 **그 줄에** 붙어 있다. 줄과 함께 사라지면 다음 사람이 "왜 빈
//                statuses 를 위반으로 안 보나" 를 재발명한다 → 함수 도크로 **재홈**해야 green
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { describe, expect, it } from 'vitest'

import { checkCommitConventions } from '../invariants.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, '..', '..', '..')
const INVARIANTS_PATH = path.join(REPO_ROOT, 'scripts/lib/invariants.mjs')
const WIKI_PREFIX = 'wiki/'

/** ★ 변이 앵커 — 리터럴이다(규범 A). 이 두 문자열이 없으면 하네스가 **VACUOUS** 로 죽어야 한다. */
const STATUSES_ANCHOR = 'const statuses = getCommitDocStatuses('
const EARLY_CONTINUE = 'if (statuses.length === 0) continue'

/** sha → `git show --name-status` stdout. 기존 `invariants.feed-only.test.mjs:36` 패턴 재사용. */
function stubGitStatuses(byHash) {
  return (args) => (args.includes('show') ? (byHash[args.at(-1)] ?? '') : '')
}

/**
 * 입력 행렬 — **커버리지가 아니라 등가성**을 겨냥한다.
 *
 * 빈 statuses(그 줄이 유일하게 겨냥하는 입력)를 중심에 두고, 그 줄이 없을 때 실행되는 경로
 * (`filter` 2회 → 조건 평가)가 **모든 형태에서** 같은 결과를 내는지 본다.
 */
const STATUS_MATRIX = [
  { label: '빈 statuses(이관 이전 커밋)', raw: '' },
  { label: '수정만', raw: 'M\twiki/company/a.md' },
  { label: '추가만', raw: 'A\twiki/company/a.md' },
  { label: '삭제만', raw: 'D\twiki/company/a.md' },
  { label: '추가+삭제(문서 id 소실 시그니처)', raw: 'A\twiki/tech/x.md\nD\twiki/company/y.md' },
  { label: 'git 이 인식한 rename', raw: 'R100\twiki/company/a.md\twiki/tech/a.md' },
  { label: 'vault 밖 파일만', raw: 'A\tREADME.md\nD\tdocs/old.md' },
]

/** 관측 형태 — throw 여부와 메시지 전문(마스킹 없음: 두 변종은 같은 입력을 받는다). */
function observe(check, raw) {
  const commits = [{ hash: 'c0ffee00gf01', subject: 'chore: 등가성 관측' }]
  try {
    check(commits, stubGitStatuses({ c0ffee00gf01: raw }), WIKI_PREFIX)
    return { threw: false }
  } catch (error) {
    return { message: error instanceof Error ? error.message : String(error), threw: true }
  }
}

/**
 * 두 변종을 tmp 에 써서 로드한다 — **실 소스는 읽기 전용**(규범 F).
 *
 * 상대 import(`./git.mjs`)는 tmp 에서 깨지므로 **절대 file URL 로 치환**한다. 그 치환이 유일한
 * 인위적 변형이고, 양쪽 변종에 **동일하게** 걸리므로 비교를 오염시키지 않는다(A/B 교란 일치와 같은 원리).
 */
async function loadVariants() {
  const source = readFileSync(INVARIANTS_PATH, 'utf8')

  // VACUOUS 가드: 앵커가 없으면 하네스가 아무것도 변이하지 못한 채 "차이 없음" 을 낸다.
  const anchorCount = source.split(STATUSES_ANCHOR).length - 1
  if (anchorCount !== 1)
    throw new Error(`VACUOUS: statuses 앵커가 ${anchorCount}개다(1개여야 한다)`)

  const gitUrl = pathToFileURL(path.join(REPO_ROOT, 'scripts/lib/git.mjs')).href
  const rebase = (text) => text.replace("from './git.mjs'", `from '${gitUrl}'`)

  // 라인 유무와 **무관하게** 두 변종을 결정적으로 만든다 — Task 6 착륙 전후 모두 동작한다.
  const withoutLine = source
    .split('\n')
    .filter((line) => !line.includes(EARLY_CONTINUE))
    .join('\n')
  const withLine = withoutLine
    .split('\n')
    .flatMap((line) => (line.includes(STATUSES_ANCHOR) ? [line, `    ${EARLY_CONTINUE}`] : [line]))
    .join('\n')

  if (withLine === withoutLine) throw new Error('VACUOUS: 두 변종이 동일하다(주입 실패)')

  const dir = mkdtempSync(path.join(tmpdir(), 'p6-gf-'))
  const load = async (text, name) => {
    const file = path.join(dir, name)
    writeFileSync(file, rebase(text), 'utf8')
    return import(pathToFileURL(file).href)
  }
  return {
    cleanup: () => rmSync(dir, { force: true, recursive: true }),
    withLine: await load(withLine, 'with-line.mjs'),
    withoutLine: await load(withoutLine, 'without-line.mjs'),
  }
}

describe('F-8 — 등가 변이 관측 (GF1 측정 · CX-6O)', () => {
  it('GF1: 그 줄의 유무가 `checkCommitConventions` 의 관측 가능한 행동을 바꾸지 않는다', async () => {
    // ★ 이것이 "무는 테스트가 없다" 를 *주장*에서 *관측*으로 바꾼다. 차이가 나오면 §12-⑥ 이 뒤집히고
    //   Task 6(삭제)은 **중단**된다 — 그 경우 여기서 나온 차이가 곧 F-8 이 찾던 케이스다.
    const variants = await loadVariants()
    try {
      const differences = []
      for (const { label, raw } of STATUS_MATRIX) {
        const a = observe(variants.withLine.checkCommitConventions, raw)
        const b = observe(variants.withoutLine.checkCommitConventions, raw)
        if (JSON.stringify(a) !== JSON.stringify(b)) {
          differences.push(`${label}: 있음=${JSON.stringify(a)} 없음=${JSON.stringify(b)}`)
        }
      }

      // 앵커(규범 B): 행렬이 **실제로 양극성**을 갖는다 — 전부 통과하는 입력만 넣으면 "차이 없음" 이
      //   자동으로 참이 된다. 하나는 throw 하고 하나는 통과해야 비교가 의미를 갖는다.
      const throwing = STATUS_MATRIX.filter(
        ({ raw }) => observe(variants.withLine.checkCommitConventions, raw).threw,
      )
      expect(throwing.length).toBeGreaterThanOrEqual(1)
      expect(throwing.length).toBeLessThan(STATUS_MATRIX.length)

      expect(
        differences,
        '등가성이 깨졌다 — **삭제를 중단**하고 이 차이를 F-8 의 답(무는 케이스)으로 승격하라(§8-7).',
      ).toEqual([])
    } finally {
      variants.cleanup()
    }
  })
})

describe('F-8 — 삭제가 보호를 줄이지 않는다 (GF2 pair)', () => {
  it('GF2: 이관 이전 커밋은 여전히 면제되고 A+D 는 여전히 throw 한다', () => {
    // ★ 두 방향을 **한 케이스 안에** 둔다. 한쪽만 두면 "전부 통과"·"전부 실패" 구현이 통과한다.
    //   ①(면제)은 FO7 과 같은 축이지만, 여기서는 *삭제 이후에도 살아 있는가* 를 묻는다 —
    //   그 줄이 사라지면 면제는 `filter` 결과가 비어 조건이 false 인 경로로 **자연히** 유지된다.
    const exempt = [{ hash: 'c0ffee00gf02', subject: 'chore: 옛 규칙 커밋' }]
    expect(() =>
      checkCommitConventions(exempt, stubGitStatuses({ c0ffee00gf02: '' }), WIKI_PREFIX),
    ).not.toThrow()

    const violating = [{ hash: 'c0ffee00gf03', subject: 'chore: 이동하며 재작성' }]
    expect(() =>
      checkCommitConventions(
        violating,
        stubGitStatuses({
          c0ffee00gf03: ['A\twiki/tech/x.md', 'D\twiki/company/y.md'].join('\n'),
        }),
        WIKI_PREFIX,
      ),
    ).toThrow(/컨벤션 위반/)
  })
})

describe('F-8 — 사유 재홈 (GF3 🔴RED)', () => {
  it('GF3: grandfathering 근거가 `checkCommitConventions` 함수 도크에 있고 CN1·FO7 을 지목한다', () => {
    // 🔴 왜 지금 red 인가: 근거 주석이 **삭제 예정인 그 줄 위에** 붙어 있고(`invariants.mjs:19-21`),
    //   함수 도크(`:11`)는 _"커밋 subject 규약이 …"_ 한 줄뿐이라 CN1·FO7 을 지목하지 않는다.
    //   줄과 함께 사유가 사라지면 다음 사람이 "왜 빈 statuses 를 위반으로 안 보나" 를 재발명한다
    //   — 이 리포에서 그 재발명은 **옛 커밋 13건이 영구히 빌드를 죽이는** 결과로 끝난다.
    // GREEN: 삭제하면서 사유를 함수 도크로 옮기고, 그 사유를 지키는 케이스 id(CN1·FO7)를 적는다.
    const source = readFileSync(INVARIANTS_PATH, 'utf8')
    const lines = source.split('\n')
    const signature = lines.findIndex((line) => line.includes('export function checkCommitConventions')) // prettier-ignore

    // 앵커: 함수가 실재한다(파일 구조가 바뀌어 도크를 못 찾은 것과 "도크가 비었다" 를 가른다).
    expect(signature).toBeGreaterThan(0)

    const doc = []
    for (let index = signature - 1; index >= 0; index -= 1) {
      const line = lines[index].trim()
      if (line === '') break
      if (!line.startsWith('*') && !line.startsWith('/*') && !line.startsWith('//')) break
      doc.unshift(line)
    }

    const text = doc.join('\n')
    expect(doc.length, '함수 도크가 없다').toBeGreaterThan(0)
    expect(text, 'grandfathering 근거가 지목해야 할 케이스 id').toContain('CN1')
    expect(text, 'grandfathering 근거가 지목해야 할 케이스 id').toContain('FO7')
  })
})
