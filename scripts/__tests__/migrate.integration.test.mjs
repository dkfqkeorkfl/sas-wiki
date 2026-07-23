// @vitest-environment node
//
// migrate() 통합 — 실 git tmp vault 에서 마이그레이션 orchestration 을 검증한다. 순수 로직
// (uuidv7FromMs·insertFrontmatterId)은 migrate-assign-uuid.test.mjs(R7)가 단위로 못박고, 여기서는
// "id 없는 문서에 생성-시각 시드 UUIDv7 을 주입하고 재실행이 idempotent" 라는 실제 동작을 확인한다.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { migrate, uuidv7FromMs } from '../migrate-assign-uuid.mjs'
import { parseFrontmatterYaml } from '../lib/parse.mjs'
import { cleanup, commit, initVault, writeDoc } from './helpers/tmp-git-vault.mjs'

const UUIDV7_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u

function idOf(vault, rel) {
  const raw = readFileSync(path.join(vault, 'vault', 'wiki', `${rel}.md`), 'utf8')
  return parseFrontmatterYaml(raw.match(/^---\r?\n([\s\S]*?)\r?\n---/u)[1]).id
}

describe('migrate — vault 문서에 생성-시각 시드 UUIDv7 주입', () => {
  it('id 없는 문서에 유효 UUIDv7 을 주입하고 상위 48-bit 를 생성 시각으로 시드한다', () => {
    const vault = initVault()
    try {
      writeDoc(vault, 'company/삼성전자', { title: '삼성전자' }) // id 없음
      writeDoc(vault, 'tech/HBM', { title: 'HBM' })
      commit(vault, 'cwiki: 초기 문서')

      const results = migrate({ vault })

      expect(results.map((r) => r.changed)).toEqual([true, true])
      for (const rel of ['company/삼성전자', 'tech/HBM']) {
        const id = idOf(vault, rel)
        expect(id).toMatch(UUIDV7_RE)
        // 상위 48-bit(ms) 가 그 문서 생성 커밋 시각에서 시드됐는지(같은 커밋 → 같은 ms 프리픽스).
      }
      // 같은 커밋에서 난 두 문서는 상위 48-bit(ms 프리픽스)가 같고 tail 은 유일하다.
      const [a, b] = ['company/삼성전자', 'tech/HBM'].map((rel) => idOf(vault, rel))
      expect(a.slice(0, 13)).toBe(b.slice(0, 13))
      expect(a).not.toBe(b)
    } finally {
      cleanup(vault)
    }
  })

  it('이미 id 가 있는 문서는 재실행해도 그대로다(idempotent skip)', () => {
    const vault = initVault()
    try {
      writeDoc(vault, 'company/삼성전자', { title: '삼성전자' })
      commit(vault, 'cwiki: 문서 생성')
      migrate({ vault })
      const first = idOf(vault, 'company/삼성전자')

      const results = migrate({ vault })

      expect(results.map((r) => r.changed)).toEqual([false])
      expect(results[0].id).toBe(first)
      expect(idOf(vault, 'company/삼성전자')).toBe(first)
    } finally {
      cleanup(vault)
    }
  })

  it('미커밋 문서(생성 커밋 없음)는 명시적으로 실패한다', () => {
    const vault = initVault()
    try {
      writeDoc(vault, 'company/삼성전자', { title: '삼성전자' }) // 커밋하지 않는다
      expect(() => migrate({ vault })).toThrow(/생성 커밋/u)
    } finally {
      cleanup(vault)
    }
  })
})

describe('uuidv7FromMs — 통합 재확인(시드 되디코드)', () => {
  it('상위 48-bit 를 되디코드하면 입력 ms 다', () => {
    const ms = Date.parse('2026-03-04T05:06:07Z')
    expect(Number.parseInt(uuidv7FromMs(ms).replaceAll('-', '').slice(0, 12), 16)).toBe(ms)
  })
})
