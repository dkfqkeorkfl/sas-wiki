import { runFeedsGenerator } from '../lib/generator.mjs'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { parsePayloads } from './vaultPayloads.mjs'

// 두 억제 통합 테스트가 실제 feeds 생성기의 명시적 ignore 처리를 사용한다.
export async function generatePayloads({ vault, env = 'dev' }) {
  const parsed = parsePayloads({ vault, env })
  const out = mkdtempSync(path.join(tmpdir(), 'wiki-generated-feeds-'))
  try {
    const generated = await runFeedsGenerator({
      vault,
      env,
      count: 200,
      ignore: 'ignore-feeds.json',
      artifactPath: path.join(out, 'feeds.json'),
    })
    return { ...parsed, feeds: generated.payload }
  } finally {
    rmSync(out, { recursive: true, force: true })
  }
}
