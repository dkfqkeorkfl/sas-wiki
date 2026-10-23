#!/usr/bin/env node
/**
 * PreToolUse hook: path-resolution-based credential / integrity guard.
 *
 * Reads .claude/config/protected-paths.json and denies a tool call when the
 * REAL path it touches (after ~ / $HOME expansion, `..` normalisation, symlink
 * resolution and brace / shell-glob expansion, all relative to the live shell
 * `cwd`) matches a protected entry. Because it compares resolved paths rather
 * than command text, unrelated names that merely contain a protected substring
 * (`locker.secret.tsx`, a variable called `id_rsa_backup`) are not blocked.
 *
 * Shipped as `.mjs` so Node always loads it as an ES module, whatever `type`
 * the host project's package.json declares — a `.js` file would be read as
 * CommonJS in one project and as ESM in another, and a hook that fails to load
 * does not block anything.
 *
 * Entry `path` patterns (gitignore / settings.json Read() convention):
 *   ~/x   home        /x   absolute        ./x  project root (fixed)
 *   bare  any depth   *,?  never cross `/`  **   anything
 *   Every pattern matches the path it names and everything below it
 *   (`~/.ssh`, `~/.ssh/`, `~/.ssh/**` are equivalent).
 * Bare filename patterns can collide with a symbol name typed in a shell
 * command, so on shell channels they require the file to actually exist.
 * Patterns containing a slash explicitly describe paths and also protect
 * directories and files that do not exist yet.
 *
 * Covered channels
 *   read  : Read, Grep, Glob, Serena read tools
 *   write : Write, Edit, MultiEdit, NotebookEdit, Serena write tools, and
 *           Codex CLI's apply_patch (tool_name "apply_patch"; paths are
 *           parsed out of the patch envelope body in tool_input.command —
 *           see classify() and APPLY_PATCH_PATH_RE below)
 *   bash  : Bash, plus code-execution MCP tools (their code string is scanned
 *           the same way a shell command is). Codex CLI's own shell tool and
 *           its unified exec_command both report tool_name "Bash" with the
 *           same tool_input.command (string) shape as Claude Code, so no
 *           separate branch is needed for them — this was verified against
 *           developers.openai.com/codex/hooks (Tool coverage table) and
 *           codex-rs/hooks/src/events/pre_tool_use.rs.
 *
 * This script and protected-paths.json are themselves protected-paths.json
 * entries (write+bash blocked, same as eslint-rules/** below), so neither can
 * be Edited/Written nor shell-overwritten out from under itself — any attempt
 * still has to pass through the config as it currently stands. The Read tool
 * stays open for inspection since neither entry blocks `read`; there is no
 * Bash-channel carve-out (`cat` included), since `bash` does not distinguish
 * a read from a write and a narrower carve-out is easy to get wrong (a prior
 * version of this exact carve-out let `cat x >> this-file` through).
 *
 * Identified targets of tree-walking commands (grep -r, rg --hidden/--no-ignore,
 * cp -r, zip -r, rm -r, tar, rsync) are checked for protected descendants.
 * Fixed paths first use an ancestor check; a bounded metadata walk then checks
 * all Bash-blocking rules, including symlink targets. File contents are never read.
 * The shell operand parser is conservative, not a complete command parser;
 * complex option combinations may leave a command's implicit target unidentified.
 *
 * Known residual classes (Bash is not a security boundary — see Claude Code
 * docs). These cannot be closed by path matching and are left documented;
 * the literal-text backstop rules in .claude/settings.json (Bash(*.secret/*)
 * etc.) cover the first class whenever the name is still spelled out:
 *   - indirection the hook does not evaluate: string concatenation inside
 *     code (open('.secret' '/token')), encoded spellings ($'\x2e'secret),
 *     values from anything other than a plain assignment or echo/printf
 *     (X=$(basename ...); cat $X/token)
 *   - encoded/decoded payloads: base64 (or similar) decoded and piped into
 *     eval/sh/bash, or `source`/`.` of a script file whose own path is
 *     computed at runtime rather than spelled out
 *   - find ... -exec cat {} or find ... | xargs cat (the target only exists,
 *     or is only named, after find runs)
 *   - whole-project Grep / Serena search with no path (relies on .gitignore +
 *     ripgrep's default hidden-file skipping)
 *
 * Fail-closed: any internal error, or a config file that fails to load or
 * validate, denies every governed tool call with an explanatory reason instead
 * of silently passing it through. A brace or glob expansion that overflows its
 * bound (BRACE_LIMIT, GLOB_LIMIT), or a glob pattern `fs.globSync` itself
 * cannot evaluate, throws rather than silently returning a truncated or empty
 * candidate set, so it is denied the same way.
 *
 * Registered with matcher "*" in .claude/settings.json (hooks.PreToolUse) for
 * Claude Code, and in .codex/hooks.json (same script, same matcher) for
 * Codex CLI.
 * Regression tests: node --test src/tests/claude/scripts/protect-paths-hook.test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CONFIG_PATH = path.join(__dirname, '..', 'config', 'protected-paths.json');
// Fixed project root derived from this file's location — never from
// $CLAUDE_PROJECT_DIR (observed missing) or the live cwd (moves with `cd`).
const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const HOME = os.homedir();

const CATEGORIES = new Set(['read', 'write', 'bash']);
const READ_TOOLS = new Set(['Read', 'Grep', 'Glob']);
const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
const SERENA_READ = new Set([
  'find_symbol',
  'find_declaration',
  'find_implementations',
  'find_referencing_symbols',
  'get_symbols_overview',
  'get_diagnostics_for_file',
  'search_for_pattern',
]);
const SERENA_WRITE = new Set([
  'insert_after_symbol',
  'insert_before_symbol',
  'replace_content',
  'replace_symbol_body',
  'safe_delete_symbol',
  'rename_symbol',
  'replace_in_files',
]);
// Serena may be registered directly (mcp__serena__x) or via plugin
// (mcp__plugin_serena_serena__x); accept both spellings.
const SERENA_TOOL = /^mcp__\w*serena\w*__(\w+)$/;
// MCP tools that execute a free-text code string: scanned like a Bash command.
const CODE_EXEC_TOOLS = { mcp__ide__executeCode: 'code' };
// Codex CLI's file-edit tool. Its PreToolUse payload always reports
// tool_name "apply_patch" (never Write/Edit, even though those are accepted
// matcher aliases) and puts the raw patch envelope in tool_input.command —
// confirmed against developers.openai.com/codex/hooks and Codex's own patch
// parser (codex-rs/apply-patch/src/parser.rs; same marker grammar documented
// in openai/gpt-oss's apply_patch.md). Each operation's path is on its own
// header line and is always relative to the session cwd, never absolute.
const APPLY_PATCH_PATH_RE = /^\*\*\* (?:Add File|Delete File|Update File|Move to): (.+?)\r?$/;

// Commands that read or copy a whole directory tree, with the flag (if any)
// that makes them recursive. Aimed at a folder ABOVE a protected path they
// would walk into it, so the ancestor rule in decide() denies them and points
// at `rg` (skips hidden + gitignored files) or a narrower folder instead.
// grep/rg with no path operand default to the cwd, hence `implicitCwd`.
// `kind: 'search'` commands can reasonably be replaced by `rg`; the rest
// (copy/archive/delete) cannot, so denyRecursiveReach gives them different
// advice instead of suggesting a search tool.
const RECURSIVE_READERS = [
  {
    name: 'grep -r',
    cmds: ['grep', 'egrep', 'fgrep'],
    flag: /^-[a-zA-Z]*[rR]|^--(?:recursive|dereference-recursive)$/,
    implicitCwd: true,
    kind: 'search',
  },
  {
    name: 'rg --hidden/--no-ignore',
    cmds: ['rg', 'ag'],
    flag: /^-[a-zA-Z.]*[u.]|^--(?:hidden|unrestricted|no-ignore)/,
    implicitCwd: true,
    kind: 'search',
  },
  {
    name: 'cp -r',
    cmds: ['cp'],
    flag: /^-[a-zA-Z]*[rRa]|^--(?:recursive|archive)$/,
    kind: 'archive',
  },
  { name: 'zip -r', cmds: ['zip'], flag: /^-[a-zA-Z]*r|^--recursive$/, kind: 'archive' },
  { name: 'rm -r', cmds: ['rm'], flag: /^-[a-zA-Z]*r|^--recursive$/, kind: 'archive' },
  { name: 'tar', cmds: ['tar'], flag: null, kind: 'archive' },
  { name: 'rsync', cmds: ['rsync'], flag: null, kind: 'archive' },
];

const HAS_GLOB = /[*?[]/;
const GLOB_EXCLUDE = new Set(['node_modules', '.git']);
const GLOB_LIMIT = 5000;
const BRACE_LIMIT = 256;
const RECURSIVE_SCAN_LIMIT = 5000;
const RECURSIVE_SCAN_MS = 1000;

// ---------------------------------------------------------------- paths ----

const USER = (() => {
  try {
    return os.userInfo().username;
  } catch {
    return '';
  }
})();

// $HOME / ${HOME} / ${HOME:-x}, $PWD, $CLAUDE_PROJECT_DIR, other environment
// variables, ~ and ~user.
function expandVars(p, cwd) {
  let s = p
    .replace(/\$\{HOME(?::?[-=?+][^}]*)?\}|\$HOME(?![A-Za-z0-9_])/g, HOME)
    .replace(/\$\{PWD(?::?[-=?+][^}]*)?\}|\$PWD(?![A-Za-z0-9_])/g, cwd)
    .replace(
      /\$\{CLAUDE_PROJECT_DIR(?::?[-=?+][^}]*)?\}|\$CLAUDE_PROJECT_DIR(?![A-Za-z0-9_])/g,
      PROJECT_ROOT,
    );
  s = s.replace(/\$\{([A-Za-z_]\w*)\}|\$([A-Za-z_]\w*)/g, (match, braced, bare) => {
    const name = braced || bare;
    return process.env[name] !== undefined ? process.env[name] : match;
  });
  if (s === '~') return HOME;
  if (s.startsWith('~/')) return path.join(HOME, s.slice(2));
  const m = /^~([A-Za-z0-9_.-]+)(\/.*)?$/.exec(s);
  if (m) return path.join(m[1] === USER ? HOME : path.join(path.dirname(HOME), m[1]), m[2] || '');
  return s;
}

// Resolve the longest existing prefix so a symlinked directory is still
// followed when the candidate's final component will be created later.
// `cache` (a Map, one per decide() invocation) memoizes by input path: the
// main loop below calls this once per (candidate x base) pair, and distinct
// pairs often share the same base directory, so without memoizing this walks
// the same filesystem prefix over and over.
//
// IMPORTANT: this only gives the right answer when `p` has no `..`/`.`
// segments left in it — `fs.realpathSync()` does not reliably resolve a `..`
// that follows a symlinked directory (verified: it mis-resolves exactly that
// case), so any `..` must already be handled by the caller (see
// `realAwareResolve` below) before reaching here.
function realpathOfExistingPrefix(p, cache) {
  if (cache && cache.has(p)) return cache.get(p);
  const missing = [];
  let current = p;
  let result;
  while (true) {
    try {
      result = path.join(fs.realpathSync(current), ...missing);
      break;
    } catch {
      const parent = path.dirname(current);
      if (parent === current) {
        result = p;
        break;
      }
      missing.unshift(path.basename(current));
      current = parent;
    }
  }
  if (cache) cache.set(p, result);
  return result;
}

// path.resolve also normalizes `..`, `.` and repeated slashes in absolute input.
function toAbsolute(p, base) {
  return path.resolve(base, expandVars(p, base));
}

// Join without collapsing `..`/`.` the way path.join/path.resolve do — the
// starting point for realAwareResolve, which needs the literal `..` segments
// still present so it can apply each one at the right place in the walk.
function joinRaw(base, p) {
  if (path.isAbsolute(p)) return p;
  return base.replace(/\/+$/, '') + '/' + p;
}

// Symlink-aware alternative to the lexical `..`-collapse that toAbsolute (via
// path.resolve) performs. A real shell/OS resolves a path left to right,
// following any symlink at each component BEFORE applying a later `..` —
// so `..` after a symlinked directory lands at the parent of whatever the
// symlink actually points to, not at the parent of the symlink's own name.
// `path.resolve()` only does string-level collapsing and gets this wrong;
// `fs.realpathSync()` does too when given a path that still contains `..`
// (confirmed by direct test — it does not interleave symlink resolution with
// `..` the way POSIX path resolution does). So this walks the path one
// component at a time instead: plain components are appended, `..` moves to
// the parent of the REAL path accumulated SO FAR, and a component that turns
// out to be a symlink is resolved (via realpathOfExistingPrefix, safe here
// since at this point it never contains `..`) before continuing. A component
// that does not exist yet is kept literal, matching realpathOfExistingPrefix's
// own "existing prefix only" behaviour.
function realAwareResolve(absPath, cache) {
  if (cache && cache.has(absPath)) return cache.get(absPath);
  const root = path.parse(absPath).root;
  const segments = absPath.slice(root.length).split('/').filter(Boolean);
  let real = root.replace(/\/+$/, '') || root;
  for (const seg of segments) {
    if (seg === '.') continue;
    if (seg === '..') {
      real = path.dirname(real);
      continue;
    }
    const next = real === '/' ? `/${seg}` : `${real}/${seg}`;
    let stat;
    try {
      stat = fs.lstatSync(next);
    } catch {
      real = next;
      continue;
    }
    real = stat.isSymbolicLink() ? realpathOfExistingPrefix(next, cache) : next;
  }
  if (cache) cache.set(absPath, real);
  return real;
}

// Bash-like expansion (verified on Node 22: `*` skips dotfiles, `.*` matches
// them). Runs from the filesystem root so absolute patterns work unchanged.
// Fail-closed: a hit count over GLOB_LIMIT throws instead of silently
// returning only the first GLOB_LIMIT matches, which would let a flood of
// generated names quietly push a real match out of the truncated set. A glob
// `fs.globSync` itself cannot evaluate (invalid pattern, read error while
// walking) is a real failure, not "no match", so it is left to propagate
// instead of being swallowed into an empty result.
function expandShellGlob(absPattern) {
  const root = path.parse(absPattern).root;
  const rel = path.relative(root, absPattern);
  const hits = fs.globSync(rel, {
    cwd: root,
    exclude: (p) => GLOB_EXCLUDE.has(path.basename(p)),
  });
  if (hits.length > GLOB_LIMIT) {
    throw new Error(`glob 확장이 ${GLOB_LIMIT}개를 넘음(${absPattern})`);
  }
  return hits.map((h) => path.join(root, h));
}

// Bash brace expansion, single level, bounded: config{,} -> config, a{b,c} -> ab ac.
// Fail-closed: over BRACE_LIMIT throws instead of silently stopping partway
// (the previous behaviour), which would quietly drop any alternative past the
// cutoff from the set that gets checked against protected entries.
function expandBraces(s) {
  const m = /\{([^{}]*)\}/.exec(s);
  if (!m) return [s];
  const head = s.slice(0, m.index);
  const tail = s.slice(m.index + m[0].length);
  const out = [];
  for (const alt of m[1].split(',')) {
    out.push(...expandBraces(head + alt + tail));
    if (out.length > BRACE_LIMIT) {
      throw new Error(`brace 확장이 ${BRACE_LIMIT}개를 넘음(${s})`);
    }
  }
  return out;
}

// One candidate string -> every absolute path it can denote: the literal
// resolution, its brace/glob expansions (shell channels only, and only when
// the candidate was not a single fully-quoted shell word — see `tokenize`),
// its symlink-resolved real path, and — when the form contains `..` — the
// symlink-aware resolution of the UNCOLLAPSED form too (see
// `realAwareResolve`), since the lexical and symlink-aware answers can differ
// and either one matching a protected entry is reason enough to deny.
function resolveCandidate(candidate, base, isShell, cache, skipExpand) {
  const varsExpanded = isShell ? expandVars(candidate, base) : candidate;
  const forms = isShell && !skipExpand ? expandBraces(varsExpanded) : [varsExpanded];
  const out = new Set();
  for (const form of forms) {
    const abs = toAbsolute(form, base);
    const literal =
      isShell && !skipExpand && HAS_GLOB.test(abs) ? [abs, ...expandShellGlob(abs)] : [abs];
    for (const p of literal) {
      out.add(p);
      const real = realpathOfExistingPrefix(p, cache);
      if (real !== p) out.add(real);
    }
    if (form.includes('..')) {
      out.add(realAwareResolve(joinRaw(base, form), cache));
    }
  }
  return [...out];
}

// ------------------------------------------------------- entry patterns ----

// Glob -> regex source. `*` and `?` never cross a slash; `**/` is zero or more
// directories; `**` elsewhere matches anything.
function globToRegexSource(glob) {
  let re = '';
  let i = 0;
  while (i < glob.length) {
    if (glob.startsWith('**/', i)) {
      re += '(?:.*/)?';
      i += 3;
      continue;
    }
    if (glob.startsWith('**', i)) {
      re += '.*';
      i += 2;
      continue;
    }
    const c = glob[i++];
    if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/, '\\$&');
  }
  return re;
}

// ~/x home, /x absolute, ./x project root (fixed — never the shell cwd),
// bare pattern = any depth. As in gitignore, a pattern matches the path it
// names AND everything below it, so `~/.ssh`, `~/.ssh/` and `~/.ssh/**` are
// equivalent — a directory entry can't be accidentally narrowed to the
// directory node alone by leaving off `/**`.
const BELOW = '(?:/.*)?';
function compileEntry(entry, index) {
  if (typeof entry.path !== 'string' || !entry.path) throw new Error(`entries[${index}].path 누락`);
  if (!Array.isArray(entry.block) || !entry.block.every((b) => CATEGORIES.has(b))) {
    throw new Error(`entries[${index}].block 은 read/write/bash 배열이어야 함`);
  }
  const expanded = expandVars(entry.path, PROJECT_ROOT)
    .replace(/\/+$/, '')
    .replace(/\/\*\*$/, '');
  let regex;
  let anchored = true;
  let absPattern = null;
  if (path.isAbsolute(expanded)) absPattern = expanded;
  else if (expanded.startsWith('./')) absPattern = path.join(PROJECT_ROOT, expanded.slice(2));
  if (absPattern) regex = new RegExp(`^${globToRegexSource(absPattern)}${BELOW}$`);
  else {
    regex = new RegExp(`^(?:.*/)?${globToRegexSource(expanded)}${BELOW}$`);
    anchored = false;
  }
  // Literal directory prefix of an anchored pattern (up to its first wildcard),
  // used by the ancestor rule. Unanchored patterns have no fixed location.
  let prefix = null;
  if (absPattern) {
    const wild = absPattern.search(HAS_GLOB);
    prefix = wild < 0 ? absPattern : absPattern.slice(0, absPattern.lastIndexOf('/', wild));
  }
  const requireExistingShellPath = !anchored && !entry.path.includes('/');
  return { ...entry, regex, anchored, prefix, requireExistingShellPath };
}

function isAncestor(dir, target) {
  return dir === '/' || target.startsWith(dir.replace(/\/+$/, '') + '/');
}

// Which tree-walking commands appear, judged on each command's own arguments
// (up to the next shell operator) and the cwd in effect at that point in the
// line. For grep/rg the first non-flag argument is the pattern; with no
// further operand they default to that cwd.
function recursiveReaders(tokens, baseAt) {
  const found = [];
  for (const spec of RECURSIVE_READERS) {
    for (let at = 0; at < tokens.length; at += 1) {
      if (!spec.cmds.includes(tokens[at])) continue;
      const args = [];
      for (const t of tokens.slice(at + 1)) {
        if (OPERATORS.has(t)) break;
        args.push(t);
      }
      if (spec.flag && !args.some((t) => spec.flag.test(t))) continue;
      const operands = args.filter((t) => !t.startsWith('-'));
      found.push({
        name: spec.name,
        kind: spec.kind,
        operands,
        base: baseAt[at],
        needsCwd: Boolean(spec.implicitCwd) && operands.length <= 1,
      });
    }
  }
  return found;
}

function loadEntries() {
  const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  if (!Array.isArray(raw.entries)) throw new Error('entries 배열이 없음');
  return raw.entries.map(compileEntry);
}

function matchEntry(abs, category, entries, isShell) {
  for (const entry of entries) {
    if (!entry.block.includes(category)) continue;
    if (!entry.regex.test(abs)) continue;
    // Only bare filename patterns need the existence guard against symbols.
    // Explicit path patterns such as **/.secret/** must also stop creation
    // of a protected path, before either its parent or the file exists.
    if (entry.requireExistingShellPath && isShell && !fs.existsSync(abs)) continue;
    return entry;
  }
  return null;
}

// ------------------------------------------------------ shell tokenizing ----

const OPERATOR_RE = /(\|\||&&|\d?>>?|<<?|\||;|&|\(|\)|`)/g;
const OPERATORS = new Set([
  '||',
  '&&',
  '>>',
  '>',
  '<<',
  '<',
  '|',
  ';',
  '&',
  '(',
  ')',
  '`',
  '2>',
  '2>>',
  '1>',
  '1>>',
]);
const PATH_PIECE_SPLIT = /[^A-Za-z0-9_.\-/~${}*?[\]]+/;

