// @vitest-environment node
//
// 문서 id 모듈 계약 — 형식 판정(isDocId) · frontmatter id 줄 패턴(DOC_ID_FIELD) · 새 id 발급(newDocId) ·
//   유효성 판단(judgeDocId) · 중복 검사(findDuplicateIds).
//
// 기대값은 전부 리터럴이다. 모듈의 상수로 기대값을 만들면 상수가 틀려도 테스트가 따라 틀려 통과한다.
import { describe, expect, it } from 'vitest'

import { DOC_ID_FIELD, findDuplicateIds, isDocId, judgeDocId } from '../doc-id.mjs'
import { newDocId } from '../new-doc-id.mjs'
import { extractFrontmatterField, parseFrontmatterYaml } from '../parse.mjs'

const UUIDV7 = '0192f0c0-8000-7000-8000-0123456789ab'
const UUIDV7_B = '0192f0c1-0000-7000-b000-000000000002'
const UUIDV4 = 'f47ac10b-58cc-4372-a567-0e02b2c3d479'

describe('isDocId — UUIDv7 형식만 문서 id 로 인정한다', () => {
  it('소문자 UUIDv7 은 문서 id 다', () => {
    expect(isDocId(UUIDV7)).toBe(true)
  })

  it.each([
    ['UUIDv4(버전 니블 4)', UUIDV4],
    ['대문자 UUIDv7(스키마가 소문자만 허용)', UUIDV7.toUpperCase()],
    ['variant 니블이 8·9·a·b 가 아님', '0192f0c0-8000-7000-c000-0123456789ab'],
    ['따옴표가 남은 원시 문자열', `'${UUIDV7}'`],
    ['앞뒤 공백', ` ${UUIDV7} `],
    ['12-hex 옛 형식', '062530b95593'],
    ['빈 문자열', ''],
  ])('%s 는 문서 id 가 아니다', (_label, value) => {
    expect(isDocId(value)).toBe(false)
  })

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['숫자', 42],
  ])('문자열이 아닌 값(%s)은 문서 id 가 아니다', (_label, value) => {
    expect(isDocId(value)).toBe(false)
  })
})

describe('newDocId — 새 문서 id 발급', () => {
  it('발급한 id 는 문서 id 형식이다', () => {
    expect(isDocId(newDocId())).toBe(true)
  })

  it('연속 발급한 id 는 서로 다르고 발급 순서대로 문자열 정렬된다(UUIDv7 시간 정렬)', () => {
    const ids = Array.from({ length: 64 }, () => newDocId())

    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.toSorted()).toEqual(ids)
  })
})

describe('DOC_ID_FIELD — frontmatter 최상위 id 줄만 잡고 원시 값을 캡처한다', () => {
  it.each([
    ['작은따옴표', `id: '${UUIDV7}'`, ` '${UUIDV7}'`],
    ['큰따옴표', `id: "${UUIDV7}"`, ` "${UUIDV7}"`],
    ['따옴표 없음', `id: ${UUIDV7}`, ` ${UUIDV7}`],
    ['콜론 앞 공백(parseFrontmatterYaml 은 키를 trim 한다)', `id : ${UUIDV7}`, ` ${UUIDV7}`],
    ['값 없음', 'id:', ''],
  ])('%s 줄을 잡는다', (_label, line, raw) => {
    expect(DOC_ID_FIELD.exec(line)?.[1]).toBe(raw)
  })

  it.each([
    ['다른 키의 접두어', `idx: ${UUIDV7}`],
    ['중첩 키(들여쓰기)', `  id: ${UUIDV7}`],
    ['주석 줄', `# id: ${UUIDV7}`],
  ])('%s 는 잡지 않는다', (_label, line) => {
    expect(DOC_ID_FIELD.exec(line)).toBeNull()
  })
})

describe('DOC_ID_FIELD — 검증기(parseFrontmatterYaml)와 같은 값을 읽는다', () => {
  // 검증기는 키를 String#trim 으로 다듬으므로 콜론 앞의 NBSP·전각 공백(한글 입력기로 치기 쉽다)도
  //   `id` 키로 읽는다. 추출기가 이런 줄을 놓치면 검증기가 보는 id 와 변경 판별이 보는 id 가 갈린다.
  it.each([
    ['NBSP', `id\u00a0: '${UUIDV7}'`],
    ['전각 공백', `id\u3000: '${UUIDV7}'`],
    ['폼 피드', `id\f: '${UUIDV7}'`],
    ['값 끝의 줄 구분자(U+2028)', `id: '${UUIDV7}'\u2028`],
    ['CRLF 뒤에 남은 CR', `id: '${UUIDV7}'\r`],
  ])('콜론·값 주변의 %s', (_label, line) => {
    const yaml = `title: 문서\n${line}`
    const markdown = `---\n${yaml}\n---\n\n본문\n`

    expect(parseFrontmatterYaml(yaml).id).toBe(UUIDV7)
    expect(extractFrontmatterField(markdown, DOC_ID_FIELD)).toBe(UUIDV7)
  })
})

describe('judgeDocId — [전, 후] 로 id 를 판단한다', () => {
  // 전 = id 줄이 마지막으로 바뀌기 바로 전 값, 후 = 지금 값.
  it.each([
    ['전이 없고 후가 UUIDv7 → 정상(처음 등록)', undefined, UUIDV7, 'ok'],
    ['전이 형식 불량이고 후가 UUIDv7 → 정상(처음 등록)', 'draft-id', UUIDV7, 'ok'],
    ['전·후가 같은 UUIDv7 → 정상', UUIDV7, UUIDV7, 'ok'],
    ['전·후가 다른 UUIDv7 → 변경', UUIDV7, UUIDV7_B, 'changed'],
    ['전이 없고 후도 없음 → 미등록', undefined, undefined, 'unregistered'],
    ['전이 null(빈 값)이고 후가 형식 불량 → 미등록', null, 'draft-id', 'unregistered'],
    ['전이 UUIDv7 이고 후가 없음 → 훼손', UUIDV7, undefined, 'damaged'],
    ['전이 UUIDv7 이고 후가 형식 불량 → 훼손', UUIDV7, `${UUIDV7}x`, 'damaged'],
  ])('%s', (_label, before, after, verdict) => {
    expect(judgeDocId([before, after])).toBe(verdict)
  })
})

describe('findDuplicateIds — 두 번 이상 쓰인 id 와 그 항목들', () => {
  it('문자열 id 가 겹치는 묶음만 입력 순서대로 낸다', () => {
    const items = [
      { id: UUIDV7, path: 'a' },
      { id: UUIDV7_B, path: 'b' },
      { id: UUIDV7, path: 'c' },
      { id: undefined, path: 'd' },
      { id: undefined, path: 'e' },
      { id: 'bad', path: 'f' },
      { id: 'bad', path: 'g' },
    ]

    const duplicates = findDuplicateIds(items, (item) => item.id)

    expect([...duplicates].map(([id, group]) => [id, group.map((item) => item.path)])).toEqual([
      [UUIDV7, ['a', 'c']],
      ['bad', ['f', 'g']],
    ])
  })

  it('겹치는 id 가 없으면 빈 Map 이다', () => {
    expect(findDuplicateIds([{ id: UUIDV7 }, { id: UUIDV7_B }], (item) => item.id).size).toBe(0)
  })
})
