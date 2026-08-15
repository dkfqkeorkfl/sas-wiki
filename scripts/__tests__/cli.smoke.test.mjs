// @vitest-environment node
//
// P5 REFACTOR — 3 엔드포인트 CLI(summary/feeds/wiki) 얇은 셸 smoke (구 wiki-serve.smoke → 3파일 분리 반영).
//
// 얇은 셸이라 로직은 endpoints 가 갖는다 — 이 smoke 는 각 CLI 의 argv 파싱·출력·에러 경로만 실 git
//   시딩으로 1회 태워 "셸이 실제로 돈다"를 고정한다(0% 커버리지 → 셸 분기 커버).
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

import { prebuildArtifacts } from './helpers/prebuild-artifacts.mjs'
import { cleanup, commit, feedCommit, initVault, writeDoc } from './helpers/tmp-git-vault.mjs'
import { main as feedsMain } from '../feeds.mjs'
import { main as summaryMain } from '../summary.mjs'
import { main as wikiMain } from '../wiki.mjs'

const ID_A = '0192a000-0000-7000-8000-0000000000aa'
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

/** active 문서 1 + 그 문서를 가리키는 feed 1 (post-D1 — blob 에 id 존재). */
function seed() {
  const vault = initVault()
  writeDoc(vault, 'company/삼성', { id: ID_A })
  commit(vault, 'chore: 삼성 생성')
  writeDoc(vault, 'company/삼성', { body: '## 정의\n\n갱신.\n', id: ID_A })
  feedCommit(vault, { date: '2026-01-05T00:00:00Z', subject: '삼성 소식' })
  return vault
}

/** main 이 process.stdout.write 로 낸 JSON 문자열을 캡처한다. */
async function run(main, argv) {
  const chunks = []
  const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    chunks.push(chunk)
    return true
  })
  try {
    await main(argv)
  } finally {
    spy.mockRestore()
  }
  return chunks.join('')
}

