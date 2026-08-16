// @vitest-environment node
//
// `feeds()` 모듈 API 의 env/count 미검증(모듈 직접 호출) 과 feeds CLI `--count` 의 상한 부재
// (자원 고갈 가능)를 겨냥한 회귀 프로브.
//
// 결함 1(모듈 API): `feeds(vault, env, window)` 는 두 번째·세 번째 인자를 검증하지 않는다.
//   `window.count: 0` 을 직접 넘기면 결과가 vault 상태에 따라 갈린다 — **피드로 잡히는 커밋이
//   있는** vault 는 내부 커서 워크가 빈 페이지 위에서 마지막 항목에 접근해 TypeError 로 죽고,
//   피드가 0건인 vault(HEAD 는 있으나 `feed:` 커밋이 없다)는 아무 사유도 없이 빈 페이지를
//   조용히 낸다. `env` 열거 밖 값도 같은 이유로 응답 봉투까지 그대로 흘러간다. 어느 경로도
//   "무엇이 왜 잘못됐는지" 를 호출자에게 말하지 않는다.
//
// 결함 2(CLI): `--count` 는 하한(1 이상 정수)만 검증하고 상한이 없어, 임의로 큰 값이 그대로
//   git rev-list 의 배치 상한으로 전달된다(자원 고갈 가능). `package.json` 의 `build`·`build-dev`
//   는 이미 `--count 200` 을 쓰므로 상한은 그 값 이상이어야 한다.
//
// ★ 픽스처는 전부 **커밋 1건 이상**을 갖는다 — `feeds()` 는 응답 `sourceCommit` 을 위해 무조건
//   `git rev-parse HEAD` 를 부르므로, 진짜 0-커밋(HEAD 부재) vault 는 count/env 값과 무관하게
//   그 호출에서 죽는다. 그 경로는 이 배치의 대상이 아니므로(범위 밖 관찰) 여기서는 피한다.
import { afterAll, describe, expect, it } from 'vitest'

import { cleanup, commit, initVault, writeDoc } from './helpers/tmp-git-vault.mjs'
import { runFeedsCli, seedFeedVault } from './helpers/cursor-vault.mjs'

const { feeds } = await import(new URL('../feeds.mjs', import.meta.url).href)

const ID_DOC = '0192f000-0000-7000-8000-0000000000f1'

const tmps = []
afterAll(() => cleanup(...tmps))

/** HEAD 가 있는(커밋 1건) vault — `feed:` 접두 커밋은 없다(= 피드 0건 상태). */
function seedNoFeedVault() {
  const vault = initVault()
  tmps.push(vault)
  writeDoc(vault, 'company/피드없음', { id: ID_DOC, title: '피드없음' })
  commit(vault, 'chore: 문서 1건(피드 아님)')
  return vault
}

describe('feeds() 모듈 API — count/env 미검증 회귀 프로브', () => {
  it('count:0 은 피드가 있는 vault 에서도 TypeError 로 새지 않고 fail-loud 사유를 말한다', async () => {
    const { vault } = seedFeedVault({ feedCount: 1 })
    tmps.push(vault)

    await expect(feeds(vault, 'dev', { count: 0 })).rejects.toThrow(/count/u)
  })

  it('count:0 은 피드가 0건인 vault 에서도 같은 사유로 fail-loud 한다(조용한 빈 페이지가 아니다)', async () => {
    const vault = seedNoFeedVault()

    await expect(feeds(vault, 'dev', { count: 0 })).rejects.toThrow(/count/u)
  })

  it('회귀 방지 앵커: 정상 count 값은 그대로 통과한다', async () => {
    const vault = seedNoFeedVault()

    await expect(feeds(vault, 'dev', { count: 1 })).resolves.toBeDefined()
  })

  it('env 열거 밖 값은 응답 봉투로 새지 않고 즉시 거절된다', async () => {
    const vault = seedNoFeedVault()

    await expect(feeds(vault, 'staging', {})).rejects.toThrow(/--env/u)
  })
})

describe('feeds CLI — `--count` 상한 부재 회귀 프로브', () => {
  it('과도한 --count 는 exit 2 · stdout 침묵으로 거절된다(자원 고갈 방지)', () => {
    const vault = seedNoFeedVault()

    const result = runFeedsCli(vault, { count: '1000000000' })

    expect(result.status, `stdout=${result.stdout}`).toBe(2)
    expect(result.stdout).toBe('')
    expect(result.stderr).toMatch(/count/iu)
  })

  it('회귀 방지 앵커: 빌드 체인이 쓰는 --count 200 은 계속 exit 0 이다', () => {
    const vault = seedNoFeedVault()

    const result = runFeedsCli(vault, { count: '200' })

    expect(result.status, result.stderr).toBe(0)
  })
})
