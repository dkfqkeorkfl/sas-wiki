/**
 * Shared helpers for ecc-hooks.mjs / ecc-mcp.mjs (post-create only).
 */
import fs from 'node:fs'
import path from 'node:path'

export const PREFIX = '[post-create]'

/** @param {unknown[]} parts */
export function log(...parts) {
  console.log(PREFIX, ...parts)
}

/** @param {unknown[]} parts */
export function warn(...parts) {
  console.warn(PREFIX, ...parts)
}

/** @param {string} filePath */
export function readJsonFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8')
  return JSON.parse(raw)
}

/**
 * @param {string} filePath
 * @param {string} contents
 */
export function writeAtomic(filePath, contents) {
  const dir = path.dirname(filePath)
  fs.mkdirSync(dir, { recursive: true })
  const tmp = `${filePath}.tmp.${process.pid}.${Date.now()}`
  fs.writeFileSync(tmp, contents, 'utf8')
  fs.renameSync(tmp, filePath)
}

/**
 * @param {string} filePath
 * @returns {string} backup path written
 */
export function backupCopy(filePath) {
  const stamp = new Date()
    .toISOString()
    .replace(/[-:TZ.]/g, '')
    .slice(0, 14)
  const bak = `${filePath}.bak.${stamp}`
  if (fs.existsSync(filePath)) fs.copyFileSync(filePath, bak)
  return bak
}

export function homeDir() {
  const h = process.env.HOME || process.env.USERPROFILE
  if (!h) throw new Error('HOME or USERPROFILE is not set')
  return h
}
