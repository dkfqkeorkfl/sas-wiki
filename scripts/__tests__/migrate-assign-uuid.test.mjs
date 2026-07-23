// @vitest-environment node
//
// P1 · R7 — 마이그레이션 스크립트 순수 함수 (HANDROLL UUIDv7 · 의존성 0) — tdd §3 Task 4
//
// RED 사유: `scripts/migrate-assign-uuid.mjs` 가 **아직 없다** → 아래 named import 가 모듈 미해석으로
//   파일 전체를 실패시킨다(유효 RED). uuid 패키지 금지 — `node:crypto` 만.
//
// 계약(GREEN 이 세울 seam · REFACTOR 로 순수 함수 분리):
//   · uuidv7FromMs(ms)            → 생성 시각 ms 로 시드한 UUIDv7 문자열(RFC 9562 §5.7: 48-bit ms ‖
//                                    ver=7 ‖ var=10 ‖ 랜덤 tail). 같은 ms 여도 랜덤 tail 로 유일.
//   · insertFrontmatterId(md, id) → { changed, text }. frontmatter 에 id 가 없으면 `id: "<id>"`(따옴표)
//                                    삽입, 이미 있으면 skip(changed:false, 덮어쓰지 않음 — idempotent).
import { describe, expect, it } from 'vitest'

import { insertFrontmatterId, uuidv7FromMs } from '../migrate-assign-uuid.mjs'
import { parseFrontmatterYaml } from '../lib/parse.mjs'

const UUIDV7_A = '0192f0c0-8000-7000-8000-0123456789ab'
const UUIDV7_B = '0192f0c0-8000-7000-9abc-0123456789ab'
const UUIDV7_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const MS = Date.parse('2026-01-01T00:00:00Z')

const DOC = ['---', 'title: HBM', 'type: concept', 'status: active', '---', '', '## 정의', '', '본문.', ''].join('\n') // prettier-ignore

describe('R7 uuidv7FromMs — 비트 정확성', () => {
  it('version 니블(13번째 hex)=7, variant 니블(17번째 hex)∈{8,9,a,b}', () => {
    const hex = uuidv7FromMs(MS).replaceAll('-', '')

    expect(hex[12]).toBe('7')
    expect(['8', '9', 'a', 'b']).toContain(hex[16])
  })

  it('상위 48-bit 를 되디코드하면 입력 ms 다(생성 시각 시드)', () => {
    const hex = uuidv7FromMs(MS).replaceAll('-', '')

    expect(Number.parseInt(hex.slice(0, 12), 16)).toBe(MS)
  })

  it('UUIDv7 정규식(§0)을 만족한다', () => {
    expect(uuidv7FromMs(MS)).toMatch(UUIDV7_RE)
  })

  it('같은 ms 2회 — 상위 48-bit 동일 · 전체 UUID 상이(랜덤 tail, seq 불요)', () => {
    const a = uuidv7FromMs(MS)
    const b = uuidv7FromMs(MS)

    expect(a.slice(0, 13)).toBe(b.slice(0, 13)) // 앞 12 hex(=48-bit ms) + 하이픈 = 13자 동일
    expect(a).not.toBe(b)
  })
})

describe('R7 insertFrontmatterId — idempotent 따옴표 삽입', () => {
  it('id 가 없으면 frontmatter 에 따옴표 스칼라로 삽입한다', () => {
    const { changed, text } = insertFrontmatterId(DOC, UUIDV7_A)

    expect(changed).toBe(true)
    expect(text).toContain(`id: "${UUIDV7_A}"`)
  })

  it('삽입된 id 는 parseFrontmatterYaml 이 스칼라로 읽는다(parse.mjs:199 따옴표 분기)', () => {
    const { text } = insertFrontmatterId(DOC, UUIDV7_A)
    const yaml = text.match(/^---\r?\n([\s\S]*?)\r?\n---/u)[1]

    expect(parseFrontmatterYaml(yaml).id).toBe(UUIDV7_A)
  })

  it('이미 id 가 있으면 변경하지 않는다(idempotent skip · 덮어쓰기 금지)', () => {
    const withId = insertFrontmatterId(DOC, UUIDV7_A).text
    const again = insertFrontmatterId(withId, UUIDV7_B)

    expect(again.changed).toBe(false)
    expect(again.text).toBe(withId)
    expect(again.text).toContain(UUIDV7_A)
    expect(again.text).not.toContain(UUIDV7_B)
  })
})
