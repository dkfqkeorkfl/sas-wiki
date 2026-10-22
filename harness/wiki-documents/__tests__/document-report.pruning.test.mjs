import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import {
  cleanup,
  commit,
  feedCommit,
  initVault,
  writeDoc,
} from '../../test-utils/tmp-git-vault.mjs'
import { inspectVault } from '../document-integrity.mjs'
const HERE = path.dirname(
  fileURLToPath(new URL('../../../scripts/__tests__/build.p5-plumbing.test.mjs', import.meta.url)),
)
const SCRIPTS_DIR = path.resolve(HERE, '..')
const REPORT_SCHEMA = path.join(SCRIPTS_DIR, 'schema', 'report.schema.json')
const REPORT_PROPERTY_KEYS = [
  'env',
  'excluded',
  'generatedAt',
  'invalidExcludedRefs',
  'prunedFeeds',
  'schemaVersion',
  'sourceCommit',
  'summary',
  'unresolvedPaths',
]
const ID_A = '0192a000-0000-7000-8000-0000000000aa'
const REL_A = 'company/삼성전자'
const STRAY_PATH = 'wiki/concept/메모장.md'
const tmps = []
afterAll(() => cleanup(...tmps))
describe('문서 검사 계약 회귀', () => {
  it(
    'PL11: prune 이 실제로 일어난 vault 에서 `prunedFeeds` 등이 **>0** 이고 스키마가 선언한다',
    { timeout: 300_000 },
    () => {
      // 진단 채널이다 — 사유는 아티팩트가 아니라 **리포트**가 받는다(D-C: 부정 정보를 발행물에 싣지 않는다).
      // 앵커: 전부 0 인 vault 로 통과하는 것을 배제하려고 **prune 이 실재하는** vault 를 만든다.
      const vault = initVault()
      tmps.push(vault)
      writeDoc(vault, REL_A, { body: '## 정의\n\n본문.\n', id: ID_A, title: '삼성전자', type: 'company' }) // prettier-ignore
      // frontmatter 가 없는 `.md` — 문서 후보이되 문서가 아니다(stray). 이것을 가리키는 피드는
      //   `unresolved` 로 fail-closed 드랍된다 → prunedFeeds·unresolvedPaths 가 실제로 올라간다.
      mkdirSync(path.join(vault, 'wiki', 'concept'), { recursive: true })
      writeFileSync(path.join(vault, STRAY_PATH), '그냥 메모다. frontmatter 가 없다.\n')
      commit(vault, 'chore: 문서 1건 + 메모 1건')
      writeFileSync(path.join(vault, STRAY_PATH), '메모를 고쳤다. 여전히 frontmatter 가 없다.\n')
      const strayFeedSha = feedCommit(vault, {
        date: '2026-05-01T00:00:00Z',
        subject: '메모장 소식',
      })

      // 🔴 v3 P1(§4.10 「재작성」 · PL11 · plan Task 7 · D5): 리포트는 **생성기 발행물에서 빠지고**
      //   `validate.mjs --out <dir>` 로 이사한다. 그래서 생성 주체와 읽는 경로를 함께 옮긴다 —
      //   **prune 진단 3키 계약 자체는 그대로 유지한다**(그것이 이 케이스의 본체다).
      //   ★ 이 vault 는 unresolved feed 참조가 실재하므로 `validate.mjs` 의 게이트 ④
      //     (`checkFeedResolution`)가 fail-loud 로 끊는다 — exit 는 0 이 아니다. **그래도 리포트는
      //     기록돼야 한다**: 진단 채널은 게이트가 통과할 때가 아니라 **막힐 때** 가장 필요하고, D5 가
      //     리포트 내용으로 지정한 것(무엇이 어떤 사유로 제외됐고 어떤 피드가 그것을 가리켰는가)이
      //     정확히 그 상황의 정보다. 그래서 exit code 를 단언하지 않고 **리포트 실재**를 앵커로 쓴다.
      const reportDir = mkdtempSync(path.join(tmpdir(), 'p5-report-'))
      tmps.push(reportDir)
      let failure
      try {
        inspectVault({ vault, env: 'dev', reportDir })
      } catch (error) {
        failure = error
      }
      expect(failure).toBeDefined()

      // 앵커: 리포트 2형식이 **지정한 디렉토리에** 실제로 생겼다(읽기 실패로 뭉개지는 것을 배제).
      const reportJson = path.join(reportDir, 'summary.report.dev.json')
      expect(existsSync(reportJson), failure.message).toBe(true)
      expect(existsSync(path.join(reportDir, 'summary.report.dev.txt')), failure.message).toBe(true)
      const report = JSON.parse(readFileSync(reportJson, 'utf8'))

      expect(report.prunedFeeds).toBeGreaterThan(0)
      expect(report.unresolvedPaths.length).toBeGreaterThan(0)
      expect(report.invalidExcludedRefs).toContainEqual({ path: STRAY_PATH, sha: strayFeedSha })

      // 스키마가 **같은 커밋에서** 따라왔는가 — `additionalProperties:false` 라 안 따라오면 산출물이
      //   자기 스키마를 어긴다(P4 AR8 과 같은 형태).
      const schema = JSON.parse(readFileSync(REPORT_SCHEMA, 'utf8'))
      expect(Object.keys(schema.properties).toSorted()).toEqual(REPORT_PROPERTY_KEYS)
    },
  )
})
