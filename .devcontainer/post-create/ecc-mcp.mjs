#!/usr/bin/env node
/**
 * Merge ECC ~/.claude/mcp-configs/mcp-servers.json into ~/.claude.json mcpServers.
 * Allowlist-only: empty ECC_DEVCONTAINER_MCP_SERVERS → no-op (do not modify ~/.claude.json).
 * Non-empty: comma-separated catalog keys from mcp-servers.json.
 * Special alias: `exa` → HTTP Exa at https://mcp.exa.ai/mcp (not in ECC catalog).
 * User wins on same key (spread user last in mergeMcpServers).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PREFIX, backupCopy, homeDir, log, readJsonFile, warn, writeAtomic } from './lib.mjs';

function trim(s) {
  return String(s || '')
    .replace(/^ +/, '')
    .replace(/ +$/, '');
}

/** @param {string} csv */
function splitCsv(csv) {
  return trim(csv)
    .split(',')
    .map((x) => trim(x))
    .filter(Boolean);
}

function hasKeyCsv(csv, key) {
  return splitCsv(csv).some((x) => x === key);
}

/** @param {string[]} keys */
function uniquePreserveOrder(keys) {
  const seen = new Set();
  /** @type {string[]} */
  const out = [];
  for (const k of keys) {
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(k);
  }
  return out;
}

/**
 * @typedef {'none'|'injected'|'skipped_user'|'skipped_collision'} ExaInjectResult
 */

/**
 * jq walk: if object has command and no type, add type stdio (recursive).
 * @param {unknown} node
 */
export function ensureStdioType(node) {
  if (node == null || typeof node !== 'object' || Array.isArray(node)) return node;
  const o = /** @type {Record<string, unknown>} */ ({ .../** @type {object} */ (node) });
  if ('command' in o && !('type' in o)) o.type = 'stdio';
  for (const k of Object.keys(o)) {
    const v = o[k];
    if (v && typeof v === 'object' && !Array.isArray(v)) o[k] = ensureStdioType(v);
  }
  return o;
}

/**
 * @param {Record<string, unknown>} catalog mcpServers object from ECC file
 * @param {string} allowRaw ECC_DEVCONTAINER_MCP_SERVERS (empty string → {})
 */
export function filterMcpCatalog(catalog, allowRaw) {
  const allow = trim(allowRaw);
  if (!allow.length) return {};

  const ns = new Set(splitCsv(allow));
  const filtered = Object.fromEntries(Object.entries(catalog).filter(([k]) => ns.has(k)));

  /** @type {Record<string, unknown>} */
  const typed = {};
  for (const [k, v] of Object.entries(filtered)) {
    typed[k] = ensureStdioType(v);
  }
  return typed;
}

const EXA_HTTP_SERVER = Object.freeze({
  type: 'http',
  url: 'https://mcp.exa.ai/mcp',
});

/**
 * If allowlist contains `exa`, inject Exa MCP as HTTP server under key `exa`.
 * Does not override user-defined `exa`.
 *
 * @param {Record<string, unknown>} filtered catalog-filtered servers (already typed)
 * @param {string} allowRaw ECC_DEVCONTAINER_MCP_SERVERS
 * @param {Record<string, unknown>} userExisting existing ~/.claude.json mcpServers
 * @returns {{ filtered: Record<string, unknown>, exaResult: ExaInjectResult }}
 */
export function maybeInjectHttpExa(filtered, allowRaw, userExisting) {
  if (!trim(allowRaw) || !hasKeyCsv(allowRaw, 'exa')) {
    return { filtered, exaResult: 'none' };
  }
  if (userExisting && Object.prototype.hasOwnProperty.call(userExisting, 'exa')) {
    return { filtered, exaResult: 'skipped_user' };
  }
  if (Object.prototype.hasOwnProperty.call(filtered, 'exa')) {
    return { filtered, exaResult: 'skipped_collision' };
  }
  return { filtered: { ...filtered, exa: EXA_HTTP_SERVER }, exaResult: 'injected' };
}

/**
 * One-line human scan of each allowlist token vs catalog / user / exa alias.
 *
 * @param {object} p
 * @param {string[]} p.requested
 * @param {Record<string, unknown>} p.catalog
 * @param {Record<string, unknown>} p.userMcp
 * @param {Record<string, unknown>} p.filtered after filter + exa inject
 * @param {ExaInjectResult} p.exaResult
 */
