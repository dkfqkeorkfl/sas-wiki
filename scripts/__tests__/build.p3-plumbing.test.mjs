// @vitest-environment node
//
// P3 · Task 10 — 배관 (`.gitignore` · 스키마 2종 · `package.json` · 경로 소유권) — tdd §3.11 (PL1~PL5)
//
// RED 사유:
//   PL1 — `.gitignore` 에 `cache` 가 없다(현행 2줄: `node_modules`·`logs`).
//   PL2 — `summary.schema.json` 은 strict + required 6키다. `inputsFingerprint` 가 아직 없다.
//   PL3 — `scripts/lib/doc-gate.mjs` 와 `scripts/schema/report.schema.json` 이 **둘 다 부재**다.
//   PL5 — 생성기가 없어 `--vault` 기준 경로 소유권을 아직 관측할 수 없다.
//   PL4 — pin(현행도 통과). `cli-contract.test.mjs:246`(T3)이 같은 문자열을 정확 일치로 물고 있다.
//
// 왜 배관을 테스트하는가: 이 phase 의 산출물 계약(봉투 7키·사유 7값)은 **코드·스키마·리포트 3곳**에
//   흩어진다. 한쪽만 넓히면 나머지가 조용히 어긋나고, 그 어긋남은 `.mjs`(타입 체커 없음)에서 런타임
//   까지 드러나지 않는다. PL3 이 그 3자를 한자리에서 맞댄다(트립와이어).
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { afterAll, describe, expect, it } from 'vitest'

import { cleanup } from './helpers/tmp-git-vault.mjs'
import { seedCleanVault } from './helpers/polluted-vault.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SCRIPT_DIR = path.resolve(HERE, '..')
const REPO_ROOT = path.resolve(HERE, '..', '..')
const SCHEMA_DIR = path.join(SCRIPT_DIR, 'schema')
const SUMMARY = path.join(SCRIPT_DIR, 'summary.mjs')

/**
 * 제외 사유 7값 — **우선순위 순서**이기도 하다(OQ-P3-3). 여기 적힌 것이 리터럴 기준이고, 코드 상수와
 * 리포트 스키마 enum 이 이것을 따라와야 한다(3자 대조 · PL3).
 */
const REASON_CODES_LITERAL = [
  'NO_FRONTMATTER',
  'MISSING_TYPE',
  'SCHEMA_VIOLATION',
  'DUPLICATE_PATH',
  'DUPLICATE_ID',
  'ID_TAMPERED',
  'DELETED_ID_REUSE',
]

const tmps = []
afterAll(() => cleanup(...tmps))

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'))

/** 스키마 어디에 있든 `NO_FRONTMATTER` 를 담은 enum 배열을 찾는다(스키마 구조에 결합하지 않는다). */
function findReasonEnum(node) {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findReasonEnum(child)
      if (found) return found
    }
    return null
  }
  if (node === null || typeof node !== 'object') return null
  if (Array.isArray(node.enum) && node.enum.includes('NO_FRONTMATTER')) return node.enum
  for (const value of Object.values(node)) {
    const found = findReasonEnum(value)
    if (found) return found
  }
  return null
}

describe('배관 — .gitignore (PL1 · 🔴RED)', () => {
  it('PL1: `cache` 가 추가되고 `node_modules`·`logs` 는 **여전히** 있다', () => {
    // 두 번째 단언이 "추가하면서 기존을 지웠다" 를 문다 — 생성물 3종(캐시·리포트·커버리지)이 전부
    //   워킹트리를 더럽히면 §8.1 항목 8(`git status --porcelain` 이 비어 있어야 한다)이 깨진다.
    const lines = readFileSync(path.join(REPO_ROOT, '.gitignore'), 'utf8')
      .split('\n')
      .map((line) => line.trim())

    expect(lines).toContain('cache')
    expect(lines).toContain('node_modules')
    expect(lines).toContain('logs')
  })
})

describe('배관 — summary 봉투 스키마 (PL2 · 🔴RED)', () => {
  it('PL2: `inputsFingerprint` 가 required 이고 pattern 이 16자리 hex 다', () => {
    const schema = readJson(path.join(SCHEMA_DIR, 'summary.schema.json'))

    expect(schema.required).toContain('inputsFingerprint')
    expect(schema.properties.inputsFingerprint.pattern).toBe('^[0-9a-f]{16}$')
    // 앵커: 기존 6키를 밀어내지 않았다(strict 스키마라 누락은 산출물 전체를 죽인다).
    for (const key of ['schemaVersion', 'generatedAt', 'sourceCommit', 'docs', 'tree', 'tags']) {
      expect(schema.required).toContain(key)
    }
  })
})

