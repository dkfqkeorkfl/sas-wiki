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
  const wikiDir = path.join(path.resolve(vaultDir), ...WIKI_PREFIX.split('/').filter(Boolean))
  for (const file of listInputs(wikiDir, (filePath) => filePath.endsWith('.md'))) {
    updateFile(hash, 'wiki', path.resolve(vaultDir), file)
  }

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
