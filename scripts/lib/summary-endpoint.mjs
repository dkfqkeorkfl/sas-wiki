// summary 엔드포인트(**얕은 티어**) — vault 를 그 자리에서 파싱해 부팅 페이로드 1건을 만든다.
//
// ★ 왜 생성기 CLI(`scripts/summary.mjs`)와 같은 파일에 두지 않는가:
//   이 함수는 `parse-vault → derive → render` 사슬을 **정적으로** 물어야 한다(본문을 실제로 파생하므로
//   정상이다). 그런데 그 사슬 하나가 모듈 로드에만 수 초를 쓰기 때문에, 생성기와 한 파일에 있으면
//   **"안 바뀌었나?" 한 번을 묻는 데도** 그 비용이 전부 붙는다 — 렌더 결과를 한 줄도 쓰지 않는데도.
//   그래서 판정 경로(`summary.mjs`)와 파싱 경로(여기)를 **파일 단위로** 갈랐다. `summary.mjs` 는
//   이것을 재export 하지 않는다 — 재export 는 정적 import 와 같은 비용이라 분리가 무효가 된다.
//
//   시그니처·동기성·비용 티어는 이동 전과 **완전히 같다**(위치만 옮겼다).
import path from 'node:path'

import { computeInputsFingerprint } from './fingerprint.mjs'
import { buildWirePayload } from './parse-vault.mjs'
import { buildSummary } from './payloads.mjs'

/**
 * @param {string} vault git vault repository root — **기본값을 흡수하지 않는다**(순수 함수 격리 불변식).
 * @param {'dev'|'prod'} env
 */
export function summary(vault, env = 'prod') {
  const vaultDir = path.resolve(vault)
  const payload = buildWirePayload(vaultDir, env)
  const inputsFingerprint = computeInputsFingerprint({
    env,
    sourceCommit: payload.sourceCommit,
    vaultDir,
  })
  return buildSummary({
    docs: payload.docs,
    env,
    generatedAt: payload.generatedAt,
    inputsFingerprint,
    sourceCommit: payload.sourceCommit,
    tags: payload.tags,
    tree: payload.tree,
  })
}