// D3: --vault 누락 시 기본값 = REPO_ROOT(실 repo). vitest 의 GIT_CONFIG_GLOBAL=/dev/null 로 전역
//   safe.directory 예외가 사라져 9p/컨테이너에서 실 repo git 이 dubious-ownership 로 죽으므로 주입한다
//   (build.uuidv7-e2e 관례). tmp vault 케이스엔 무해.
const SAVED_GIT_ENV = {}
// REPO_ROOT 프리빌드 산출물 — **실 repo 의 `cache/` 에 쓰지 않는다.** 예전엔 옵션을 안 줘
//   `prebuildArtifacts` 가 기본 경로(REPO_ROOT/cache/summary.dev.json·feeds.dev.json)에 직접 썼는데,
//   그 경로는 `cli-contract.test.mjs`·다른 스위트도 함께 건드리는 **공유 자원**이다 — 병렬 실행 중
//   결과가 그 시점에 누가 마지막으로 썼는지에 따라 달라지는 비결정적 경합이 생긴다. 격리된 tmp
//   디렉토리에 쓰고, 아래 wiki 스모크가 그 경로를 직접 가리킨다.
let repoRootOutDir
let repoRootSummaryPath
beforeAll(async () => {
  for (const [k, v] of [
    ['GIT_CONFIG_COUNT', '1'],
    ['GIT_CONFIG_KEY_0', 'safe.directory'],
    ['GIT_CONFIG_VALUE_0', REPO_ROOT],
  ]) {
    SAVED_GIT_ENV[k] = process.env[k]
    process.env[k] = v
  }
  repoRootOutDir = mkdtempSync(path.join(tmpdir(), 'wiki-smoke-repo-root-'))
  repoRootSummaryPath = path.join(repoRootOutDir, 'summary.dev.json')
  await prebuildArtifacts(REPO_ROOT, 'dev', {
    artifactPath: repoRootSummaryPath,
    feedsArtifactPath: path.join(repoRootOutDir, 'feeds.dev.json'),
  })
})
afterAll(() => {
  for (const [k, v] of Object.entries(SAVED_GIT_ENV)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  if (repoRootOutDir) rmSync(repoRootOutDir, { force: true, recursive: true })
})

let vault
beforeEach(async () => {
  vault = seed()
  await prebuildArtifacts(vault, 'dev')
})
afterEach(() => {
  cleanup(vault)
})

describe('summary.mjs CLI smoke', () => {
  it('summary → 유효 JSON(docs 에 문서 포함)', async () => {
    const json = JSON.parse(await run(summaryMain, ['--vault', vault, '--env', 'dev']))

    expect(Array.isArray(json.docs)).toBe(true)
    expect(json.docs.some((doc) => doc.id === ID_A)).toBe(true)
  })

  it('--vault 누락 → 기본값 REPO_ROOT 로 실행(throw 안 함 — D3)', async () => {
    const json = JSON.parse(await run(summaryMain, ['--env', 'dev']))
    expect(Array.isArray(json.docs)).toBe(true)
    expect(json.docs.length).toBeGreaterThan(0)
  })
})

describe('feeds.mjs CLI smoke', () => {
  it('feeds → 유효 JSON(items 에 그 피드)', async () => {
    const json = JSON.parse(
      await run(feedsMain, ['--vault', vault, '--env', 'dev', '--count', '5']),
    )

    expect(Array.isArray(json.items)).toBe(true)
    expect(json.items.map((item) => item.title)).toContain('삼성 소식')
  })

  it('--vault 누락 → 기본값 REPO_ROOT 로 실행(throw 안 함 — D3)', async () => {
    const json = JSON.parse(await run(feedsMain, ['--env', 'dev', '--count', '5']))
    expect(Array.isArray(json.items)).toBe(true)
  })
})

describe('wiki.mjs CLI smoke', () => {
  // ★ v3 P4 · D27(§4.1 arm 갱신) — `--summary` 가 **필수**가 됐다. `feeds` 가 D15 때 `--count` 로
  //   받은 것과 같은 형태의 arm 이다: 안 실으면 세 케이스가 전부 exit 2(stdout 침묵) → `JSON.parse('')`
  //   로 죽어 사유가 「배선이 틀렸다」에서 「인자가 모자라다」로 조용히 바뀐다(규범 P).
  //   **이 케이스들이 무는 것은 CLI 배선이지 인자 개수가 아니다.**
  //   ★ 상대 경로를 준다 — `--vault` 기본값(REPO_ROOT) 파생을 무는 세 번째 케이스가 그 해석에 걸린다.
  const REL_SUMMARY_DEV = 'cache/summary.dev.json'

  it('wiki --path → 그 문서 1건(path 미러)', async () => {
    const json = JSON.parse(
      await run(wikiMain, ['--vault', vault, '--env', 'dev', '--path', 'company/삼성', '--summary', REL_SUMMARY_DEV]), // prettier-ignore
    )

    expect(json.path).toBe('company/삼성')
  })

  it('wiki 없는 path → null', async () => {
    expect(JSON.parse(await run(wikiMain, ['--vault', vault, '--env', 'dev', '--path', 'none/x', '--summary', REL_SUMMARY_DEV]))).toBeNull() // prettier-ignore
  })

  it('--vault 누락 → 기본값 REPO_ROOT 로 실행(throw 안 함 — D3)', async () => {
    // ★ 이 arm 만 격리된 `repoRootSummaryPath`(절대 경로)를 준다 — REPO_ROOT 상대 경로
    //   (`cache/summary.dev.json`)를 쓰면 위 beforeAll 이 격리하려고 옮긴 경로와 다시 갈라진다.
    expect(JSON.parse(await run(wikiMain, ['--env', 'dev', '--path', 'no/such', '--summary', repoRootSummaryPath]))).toBeNull() // prettier-ignore
  })

  it('--summary 누락 → exit 2(에러 경로, stdout 은 비어 있다)', async () => {
    // 파일 헤더가 주장하는 "에러 경로" 커버리지가 실제로는 이 파일 안에 한 건도 없었다 — 전 케이스가
    //   성공 경로였다. `main()` 은 `--summary` 미지정을 exit 2 로 거부하는데(wiki.mjs), 그 계약이
    //   깨져도(예: exit code 만 조용히 0 으로 바뀌어도) 이 파일 안에서는 아무것도 못 잡았다.
    //   `process.exitCode` 는 프로세스 전역 상태라 — 이 테스트가 끝나기 전에 반드시 원복한다.
    const before = process.exitCode
    try {
      const stdout = await run(wikiMain, ['--vault', vault, '--env', 'dev', '--path', 'company/삼성']) // prettier-ignore

      expect(stdout).toBe('') // 인자 계약 위반 경로는 stdout 을 쓰지 않는다
      expect(process.exitCode).toBe(2)
    } finally {
      process.exitCode = before
    }
  })
})
