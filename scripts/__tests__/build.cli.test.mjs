// @vitest-environment node
//
// P2 RED-8 · scripts/wiki/build.mjs CLI 계약(인자 분리 · shallow 가드 · 통계 출력) — tdd §6.8
//
// RED 사유:
//   ① `parseArgs` 가 export 되지 않는다(현행은 모듈 내부 함수) → import 링크 실패(파일 전체 RED).
//   ② 현행 인자는 `--root` 하나뿐이다 — 입력·schema·git·**출력**을 겸해 서브모듈에 산출물을 싸지른다.
//   ③ shallow/partial 선제 fail·3파일 산출·통계 stdout 미구현.
//
// 계약(GREEN 이 구현할 seam):
//   parseArgs(argv) → { allowDeadlinks, out, schema, vault }   // 테스트 가능하도록 **export**
//     `--vault <dir>`(입력) · `--out <dir>`(출력) · `--schema <dir>`(기본 = 스크립트 옆 schema/)
//     **`--root` 는 거부한다** — 호환 별칭을 만들지 마라(마이그레이션 금지).
//   node build.mjs --vault <v> --out <o>
//     → <o>/wiki_{summary,feeds,body}.json 3파일 · stdout 에 docs=·feeds=·prune=·unresolved=·warnings=
//     → shallow·partial·스키마 위반이면 **exit 1**
//
// subprocess 는 **여기서만** 쓴다(CLI 회귀). 나머지는 in-process — 커버리지 계측 때문이다(tdd §11).
import { execFileSync, spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs' // prettier-ignore
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { parseArgs } from '../build.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SCRIPT_DIR = path.resolve(HERE, '..') // scripts/wiki
const BUILD_SCRIPT = path.join(SCRIPT_DIR, 'build.mjs')
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

function outDir() {
  return mkdtempSync(path.join(ctx.tmp, 'out-'))
}

function runCli(args) {
  return spawnSync(process.execPath, [BUILD_SCRIPT, ...args], {
    encoding: 'utf8',
    env: { ...process.env, SOURCE_DATE_EPOCH: '1700000000' },
  })
}

function writeDoc(root, rel, title) {
  const full = path.join(root, 'vault', 'wiki', `${rel}.md`)
  mkdirSync(path.dirname(full), { recursive: true })
  writeFileSync(
    full,
    [
      '---',
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
  // frontmatter 가 **없는** vault md — 문서가 아니다(parseMarkdownFile → null).
  // 이 파일을 건드린 feed 커밋의 diff 경로는 역인덱스로도 삭제집합으로도 해석되지 않는다
  // → **unresolvedPaths 로 집계**돼야 한다. `continue` 로 버리면 조용한 유실이다(tdd §8).
  const full = path.join(root, 'vault', 'wiki', 'concept', '메모장.md')
  mkdirSync(path.dirname(full), { recursive: true })
  writeFileSync(full, `${text}\n`)
}

beforeAll(() => {
  ctx.tmp = mkdtempSync(path.join(tmpdir(), 'wiki-cli-'))
  ctx.vault = path.join(ctx.tmp, 'vault-repo')
  mkdirSync(ctx.vault, { recursive: true })
  git(ctx.vault, ['init', '-q'])

  writeDoc(ctx.vault, 'concept/foo', '삼성전자')
  commit(ctx.vault, 'cwiki: 삼성전자 문서 생성')

  writeFileSync(
    path.join(ctx.vault, 'vault', 'wiki', 'concept', 'foo.md'),
    `${readFileSync(path.join(ctx.vault, 'vault', 'wiki', 'concept', 'foo.md'), 'utf8')}\nHBM4 로드맵을 공개했다.\n`,
  )
  commit(
    ctx.vault,
    'feed: 삼성전자 HBM4 로드맵 공개\n\n본문.\n\nKeywords: HBM\nImportance: breaking',
  )

  // prune 시나리오 — 삭제될 문서 + 그 문서를 가리키는 피드
  writeDoc(ctx.vault, 'misc/del-me', '폐기문서')
  commit(ctx.vault, 'cwiki: 폐기문서 문서 생성')
  writeFileSync(
    path.join(ctx.vault, 'vault', 'wiki', 'misc', 'del-me.md'),
    `${readFileSync(path.join(ctx.vault, 'vault', 'wiki', 'misc', 'del-me.md'), 'utf8')}\n정리 대상이다.\n`,
  )
  commit(ctx.vault, 'feed: 폐기문서 관련 소식\n\n본문.\n\nKeywords: 정리\nImportance: normal')
  git(ctx.vault, ['rm', '-q', 'vault/wiki/misc/del-me.md'])
  commit(ctx.vault, 'uwiki: 폐기문서 삭제')

  // 해석 불가(unresolved) 시나리오는 **별도 vault** 다 — 본 vault 에 섞으면 컨벤션 가드가 먼저
  // 죽여서(신규 파일을 추가하는 uwiki 는 위반) 나머지 CLI 계약을 검증할 수 없다.
  ctx.unresolvedVault = path.join(ctx.tmp, 'unresolved-repo')
  mkdirSync(ctx.unresolvedVault, { recursive: true })
  git(ctx.unresolvedVault, ['init', '-q'])
  writeDoc(ctx.unresolvedVault, 'concept/foo', '삼성전자')
  commit(ctx.unresolvedVault, 'cwiki: 삼성전자 문서 생성')
  // 컨벤션 밖(`chore:`) 커밋으로 stray 를 들인다 — 컨벤션 가드의 대상이 아니므로 통과하고,
  // 그 경로를 건드리는 feed 만 남는다.
  writeStray(ctx.unresolvedVault, '# 메모\n\n프론트매터가 없는 임시 메모다.')
  commit(ctx.unresolvedVault, 'chore: 임시 메모 추가')

  // 문서 1건 + **해석 불가 경로 1건**을 함께 건드리는 피드 → 삭제 이력이 없으므로 build fail
  writeStray(ctx.unresolvedVault, '# 메모\n\n갱신된 메모다.')
  writeFileSync(
    path.join(ctx.unresolvedVault, 'vault', 'wiki', 'concept', 'foo.md'),
    `${readFileSync(path.join(ctx.unresolvedVault, 'vault', 'wiki', 'concept', 'foo.md'), 'utf8')}\nHBM4 로드맵을 공개했다.\n`,
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

describe('parseArgs — 인자 분리(--root 폐기)', () => {
  it('--vault·--out·--schema·--allow-deadlinks 를 절대경로로 파싱한다', () => {
    const options = parseArgs(['--vault', 'sas-wiki', '--out', 'public', '--allow-deadlinks'])

    expect(options.vault).toBe(path.resolve('sas-wiki'))
    expect(options.out).toBe(path.resolve('public'))
    expect(options.allowDeadlinks).toBe(true)
    // 서브모듈에는 schema/ 가 없다(실측) → 기본값은 **스크립트 옆** schema/ 다.
    expect(options.schema).toBe(REAL_SCHEMA_DIR)
  })

  it('--schema 를 주면 그 디렉토리를 쓴다', () => {
    const options = parseArgs(['--vault', 'v', '--out', 'o', '--schema', 'custom/schema'])

    expect(options.schema).toBe(path.resolve('custom/schema'))
  })

  it('--root 는 거부한다(호환 별칭 금지 — 입력·출력이 한 인자에 뭉치던 결함)', () => {
    expect(() => parseArgs(['--root', 'sas-wiki'])).toThrow(/--vault|--out/)
  })

  it('--vault 누락은 throw 한다(cwd 로 조용히 폴백하지 않는다)', () => {
    expect(() => parseArgs(['--out', 'public'])).toThrow(/--vault/)
  })
})

describe('build CLI — 히스토리 무결성 선제 fail', () => {
  it('shallow 리포는 이유와 복구 명령을 담아 실패한다', () => {
    const result = runCli(['--vault', ctx.shallow, '--out', outDir()])

    expect(result.status).not.toBe(0)
    // "얕은 히스토리는 문서 id 와 피드를 **조용히** 틀리게 만든다" — 왜 죽는지가 메시지에 있어야 한다.
    expect(`${result.stderr}${result.stdout}`).toMatch(/shallow|얕은/i)
    expect(`${result.stderr}${result.stdout}`).toMatch(/fetch-depth|unshallow|fetch/i)
  })

  it('partial clone(blob 필터)도 실패한다', () => {
    const result = runCli(['--vault', ctx.partial, '--out', outDir()])

    expect(result.status).not.toBe(0)
    expect(`${result.stderr}${result.stdout}`).toMatch(/partial|blob/i)
  })

  it('정상 full clone 은 성공한다(과잉 검출 방지)', () => {
    // 2번째 케이스: 하드코딩 fail 이면 정상 vault 까지 죽인다.
    const result = runCli(['--vault', ctx.vault, '--out', outDir()])

    expect(result.status).toBe(0)
  })
})

describe('build CLI — 산출물', () => {
  it('3파일을 --out 에 쓰고 vault 워킹트리를 더럽히지 않는다', () => {
    const out = outDir()

    const result = runCli(['--vault', ctx.vault, '--out', out])

    expect(result.status).toBe(0)
    for (const file of ['wiki_summary.json', 'wiki_feeds.json', 'wiki_body.json']) {
      expect(existsSync(path.join(out, file)), file).toBe(true)
    }
    expect(git(ctx.vault, ['status', '--porcelain'])).toBe('')
  })

  it('content.json·prototype.html 을 더 이상 만들지 않는다', () => {
    const out = outDir()

    runCli(['--vault', ctx.vault, '--out', out])

    for (const dir of [out, ctx.vault]) {
      expect(existsSync(path.join(dir, 'content.json')), `${dir}/content.json`).toBe(false)
      expect(existsSync(path.join(dir, 'prototype.html')), `${dir}/prototype.html`).toBe(false)
    }
  })

  it('스키마 위반은 exit 1 로 죽는다', () => {
    const result = runCli(['--vault', ctx.vault, '--out', outDir(), '--schema', ctx.badSchema])

    expect(result.status).toBe(1)
    expect(`${result.stderr}${result.stdout}`).toMatch(/스키마|schema|NOPE/i)
  })
})

describe('build CLI — 통계 stdout (조용한 유실 종료)', () => {
  it('docs·feeds·prune·unresolved·warnings 를 stdout 에 낸다', () => {
    const result = runCli(['--vault', ctx.vault, '--out', outDir()])

    for (const token of ['docs=', 'feeds=', 'prune=', 'unresolved=', 'warnings=']) {
      expect(result.stdout, token).toContain(token)
    }
  })

  it('해석 실패 경로는 sha·경로를 담아 exit 1 로 죽는다', () => {
    // 예전엔 unresolved=1 을 stdout 에 찍고도 exit 0 이었다 — 피드가 가리킨 문서 1건이 조용히
    // 빠진 산출물이 그대로 배포된다. "삭제 이력으로도 설명되지 않는" 경로는 데이터 결함이므로
    // 산출물을 쓰기 전에 중단한다(삭제로 설명되는 경로는 여전히 prune 이다 — 아래 케이스).
    const result = runCli(['--vault', ctx.unresolvedVault, '--out', outDir()])

    expect(result.status).toBe(1)
    const output = `${result.stderr}${result.stdout}`
    expect(output).toContain('vault/wiki/concept/메모장.md')
    expect(output).toContain(ctx.strayFeedSha.slice(0, 12))
  })

  it('prune 건수가 stdout 에 나온다', () => {
    const result = runCli(['--vault', ctx.vault, '--out', outDir()])

    expect(result.stdout).toContain('prune=1')
  })
})
