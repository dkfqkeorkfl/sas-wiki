// @vitest-environment node
//
// P5 · Task 8 — 억제 분리의 **종단 계약** (D-H) — tdd §3.8 (SU6~SU8)
//
// 단위 축은 SU1~SU4 가 물었으나 **v3 P1 이 그 함수와 전용 테스트를 통째로 없앤다**
//   (§4.3 ⑤ · 승계처 없는 의도된 손실 — §4.2). 소비자 캐시 축은 **CS4~CS6** 이 문다.
//   여기서는 **CLI 프로세스**만 관측한다(tdd §7.5) — exit code ·
//   stdout 판정 JSON · 발행된 파일의 **바이트**.
//
// 무엇을 얻는가: 억제 한 줄 편집이 summary 산출물 바이트를 바꾸지 않는다는 계약이 명시된다.
//   D12 의 _"저장만으로 즉시 반영되는 싼 연산"_ 이 복원된다.
// 무엇을 잃는가(D-H 가 **명시적으로 수용**): 생성기 조회 경로가 malformed 억제 목록을 조기 검출하던
//   층이 사라진다. **SU8 이 그 경계를 계약으로
//   못박는다** — 없으면 다음 사람이 회귀로 읽고 되돌린다(OQ-P5-6 = 무변경).
//
// RED 사유:
//   · SU6 — **RED**. 오늘 억제 입력이 summary 바이트를 바꾼다.
//   · SU7 — **RED**. feeds 아티팩트가 발행되지 않는다.
//   · SU8 — **RED(flip)**. 오늘 malformed 억제 vault 에서 생성기 조회 경로가 exit 1 이다.
//
// ★ 단언 강도(tdd §12 ⑥ · plan Task 8 VALIDATE): 선택적 필드 제외가 아니라 **완전 바이트
//   동일**이다. D-B 로 `generatedAt` 까지 억제 무관이 되므로 그것이 성립하고, 약한 형태로 두면
//   **D-B 가 되돌려져도 green** 이다.
//
// 규범 A·B·F: 억제 엔트리는 리터럴이고 tmp git vault 에서만 만든다. "안 변한다" 앞에는 **문서를
//   바꾸면 변한다** 앵커를 둔다.
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { prebuildArtifacts } from './helpers/prebuild-artifacts.mjs'
import { cleanup, commit, feedCommit, git, initVault, writeDoc } from './helpers/tmp-git-vault.mjs'
import { runGeneratorOnce } from './helpers/generator-race.mjs'

const ID_A = '0192a000-0000-7000-8000-0000000000aa'
const ID_B = '0192b000-0000-7000-8000-0000000000bb'
const REL_A = 'company/삼성전자'
const REL_B = 'concept/온디바이스-AI'
const FEED_TS = '2026-05-01T00:00:00Z'
const FEED_TITLE = '삼성 소식'

const IGNORE_FILE = 'ignore-feeds.json'
const IGNORE_WHEN = '2026-07-28T00:00:00Z'
/** 스키마 위반 억제 목록 — `id` 가 12hex 가 아니다. 리터럴이다. */
const IGNORE_BROKEN = '[{"id":"not-12hex","when":"nope"}]'

const summaryFile = (vault, env) => path.join(vault, 'cache', `summary.${env}.json`)
const feedsFile = (vault, env) => path.join(vault, 'cache', `feeds.${env}.json`)

const tmps = []
afterAll(() => cleanup(...tmps))

function seedVault() {
  const vault = initVault()
  tmps.push(vault)
  writeDoc(vault, REL_A, { body: '## 정의\n\n초판.\n', id: ID_A, title: '삼성전자', type: 'company' }) // prettier-ignore
  writeDoc(vault, REL_B, { body: '## 정의\n\n온디바이스 초판.\n', id: ID_B, title: '온디바이스 AI' }) // prettier-ignore
  commit(vault, 'chore: 문서 2건 생성')
  writeDoc(vault, REL_A, { body: '## 정의\n\n갱신.\n', id: ID_A, title: '삼성전자', type: 'company' }) // prettier-ignore
  const feedSha = feedCommit(vault, { date: FEED_TS, subject: FEED_TITLE })
  return { feedId: feedSha.slice(0, 12), vault }
}