// Returns { tokens, quotedWhole }: `tokens` as before (plain strings, quotes
// stripped), plus a Set of token VALUES that came from a single fully-quoted
// shell word (start to end inside one pair of quotes, nothing unquoted mixed
// in). Bash does not brace- or glob-expand a fully-quoted word, so a token in
// `quotedWhole` skips that step in resolveCandidate instead of being expanded
// and, if the content happens to look like a huge brace/glob list, wrongly
// denied. A token that mixes quoted and unquoted parts is NOT added here
// (conservatively still expanded) — safe because that only risks the
// over-blocking direction already documented elsewhere in this file.
function tokenize(command) {
  const spaced = command.replace(OPERATOR_RE, ' $1 ');
  const tokens = [];
  const quotedWhole = new Set();
  let cur = '';
  let curIsQuotedWhole = true;
  let curHasChar = false;
  let quote = null;
  let escaped = false;
  const pushToken = () => {
    if (cur) {
      tokens.push(cur);
      if (curIsQuotedWhole && curHasChar) quotedWhole.add(cur);
    }
    cur = '';
    curIsQuotedWhole = true;
    curHasChar = false;
  };
  for (const c of spaced) {
    if (escaped) {
      cur += c;
      curHasChar = true;
      if (!quote) curIsQuotedWhole = false;
      escaped = false;
    } else if (c === '\\' && quote !== "'") {
      escaped = true;
    } else if (quote) {
      if (c === quote) quote = null;
      else {
        cur += c;
        curHasChar = true;
      }
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (/\s/.test(c)) {
      pushToken();
    } else {
      cur += c;
      curHasChar = true;
      curIsQuotedWhole = false;
    }
  }
  pushToken();
  return { tokens, quotedWhole };
}

// Every string in a command that could denote a path: whole tokens, the value
// side of `--flag=value`, and slash-bearing pieces inside quoted code such as
// python3 -c "open('.secret/token')".
//
// Also returns every directory the command could be "in": the live cwd plus
// the target of each `cd`/`pushd` seen (`cd ~ && cat .ssh/config`). Exact
// scoping of subshells/`||` is unknowable here, so relative candidates are
// later resolved against ALL bases — over-blocking direction only.
// `$(echo X)` / `` `echo X` `` is just X — fold it before tokenizing so
// "$(echo .secret)/token" is seen as .secret/token.
const ECHO_SUBST =
  /\$\(\s*(?:echo|printf)\s+(?:-\w+\s+)*([^)]*?)\s*\)|`\s*(?:echo|printf)\s+(?:-\w+\s+)*([^`]*?)\s*`/g;
const ASSIGNMENT = /^([A-Za-z_]\w*)=(.*)$/;
const VAR_REF = /\$\{([A-Za-z_]\w*)\}|\$([A-Za-z_]\w*)/g;

// Replace $NAME / ${NAME} with values assigned earlier in the same command.
function substituteVars(s, vars) {
  return s.replace(VAR_REF, (m, a, b) => (vars[a || b] !== undefined ? vars[a || b] : m));
}

function shellCandidates(command, liveCwd) {
  const out = new Set();
  // Candidates that were a single fully-quoted shell word: resolveCandidate
  // skips brace/glob expansion for these (see `tokenize`).
  const quotedCandidates = new Set();
  const bases = new Set([liveCwd]);
  const vars = Object.create(null);
  let base = liveCwd;
  let expectCdTarget = false;

  const changeDir = (target) => {
    if (target === '-') return; // previous dir unknowable
    base = toAbsolute(target, base);
    bases.add(base);
  };

  const { tokens, quotedWhole } = tokenize(command.replace(ECHO_SUBST, (m, a, b) => a ?? b));
  const baseAt = []; // base directory in effect when each token is reached
  for (const raw of tokens) {
    baseAt.push(base);
    if (OPERATORS.has(raw)) {
      if (expectCdTarget) changeDir('~'); // bare `cd` = home
      expectCdTarget = false;
      continue;
    }
    // X=.secret ... $X/token : remember simple assignments and expand later
    // references, so indirection through a shell variable still resolves.
    const assign = ASSIGNMENT.exec(raw);
    if (assign) vars[assign[1]] = substituteVars(assign[2], vars);
    const token = substituteVars(raw, vars);
    if (expectCdTarget && (token === '-' || !token.startsWith('-'))) {
      changeDir(token);
      expectCdTarget = false;
    } else if (token === 'cd' || token === 'pushd') {
      expectCdTarget = true;
    }

    let core = token;
    if (token.startsWith('-')) {
      const eq = token.indexOf('=');
      if (eq < 0) continue;
      core = token.slice(eq + 1);
    }
    if (!core) continue;
    out.add(core);
    // Only the unmodified whole token (not a `--flag=value` extraction) can
    // be attributed to the raw token's quoted-ness.
    if (core === token && quotedWhole.has(raw)) quotedCandidates.add(core);
    for (const piece of core.split(PATH_PIECE_SPLIT)) {
      if (piece && piece !== core && (piece.includes('/') || piece.startsWith('~'))) out.add(piece);
    }
  }
  if (expectCdTarget) changeDir('~');
  return { candidates: [...out], bases: [...bases], tokens, baseAt, quotedCandidates };
}

// ------------------------------------------------------- classification ----

// Returns { category, candidates, bases } or null when the tool is not governed.
function classify(toolName, toolInput, liveCwd) {
  if (toolName === 'Bash') {
    return { category: 'bash', ...shellCandidates(String(toolInput.command || ''), liveCwd) };
  }
  if (CODE_EXEC_TOOLS[toolName]) {
    return {
      category: 'bash',
      ...shellCandidates(String(toolInput[CODE_EXEC_TOOLS[toolName]] || ''), liveCwd),
    };
  }
  if (READ_TOOLS.has(toolName)) {
    const candidates = [];
    if (toolInput.file_path) candidates.push(toolInput.file_path);
    if (toolInput.path) candidates.push(toolInput.path);
    // Glob/Grep patterns are themselves globs; expand them against their base dir.
    if (toolName === 'Glob' && toolInput.pattern)
      candidates.push(path.join(toolInput.path || PROJECT_ROOT, toolInput.pattern));
    if (toolName === 'Grep' && toolInput.glob)
      candidates.push(path.join(toolInput.path || PROJECT_ROOT, toolInput.glob));
    return { category: 'read', candidates, expandGlobs: true };
  }
  if (WRITE_TOOLS.has(toolName)) {
    const candidates = [];
    if (toolInput.file_path) candidates.push(toolInput.file_path);
    if (toolInput.notebook_path) candidates.push(toolInput.notebook_path);
    return { category: 'write', candidates };
  }
  if (toolName === 'apply_patch') {
    const candidates = [];
    for (const line of String(toolInput.command || '').split('\n')) {
      const m = APPLY_PATCH_PATH_RE.exec(line);
      if (m) candidates.push(path.resolve(liveCwd, m[1]));
    }
    return { category: 'write', candidates };
  }
  const serena = SERENA_TOOL.exec(toolName);
  if (serena) {
    const short = serena[1];
    const category = SERENA_READ.has(short) ? 'read' : SERENA_WRITE.has(short) ? 'write' : null;
    if (!category) return null;
    const candidates = toolInput.relative_path ? [toolInput.relative_path] : [];
    return { category, candidates };
  }
  return null;
}

// ---------------------------------------------------------------- output ----

function deny(reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: reason,
      },
    }),
  );
  process.exit(0);
}

function decide(raw) {
  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    process.stderr.write('[protect-paths] 입력 JSON 파싱 실패 — 검사 없이 통과\n');
    return;
  }
  const toolName = input.tool_name || '';
  const toolInput = input.tool_input || {};
  const liveCwd = input.cwd || process.cwd();

  const cls = classify(toolName, toolInput, liveCwd);
  if (!cls || cls.candidates.length === 0) return;

  let entries;
  try {
    entries = loadEntries();
  } catch (e) {
    deny(
      `[protect-paths] 설정 파일 로드 실패(${e.message}) — 고칠 때까지 ${toolName} 차단: ${CONFIG_PATH}`,
    );
  }

  const isShell = cls.category === 'bash';
  // Non-shell tools give absolute paths (Read/Write) or project-relative ones
  // (Serena), so the project root is their only base.
  const bases = isShell ? cls.bases : [PROJECT_ROOT];
  // One Map per invocation: realpathOfExistingPrefix memoizes on it so the
  // candidate x base loop below does not re-walk the same filesystem prefix
  // (typically the same base directory) once per candidate.
  const realpathCache = new Map();
  for (const candidate of cls.candidates) {
    const skipExpand = isShell && cls.quotedCandidates.has(candidate);
    for (const base of bases) {
      for (const abs of resolveCandidate(
        candidate,
        base,
        isShell || cls.expandGlobs,
        realpathCache,
        skipExpand,
      )) {
        const hit = matchEntry(abs, cls.category, entries, isShell);
        if (hit) {
          // Only on shell channels, and only when NO entry would also block
          // a plain Read of this same resolved path — Read/Write candidates
          // have no such fallback, and a different entry than the one that
          // matched here (e.g. an unanchored *.env rule) can still block read.
          const readBlocked = isShell && Boolean(matchEntry(abs, 'read', entries, false));
          const hint = isShell && !readBlocked ? ' — 읽기만 필요하면 Read 도구를 쓰세요' : '';
          deny(
            `[protect-paths] "${hit.path}" 보호 대상(${hit.reason || '사유 미지정'}) — ${toolName} 호출 차단${hint}`,
          );
        }
      }
    }
  }
  if (isShell) denyRecursiveReach(cls, entries, toolName, realpathCache);
}

// Ancestor rule: a tree-walking command (grep -r, tar, cp -r, ...) aimed at a
// folder above an anchored protected path would read it without ever naming
// it. Only that command's own operands count — a `cd /project` earlier in the
// same line names the project root but does not make `tar czf x.tgz dist/`
// walk it. Only anchored entries have a fixed location to compare against.
//
// Each resolved directory keeps a reference to the specific reader that
// produced it (first one wins on a collision), so the deny message below
// names the command that actually reaches the protected path and gives it
// matching advice — not just the first reader spec in RECURSIVE_READERS,
// which earlier picked `readers[0]` regardless of which reader's own operand
// resolved into the ancestor match.
function findProtectedDescendant(dir, entries, budget) {
  const pending = [{ candidate: dir, ancestors: new Set() }];
  while (pending.length) {
    const { candidate, ancestors } = pending.pop();
    if (++budget.count > RECURSIVE_SCAN_LIMIT || Date.now() > budget.deadline) {
      throw new Error('재귀 보호 경로 검사 한도 초과 — 대상을 더 작은 폴더로 지정하세요');
    }
    // Check the named path before following links, and the physical target
    // afterward: either spelling may enter a protected directory.
    const namedHit = matchEntry(candidate, 'bash', entries, false);
    if (namedHit) return namedHit;
    let physical;
    let stat;
    try {
      physical = fs.realpathSync(candidate);
      stat = fs.statSync(physical);
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR') continue;
      throw error;
    }
    const resolvedHit = matchEntry(physical, 'bash', entries, false);
    if (resolvedHit) return resolvedHit;
    if (!stat.isDirectory()) continue;
    if (ancestors.has(physical)) {
      throw new Error('재귀 보호 경로 검사 중 순환 심링크 발견 — 안전을 위해 차단');
    }
    const nextAncestors = new Set(ancestors).add(physical);
    const handle = fs.opendirSync(candidate);
    try {
      let child;
      while ((child = handle.readSync()) !== null) {
        if (budget.count + pending.length >= RECURSIVE_SCAN_LIMIT || Date.now() > budget.deadline) {
          throw new Error('재귀 보호 경로 검사 한도 초과 — 대상을 더 작은 폴더로 지정하세요');
        }
        pending.push({ candidate: path.join(candidate, child.name), ancestors: nextAncestors });
      }
    } finally {
      handle.closeSync();
    }
  }
  return null;
}

function denyRecursiveReach(cls, entries, toolName, cache) {
  const readers = recursiveReaders(cls.tokens, cls.baseAt);
  if (readers.length === 0) return;
  const dirReaders = new Map();
  for (const reader of readers) {
    const dirs = new Set();
    for (const operand of reader.operands) {
      const skipExpand = cls.quotedCandidates.has(operand);
      resolveCandidate(operand, reader.base, true, cache, skipExpand).forEach((abs) =>
        dirs.add(abs),
      );
    }
    if (reader.needsCwd) dirs.add(reader.base);
    for (const dir of dirs) {
      if (!dirReaders.has(dir)) dirReaders.set(dir, reader);
    }
  }
  const bashEntries = entries.filter((entry) => entry.block.includes('bash'));
  const budget = { count: 0, deadline: Date.now() + RECURSIVE_SCAN_MS };
  for (const [dir, reader] of dirReaders) {
    let hit = null;
    for (const entry of entries) {
      if (!entry.prefix || !entry.block.includes('bash') || !isAncestor(dir, entry.prefix))
        continue;
      hit = entry;
      break;
    }
    if (!hit && bashEntries.length) hit = findProtectedDescendant(dir, bashEntries, budget);
    if (hit) {
      // `rg` is only a sensible substitute for a search command; cp/zip/rm/
      // tar/rsync copy, archive or delete, so they get path-scoping advice.
      const advice =
        reader.kind === 'search'
          ? 'rg(숨김·gitignore 제외) 를 쓰거나 하위 폴더를 지정하세요'
          : '보호 경로를 제외하거나 하위 폴더를 지정하세요';
      deny(
        `[protect-paths] ${reader.name} 가 "${dir}" 아래를 재귀 탐색하면 보호 경로 "${hit.path}"(${hit.reason || '사유 미지정'}) 에 닿음 — ${toolName} 호출 차단. ${advice}`,
      );
    }
  }
}

function main() {
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    raw += chunk;
  });
  process.stdin.on('end', () => {
    try {
      decide(raw);
      process.exit(0);
    } catch (e) {
      deny(`[protect-paths] 훅 내부 오류(${e.message}) — 안전을 위해 차단`);
    }
  });
}

main();
