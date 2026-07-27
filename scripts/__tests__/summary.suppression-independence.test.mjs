// @vitest-environment node
//
// P5 · Task 8 — 억제 분리의 **종단 계약** (D-H) — tdd §3.8 (SU5~SU8)
//
// 단위 축(지문 함수 자체)은 `lib/__tests__/fingerprint.suppression-independent.test.mjs`(SU1~SU4)가,
//   소비자 캐시 축은 **CS4~CS6** 이 문다. 여기서는 **CLI 프로세스**만 관측한다(tdd §7.5) — exit code ·
//   stdout 판정 JSON · 발행된 파일의 **바이트**.
//
// 무엇을 얻는가: 억제 한 줄 편집이 전량 재생성 23~26초를 부르던 것이(B10) **0.3초 판정**으로 돌아온다.
//   D12 의 _"저장만으로 즉시 반영되는 싼 연산"_ 이 복원된다.
// 무엇을 잃는가(D-H 가 **명시적으로 수용**): `summary --status` 가 malformed 억제 목록을 조기 검출하던
//   층이 사라진다(지문 변화 → 재생성 → throw 로 _우연히_ 검출하던 것이다). **SU8 이 그 경계를 계약으로
//   못박는다** — 없으면 다음 사람이 회귀로 읽고 되돌린다(OQ-P5-6 = 무변경).
//
// RED 사유:
//   · SU5 — **RED(flip)**. 오늘 억제 저장이 지문을 흔들어 `regenerated === true` 다(P4 FP7).
//   · SU6 — **RED**. 오늘 두 실행의 `inputsFingerprint` 가 달라 바이트가 다르다.
//   · SU7 — **RED**. feeds 아티팩트가 발행되지 않는다.
//   · SU8 — **RED(flip)**. 오늘 malformed 억제 vault 에서 `--status` 가 exit 1 이다(재생성 중 throw).
//
// ★ 단언 강도(tdd §12 ⑥ · plan Task 8 VALIDATE): 「지문 **제외** 바이트 동일」이 아니라 **완전 바이트
//   동일**이다. D-B 로 `generatedAt` 까지 억제 무관이 되므로 그것이 성립하고, 약한 형태로 두면
//   **D-B 가 되돌려져도 green** 이다.
//
// 규범 A·B·F: 억제 엔트리는 리터럴이고 tmp git vault 에서만 만든다. "안 변한다" 앞에는 **문서를
//   바꾸면 변한다** 앵커를 둔다.
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

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

const statusOf = (vault, args = []) => {
  const child = runGeneratorOnce({ args: ['--env', 'dev', '--status', ...args], vault })
  let parsed = null
  try {
    parsed = JSON.parse(child.stdout)
  } catch {
    parsed = null
  }
  return { ...child, parsed }
}

/** SU6·SU7 공용 — 억제 없음 / 억제 전량을 **각각 강제 재생성**해 발행 바이트를 뜬다. */
let independence

