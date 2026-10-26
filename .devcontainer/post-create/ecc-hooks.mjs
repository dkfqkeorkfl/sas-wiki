#!/usr/bin/env node
/**
 * Merge ECC ~/.claude/hooks/hooks.json (.hooks) into ~/.claude/settings.json under "hooks".
 * Same rules as legacy jq: per-event-key arrays are concatenated (user first, then ECC).
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PREFIX, backupCopy, homeDir, log, readJsonFile, warn, writeAtomic } from './lib.mjs'

/** @param {Record<string, unknown>} userHooks @param {Record<string, unknown>} eccHooks */
export function mergeHookEvents(userHooks, eccHooks) {
  const u = userHooks && typeof userHooks === 'object' && !Array.isArray(userHooks) ? userHooks : {}
  const e = eccHooks && typeof eccHooks === 'object' && !Array.isArray(eccHooks) ? eccHooks : {}
  const keys = [...new Set([...Object.keys(u), ...Object.keys(e)])]
  const out = {}
  for (const k of keys) {
    const ua = Array.isArray(u[k]) ? u[k] : []
    const ea = Array.isArray(e[k]) ? e[k] : []
    out[k] = [...ua, ...ea]
  }
  return out
}

function main() {
  const home = homeDir()
  const settingsFile = path.join(home, '.claude', 'settings.json')
  const eccHooksFile = path.join(home, '.claude', 'hooks', 'hooks.json')

  fs.mkdirSync(path.join(home, '.claude'), { recursive: true })

  if (!fs.existsSync(eccHooksFile)) {
    warn(`ECC hooks file missing at ${eccHooksFile}; skip merging into settings.json`)
    process.exit(0)
  }

  let eccRoot
  try {
    eccRoot = readJsonFile(eccHooksFile)
  } catch (e) {
    warn(`Cannot read ${eccHooksFile}:`, String(/** @type {Error} */ (e).message || e))
    process.exit(0)
  }

  const eccHooks =
    eccRoot &&
    typeof eccRoot === 'object' &&
    eccRoot.hooks &&
    typeof eccRoot.hooks === 'object' &&
    !Array.isArray(eccRoot.hooks)
      ? eccRoot.hooks
      : null
  if (!eccHooks) {
    warn(`${eccHooksFile} has no valid .hooks object; skip merge`)
    process.exit(0)
  }

  if (fs.existsSync(settingsFile)) {
    try {
      const s = readJsonFile(settingsFile)
      if (s && s.disableAllHooks === true) {
        warn(
          'disableAllHooks is true in settings.json; ECC hook merge may have no effect until unset',
        )
      }
    } catch {
      /* ignore invalid settings for this warning */
    }
  }

  if (!fs.existsSync(settingsFile)) {
    writeAtomic(settingsFile, '{}')
  }

  let settings
  try {
    settings = readJsonFile(settingsFile)
  } catch (e) {
    console.error(
      PREFIX,
      `Cannot parse ${settingsFile}:`,
      String(/** @type {Error} */ (e).message || e),
    )
    process.exit(1)
  }
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    console.error(PREFIX, `${settingsFile} must be a JSON object`)
    process.exit(1)
  }

  const userHooks =
    settings.hooks && typeof settings.hooks === 'object' && !Array.isArray(settings.hooks)
      ? settings.hooks
      : {}
  const mergedHooks = mergeHookEvents(userHooks, /** @type {Record<string, unknown>} */ (eccHooks))

  const bak = backupCopy(settingsFile)
  log(`ECC hooks → settings.json (backup: ${bak})`)

  const next = { ...settings, hooks: mergedHooks }
  writeAtomic(settingsFile, `${JSON.stringify(next, null, 2)}\n`)
  process.exit(0)
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) main()
