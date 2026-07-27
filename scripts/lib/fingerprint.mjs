import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

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
  for (const file of listInputs(path.join(path.resolve(vaultDir), 'wiki'), (filePath) =>
    filePath.endsWith('.md'),
  )) {
    updateFile(hash, 'wiki', path.resolve(vaultDir), file)
  }

  return hash.digest('hex').slice(0, 16)
}

function isScriptInput(filePath) {
  const normalized = filePath.split(path.sep).join('/')
  if (normalized.split('/').includes('__tests__')) return false
  return filePath.endsWith('.mjs') || /[/\\]schema[/\\][^/\\]+\.json$/u.test(filePath)
}

function listInputs(root, predicate) {
  if (!fs.existsSync(root)) return []
  const out = []
  const stack = [root]
  while (stack.length > 0) {
    const current = stack.pop()
    const stat = fs.statSync(current)
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(current)) stack.push(path.join(current, name))
      continue
    }
    if (stat.isFile() && predicate(current)) out.push(current)
  }
  return out.sort((a, b) => a.localeCompare(b))
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
