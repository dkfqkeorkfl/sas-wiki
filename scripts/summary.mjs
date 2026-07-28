#!/usr/bin/env node
// summary **생성기 CLI 껍데기** — 판정·발행은 전부 `lib/generator.mjs`(`runSummaryGenerator`)가 한다.
//
// ★ OQ-P5-1 = A: `runSummaryGenerator` 는 `lib/generator.mjs` 로 옮겼다(재export 없음). 이 파일은
//   argv 파싱·exit code·stdout 포맷만 남은 **CLI 껍데기**다 — `feeds.mjs`·`wiki.mjs` 는 이 파일이
//   아니라 `lib/generator.mjs` 를 직접 문다(CLI 가 CLI 를 물지 않는다).
//   이 파일의 **정적** import 그래프에도 여전히 파싱·렌더 툴체인이 들어오면 안 된다 — `lib/generator.mjs`
//   가 재생성 분기에서만 동적으로 열기 때문이다. 이 규칙은 산문이 아니라 정적 import 그래프 테스트가
//   지킨다.
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { envEnumError } from './lib/cli-env.mjs'
import { runSummaryGenerator } from './lib/generator.mjs'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..')

export async function main(argv = process.argv.slice(2)) {
  let options
  try {
    options = parseCliArgs(argv)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 2
    return
  }

  try {
    const result = await runSummaryGenerator(options)
    if (options.status) {
      process.stdout.write(`${JSON.stringify(statusPayload(result, options.env))}\n`)
    } else {
      process.stdout.write(`${JSON.stringify(result.payload)}\n`)
    }
    // `--stdout` 은 **아무것도 쓰지 않는다**(side-effect-free 질의). 그런데도 산출물 경로를 찍으면
    //   "저 파일이 갱신됐다" 는 거짓을 말하게 된다 — 실제로는 그 경로가 옛 세대 그대로다.
    if (!options.writeSideEffects) {
      console.error(
        `[wiki] summary computed status=${result.status} excluded=${result.excludedCount} (--stdout: 아티팩트·리포트 미기록)`,
      )
    } else if (result.regenerated) {
      console.error(
        `[wiki] summary regenerated status=${result.status} excluded=${result.excludedCount} artifact=${result.artifactPath}`,
      )
    } else {
      console.error(
        `[wiki] summary artifact hit excluded=${result.excludedCount} artifact=${result.artifactPath}`,
      )
    }
    if (result.report.error) console.error(`[wiki] report error: ${result.report.error}`)
    if (typeof options.maxExcluded === 'number' && result.excludedCount > options.maxExcluded) {
      process.exitCode = 3
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}

function parseCliArgs(argv) {
  const options = { env: 'prod', vault: REPO_ROOT, writeSideEffects: true }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const [name, inlineValue] = arg.split('=', 2)
    const readValue = () => {
      if (inlineValue !== undefined) return inlineValue
      const value = argv[i + 1]
      if (value === undefined) throw new Error(`${arg} 값이 필요합니다`)
      i += 1
      return value
    }
    if (arg === '--stdout') {
      options.writeSideEffects = false
      continue
    }
    if (arg === '--status') {
      options.status = true
      continue
    }
    if (arg === '--force') {
      options.force = true
      continue
    }
    if (name === '--vault') {
      options.vault = path.resolve(readValue())
      continue
    }
    if (name === '--env') {
      const value = readValue()
      // 문구는 `lib/cli-env.mjs` 가 소유하고, **종료는 여기서** 한다 — 던지면 `main()` 이 받아
      //   exitCode 2 를 세운다(다른 인자 오류와 같은 경로).
      const envError = envEnumError(value)
      if (envError !== null) throw new Error(envError)
      options.env = value
      continue
    }
    if (name === '--out') {
      options.artifactPath = path.resolve(readValue())
      continue
    }
    if (name === '--max-excluded') {
      const raw = readValue()
      if (!/^\d+$/u.test(raw)) throw new Error('--max-excluded 에는 0 이상의 정수가 필요합니다')
      options.maxExcluded = Number.parseInt(raw, 10)
      continue
    }
    throw new Error(`알 수 없는 인자: ${arg}`)
  }
  return options
}

/**
 * `--status` 출력 — **소비자 계약**이다.
 *
 * `artifactPath` 와 `env` 를 실어 보내는 이유: 소비자가 그 둘을 **직접 만들지 않게** 하기 위해서다.
 * 경로를 소비자가 조립하면 파일명 리터럴이 두 리포에 중복되고, env 를 소비자가 재기입하면 독자의
 * 기대값이 생성기의 실제 발행과 조용히 어긋난다.
 */
function statusPayload(result, env) {
  return {
    artifactPath: result.artifactPath,
    env,
    excludedCount: result.excludedCount,
    inputsFingerprint: result.inputsFingerprint,
    regenerated: result.regenerated,
    reportPath: result.report.jsonPath,
    status: result.status,
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