const suppressAll = (vault, feedId) =>
  writeFileSync(
    path.join(vault, IGNORE_FILE),
    JSON.stringify([{ id: feedId, when: IGNORE_WHEN }]),
    'utf8',
  )

async function buildStatus(vault, env = 'dev') {
  try {
    const result = await prebuildArtifacts(vault, env)
    return { exitCode: 0, result, stderr: '' }
  } catch (error) {
    return {
      exitCode: 1,
      result: null,
      stderr: error instanceof Error ? error.message : String(error),
    }
  }
}

/** SU6·SU7 공용 — 억제 없음 / 억제 전량을 각각 발행해 바이트를 뜬다. */
let independence

beforeAll(async () => {
  const { feedId, vault } = seedVault()
  const first = await buildStatus(vault)
  const withoutIgnore = {
    feeds: readOrNull(feedsFile(vault, 'dev')),
    summary: readOrNull(summaryFile(vault, 'dev')),
  }

  suppressAll(vault, feedId)
  const second = await buildStatus(vault)
  const withIgnore = {
    feeds: readOrNull(feedsFile(vault, 'dev')),
    summary: readOrNull(summaryFile(vault, 'dev')),
  }

  independence = { feedId, first, second, vault, withIgnore, withoutIgnore }
}, 300_000)

function readOrNull(file) {
  try {
    return readFileSync(file, 'utf8')
  } catch {
    return null
  }
}

describe('summary 산출물은 억제와 무관하다 (SU6 · 🔴RED 오늘 바이트가 다르다)', () => {
  it(
    'SU6: `ignore=[]` 와 `ignore=[전량]` 의 summary 아티팩트가 **완전 바이트 동일** — CLI 프로세스 관측',
    { timeout: 300_000 },
    async () => {
      // plan 비공허성 요구 ⑥ 을 속성으로 고정한다(B14). 완전 동일이어야 D-B 가 되돌려질 때 이
      //   케이스가 red 로 잡는다.
      // ★ 이 파일의 헤더(§ :7)는 "여기서는 CLI 프로세스만 관측한다" 고 선언한다 — 아래 IW2·SU8 은
      //   이미 CLI spawn(`runGeneratorOnce`)으로 관측하는데 이 케이스만 in-process(`prebuildArtifacts`
      //   경유 `buildStatus`)로 남아 있었다. CLI 배선이 깨져도(예: `summary.mjs` 가 `--out` 을
      //   무시하게 되어도) in-process 경로만 보면 못 잡는다 — 관측 층을 헤더 주장과 맞춘다.
      //   (공유 `beforeAll`/`independence`/`buildStatus` 는 그대로 둔다 — SU8 이 "in-process 조회
      //   경로는 malformed 억제에도 관용적이다" 를 바로 그 in-process 층으로 검증해야 하고, 아래
      //   IW2 의 짝 앵커도 그 값을 그대로 재사용한다.)
      const { feedId, vault } = seedVault()
      const out = summaryFile(vault, 'dev')

      const before = runGeneratorOnce({
        args: ['--env', 'dev', '--out', out],
        script: 'summary.mjs',
        vault,
      })
      expect(before.exitCode, before.stderr).toBe(0)
      const withoutIgnore = readOrNull(out)
      // 앵커: 실행이 **실제로 파일을 냈다**.
      expect(withoutIgnore).not.toBeNull()

      suppressAll(vault, feedId)
      rmSync(out, { force: true })
      const after = runGeneratorOnce({
        args: ['--env', 'dev', '--out', out],
        script: 'summary.mjs',
        vault,
      })
      expect(after.exitCode, after.stderr).toBe(0)
      const withIgnore = readOrNull(out)
      expect(withIgnore).not.toBeNull()

      expect(withIgnore).toBe(withoutIgnore)

      // 앵커: **문서를 고치면 바이트가 달라진다**(비교가 죽어서 늘 같은 것을 배제).
      writeDoc(vault, REL_B, { body: '## 정의\n\n또 고쳤다.\n', id: ID_B, title: '온디바이스 AI' }) // prettier-ignore
      rmSync(out, { force: true })
      const changed = runGeneratorOnce({
        args: ['--env', 'dev', '--out', out],
        script: 'summary.mjs',
        vault,
      })
      expect(changed.exitCode, changed.stderr).toBe(0)
      expect(readOrNull(out)).not.toBe(withoutIgnore)
    },
  )
})

