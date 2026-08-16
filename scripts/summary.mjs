#!/usr/bin/env node
// summary **생성기 CLI 껍데기** — 계산은 `lib/generator.mjs`(`runSummaryGenerator`)가 한다.
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
    if (options.artifactPath) {
      console.error(
        `[wiki] summary generated status=${result.status} excluded=${result.excludedCount} artifact=${result.artifactPath}`,
      )
    } else {
      process.stdout.write(`${JSON.stringify(result.payload)}\n`)
      console.error(
        `[wiki] summary computed status=${result.status} excluded=${result.excludedCount}`,
      )
    }
    if (typeof options.maxExcluded === 'number' && result.excludedCount > options.maxExcluded) {
      process.exitCode = 3
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}

function parseCliArgs(argv) {
  const options = { env: 'prod', vault: REPO_ROOT }
  let artifactPathRaw
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    // `arg.split('=', 2)` 는 `String.prototype.split` 의 `limit` 인자를 쓴다 — limit 은 "몇 조각을
    //   낼지"가 아니라 "결과 배열에서 몇 개를 **잘라 버릴지**"다(잘린 나머지는 유실, 재합류가 아니다).
    //   그래서 `--out=a=b` 는 `['--out', 'a', 'b']` 중 앞 2개만 남아 `inlineValue` 가 `'a'` 가 되고
    //   `=b` 가 조용히 사라진다(재현됨). 첫 `=` 의 인덱스만 찾아 그 **뒤 전부**를 값으로 삼으면(값
    //   자체에 `=` 이 더 있어도) 절단이 없다.
    const eqIndex = arg.indexOf('=')
    const name = eqIndex === -1 ? arg : arg.slice(0, eqIndex)
    const inlineValue = eqIndex === -1 ? undefined : arg.slice(eqIndex + 1)
    const readValue = () => {
      if (inlineValue !== undefined) return inlineValue
      const value = argv[i + 1]
      if (value === undefined) throw new Error(`${arg} 값이 필요합니다`)
      i += 1
      return value
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
      artifactPathRaw = readValue()
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
  if (artifactPathRaw !== undefined) {
    options.artifactPath = resolveFromVault(options.vault, artifactPathRaw)
  }
  return options
}

function resolveFromVault(vault, value) {
  return path.isAbsolute(value) ? value : path.join(vault, value)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
