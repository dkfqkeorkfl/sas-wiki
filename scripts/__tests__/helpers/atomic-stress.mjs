#!/usr/bin/env node
// P3 — 원자 발행 동시성 스트레스 드라이버 (AT6 하드 게이트 · tdd §8.2 9p 측정). **`expect` 금지**(규범 D).
//
// 왜 프로세스 2개인가: 단일 프로세스 안에서 "쓰고 나서 읽어보니 멀쩡하더라" 는 **아무것도 증명하지
//   못한다**. Node 는 단일 스레드라 write 와 read 가 애초에 겹치지 않는다. 소비자를 **별도 프로세스**로
//   띄워야 "생산자가 갈아끼우는 동안 소비자가 무엇을 보는가" 가 관측된다.
//
// 판정하지 않는다 — **사실만 센다**. 하드 게이트(컨테이너 로컬 fs 는 0건)는 `atomic.concurrency.test.mjs`
//   가, 9p 대조는 tdd §8.2 측정표가 각각 결론을 낸다(로컬 0 · 9p >0 이면 우리 코드가 아니라 파일시스템).
//
// 사용법:
//   node scripts/__tests__/helpers/atomic-stress.mjs                     # 드라이버 → stdout JSON 1줄
//   CACHE_DIR=/workspace/sas-wiki/.tmp-atomic node …/atomic-stress.mjs   # 9p 경로 측정(tdd §8.2)
//   ROLE=producer node …/atomic-stress.mjs                               # 자식 단독(부트스트랩이 쓴다)
//
// env: CACHE_DIR(기본 mkdtemp) · GENERATIONS(기본 40) · PAYLOAD_KB(기본 256) · ROLE(기본 driver)
//   PAYLOAD_KB 를 KB 단위로 키운 이유(tdd §6 CX18): 수 KB 페이로드는 커널이 1회 write 로 내보내
//   **비원자 구현이어도 찢긴 상태가 잘 재현되지 않는다**. 변이(원자 발행 → 직접 쓰기)가 실제로 red 를
//   내려면 truncate→write 창이 충분히 벌어져야 한다.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SELF = fileURLToPath(import.meta.url)
const GENERATIONS = Number.parseInt(process.env.GENERATIONS ?? '40', 10)
const PAYLOAD_KB = Number.parseInt(process.env.PAYLOAD_KB ?? '256', 10)
const FILLER_LENGTH = PAYLOAD_KB * 1024
const ROLE = process.env.ROLE ?? 'driver'

const targetPath = (cacheDir) => path.join(cacheDir, 'summary.json')
const donePath = (cacheDir) => path.join(cacheDir, 'PRODUCER_DONE')

/** 세대 g 의 정본 — 소비자가 "중간 세대(찢겼거나 섞인 내용)" 를 판별할 수 있게 세대 번호를 심는다. */
function generationPayload(generation) {
  return { filler: 'x'.repeat(FILLER_LENGTH), generation, marker: `generation-${generation}` }
}

async function runProducer(cacheDir) {
  // RED 시점에는 `lib/atomic.mjs` 가 없다 → 로드 실패를 **사실로 보고**하고 끝낸다(죽지 않는다).
  const loaded = await import(new URL('../../lib/atomic.mjs', import.meta.url).href).catch(
    (error) => ({ __loadError: error instanceof Error ? error.message : String(error) }),
  )
  if (loaded.__loadError !== undefined || typeof loaded.writeFileAtomic !== 'function') {
    writeFileSync(donePath(cacheDir), 'load-error')
    return {
      loadError:
        loaded.__loadError ?? 'lib/atomic.mjs 에 writeFileAtomic export 가 없다 (P3 Task 6 미구현)',
      writes: 0,
    }
  }

  let writes = 0
  for (let generation = 1; generation <= GENERATIONS; generation += 1) {
    loaded.writeFileAtomic(targetPath(cacheDir), JSON.stringify(generationPayload(generation)))
    writes += 1
  }
  writeFileSync(donePath(cacheDir), 'ok')
  return { writes }
}

