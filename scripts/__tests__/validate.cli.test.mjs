// @vitest-environment node
//
// validate.mjs CLI 계약(인자 분리 · shallow/partial 가드 · 통계 출력 · JSON 미생산) — 구 build.cli.test.
//
// build.mjs → validate.mjs 재정리 반영: `--out`/JSON 산출은 **제거**됐다(dev=미들웨어 on-demand,
//   prod=미래 서버). CLI 는 무결성 검증 전용 — 통과 시 exit 0, 위반(컨벤션·스키마·unresolved·shallow·
//   partial) 시 exit 1(fail-loud). 산출 파일은 만들지 않는다. 인자·게이트·통계 단언은 의미 보존.
//
// subprocess 는 **여기서만** 쓴다(CLI 회귀). 나머지는 in-process — 커버리지 계측 때문이다.
import { execFileSync, spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs' // prettier-ignore
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { parseArgs } from '../validate.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SCRIPT_DIR = path.resolve(HERE, '..')
const VALIDATE_SCRIPT = path.join(SCRIPT_DIR, 'validate.mjs')
const REAL_SCHEMA_DIR = path.join(SCRIPT_DIR, 'schema')

const NAME = 'SAS Wiki Bot'
const EMAIL = 'bot@sas.wiki'
let tick = 1_136_239_445

const ctx = {
  badSchema: '',
  partial: '',
  shallow: '',
  strayFeedSha: '',
  tmp: '',
  unresolvedVault: '',
  vault: '',
}

function commit(cwd, message) {
  const date = nextDate()
  git(cwd, ['add', '-A'])
  git(cwd, ['commit', '--no-gpg-sign', '-m', message], {
    GIT_AUTHOR_DATE: date,
    GIT_COMMITTER_DATE: date,
  })
  return git(cwd, ['rev-parse', 'HEAD'])
}

function git(cwd, args, extraEnv = {}) {
  return execFileSync('git', ['-c', 'core.quotepath=false', ...args], {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_EMAIL: EMAIL,
      GIT_AUTHOR_NAME: NAME,
      GIT_COMMITTER_EMAIL: EMAIL,
      GIT_COMMITTER_NAME: NAME,
      ...extraEnv,
    },
  }).trim()
}

function nextDate() {
  tick += 60
  return `${tick} +0000`
}

// frontmatter 저작 UUIDv7 doc id — 결정적 counter(문서마다 유일).
let idSeq = 0
function nextDocId() {
  return `0192f0d0-0000-7000-8000-${(idSeq += 1).toString(16).padStart(12, '0')}`
}

function runCli(args) {
  return spawnSync(process.execPath, [VALIDATE_SCRIPT, ...args], {
    encoding: 'utf8',
    env: { ...process.env, SOURCE_DATE_EPOCH: '1700000000' },
  })
}

function writeDoc(root, rel, title) {
  const full = path.join(root, 'wiki', `${rel}.md`)
  mkdirSync(path.dirname(full), { recursive: true })
  writeFileSync(
    full,
    [
      '---',
      `id: "${nextDocId()}"`,
      `title: ${title}`,
      'type: concept',
      'status: active',
      'tags: ["반도체"]',
      '---',
      '',
      '## 정의',
      '',
      `${title} 문서의 정의 문단이다.`,
      '',
      '## 로드맵',
      '',
      '세대 전환을 준비한다.',
      '',
    ].join('\n'),
  )
}

function writeStray(root, text) {
  // frontmatter 가 **없는** vault md — 문서가 아니다(parseMarkdownFile → null). 이 파일을 건드린 feed
  // 커밋의 diff 경로는 역인덱스로도 삭제집합으로도 해석되지 않는다 → **unresolvedPaths 로 집계**돼야 한다.
  const full = path.join(root, 'wiki', 'concept', '메모장.md')
  mkdirSync(path.dirname(full), { recursive: true })
  writeFileSync(full, `${text}\n`)
}

