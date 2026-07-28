// @vitest-environment node
//
// P5 · Task 7 — F-19·F-20 **근치** — tdd §3.9 (AG1~AG4)
//
// 두 결함은 독립이지만 성질이 같다: **조용한 잘못**이다.
//   · F-19 `atomic.mjs:58-63` — 재시도 대기가 **busy-wait** 다. CPU 를 태우는 것도 문제지만, 진짜
//     문제는 "의존성 0 유지" 를 이유로 그 형태가 정당화돼 왔다는 것이다. `Atomics.wait` 는 **내장**이라
//     의존성을 늘리지 않고 같은 일을 한다.
//   · F-20 `git.mjs:328-334` — `tryGit` 이 **모든 예외를 `''` 로 흡수**한다. 그래서 고장난 git 이
//     "삭제된 적 없음" 으로 둔갑하고, 피드 사유가 `deleted` → `unresolved` 로 뒤집혀 **fail-closed
//     드랍**이 된다(plan Task 7 GOTCHA). 산출물이 셋이 된 지금 그 오분류는 서빙 전체에 퍼진다.
//
// RED 사유:
//   · AG1 — **RED**. 오늘 `atomic.mjs` 에 `while (Date.now() < until)` 이 있다. **CX 지목 = CX-Q**.
//   · AG2b — **RED**. 오늘 대기는 `Atomics.wait` 가 아니다. **CX 지목 = CX-Q′**(sleep 을 통째로
//     제거한 구현을 AG1 은 못 잡는다 — 문자열은 여전히 0회라 green 이다).
//   · AG3·AG4 — **RED**. 오늘 `tryGit` 이 임의 실패까지 흡수한다. **CX 지목 = CX-P**.
//   · AG2 — **pair**(오늘도 green). 재시도 분류 자체는 이미 옳다 — 그것이 사라지지 않았음을 문다.
//
// 관측 층(tdd §7.5): 소스 텍스트(AG1) · 주입 seam 을 통한 거동(AG2·AG2b·AG3) · 실 git tmp vault(AG4).
// 규범 A: 오류 코드·git argv·기대 문자열은 **리터럴**이다. 규범 B: 흡수/거부 양쪽 arm 을 함께 둔다.
import fs, { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'

import { writeFileAtomic } from '../atomic.mjs'
import { anyMarkdown, checkHistoryIntegrity, collectEverDeletedDocPaths, makeGitRunner } from '../git.mjs' // prettier-ignore
import { cleanup, commit, git, initVault, writeDoc } from '../../__tests__/helpers/tmp-git-vault.mjs' // prettier-ignore

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ATOMIC_SOURCE = path.resolve(HERE, '..', 'atomic.mjs')

const ID_A = '0192a000-0000-7000-8000-0000000000aa'
const ID_B = '0192b000-0000-7000-8000-0000000000bb'
const REL_KEEP = 'company/유지문서'
const REL_DROP = 'company/삭제문서'
const DROP_PATH = 'wiki/company/삭제문서.md'

const tmps = []
afterAll(() => cleanup(...tmps))
afterEach(() => vi.restoreAllMocks())

/** git 이 "값이 없다" 로 끝내는 실패(`config --get`) — exit 1 · stderr 없음. 리터럴 shape 다. */
function noValueError() {
  return Object.assign(new Error('Command failed: git config --get …'), {
    status: 1,
    stderr: '',
  })
}

/** 진짜 고장 — exit 128 + fatal stderr. 이것까지 흡수하면 조용한 오분류가 된다. */
function fatalGitError() {
  return Object.assign(new Error('Command failed: git log …'), {
    status: 128,
    stderr: 'fatal: not a git repository (or any of the parent directories): .git\n',
  })
}

/** 재시도 가능 fs 오류(EPERM/EACCES/EBUSY) — `classifyFsError` 가 'retry' 로 분류하는 그 코드들이다. */
function fsError(code) {
  return Object.assign(new Error(`${code}: operation not permitted, rename`), { code })
}

function tmpTarget(name) {
  const dir = mkdtempSync(path.join(tmpdir(), 'wiki-ag-'))
  tmps.push(dir)
  return path.join(dir, name)
}

describe('busy-wait 근치 — 소스 트립와이어 (AG1 · 🔴RED · CX-Q)', () => {
  it('AG1: `atomic.mjs` 에 busy-wait 루프가 없고 `Atomics.wait` 를 쓰며 **의존성이 늘지 않았다**', () => {
    const source = readFileSync(ATOMIC_SOURCE, 'utf8')

    expect([...source.matchAll(/while\s*\(\s*Date\.now\(\)\s*</gu)]).toHaveLength(0)
    expect(source).toContain('Atomics.wait')

    // "의존성 0 유지" 를 파일 스코프로 문다 — 이 모듈의 import 는 전부 **내장**이어야 한다.
    //   (`package.json` 전체를 리터럴로 박으면 무관한 의존성 변경에 브리틀해진다.)
    const specifiers = [...source.matchAll(/^import\s+(?:[^'"()]*?\s+from\s+)?['"]([^'"]+)['"]/gmu)]
    expect(specifiers.length).toBeGreaterThan(0)
    expect(specifiers.map((match) => match[1].startsWith('node:'))).toEqual(
      specifiers.map(() => true),
    )
  })
})

describe('재시도 경로는 여전히 작동한다 (AG2 · 🟩pair)', () => {
  it('AG2: 재시도 가능 오류 뒤 성공하고, 치명 오류는 **즉시** throw 한다', () => {
    // ★ AG1 만 두면 "sleep 을 통째로 지운" 구현이 통과한다 — 이 행은 그 반대편(분류·재시도가
    //   사라지지 않았다)을 문다. 기존 `atomic.test.mjs` 의 분류 케이스와 **축이 다르다**(거동 대 분류).
    const target = tmpTarget('retryable.json')
    const real = fs.renameSync.bind(fs)
    let calls = 0
    vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
      calls += 1
      if (calls <= 2) throw fsError('EPERM')
      return real(from, to)
    })

    writeFileAtomic(target, '{"ok":true}\n')

    expect(calls).toBe(3)
    expect(readFileSync(target, 'utf8')).toBe('{"ok":true}\n')

    const fatalTarget = tmpTarget('fatal.json')
    let fatalCalls = 0
    vi.spyOn(fs, 'renameSync').mockImplementation(() => {
      fatalCalls += 1
      throw fsError('ENOSPC')
    })

    expect(() => writeFileAtomic(fatalTarget, 'x')).toThrow()
    expect(fatalCalls).toBe(1) // 치명 오류는 재시도하지 않는다
    expect(existsSync(fatalTarget)).toBe(false)
  })

  it('AG2b: 재시도 사이에 **실제로 대기한다**(`Atomics.wait` 관측 · 🔴RED · CX-Q′)', () => {
    // 벽시계를 재지 않는다(규범 E) — **구조**를 관측한다. sleep 을 통째로 제거하면(즉시 재시도 스핀)
    //   AG1 은 여전히 green 인 채 이 케이스만 red 가 된다.
    const target = tmpTarget('waited.json')
    const real = fs.renameSync.bind(fs)
    let calls = 0
    vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
      calls += 1
      if (calls <= 1) throw fsError('EBUSY')
      return real(from, to)
    })
    const waitSpy = vi.spyOn(Atomics, 'wait')

    writeFileAtomic(target, 'y')

    // 앵커: 재시도가 실제로 일어났다(1회차 실패 · 2회차 성공).
    expect(calls).toBe(2)
    expect(waitSpy.mock.calls.length).toBeGreaterThan(0)
  })
})

describe('tryGit 은 알려진 양성 실패만 흡수한다 (AG3 · 🔴RED 오늘 포괄 흡수 · CX-P)', () => {
  it('AG3: `config --get` 값 없음은 `""` · 임의 실패는 **rethrow**', () => {
    // MIRROR: `revListFeedCandidates` 가 이미 쓰는 "특정 메시지만 흡수" 패턴이다.
    // 앵커: 흡수 arm 이 **실제로 `''` 를 낸다**(전부 던지는 구현 배제).
    const benign = (args) => {
      if (args[0] === 'config') throw noValueError()
      return 'false\n'
    }
    expect(checkHistoryIntegrity(benign)).toEqual({ partialFilter: '', shallow: false })

    const broken = (args) => {
      if (args[0] === 'config') throw fatalGitError()
      return 'false\n'
    }
    expect(() => checkHistoryIntegrity(broken)).toThrow(/fatal/u)
  })
})

describe('F-20 의 서빙 귀결 (AG4 · 🔴RED 오늘 조용한 빈 결과 · CX-P)', () => {
  it('AG4: 고장난 러너에서 `collectEverDeletedDocPaths` 가 **에러**를 낸다(빈 Set 아님)', () => {
    // plan Task 7 GOTCHA: 흡수된 실패가 "삭제된 적 없음" 으로 둔갑해 피드 사유가 `deleted` →
    //   `unresolved` 로 뒤집히고 **fail-closed 드랍**이 된다. 조용한 빈 결과가 서빙을 바꾼다.
    const vault = initVault()
    tmps.push(vault)
    writeDoc(vault, REL_KEEP, { body: '## 정의\n\n유지되는 문서다.\n', id: ID_A })
    writeDoc(vault, REL_DROP, {
      body: '## 정의\n\n환율 헤지 비율과 결제 통화별 만기 구조를 표로 남긴다.\n',
      id: ID_B,
    })
    commit(vault, 'chore: 문서 2건 생성')
    git(vault, ['rm', '-q', DROP_PATH])
    commit(vault, 'chore: 문서 1건 삭제')

    // 앵커: 정상 러너는 **실제 삭제 경로**를 담는다(항상 비어서 통과하는 것을 배제).
    const healthy = collectEverDeletedDocPaths(makeGitRunner(vault), { isDocPath: anyMarkdown })
    expect([...healthy]).toContain(DROP_PATH)

    const broken = () => {
      throw fatalGitError()
    }
    expect(() => collectEverDeletedDocPaths(broken, { isDocPath: anyMarkdown })).toThrow(/fatal/u)
  })
})

describe('AG5 — 커밋 0건 vault 는 **고장이 아니다** (F-20 좁힘의 과잉 교정 가드)', () => {
  // ★ 이 케이스가 왜 뒤늦게 생겼나: F-20 이 `tryGit` 의 흡수 범위를 `config --get` 하나로 좁혔는데,
  //   **같은 phase 가 얕은 티어를 없애면서**(D-I) `collectDeletedDocEvents`·`collectEverDeletedDocPaths`
  //   가 서빙 경로에서도 항상 돌게 됐다. 예전엔 그 블록이 스킵돼 드러나지 않았고, catch-all 이 이
  //   케이스를 우연히 덮고 있었다. 둘이 겹치자 **커밋 0건 vault 에서 `parseVault` 전체가 죽었다**
  //   (리뷰 실측 → 메인 재현). 766개 테스트 중 아무것도 이 조합을 밟지 않았다.
  //
  //   "삭제 이력이 없다" 는 **참인 상태**이지 고장이 아니다. 좁히기 자체는 옳았고 경계가 한 칸
  //   틀렸을 뿐이라, 넓히는 방향은 이 한 가지 조건에서 멈춘다 — 짝 단언(AG3·AG4)이 임의 실패는
  //   여전히 rethrow 임을 계속 문다.
  it('AG5: 커밋 0건 vault 에서 삭제 이력 조회가 빈 결과다 (임의 실패는 여전히 throw)', () => {
    const vault = initVault() // `git init` 만 — 커밋 0건
    tmps.push(vault)

    // 앵커: 이 vault 는 실제로 git 리포이고 **커밋이 0건**이다(엉뚱한 디렉토리로 통과 배제).
    expect(existsSync(path.join(vault, '.git'))).toBe(true)
    expect(() => git(vault, ['rev-parse', 'HEAD'])).toThrow()

    expect([...collectEverDeletedDocPaths(makeGitRunner(vault), { isDocPath: anyMarkdown })]).toEqual([]) // prettier-ignore

    // 짝: 넓힌 것은 "커밋 없음" 하나뿐이다 — 진짜 고장은 그대로 던진다.
    const broken = () => {
      throw fatalGitError()
    }
    expect(() => collectEverDeletedDocPaths(broken, { isDocPath: anyMarkdown })).toThrow(/fatal/u)
  })
})