/** 소비자 루프 — 생산자 종료 표식이 보일 때까지 read + JSON.parse 를 반복하며 실패를 분류 집계한다. */
export function consume(cacheDir) {
  const target = targetPath(cacheDir)
  const done = donePath(cacheDir)
  const seen = new Set()
  let enoent = 0
  let parseFail = 0
  let published = false
  let reads = 0
  let unknownGeneration = 0

  // 생산자가 끝나도 한 바퀴 더 돈다 — 마지막 rename 직후 상태까지 관측 범위에 넣는다.
  let trailing = 2
  for (;;) {
    const finished = existsSync(done)
    try {
      const raw = readFileSync(target, 'utf8')
      published = true
      reads += 1
      try {
        const parsed = JSON.parse(raw)
        const intact =
          parsed.marker === `generation-${parsed.generation}` &&
          typeof parsed.filler === 'string' &&
          parsed.filler.length === FILLER_LENGTH
        if (intact) seen.add(parsed.generation)
        else unknownGeneration += 1
      } catch {
        parseFail += 1
      }
    } catch (error) {
      // **최초 발행 이전의 부재는 세지 않는다** — 그건 원자성 결함이 아니라 아직 안 만든 것이다.
      // 한 번이라도 보인 뒤의 부재만이 "갈아끼우는 사이에 파일이 사라졌다" 는 증거다.
      if (error.code === 'ENOENT') {
        if (published) enoent += 1
      } else throw error
    }
    if (finished) {
      trailing -= 1
      if (trailing <= 0) break
    }
  }
  return { enoent, generationsSeen: seen.size, parseFail, reads, unknownGeneration }
}

/**
 * 자식 안에서 생산자를 **비동기로** 띄운 뒤 자신이 소비자가 되는 부트스트랩.
 *
 * `spawnSync` 는 부모를 블록하므로 부모에서 두 자식을 겹쳐 돌릴 수 없다. 그래서 자식 하나를 띄우고
 * 그 안에서 `spawn`(비동기)으로 생산자를 띄운다 — **동시에 도는 프로세스가 2개**가 된다.
 */
const BOOTSTRAP = `
const { spawn } = require('node:child_process')
const self = process.env.SELF_PATH
const producer = spawn(process.execPath, [self], {
  env: { ...process.env, ROLE: 'producer' },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let out = ''
let err = ''
producer.stdout.on('data', (chunk) => { out += chunk })
producer.stderr.on('data', (chunk) => { err += chunk })
import(self).then(async (mod) => {
  const consumer = mod.consume(process.env.CACHE_DIR)
  await new Promise((resolve) => producer.on('close', resolve))
  let parsed
  try { parsed = JSON.parse(out) } catch { parsed = { raw: out.slice(0, 500), stderr: err.slice(0, 800) } }
  process.stdout.write(JSON.stringify({ consumer, producer: parsed }))
})
`

function runDriver() {
  const owned = process.env.CACHE_DIR === undefined
  const cacheDir = process.env.CACHE_DIR ?? mkdtempSync(path.join(tmpdir(), 'wiki-atomic-'))
  mkdirSync(cacheDir, { recursive: true })
  rmSync(donePath(cacheDir), { force: true })
  rmSync(targetPath(cacheDir), { force: true })

  try {
    const child = spawnSync(process.execPath, ['-e', BOOTSTRAP], {
      encoding: 'utf8',
      env: {
        ...process.env,
        CACHE_DIR: cacheDir,
        GENERATIONS: String(GENERATIONS),
        PAYLOAD_KB: String(PAYLOAD_KB),
        ROLE: 'bootstrap',
        SELF_PATH: SELF,
      },
      maxBuffer: 16 * 1024 * 1024,
    })
    let report
    try {
      report = JSON.parse(child.stdout)
    } catch {
      report = { raw: (child.stdout ?? '').slice(0, 800) }
    }
    return {
      ...report,
      cacheDir,
      exitCode: child.status,
      stderr: (child.stderr ?? '').slice(0, 2000),
    }
  } finally {
    if (owned) rmSync(cacheDir, { force: true, recursive: true })
  }
}

if (ROLE === 'producer') {
  process.stdout.write(JSON.stringify(await runProducer(process.env.CACHE_DIR)))
} else if (ROLE === 'consumer') {
  process.stdout.write(JSON.stringify(consume(process.env.CACHE_DIR)))
} else if (process.argv[1] === SELF) {
  process.stdout.write(`${JSON.stringify(runDriver())}\n`)
}