beforeAll(() => {
  ctx.tmp = mkdtempSync(path.join(tmpdir(), 'wiki-cli-'))
  ctx.vault = path.join(ctx.tmp, 'vault-repo')
  mkdirSync(ctx.vault, { recursive: true })
  git(ctx.vault, ['init', '-q'])

  writeDoc(ctx.vault, 'concept/foo', '삼성전자')
  commit(ctx.vault, 'chore: 삼성전자 문서 생성')

  writeFileSync(
    path.join(ctx.vault, 'wiki', 'concept', 'foo.md'),
    `${readFileSync(path.join(ctx.vault, 'wiki', 'concept', 'foo.md'), 'utf8')}\nHBM4 로드맵을 공개했다.\n`,
  )
  commit(
    ctx.vault,
    'feed: 삼성전자 HBM4 로드맵 공개\n\n본문.\n\nKeywords: HBM\nImportance: breaking',
  )

  // prune 시나리오 — 삭제될 문서 + 그 문서를 가리키는 피드
  writeDoc(ctx.vault, 'misc/del-me', '폐기문서')
  commit(ctx.vault, 'chore: 폐기문서 문서 생성')
  writeFileSync(
    path.join(ctx.vault, 'wiki', 'misc', 'del-me.md'),
    `${readFileSync(path.join(ctx.vault, 'wiki', 'misc', 'del-me.md'), 'utf8')}\n정리 대상이다.\n`,
  )
  commit(ctx.vault, 'feed: 폐기문서 관련 소식\n\n본문.\n\nKeywords: 정리\nImportance: normal')
  git(ctx.vault, ['rm', '-q', 'wiki/misc/del-me.md'])
  commit(ctx.vault, 'chore: 폐기문서 삭제')

  // 해석 불가(unresolved) 시나리오는 **별도 vault** 다 — 본 vault 에 섞으면 컨벤션 가드가 먼저 죽인다.
  ctx.unresolvedVault = path.join(ctx.tmp, 'unresolved-repo')
  mkdirSync(ctx.unresolvedVault, { recursive: true })
  git(ctx.unresolvedVault, ['init', '-q'])
  writeDoc(ctx.unresolvedVault, 'concept/foo', '삼성전자')
  commit(ctx.unresolvedVault, 'chore: 삼성전자 문서 생성')
  writeStray(ctx.unresolvedVault, '# 메모\n\n프론트매터가 없는 임시 메모다.')
  commit(ctx.unresolvedVault, 'chore: 임시 메모 추가')
  writeStray(ctx.unresolvedVault, '# 메모\n\n갱신된 메모다.')
  writeFileSync(
    path.join(ctx.unresolvedVault, 'wiki', 'concept', 'foo.md'),
    `${readFileSync(path.join(ctx.unresolvedVault, 'wiki', 'concept', 'foo.md'), 'utf8')}\nHBM4 로드맵을 공개했다.\n`,
  )
  ctx.strayFeedSha = commit(
    ctx.unresolvedVault,
    'feed: 삼성전자 HBM4 로드맵 공개\n\n본문.\n\nKeywords: HBM\nImportance: breaking',
  )

  // shallow clone — 생성 커밋이 잘려 문서 id 가 조용히 틀어진다
  const gitDir = git(ctx.vault, ['rev-parse', '--absolute-git-dir'])
  ctx.shallow = path.join(ctx.tmp, 'shallow')
  execFileSync('git', ['clone', '--depth=1', '-q', `file://${gitDir}`, ctx.shallow], {
    encoding: 'utf8',
  })

  // partial clone(blob 필터) — blob 이 지연 로드돼 검증이 조용히 어긋난다
  ctx.partial = path.join(ctx.tmp, 'partial')
  execFileSync('git', ['clone', '-q', `file://${gitDir}`, ctx.partial], { encoding: 'utf8' })
  git(ctx.partial, ['config', 'remote.origin.partialclonefilter', 'blob:none'])

  // 스키마 위반을 강제하는 --schema 디렉토리(입력 스키마는 실물 재사용)
  ctx.badSchema = path.join(ctx.tmp, 'bad-schema')
  mkdirSync(ctx.badSchema, { recursive: true })
  copyFileSync(
    path.join(REAL_SCHEMA_DIR, 'wiki-doc.schema.json'),
    path.join(ctx.badSchema, 'wiki-doc.schema.json'),
  )
  writeFileSync(
    path.join(ctx.badSchema, 'summary.schema.json'),
    JSON.stringify({ required: ['NOPE'], type: 'object' }),
  )
  for (const file of ['feeds.schema.json', 'body.schema.json']) {
    writeFileSync(path.join(ctx.badSchema, file), JSON.stringify({ type: 'object' }))
  }
})

afterAll(() => {
  if (ctx.tmp) rmSync(ctx.tmp, { force: true, recursive: true })
})