beforeAll(async () => {
  const { feedId, vault } = seedVault()
  const first = statusOf(vault, ['--force'])
  const withoutIgnore = {
    feeds: readOrNull(feedsFile(vault, 'dev')),
    summary: readOrNull(summaryFile(vault, 'dev')),
  }

  suppressAll(vault, feedId)
  const second = statusOf(vault, ['--force'])
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

describe('억제 저장은 재생성을 유발하지 않는다 (SU5 · 🔴RED flip · FP7 대체)', () => {
  it(
    'SU5: HEAD 불변 + 억제 목록만 미커밋 저장 → `regenerated === false`',
    { timeout: 300_000 },
    () => {
      // ★ D12 복원의 종단이다(26초 → 0.3초). Task 8 이전에는 이 자리에서 P4 FP7 이 정반대를 단언한다 —
      //   §4.5 ㉑ 이 **같은 커밋에서** 그 파일을 재작성하도록 규정한다.
      const { feedId, vault } = seedVault()

      expect(statusOf(vault).parsed?.regenerated).toBe(true) // 콜드 1회차
      expect(statusOf(vault).parsed?.regenerated).toBe(false) // 앵커: 2회차는 실제로 스킵한다

      const headBefore = git(vault, ['rev-parse', 'HEAD'])
      suppressAll(vault, feedId)

      // 앵커 ①: 저장은 **워킹트리**에만 일어났고 HEAD 는 안 움직였다.
      expect(git(vault, ['status', '--porcelain'])).toContain(IGNORE_FILE)
      expect(git(vault, ['rev-parse', 'HEAD'])).toBe(headBefore)

      expect(statusOf(vault).parsed?.regenerated).toBe(false)

      // 앵커 ②: **문서**를 저장하면 여전히 재생성한다(무효화가 죽지 않았다).
      writeDoc(vault, REL_B, { body: '## 정의\n\n문서를 고쳤다.\n', id: ID_B, title: '온디바이스 AI' }) // prettier-ignore
      expect(statusOf(vault).parsed?.regenerated).toBe(true)
    },
  )
})

describe('summary 산출물은 억제와 무관하다 (SU6 · 🔴RED 오늘 지문이 다르다)', () => {
  it(
    'SU6: `ignore=[]` 와 `ignore=[전량]` 의 summary 아티팩트가 **완전 바이트 동일**',
    { timeout: 300_000 },
    () => {
      // plan 비공허성 요구 ⑥ 을 속성으로 고정한다(B14). **지문 포함** 완전 동일이어야 D-B 가 되돌려질 때
      //   이 케이스가 red 로 잡는다.
      expect(independence.first.exitCode).toBe(0)
      expect(independence.second.exitCode).toBe(0)
      // 앵커: 두 실행 다 **실제로 재생성했다**(`--force`).
      expect(independence.first.parsed?.regenerated).toBe(true)
      expect(independence.second.parsed?.regenerated).toBe(true)
      expect(independence.withoutIgnore.summary).not.toBeNull()

      expect(independence.withIgnore.summary).toBe(independence.withoutIgnore.summary)

      // 앵커: **문서를 고치면 바이트가 달라진다**(비교가 죽어서 늘 같은 것을 배제).
      writeDoc(independence.vault, REL_B, { body: '## 정의\n\n또 고쳤다.\n', id: ID_B, title: '온디바이스 AI' }) // prettier-ignore
      statusOf(independence.vault, ['--force'])
      expect(readOrNull(summaryFile(independence.vault, 'dev'))).not.toBe(
        independence.withoutIgnore.summary,
      )
    },
  )
})

describe('feeds 아티팩트도 억제와 무관하다 (SU7 · 🔴RED 파일 부재)', () => {
  it(
    'SU7: 두 실행의 feeds 아티팩트가 **바이트 동일**하되 응답은 다르다',
    { timeout: 300_000 },
    async () => {
      // FA11(억제 **전** 전량)의 논리적 귀결이다. 파일이 같고 응답이 다르다 = 억제가 **서빙 시점**에만
      //   걸린다는 뜻이고, 그것이 R1 채택안(비-입력 선언)의 안전 조건이다.
      expect(independence.withoutIgnore.feeds).not.toBeNull()
      expect(independence.withIgnore.feeds).toBe(independence.withoutIgnore.feeds)

      // 앵커: 같은 vault 의 **응답**은 서로 다르다(억제가 실제로 걸린다).
      const feedsModule = await import(new URL('../feeds.mjs', import.meta.url).href)
      const page = await feedsModule.feeds(independence.vault, 'dev', {})
      expect(page.items.map((item) => item.id)).not.toContain(independence.feedId)
    },
  )
})

describe('수용한 손실을 계약으로 (SU8 · 🔴RED flip · OQ-P5-6 무변경)', () => {
  it(
    'SU8: malformed 억제 vault 에서 `--status` 는 exit 0 · `validate`·`feeds` 는 exit≠0',
    { timeout: 300_000 },
    () => {
      // ★ 이 케이스가 없으면 다음 사람이 "`--status` 가 조용해졌다" 를 회귀로 읽고 되돌린다. 억제가
      //   **의미를 갖는 지점**(검증·서빙)에서는 여전히 fail-loud 다 — FC10 이 그 짝이다.
      const broken = seedVault()
      writeFileSync(path.join(broken.vault, IGNORE_FILE), IGNORE_BROKEN, 'utf8')

      const clean = seedVault()

      // 앵커: 정상 억제 vault 에서는 셋 다 exit 0 이다(전부 죽는 환경이 아니다).
      expect(runGeneratorOnce({ args: ['--env', 'dev', '--status'], vault: clean.vault }).exitCode).toBe(0) // prettier-ignore
      expect(runGeneratorOnce({ args: ['--env', 'dev'], script: 'validate.mjs', vault: clean.vault }).exitCode).toBe(0) // prettier-ignore
      expect(runGeneratorOnce({ args: ['--env', 'dev'], script: 'feeds.mjs', vault: clean.vault }).exitCode).toBe(0) // prettier-ignore

      expect(runGeneratorOnce({ args: ['--env', 'dev', '--status'], vault: broken.vault }).exitCode).toBe(0) // prettier-ignore
      expect(runGeneratorOnce({ args: ['--env', 'dev'], script: 'validate.mjs', vault: broken.vault }).exitCode).not.toBe(0) // prettier-ignore
      expect(runGeneratorOnce({ args: ['--env', 'dev'], script: 'feeds.mjs', vault: broken.vault }).exitCode).not.toBe(0) // prettier-ignore

      rmSync(path.join(broken.vault, IGNORE_FILE), { force: true })
    },
  )
})
