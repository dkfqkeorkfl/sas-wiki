// @vitest-environment node
//
// 이 파일에는 파일 1건 파서인 `wiki(filePath)` 자체가 소유하는 두 계약만 남는다. 옛 테스트는
// 아티팩트 명부·HTTP 게이트·비활성 스텁·이력 조립까지 자식 `wiki()` 안에서 관측했지만, 그 책임은
// 부모 dev 서버로 이동했고 자식은 요청 시점의 마크다운 파일을 파싱하는 동기 함수가 됐다.
//
// 옛 선언의 행선지:
//   · WK1 — 삭제된 `single-doc.mjs` export·비동기 계약은 소멸했다. 새 프로세스 호출 계약은
//     `wiki.file-arg.test.mjs`가 소유한다.
//   · WK2′ — active 정확 5키는 부모 `wiki.doc-serving.contract.test.ts` P-3가 소유한다.
//   · WK3 — disable 스텁 4키는 부모 P-2가 소유한다.
//   · WK4 — 명부 미스 404는 부모 P-1이 소유한다.
//   · WK7 — 명부가 아티팩트 `docs[]`에서 오고 disable도 포함한다는 계약은 부모 P-2와 P-8이
//     각각 스텁의 출처와 `--file` breadcrumb 파생을 관측한다.
//   · WK8′ — 대상 모듈 파일이 삭제돼 정적 폐쇄 계약도 함께 소멸했다.
//   · WK9′ — 아티팩트 부재의 500 fail-loud 계약은 부모 P-6이 소유한다.
//   · WK10 — 빈 `docs[]`의 404와 spawn 0은 부모 `wiki.doc-gate.contract.test.ts`가 소유한다.
//   · PN-2 — 자식 `null`을 부모가 404로 선처리하는 실제 응답은 부모 gate 계약 파일이 소유한다.
//   · STUB-1 — disable 파일 미열람은 부모 P-2가, active 파일 부재의 500은 부모 gate 계약 파일이
//     소유한다.
//
// PN-1과 LIVE-1′은 아티팩트나 HTTP가 아니라 파일 파싱 자체의 계약이라 이 층에 잔류한다.
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterAll, describe, expect, it } from 'vitest'

import { cleanup, writeDoc } from './helpers/tmp-git-vault.mjs'

const { wiki } = await import(new URL('../wiki.mjs', import.meta.url).href)

const NORMAL_REF = 'company/삼성전자'
const HEADERLESS_REF = 'concept/머리말없음'
const BODY_MARKER = '정상본문마커'
const LIVE_MARKER = '두번째호출본문마커'
const WIKI_DIR = 'wiki'
const CHILD_KEYS = ['md', 'meta', 'status']

const tmps = []

afterAll(() => cleanup(...tmps))

function docFile(vault, ref) {
  return path.join(vault, WIKI_DIR, `${ref}.md`)
}

function makeVault() {
  const vault = mkdtempSync(path.join(tmpdir(), 'wiki-parse-axis-'))
  tmps.push(vault)
  return vault
}

describe('머리말 없는 파일은 파싱 부재다 (PN-1)', () => {
  it('PN-1: 머리말 없는 파일은 `null`이고 같은 호출의 정상 파일은 정확 3키다', () => {
    const vault = makeVault()
    writeDoc(vault, NORMAL_REF, {
      body: `## 정의\n\n${BODY_MARKER}\n`,
      id: '0192a000-0000-7000-8000-000000000a01',
      title: '삼성전자',
      type: 'company',
    })
    const headerless = docFile(vault, HEADERLESS_REF)
    writeDoc(vault, HEADERLESS_REF, {
      id: '0192a000-0000-7000-8000-000000000a02',
      title: '머리말없음',
    })
    writeFileSync(headerless, '머리말이 통째로 없다. 그냥 본문이다.\n')

    const normal = wiki(docFile(vault, NORMAL_REF))

    expect(Object.keys(normal).toSorted()).toStrictEqual(CHILD_KEYS)
    expect(normal.md).toContain(BODY_MARKER)
    expect(wiki(headerless)).toBeNull()
  })
})

describe('본문은 호출 시점 디스크다 (LIVE-1′)', () => {
  it('LIVE-1′: 같은 경로의 본문만 고치면 두 번째 호출은 새 본문을 준다', () => {
    const vault = makeVault()
    const spec = {
      body: `## 정의\n\n${BODY_MARKER}\n`,
      id: '0192a000-0000-7000-8000-000000000a01',
      title: '삼성전자',
      type: 'company',
    }
    writeDoc(vault, NORMAL_REF, spec)

    const file = docFile(vault, NORMAL_REF)
    const before = wiki(file)
    expect(before.md).toContain(BODY_MARKER)
    expect(before.md).not.toContain(LIVE_MARKER)

    writeDoc(vault, NORMAL_REF, {
      ...spec,
      body: `## 정의\n\n${BODY_MARKER}\n\n${LIVE_MARKER}\n`,
    })

    expect(wiki(file).md).toContain(LIVE_MARKER)
  })
})
