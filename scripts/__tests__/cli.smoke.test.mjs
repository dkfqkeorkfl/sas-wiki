// @vitest-environment node
//
// P5 REFACTOR — 3 엔드포인트 CLI(summary/feeds/wiki) 얇은 셸 smoke (구 wiki-serve.smoke → 3파일 분리 반영).
//
// 얇은 셸이라 로직은 endpoints 가 갖는다 — 이 smoke 는 각 CLI 의 argv 파싱·출력·에러 경로만 실 git
//   시딩으로 1회 태워 "셸이 실제로 돈다"를 고정한다(0% 커버리지 → 셸 분기 커버).
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

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
beforeAll(async () => {
  for (const [k, v] of [
    ['GIT_CONFIG_COUNT', '1'],
    ['GIT_CONFIG_KEY_0', 'safe.directory'],
    ['GIT_CONFIG_VALUE_0', '*'],
  ]) {
    SAVED_GIT_ENV[k] = process.env[k]
    process.env[k] = v
  }
  await prebuildArtifacts(REPO_ROOT, 'dev')
})
afterAll(() => {
  for (const [k, v] of Object.entries(SAVED_GIT_ENV)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
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
    const json = JSON.parse(await run(feedsMain, ['--env', 'dev']))
    expect(Array.isArray(json.items)).toBe(true)
  })
})

describe('wiki.mjs CLI smoke', () => {
  it('wiki --path → 그 문서 1건(path 미러)', async () => {
    const json = JSON.parse(
      await run(wikiMain, ['--vault', vault, '--env', 'dev', '--path', 'company/삼성']),
    )

    expect(json.path).toBe('company/삼성')
  })

  it('wiki 없는 path → null', async () => {
    expect(JSON.parse(await run(wikiMain, ['--vault', vault, '--env', 'dev', '--path', 'none/x']))).toBeNull() // prettier-ignore
  })

  it('--vault 누락 → 기본값 REPO_ROOT 로 실행(throw 안 함 — D3)', async () => {
    expect(JSON.parse(await run(wikiMain, ['--env', 'dev', '--path', 'no/such']))).toBeNull()
  })
})