describe('배관 — 사유 3자 대조 트립와이어 (PL3 · 🔴RED)', () => {
  it('PL3: `REASON_CODES`(코드) · report.schema.json enum · 리터럴 7값이 일치한다', () => {
    // ★ 규범 A 의 대가를 갚는 두 자리 중 하나(다른 하나는 PG9). 한쪽만 넓히면 리포트가 조용히 자기
    //   스키마를 어기고, 그 리포트를 읽는 사람은 사유가 왜 비었는지 영원히 모른다.
    const reportSchemaPath = path.join(SCHEMA_DIR, 'report.schema.json')
    expect(existsSync(reportSchemaPath), 'scripts/schema/report.schema.json').toBe(true)

    const schemaEnum = findReasonEnum(readJson(reportSchemaPath))
    expect(schemaEnum, 'report.schema.json 에 reasonCode enum 이 없다').not.toBeNull()
    expect([...schemaEnum].toSorted()).toEqual([...REASON_CODES_LITERAL].toSorted())
  })

  it('PL3: 코드 상수 `REASON_CODES` 가 리터럴 7값과 **순서까지** 일치한다 (우선순위)', async () => {
    // 순서가 곧 우선순위다(OQ-P3-3) — 배열을 재정렬하면 같은 vault 가 실행마다 다른 사유를 낸다.
    // 존재 확인을 **먼저** 해 미구현 시점의 실패가 "모듈이 없다" 로 깨끗하게 드러나게 한다.
    const docGatePath = path.join(SCRIPT_DIR, 'lib', 'doc-gate.mjs')
    expect(existsSync(docGatePath), 'scripts/lib/doc-gate.mjs').toBe(true)

    const { REASON_CODES } = await import(pathToFileURL(docGatePath).href)
    expect([...REASON_CODES]).toEqual(REASON_CODES_LITERAL)
  })
})

describe('배관 — 사람용 스크립트 (PL4 · pin)', () => {
  it('PL4: `package.json` 의 `scripts.summary` 가 `node scripts/summary.mjs` 그대로다', () => {
    // ★ `cli-contract.test.mjs:246`(T3)이 이 문자열을 정확 일치로 문다. "생성기 의미로 정리" 를
    //   스크립트 문자열 변경으로 오해하면 §4 원장 밖 반전이 난다.
    expect(readJson(path.join(REPO_ROOT, 'package.json')).scripts.summary).toBe(
      'node scripts/summary.mjs',
    )
  })
})

describe('배관 — 산출물 경로 소유권 (PL5 · 🔴RED)', () => {
  it('PL5: tmp vault 실행이 실 리포에 `cache/`·리포트를 만들지 않는다', () => {
    // ★ `logs`·`cache` 가 `--vault` 루트 기준이 아니라 스크립트 리포 기준이면, 병렬 테스트가 실 리포의
    //   **고정명 파일 하나**를 두고 경합한다 — 서로의 산출물을 덮어써 무작위로 깨진다.
    const { vault } = seedCleanVault()
    tmps.push(vault)

    const result = spawnSync(process.execPath, [SUMMARY, '--vault', vault, '--env', 'dev'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        GIT_CONFIG_COUNT: '1',
        GIT_CONFIG_KEY_0: 'safe.directory',
        GIT_CONFIG_VALUE_0: '*',
        SOURCE_DATE_EPOCH: '1700000000',
      },
    })

    // 앵커: tmp vault 쪽에는 **실제로** 산출물이 생겼다(부재 단언이 "아무 일도 안 했다" 가 아니다).
    expect(existsSync(path.join(vault, 'cache', 'summary.json')), result.stderr).toBe(true)
    expect(existsSync(path.join(vault, 'logs', 'summary.report.json'))).toBe(true)

    expect(existsSync(path.join(REPO_ROOT, 'cache'))).toBe(false)
    expect(existsSync(path.join(REPO_ROOT, 'logs', 'summary.report.json'))).toBe(false)
    expect(existsSync(path.join(REPO_ROOT, 'logs', 'summary.report.txt'))).toBe(false)
  })
})
