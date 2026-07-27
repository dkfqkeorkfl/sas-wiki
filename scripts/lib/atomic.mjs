import fs from 'node:fs'
import path from 'node:path'

export function classifyFsError(code) {
  const retryable = new Set(['EPERM', 'EACCES', 'EBUSY'])
  return retryable.has(code) ? 'retry' : 'fatal'
}

export function writeFileAtomic(finalPath, contents, { retryBudgetMs = 500, retries = 5 } = {}) {
  const dir = path.dirname(finalPath)
  fs.mkdirSync(dir, { recursive: true })
  const tmp = path.join(
    dir,
    `.tmp-${path.basename(finalPath)}-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  )

  let fd
  try {
    fd = fs.openSync(tmp, 'wx')
    fs.writeFileSync(fd, contents)
    fs.closeSync(fd)
    fd = undefined
    renameWithRetry(tmp, finalPath, { retryBudgetMs, retries })
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd)
      } catch {
        // Best-effort cleanup after a failing write path.
      }
    }
    try {
      fs.rmSync(tmp, { force: true })
    } catch {
      // Best-effort cleanup; the original write/rename error is more useful.
    }
  }
}

function renameWithRetry(tmp, finalPath, { retryBudgetMs, retries }) {
  const start = Date.now()
  let attempt = 0
  for (;;) {
    try {
      fs.renameSync(tmp, finalPath)
      return
    } catch (error) {
      const action = classifyFsError(error?.code)
      if (action === 'fatal' || attempt >= retries || Date.now() - start >= retryBudgetMs) {
        throw error
      }
      sleep(Math.min(25 * 2 ** attempt, Math.max(1, retryBudgetMs - (Date.now() - start))))
      attempt += 1
    }
  }
}

function sleep(ms) {
  const until = Date.now() + ms
  while (Date.now() < until) {
    // Synchronous CLI path; keep dependency-free and bounded.
  }
}