// ────────────────────────────────────────────────────────────────────────────────────────────
// v3 P2 · Task 7 — **SU7 축 교체(flip)** (§4.3). 삭제가 아니라 **극성 반전**이다.
//
// 옛 축(SU7): _"두 실행의 feeds 아티팩트가 **바이트 동일**"_ — FA11(억제 **전** 전량)의 논리적
//   귀결이었다. **D20 이 그 전제를 뒤집는다**: `feeds.mjs --ignore <경로>` 가 억제의 유일한 배선이 되고
//   빌드가 그것을 붙이므로, 억제 유/무 두 실행의 아티팩트는 **달라야 한다**.
//
// ★ 이 파일의 **원래 주제는 산다** — 「억제는 summary 산출물에 영향을 주지 않는다」(SU6)는 그대로이고,
//   그것이 IW2 의 앵커다. 방어가 약해진 것이 아니라 **무엇을 계약으로 삼는지가 바뀐 것**이다.
//
// ★ Arrange 를 `independence`(모듈 API `runFeedsGenerator` 경유)에서 **CLI** 로 옮긴 이유: D20 이후
//   억제는 **명시 인자**로만 걸린다(IW6 — 암묵 `loadIgnoreFeeds` 소멸). 인자를 넘기지 않는 경로로
//   관측하면 GREEN 이 옳게 착륙해도 두 실행이 계속 바이트 동일이라 **이 케이스가 영원히 red** 가 된다.
// ────────────────────────────────────────────────────────────────────────────────────────────

describe('억제는 feeds 아티팩트를 바꾼다 (IW2 · SU7 축 교체 · 🔴RED(flip) `--ignore` 미구현)', () => {
  it(
    'IW2: 억제 유/무 두 실행의 feeds 아티팩트가 **바이트 다르다**',
    { timeout: 300_000 },
    async () => {
      const { feedId, vault } = seedVault()
      // ★ 억제되지 **않는** 피드를 하나 더 둔다. `seedVault()` 의 피드는 1건뿐이라 그것을 억제하면
      //   arm B 의 파일이 통째로 비고, 그러면 아래 앵커(_"항목이 통째로 사라진 것이 아니다"_)가
      //   성립할 수 없다 — 그 앵커가 「억제만 걸렸다」와 「전부 사라졌다」를 가르는 축이다.
      writeDoc(vault, REL_B, { body: '## 정의\n\n생존 피드용 갱신.\n', id: ID_B, title: '온디바이스 AI' }) // prettier-ignore
      feedCommit(vault, { date: FEED_TS, subject: '살아남는 소식' })
      const artifact = feedsFile(vault, 'dev')

      // ── arm A: 억제 **없이** 발행 ────────────────────────────────────────────────────────
      const withoutIgnore = publishFeeds(vault)
      expect(withoutIgnore.exitCode, withoutIgnore.stderr).toBe(0)
      const bytesWithout = readOrNull(artifact)
      expect(bytesWithout, 'arm A 가 파일을 내지 않았다').not.toBeNull()
      // 앵커: 억제 대상이 **실제로 그 파일 안에 있었다**(부재 단언의 위험 실재 축).
      expect(JSON.parse(bytesWithout).items.map((item) => item.id)).toContain(feedId)

      // ── arm B: 같은 vault 를 `--ignore` 와 함께 발행 ─────────────────────────────────────
      suppressAll(vault, feedId)
      rmSync(artifact, { force: true })
      const withIgnore = publishFeeds(vault, 'dev', path.join(vault, IGNORE_FILE))
      expect(withIgnore.exitCode, withIgnore.stderr).toBe(0)
      const bytesWith = readOrNull(artifact)
      expect(bytesWith, 'arm B 가 파일을 내지 않았다').not.toBeNull()

      // 🔴 flip — 오늘은 이 두 값이 **같다**(생성기가 억제를 아예 모른다).
      expect(bytesWith, '억제를 붙여도 아티팩트가 바이트 동일하다').not.toBe(bytesWithout)
      expect(JSON.parse(bytesWith).items.map((item) => item.id), '억제 id 가 파일에 남았다').not.toContain(feedId) // prettier-ignore
      // 앵커: 항목이 통째로 사라진 것이 아니다(빈 파일로 통과하는 것을 배제).
      expect(JSON.parse(bytesWith).items.length).toBeGreaterThan(0)

      // ★ 짝 앵커 — **파일의 원래 주제는 산다**: summary 아티팩트는 억제 유/무에 여전히 바이트 동일이다.
      expect(independence.withoutIgnore.summary).not.toBeNull()
      expect(independence.withIgnore.summary).toBe(independence.withoutIgnore.summary)
    },
  )
})

