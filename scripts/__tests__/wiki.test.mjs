// @vitest-environment node
//
// P1 · Task 3 — endpoints.wiki **on-demand per-doc git read+render** 전환 (D5 재작업) — tdd §Task 3 (E-W)
//
// RED 사유(엔진 전환): 초판 `wiki(payload, ref)` 는 pre-parsed payload.bodies 에서 1건을 골랐다(git·렌더
//   미접근). 재작업 계약은 `wiki(vault, env, ref=path)` — 그 path 문서 **1건만** git 에서 읽어
//   renderMarkdownToHtml 렌더·투영한다. 아래는 1번째 인자에 **vault 경로 문자열**을 넘긴다 → 현행이
//   `vault.bodies.find` 를 호출해 **TypeError**(의도한 미구현)로 실패한다.
//
// 계약(GREEN 이 구현):
//   wiki(vault, env, ref) → 그 path 문서 1건.
//     없는 path → null(throw 아님) · disable → status='disable' 스텁 · 요청 path 만(이웃 본문 격리).
//   P5 · §4 원장 ㉖-c — `wiki()` 가 async 가 됐다. 단언 **내용**은 무변경 — `await` 만 붙는다.
//
// ★★ **md 컷오버(E-W′) — 반환 모양이 «렌더 산출»에서 «본문 원문»으로 바뀐다.**
//   옛 계약은 `{ html, headings, meta, sources, path, status, breadcrumb }` 였고 _"렌더는
//   renderMarkdownToHtml **재사용**(build 렌더 경로와 동일 · 회귀 0)"_ 이 그 근거였다. 이제 서버는
//   렌더하지 않는다 — 반환은 `{ feed, md, meta, path, status }` 이고 HTML·목차·각주 정의는 소비자가
//   그 `md` 에서 만든다. 그 5키 정확 일치는 `wiki.single-doc.test.mjs`·`wiki.index-gate.test.mjs` 의
//   `ACTIVE_KEYS` 가 문다. 이 파일이 무는 것은 **엔드포인트 종단 계약**(1건만·격리·null·disable 스텁)
//   이고, 그 주제는 그대로다.
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { prebuildArtifacts } from './helpers/prebuild-artifacts.mjs'
import { cleanup, commit, initVault, writeDoc } from './helpers/tmp-git-vault.mjs'

const { wiki } = await import(new URL('../wiki.mjs', import.meta.url).href)

/** summary 아티팩트 경로 — **리터럴 조립**(규범 A). 정확 형태의 계약은 PL9 가 한 번만 고정한다. */
const summaryFile = (vault, env) => path.join(vault, 'cache', `summary.${env}.json`)

/**
 * ★★ v3 P4 · §4.2 arm 갱신(D27) — `wiki()` 가 summary 경로를 **4번째 위치 인자**로 받는다.
 *
 * 이 파일이 무는 것은 **엔드포인트 반환 계약**(1건 렌더·격리·null·disable 스텁)이지 인자 개수가
 * 아니다. 주제는 그대로 두고 호출 인자만 갱신한다(D15 `--count` 필수화 때의 처분과 같은 형태).
 * 오늘도 green 이다 — JS 는 여분 위치 인자를 무시한다. 규범 D: 헬퍼에 `expect` 를 두지 않는다.
 */
const askWiki = (vault, env, ref) => wiki(vault, env, ref, summaryFile(vault, env))

const ID_A = '0192a000-0000-7000-8000-0000000000aa'
const ID_B = '0192b000-0000-7000-8000-0000000000bb'
const ID_D = '0192d000-0000-7000-8000-0000000000dd'

const PATH_A = 'company/삼성전자'
const PATH_B = 'tech/HBM'
const PATH_DISABLE = 'concept/온디바이스-AI'

