// P5 — 동시 생성기 드라이버 (D-K · R3 반례 1). **`expect` 금지**(규범 D).
//
// 왜 필요한가: `plugin.ts:442-448` 은 _"같은 산출물에 쓰는 writer 가 둘 이상인 상황은 지금 성립하지
//   않는다"_ 고 **주석으로** 적었다. 산출물이 3개가 되고 `feeds`·`wiki` 도 재생성을 트리거할 수 있게
//   되면서 그 가정의 하중이 3배가 됐다 — **주석은 회귀를 못 막는다**. `atomic-stress.mjs`(AT6)의
//   드라이버 형태를 계승해 자식 프로세스를 실제로 겹쳐 돌리고 **사실만** 돌려준다.
//
// 판정하지 않는다 — 하드 게이트(컨테이너 로컬 fs 는 찢어진 세트 0건)는 `generator.multi-writer.test.mjs`
//   가, 9p 대조는 tdd §8-9 측정표가 각각 결론을 낸다.
//   (vitest 기본 include 는 `*.test.mjs` 만 잡으므로 helpers/*.mjs 는 테스트로 수집되지 않는다 — 의도.)
//
// 규범 A: 산출물 경로·producer·버전은 **리터럴**이다. 프로덕션 상수를 import 해 기대값을 만들지 않는다
//   (읽기 자체는 프로덕션 `readArtifact` 를 쓴다 — 그것이 관측 대상 seam 이기 때문이다).
import { spawn, spawnSync } from 'node:child_process'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPTS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const ARTIFACT_MODULE = path.join(SCRIPTS_DIR, 'lib', 'artifact.mjs')

/** 발행물 3종 — `{ kind, producer, rel }`. 경로·표지는 리터럴이다. */
const PUBLICATIONS = [
  { kind: 'summary', producer: 'sas-wiki/summary', rel: ['cache', 'summary.<env>.json'] },
  { kind: 'feeds', producer: 'sas-wiki/feeds', rel: ['cache', 'feeds.<env>.json'] },
  { kind: 'report', producer: 'sas-wiki/report', rel: ['logs', 'summary.report.<env>.json'] },
]

const SCHEMA_VERSION = 3

/** 소비자 자식 — 생산자들이 갈아끼우는 동안 세 산출물을 **프로덕션 독자**로 반복해 읽는다. */
const CONSUMER_SOURCE = `
import { readFileSync, existsSync } from 'node:fs'
const mod = await import(process.env.ARTIFACT_MODULE).catch((e) => ({ __err: String(e) }))
const files = JSON.parse(process.env.RACE_FILES)
const done = process.env.RACE_DONE
const counts = {}
const byKind = {}
const fingerprints = new Set()
let reads = 0
let trailing = 2
for (;;) {
  const finished = existsSync(done)
  for (const entry of files) {
    reads += 1
    if (mod.__err !== undefined || typeof mod.readArtifact !== 'function') {
      counts['load-error'] = (counts['load-error'] ?? 0) + 1
      continue
    }
    const verdict = mod.readArtifact({
      expect: {
        env: entry.env,
        inputsFingerprint: '', // 절대 일치하지 않는다 — 모든 읽기가 **사유**를 내게 한다
        producer: entry.producer,
        schemaVersion: ${SCHEMA_VERSION},
      },
      path: entry.file,
    })
    const reason = verdict.fresh ? 'fresh' : verdict.reason
    counts[reason] = (counts[reason] ?? 0) + 1
    byKind[entry.kind] = byKind[entry.kind] ?? {}
    byKind[entry.kind][reason] = (byKind[entry.kind][reason] ?? 0) + 1
    if (entry.kind === 'summary') {
      try {
        const raw = JSON.parse(readFileSync(entry.file, 'utf8'))
        if (typeof raw.inputsFingerprint === 'string') fingerprints.add(raw.inputsFingerprint)
      } catch {}
    }
  }
  if (finished) {
    trailing -= 1
    if (trailing <= 0) break
  }
}
process.stdout.write(JSON.stringify({ byKind, counts, generationsSeen: fingerprints.size, reads }))
`