export function buildMcpAllowlistSummary(p) {
  const { requested, catalog, userMcp, filtered, exaResult } = p;
  /** @type {string[]} */
  const parts = [];
  for (const k of requested) {
    if (k === 'exa') {
      if (exaResult === 'injected') parts.push('exa:ok(http)');
      else if (exaResult === 'skipped_user') parts.push('exa:skip(user)');
      else if (exaResult === 'skipped_collision') parts.push('exa:skip(collision)');
      else parts.push('exa:none');
      continue;
    }
    if (!Object.prototype.hasOwnProperty.call(catalog, k)) {
      parts.push(`${k}:missing`);
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(userMcp, k)) {
      parts.push(`${k}:skip(user)`);
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(filtered, k)) {
      parts.push(`${k}:ok`);
      continue;
    }
    parts.push(`${k}:missing`);
  }
  return parts.join(' | ');
}

/**
 * jq: .mcpServers = ($ecc * ($user // {})) — user wins on same key (spread user last).
 * @param {Record<string, unknown>} eccFiltered
 * @param {Record<string, unknown>|undefined} userExisting
 */
export function mergeMcpServers(eccFiltered, userExisting) {
  const u =
    userExisting && typeof userExisting === 'object' && !Array.isArray(userExisting)
      ? userExisting
      : {};
  return { ...eccFiltered, ...u };
}

function main() {
  const home = homeDir();
  const eccMcp = path.join(home, '.claude', 'mcp-configs', 'mcp-servers.json');
  const claudeJson = path.join(home, '.claude.json');

  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });

  const allow = process.env.ECC_DEVCONTAINER_MCP_SERVERS || '';
  if (!trim(allow)) {
    warn('ECC_DEVCONTAINER_MCP_SERVERS empty; skip ~/.claude.json mcpServers merge (no-op)');
    process.exit(0);
  }

  if (!fs.existsSync(eccMcp)) {
    warn(`ECC MCP catalog missing at ${eccMcp}; skip ~/.claude.json mcpServers merge`);
    process.exit(0);
  }

  let eccRoot;
  try {
    eccRoot = readJsonFile(eccMcp);
  } catch (e) {
    warn(`Cannot read ${eccMcp}:`, String(/** @type {Error} */ (e).message || e));
    process.exit(0);
  }

  const catalog =
    eccRoot &&
    typeof eccRoot === 'object' &&
    eccRoot.mcpServers &&
    typeof eccRoot.mcpServers === 'object' &&
    !Array.isArray(eccRoot.mcpServers)
      ? /** @type {Record<string, unknown>} */ (eccRoot.mcpServers)
      : null;
  if (!catalog) {
    warn(`${eccMcp} has no valid .mcpServers object; skip MCP merge`);
    process.exit(0);
  }

  if (!fs.existsSync(claudeJson)) {
    writeAtomic(claudeJson, '{}');
  }

  let root;
  try {
    root = readJsonFile(claudeJson);
  } catch (e) {
    console.error(
      PREFIX,
      `Cannot parse ${claudeJson}:`,
      String(/** @type {Error} */ (e).message || e),
    );
    process.exit(1);
  }
  if (!root || typeof root !== 'object' || Array.isArray(root)) {
    console.error(PREFIX, `${claudeJson} must be a JSON object`);
    process.exit(1);
  }

  const userMcp =
    root.mcpServers && typeof root.mcpServers === 'object' && !Array.isArray(root.mcpServers)
      ? /** @type {Record<string, unknown>} */ (root.mcpServers)
      : {};

  const requested = uniquePreserveOrder(splitCsv(allow));
  let filtered = filterMcpCatalog(catalog, allow);
  const { filtered: nextFiltered, exaResult } = maybeInjectHttpExa(filtered, allow, userMcp);
  filtered = nextFiltered;

  const summary = buildMcpAllowlistSummary({
    requested,
    catalog,
    userMcp,
    filtered,
    exaResult,
  });

  if (Object.keys(filtered).length === 0) {
    warn('ECC MCP merge produced no servers; skip ~/.claude.json update');
    log('MCP allowlist result:', summary);
    process.exit(0);
  }

  const merged = mergeMcpServers(filtered, userMcp);

  const bak = backupCopy(claudeJson);
  log(`ECC mcpServers → ~/.claude.json (backup: ${bak})`);

  const next = { ...root, mcpServers: merged };
  writeAtomic(claudeJson, `${JSON.stringify(next, null, 2)}\n`);
  log(`MCP catalog keys merged: ${Object.keys(merged).join(',')}`);
  log('MCP allowlist result:', summary);
  process.exit(0);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();
