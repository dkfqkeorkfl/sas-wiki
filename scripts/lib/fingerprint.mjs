import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { WIKI_PREFIX } from './head-state.mjs'

const DEFAULT_SCRIPTS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export function computeInputsFingerprint({
  env,
  scriptsDir = DEFAULT_SCRIPTS_DIR,
  sourceCommit,
  vaultDir,
}) {
  const hash = createHash('sha256')
  updateField(hash, 'env', env ?? '')
  updateField(hash, 'sourceCommit', sourceCommit ?? '')

  for (const file of listInputs(path.resolve(scriptsDir), isScriptInput)) {
    updateFile(hash, 'scripts', path.resolve(scriptsDir), file)
  }
  // 위키 루트는 `head-state.mjs` 가 소유한다 — 여기서 `'wiki'` 를 다시 적으면 루트가 또 이관될 때
  //   `listInputs` 가 **조용히 빈 배열**을 돌려주고(부재 = []) 문서 변경을 감지 못 하는 지문이 된다.
  const vaultRoot = path.resolve(vaultDir)
  const wikiDir = path.join(vaultRoot, ...WIKI_PREFIX.split('/').filter(Boolean))
  for (const file of listInputs(wikiDir, (filePath) => filePath.endsWith('.md'))) {
    updateFile(hash, 'wiki', vaultRoot, file)
  }

  // ★ P5 Task 8(D-H·R1) — 억제 목록은 **이 지문의 입력이 아니다**. 이전 주석은 "지문 밖에 두면
  //   저장해도 stale 이 안 돼 D12 가 성립하지 않는다" 고 적었으나, 그 진술은 **코드로 반증된다**:
  //   D12("저장만으로 즉시 반영")를 실제로 지탱하는 것은 이 함수의 무효화가 **아니라** `feeds.mjs`
  //   가 매 요청마다 `loadIgnoreFeeds` 를 **캐시 없이 직접** 읽는다는 사실이다(서빙 시점 필터 ·
  //   D-A·D-C). 억제는 summary 산출물의 바이트를 바꾸지 않는다(B14 실측 · SU6 이 완전 동일을 고정
  //   한다) — Gradle Incremental Build 의 규범대로 "산출에 영향을 주지 않는 속성을 입력으로 등록
  //   하면 안 된다"(등록하면 억제 편집 한 줄이 26초 전량 재생성을 부른다 · B10). 지문에 넣었던
  //   진짜 이유는 소비자의 post-suppression 인메모리 첫 페이지 캐시였고(P4), 그 캐시가 사라지면
  //   (Task 8 · `plugin.ts`) 이 입력도 함께 빠져야 한다 — 하나만 하면 "억제가 반영되지 않는다"
  //   상태로 되돌아간다.
  //
  // 수용하는 손실(OQ-P5-6): `summary --status` 가 malformed 억제 목록을 조기 검출하던 층이 사라진다
  //   (지문 변화 → 재생성 → throw 로 *우연히* 검출하던 것이었다). 검출 책임은 `loadIgnoreFeeds`
  //   가 계속 진다 — `validate`·`feeds` 는 여전히 fail-loud 다(SU8).

  return hash.digest('hex').slice(0, 16)
}

function isScriptInput(filePath) {
  const normalized = filePath.split(path.sep).join('/')
  if (normalized.split('/').includes('__tests__')) return false
  return filePath.endsWith('.mjs') || /[/\\]schema[/\\][^/\\]+\.json$/u.test(filePath)
}

/**
 * `root` 아래에서 `predicate` 를 만족하는 **일반 파일**을 모은다(경로 오름차순 — 해시 결정성).
 *
 * **심볼릭 링크는 따라가지 않는다.** `fs.statSync` 는 링크를 추종하므로 `wiki/x -> /etc` 같은 항목
 * 하나로 vault·scripts 경계 밖 파일이 지문 입력에 섞이고(실측 확인), 자기 조상을 가리키는 링크는
 * ELOOP 로 생성기 전체를 죽인다. `readdirSync(withFileTypes)` 의 `Dirent` 판정은 **링크를 링크로**
 * 보므로 디렉토리도 파일도 아닌 것으로 걸러진다 — 실 문서 수집(`parse.mjs`)이 이미 쓰는 방식이고,
 * 여기만 다른 워커를 쓰던 것이 비대칭이었다.
 */
function listInputs(root, predicate) {
  if (!fs.existsSync(root)) return []
  const out = []
  const stack = [root]
  while (stack.length > 0) {
    const current = stack.pop()
    let entries
    try {
      entries = fs.readdirSync(current, { withFileTypes: true })
    } catch {
      // root 가 디렉토리가 아니면(파일·링크) 입력 대상이 아니다 — 조용히 건너뛴다.
      continue
    }
    for (const entry of entries) {
      const child = path.join(current, entry.name)
      if (entry.isDirectory()) stack.push(child)
      else if (entry.isFile() && predicate(child)) out.push(child)
    }
  }
  // **코드포인트 비교**다 — `localeCompare` 는 환경 로케일에 따라 순서가 달라져, 같은 vault 가
  //   기계마다 다른 지문을 낼 수 있다(해시 입력 순서가 곧 지문이다).
  return out.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
}

function updateFile(hash, kind, root, filePath) {
  const rel = path.relative(root, filePath).split(path.sep).join('/')
  const contents = fs.readFileSync(filePath)
  updateField(hash, `${kind}:${rel}`, contents)
}

function updateField(hash, name, value) {
  const data = Buffer.isBuffer(value) ? value : Buffer.from(String(value))
  hash.update(`${name}\0${data.length}\0`)
  hash.update(data)
  hash.update('\0')
}
