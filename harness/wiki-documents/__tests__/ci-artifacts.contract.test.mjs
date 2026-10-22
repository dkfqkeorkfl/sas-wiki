import { spawnSync } from 'node:child_process'
import {
  copyFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const workflow = readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf8')
const sha = '1234567890abcdef1234567890abcdef12345678'
const generatedAt = '2026-08-28T00:00:00.000Z'

function verificationScript() {
  const match = workflow.match(
    /      - name: Verify prod artifact pair\n        run: \|\n((?:          [^\n]*\n)+)/u,
  )
  expect(match, 'CI에 실행 가능한 prod 세트 확인 단계가 없습니다.').not.toBeNull()
  return match[1]
    .split('\n')
    .map((line) => line.slice(10))
    .join('\n')
}

function runPair(change = () => {}, expectedSha = sha) {
  const script = verificationScript()
  const dir = mkdtempSync(path.join(tmpdir(), 'wiki-ci-pair-'))
  try {
    mkdirSync(path.join(dir, 'scripts/lib'), { recursive: true })
    for (const file of ['artifact.mjs', 'payloads.mjs', 'schema-validator.mjs']) {
      copyFileSync(path.join(root, 'scripts/lib', file), path.join(dir, 'scripts/lib', file))
    }
    cpSync(path.join(root, 'scripts/schema'), path.join(dir, 'scripts/schema'), { recursive: true })
    mkdirSync(path.join(dir, 'cache'))
    const envelope = { env: 'prod', generatedAt, schemaVersion: 1, sourceCommit: sha }
    const payloads = {
      summary: { ...envelope, docs: [], tags: {}, tree: [] },
      feeds: { ...envelope, items: [], nextCursor: null },
    }
    change(payloads)
    for (const [name, payload] of Object.entries(payloads)) {
      if (payload === undefined) continue
      writeFileSync(
        path.join(dir, `cache/${name}.prod.json`),
        typeof payload === 'string' ? payload : JSON.stringify(payload),
      )
    }
    const result = spawnSync('sh', ['-eu', '-c', script], {
      cwd: dir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, GITHUB_SHA: expectedSha },
      timeout: 10000,
      killSignal: 'SIGKILL',
    })
    expect(result.error).toBeUndefined()
    expect(result.signal).toBeNull()
    return result
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe('CI의 prod 산출물 세트 저장 계약', () => {
  it('검사·빌드·세트 확인 성공 뒤에 정확한 두 파일을 한 artifact에 저장한다', () => {
    const build = workflow.indexOf('- run: pnpm run build')
    const verify = workflow.indexOf('- name: Verify prod artifact pair')
    const store = workflow.indexOf('- name: Store prod artifact pair')
    expect(build).toBeGreaterThan(0)
    expect(verify).toBeGreaterThan(build)
    expect(store).toBeGreaterThan(verify)
    const upload = workflow.slice(store)
    expect(upload).toContain('if: ${{ success() }}')
    expect(upload).toContain(
      'uses: actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9 # v7.0.2',
    )
    expect(upload).toContain(
      'name: wiki-prod-${{ github.event_name }}-${{ github.sha }}-${{ github.run_id }}-${{ github.run_attempt }}',
    )
    expect(upload).toContain('archive: true')
    expect(upload).toContain('overwrite: false')
    expect(upload).toContain('if-no-files-found: error')
    const files = upload.match(/path: \|\n((?:            [^\n]+\n?)+)/u)
    expect(files).not.toBeNull()
    expect(
      files[1]
        .trim()
        .split('\n')
        .map((line) => line.trim()),
    ).toEqual(['cache/summary.prod.json', 'cache/feeds.prod.json'])
    expect(workflow.slice(verify)).not.toMatch(/continue-on-error|always\(/u)
    expect(verificationScript()).not.toContain('${{')
  })

  it('실제 CI 확인 명령은 같은 prod·SHA·시각의 올바른 JSON을 허용한다', () => {
    const result = runPair()
    expect(result.status, result.stderr).toBe(0)
  })

  it.each(['summary', 'feeds'])('%s 한 파일만 빠진 세트는 저장 전에 실패한다', (name) => {
    expect(
      runPair((payloads) => {
        delete payloads[name]
      }).status,
    ).not.toBe(0)
  })

  it.each([
    [
      '잘못된 JSON',
      (payloads) => {
        payloads.feeds = '{'
      },
    ],
    [
      'dev 혼입',
      (payloads) => {
        payloads.feeds.env = 'dev'
      },
    ],
    [
      '다른 버전',
      (payloads) => {
        payloads.summary.schemaVersion = 999
      },
    ],
    [
      '한쪽 SHA 불일치',
      (payloads) => {
        payloads.feeds.sourceCommit = 'f'.repeat(40)
      },
    ],
    [
      '양쪽이 지난 SHA',
      (payloads) => {
        payloads.summary.sourceCommit = payloads.feeds.sourceCommit = 'f'.repeat(40)
      },
    ],
    [
      '스키마 위반',
      (payloads) => {
        payloads.summary.extra = true
      },
    ],
    [
      '다른 generatedAt',
      (payloads) => {
        payloads.feeds.generatedAt = '2026-08-27T00:00:00.000Z'
      },
    ],
  ])('%s을 정상 세트와 구분해 실패시킨다', (_name, change) => {
    expect(runPair(change).status).not.toBe(0)
  })

  it('빈 기대 SHA를 빈 값끼리의 일치로 통과시키지 않는다', () => {
    const result = runPair((payloads) => {
      payloads.summary.sourceCommit = payloads.feeds.sourceCommit = ''
    }, '')
    expect(result.status).not.toBe(0)
  })
})