/**
 * 생성기 자식 N개를 **동시에** 띄운다(라운드마다 반복). 선택적으로 소비자 자식을 함께 돌린다.
 *
 * @param {{ children: {args: string[], script: string}[], env: string, onRound?: (round: number) => void,
 *           rounds?: number, timeoutMs?: number, vault: string, withConsumer?: boolean }} input
 * @returns {Promise<{ artifacts: {file: string, fingerprint: string|null, kind: string, parsed: object|null}[],
 *                     consumer: object|null, producers: {exitCode: number|null, stderr: string, stdout: string}[] }>}
 */
export async function runGeneratorRace({
  children,
  env,
  onRound,
  rounds = 1,
  timeoutMs = 240_000,
  vault,
  withConsumer = false,
}) {
  const donePath = path.join(vault, '.race-done')
  rmSync(donePath, { force: true })

  const files = PUBLICATIONS.map((publication) => ({
    env,
    file: path.join(vault, ...publication.rel.map((part) => part.replace('<env>', env))),
    kind: publication.kind,
    producer: publication.producer,
  }))

  const consumer = withConsumer
    ? spawn(process.execPath, ['--input-type=module', '-e', CONSUMER_SOURCE], {
        env: {
          ...process.env,
          ARTIFACT_MODULE: pathToUrl(ARTIFACT_MODULE),
          RACE_DONE: donePath,
          RACE_FILES: JSON.stringify(files),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    : null
  let consumerOut = ''
  consumer?.stdout.on('data', (chunk) => {
    consumerOut += chunk
  })

  const producers = []
  try {
    for (let round = 0; round < rounds; round += 1) {
      onRound?.(round)
      const started = children.map((child) =>
        runChild(
          path.join(SCRIPTS_DIR, child.script),
          ['--vault', vault, ...child.args],
          timeoutMs,
        ),
      )
      producers.push(...(await Promise.all(started)))
    }
  } finally {
    writeFileSync(donePath, 'ok')
  }

  if (consumer !== null) await new Promise((resolve) => consumer.on('close', resolve))
  rmSync(donePath, { force: true })

  return {
    artifacts: files.map((entry) => ({ ...entry, ...readPublication(entry.file) })),
    consumer: parseJsonOrNull(consumerOut),
    producers,
  }
}

/** 자식 하나를 **비동기로** 띄운다 — `spawnSync` 로는 부모가 블록돼 겹쳐 돌릴 수 없다(AT6 선례). */
function runChild(scriptPath, args, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      env: {
        ...process.env,
        GIT_CONFIG_COUNT: '1',
        GIT_CONFIG_KEY_0: 'safe.directory',
        GIT_CONFIG_VALUE_0: '*',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs)
    child.on('close', (exitCode) => {
      clearTimeout(timer)
      resolve({ exitCode, stderr, stdout })
    })
  })
}

function readPublication(file) {
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    return { fingerprint: parsed?.inputsFingerprint ?? null, parsed }
  } catch {
    return { fingerprint: null, parsed: null }
  }
}

function parseJsonOrNull(raw) {
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function pathToUrl(absolute) {
  return new URL(`file://${absolute}`).href
}

/** 자식 하나를 동기로 돌리는 편의(워밍업 등) — 경합이 아닌 준비 단계 전용이다. */
export function runGeneratorOnce({ args = [], script = 'summary.mjs', vault }) {
  const child = spawnSync(
    process.execPath,
    [path.join(SCRIPTS_DIR, script), '--vault', vault, ...args],
    {
      // prettier-ignore
      encoding: 'utf8',
      env: {
        ...process.env,
        GIT_CONFIG_COUNT: '1',
        GIT_CONFIG_KEY_0: 'safe.directory',
        GIT_CONFIG_VALUE_0: '*',
      },
      maxBuffer: 64 * 1024 * 1024,
    },
  )
  return { exitCode: child.status, stderr: child.stderr ?? '', stdout: child.stdout ?? '' }
}