/** active 2(A·B, 서로 다른 heading) + disable 1(D) 세계관 — 격리·disable 스텁을 드러낸다. */
function seedWorld(vault) {
  writeDoc(vault, PATH_A, { body: '## HBM 사업\n\n삼성 본문.\n', id: ID_A, title: '삼성전자', type: 'company' }) // prettier-ignore
  writeDoc(vault, PATH_B, { body: '## 공급망\n\n공급망 본문.\n', id: ID_B, title: 'HBM', type: 'concept' }) // prettier-ignore
  writeDoc(vault, PATH_DISABLE, { id: ID_D, status: 'disable', title: '온디바이스 AI', type: 'concept' }) // prettier-ignore
  commit(vault, 'chore: active 2 + disable 1 생성')
}

describe('endpoints.wiki — per-doc git read (E-W′1 🔴RED 축 교체)', () => {
  // ★ 축 교체 사유 — **한 단언은 성격이 바뀌고, 두 단언은 계약과 함께 사라진다.**
  //   · `doc.html` 에 `<h2` → `doc.md` 에 `## ` : 옛 단언은 **렌더 산출**(heading 태그가 실제로
  //     만들어졌다)을 물었다. 서버가 렌더를 그만두므로 같은 위치에서 물 수 있는 것은 **원문의
  //     heading 문법**뿐이다. 즉 「렌더가 돌았다」가 아니라 **「본문이 원문 그대로 실렸다」**를 문다.
  //     ⚠️ 그래서 이 줄은 더 이상 렌더러 회귀를 잡지 않는다 — 렌더 산출의 검증은 렌더 주체(소비자)
  //     쪽으로 옮겨간 계약이고, 여기서는 그 자리를 **원문 무손상**이 대신한다.
  //   · `doc.headings.length > 0` · `toHaveProperty('sources')` : 두 키가 응답에서 **사라진다**.
  //     그 목차·각주 정의는 이제 원문에서 소비자가 만든다. 여기서 「없어졌다」를 부정형으로 다시
  //     쓰지 않는다 — 키 집합의 권위는 `ACTIVE_KEYS` **정확 일치**(다른 두 파일)가 단독으로 지며,
  //     같은 사실을 약한 형태로 중복하면 그쪽이 약화될 때 아무도 알아채지 못한다.
  //   · `toHaveProperty('meta')` · 격리 대조는 **무변경**이다.
  it('E-W′1: wiki(vault, env, path) → 그 문서 1건(본문 원문) · 이웃 본문 미포함(격리)', async () => {
    const vault = initVault()
    try {
      seedWorld(vault)
      await prebuildArtifacts(vault, 'dev')

      const doc = await askWiki(vault, 'dev', PATH_A)

      expect(doc).not.toBeNull()
      expect(typeof doc.md).toBe('string')
      expect(doc.md).toContain('## HBM 사업') // heading 이 **원문 문법 그대로**다(렌더되지 않았다)
      expect(doc.md).toContain('삼성 본문.') // 본문 텍스트도 그대로
      expect(doc).toHaveProperty('meta')
      expect(doc.md).not.toContain('공급망') // 이웃 문서 B 본문이 새지 않는다
      expect((await askWiki(vault, 'dev', PATH_B)).md).toContain('공급망') // B 는 정확히 B
    } finally {
      cleanup(vault)
    }
  })
})

describe('endpoints.wiki — 계약 pin (E-W2·E-W3 🟢GFS)', () => {
  it('E-W2: 없는 path → null(throw 아님)', async () => {
    const vault = initVault()
    try {
      seedWorld(vault)
      await prebuildArtifacts(vault, 'dev')

      expect(await askWiki(vault, 'dev', '없는/경로')).toBeNull()
    } finally {
      cleanup(vault)
    }
  })

  it('E-W3: disable 문서 → status="disable" 스텁(throw 아님)', async () => {
    const vault = initVault()
    try {
      seedWorld(vault)
      await prebuildArtifacts(vault, 'dev')

      const doc = await askWiki(vault, 'dev', PATH_DISABLE)

      expect(doc).not.toBeNull()
      expect(doc.status).toBe('disable')
    } finally {
      cleanup(vault)
    }
  })
})
