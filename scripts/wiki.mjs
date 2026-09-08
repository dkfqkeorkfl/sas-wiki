#!/usr/bin/env node
// wiki 엔드포인트 — 호출자가 지정한 마크다운 파일 1건을 파싱해 원문과 머리말 투영만 반환한다.
import { parseArgs } from 'node:util'
import { pathToFileURL } from 'node:url'

import { parseMarkdownFile } from './lib/parse.mjs'

/**
 * 마크다운 파일 1건을 파싱한다. 머리말이 없거나 파손된 파일은 문서 부재와 같은 `null` 로 접는다.
 * 파일 자체가 없을 때의 읽기 예외는 그대로 호출자에게 전파한다.
 *
 * @param {string} filePath 읽을 마크다운 파일 경로
 * @returns {{ md: string, meta: object, status: unknown } | null}
 */
export function wiki(filePath) {
  const parsed = parseMarkdownFile(filePath)
  if (parsed === null) return null

  return {
    md: parsed.body,
    meta: parsed.frontmatter.meta || {},
    status: parsed.frontmatter.status,
  }
}

export async function main(argv = process.argv.slice(2)) {
  let values
  try {
    // `node:util` 의 `parseArgs`(strict 기본값)는 알 수 없는 인자·형식이 어긋난 인자에 대해
    // 던진다. 호출 계약 위반은 여기서 exit 2 로 가르고, 파일 읽기 같은 런타임 실패는 아래 최상위
    // catch 로 흘려 exit 1 로 유지한다.
    ;({ values } = parseArgs({
      allowPositionals: false,
      args: argv,
      options: {
        file: { type: 'string' },
      },
    }))
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 2
    return
  }

  if (values.file === undefined) {
    console.error('--file 은 필수 인자입니다 — 파싱할 마크다운 파일 경로를 명시하세요.')
    process.exitCode = 2
    return
  }

  const result = wiki(values.file)
  process.stdout.write(`${JSON.stringify(result)}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