/** CLI 로 feeds 아티팩트를 발행한다 — `--ignore` 는 **명시 인자**여야 관측이 성립한다(IW6). */
function publishFeeds(vault, env = 'dev', ignorePath) {
  const args = ['--env', env, '--count', '200', '--out', feedsFile(vault, env)]
  if (ignorePath !== undefined) args.push('--ignore', ignorePath)
  return runGeneratorOnce({ args, script: 'feeds.mjs', vault })
}

describe('수용한 손실을 계약으로 (SU8 · 🔴RED flip · OQ-P5-6 무변경)', () => {
  it(
    'SU8: malformed 억제 vault 에서 생성기는 exit 0 · `validate`·`feeds` 는 exit≠0',
    { timeout: 300_000 },
    async () => {
      // ★ 이 케이스가 없으면 다음 사람이 "생성기가 조용해졌다" 를 회귀로 읽고 되돌린다. 억제가
      //   **의미를 갖는 지점**(검증·서빙)에서는 여전히 fail-loud 다 — FC10 이 그 짝이다.
      const broken = seedVault()
      writeFileSync(path.join(broken.vault, IGNORE_FILE), IGNORE_BROKEN, 'utf8')

      const clean = seedVault()

      const cleanArrange = await buildStatus(clean.vault)
      const brokenArrange = await buildStatus(broken.vault)
      expect(cleanArrange.exitCode).toBe(0)
      expect(brokenArrange.exitCode).toBe(0)

      // 앵커: 정상 억제 vault 에서는 셋 다 exit 0 이다(전부 죽는 환경이 아니다).
      expect((await buildStatus(clean.vault)).exitCode).toBe(0)
      const cleanValidate = runGeneratorOnce({
        args: ['--env', 'dev'],
        script: 'validate.mjs',
        vault: clean.vault,
      })
      // ★ v3 P2(§4.5-③ · D15·D20) — `--count` 는 CLI 필수이고 억제는 **명시 인자**로만 걸린다.
      //   둘 다 안 주면 이 arm 의 exit≠0 사유가 「인자가 모자라다」로 바뀌어 케이스가 공허해진다.
      const cleanFeeds = runGeneratorOnce({
        args: ['--env', 'dev', '--count', '5', '--ignore', path.join(clean.vault, IGNORE_FILE)],
        script: 'feeds.mjs',
        vault: clean.vault,
      })
      expect(cleanValidate.exitCode).toBe(0)
      expect(cleanFeeds.exitCode).toBe(0)
      expect(`${cleanValidate.stderr}${cleanFeeds.stderr}`).not.toContain('ignore-feeds')

      expect((await buildStatus(broken.vault)).exitCode).toBe(0)
      const brokenValidate = runGeneratorOnce({
        args: ['--env', 'dev'],
        script: 'validate.mjs',
        vault: broken.vault,
      })
      const brokenFeeds = runGeneratorOnce({
        args: ['--env', 'dev', '--count', '5', '--ignore', path.join(broken.vault, IGNORE_FILE)],
        script: 'feeds.mjs',
        vault: broken.vault,
      })
      expect(brokenValidate.exitCode).not.toBe(0)
      expect(brokenFeeds.exitCode).not.toBe(0)
      expect(brokenValidate.stderr).toContain('ignore-feeds')
      expect(brokenFeeds.stderr).toContain('ignore-feeds')

      rmSync(path.join(broken.vault, IGNORE_FILE), { force: true })
    },
  )
})