describe('parseArgs — 인자 분리(--out/--root 폐기)', () => {
  // P2(contract-simplify) 계약 반전 — tdd §4 원장 ⑨ / §3.8 DK5·DK6·DK7.
  // **왜 바뀌었나(R3 + PRD D11)**: 불리언 `--allow-deadlinks` 는 심각도를 표현하지 못한다. 조사한 모든
  //   도구가 심각도를 **설정 가능**하게 뒀고(수렴점), 기본을 `warn` 으로 내리는 것은 리서치가 아니라
  //   **PRD D11**(빌드실패 → 런타임 UX)의 제품 결정이다. 옛 플래그는 실호출자가 0이므로 **호환 별칭으로
  //   남기지 않는다**(호환 분기는 이 PRD 가 금지한다). 별칭 부재·enum fail-loud·기본값은
  //   `scripts/__tests__/validate.deadlinks.test.mjs` 의 DK5·DK6·DK7 이 문다.
  it('--vault·--schema·--deadlinks 를 절대경로/enum 으로 파싱한다', () => {
    const options = parseArgs(['--vault', 'sas-wiki', '--deadlinks', 'error'])

    expect(options.vault).toBe(path.resolve('sas-wiki'))
    expect(options.deadlinks).toBe('error')
    // 서브모듈에는 schema/ 가 없다(실측) → 기본값은 **스크립트 옆** schema/ 다.
    expect(options.schema).toBe(REAL_SCHEMA_DIR)
  })

  it('--schema 를 주면 그 디렉토리를 쓴다', () => {
    const options = parseArgs(['--vault', 'v', '--schema', 'custom/schema'])

    expect(options.schema).toBe(path.resolve('custom/schema'))
  })

  it('--out 은 거부한다(validate.mjs 는 JSON 을 생산하지 않는다 — 출력 인자 없음)', () => {
    expect(() => parseArgs(['--vault', 'v', '--out', 'public'])).toThrow(/--out/)
  })

  it('--root 는 거부한다(호환 별칭 금지)', () => {
    expect(() => parseArgs(['--root', 'sas-wiki'])).toThrow(/--vault/)
  })

  it('--vault 누락 시 스크립트 자기 리포 루트로 기본값 파생한다(cwd 조용한 폴백 아님 — D3)', () => {
    // D3: --vault 필수→선택. 기본값은 cwd 가 아니라 import.meta.url 로 파생한 스크립트 자기 리포 루트.
    // 원장 ⑨: 옛 `--allow-deadlinks` 는 P2 에서 제거된다 → 인자 없이 기본값 파생을 확인한다.
    const REPO_ROOT = path.resolve(SCRIPT_DIR, '..')
    expect(parseArgs([]).vault).toBe(REPO_ROOT)
  })
})

describe('validate CLI — 히스토리 무결성 선제 fail', () => {
  it('shallow 리포는 이유와 복구 명령을 담아 실패한다', () => {
    const result = runCli(['--vault', ctx.shallow])

    expect(result.status).not.toBe(0)
    expect(`${result.stderr}${result.stdout}`).toMatch(/shallow|얕은/i)
    expect(`${result.stderr}${result.stdout}`).toMatch(/fetch-depth|unshallow|fetch/i)
  })

  it('partial clone(blob 필터)도 실패한다', () => {
    const result = runCli(['--vault', ctx.partial])

    expect(result.status).not.toBe(0)
    expect(`${result.stderr}${result.stdout}`).toMatch(/partial|blob/i)
  })

  it('정상 full clone 은 성공한다(과잉 검출 방지)', () => {
    const result = runCli(['--vault', ctx.vault])

    expect(result.status).toBe(0)
  })
})

describe('validate CLI — JSON 미생산 · vault 무오염', () => {
  it('무결성 통과해도 JSON 을 만들지 않고 vault 워킹트리를 더럽히지 않는다', () => {
    const result = runCli(['--vault', ctx.vault])

    expect(result.status).toBe(0)
    // validate 는 검증 전용 — 산출 JSON 을 vault 어디에도 쓰지 않는다.
    for (const file of ['wiki_summary.json', 'wiki_feeds.json', 'wiki_body.json']) {
      expect(existsSync(path.join(ctx.vault, file)), file).toBe(false)
      expect(existsSync(path.join(ctx.vault, 'wiki', file)), file).toBe(false)
    }
    expect(git(ctx.vault, ['status', '--porcelain'])).toBe('')
  })

  it('content.json·prototype.html 을 더 이상 만들지 않는다', () => {
    runCli(['--vault', ctx.vault])

    expect(existsSync(path.join(ctx.vault, 'content.json'))).toBe(false)
    expect(existsSync(path.join(ctx.vault, 'prototype.html'))).toBe(false)
  })

  it('스키마 위반은 exit 1 로 죽는다', () => {
    const result = runCli(['--vault', ctx.vault, '--schema', ctx.badSchema])

    expect(result.status).toBe(1)
    expect(`${result.stderr}${result.stdout}`).toMatch(/스키마|schema|NOPE/i)
  })
})

describe('validate CLI — 통계 stdout (조용한 유실 종료)', () => {
  it('docs·feeds·prune·unresolved·warnings 를 stdout 에 낸다', () => {
    const result = runCli(['--vault', ctx.vault])

    for (const token of ['docs=', 'feeds=', 'prune=', 'unresolved=', 'warnings=']) {
      expect(result.stdout, token).toContain(token)
    }
  })

  it('해석 실패 경로는 sha·경로를 담아 exit 1 로 죽는다', () => {
    // "삭제 이력으로도 설명되지 않는" 경로는 데이터 결함이므로 통과시키지 않고 중단한다.
    const result = runCli(['--vault', ctx.unresolvedVault])

    expect(result.status).toBe(1)
    const output = `${result.stderr}${result.stdout}`
    expect(output).toContain('wiki/concept/메모장.md')
    expect(output).toContain(ctx.strayFeedSha.slice(0, 12))
  })

  it('prune 건수가 stdout 에 나온다', () => {
    const result = runCli(['--vault', ctx.vault])

    expect(result.stdout).toContain('prune=1')
  })
})
