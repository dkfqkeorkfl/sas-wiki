// Toolchain precondition contract.
//
// This is not a throwaway smoke file: it replaces `--passWithNoTests` (a gate we deliberately
// refused) and it guards the runner preconditions that every test migrated in P3 depends on.
// See docs/prds/wiki-scripts-relocation/P2.sas-wiki-toolchain/tdd.md §5.
//
// No `// @vitest-environment node` pragma: Vitest already defaults to the node environment here.
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'

const REPO_ROOT = path.resolve(import.meta.dirname, '..')

const NAME = 'SAS Wiki Bot'
const EMAIL = 'bot@sas.wiki'

/** Identity that a hermetic test must inject explicitly. Nothing else may supply it. */
const IDENTITY = {
  GIT_AUTHOR_EMAIL: EMAIL,
  GIT_AUTHOR_NAME: NAME,
  GIT_COMMITTER_EMAIL: EMAIL,
  GIT_COMMITTER_NAME: NAME,
}

const dirs = []

/** A fresh git repo with one staged file. Every test builds its own — no shared state. */
const makeRepo = () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'toolchain-smoke-'))
  dirs.push(dir)
  execFileSync('git', ['init', '-q'], { cwd: dir })
  writeFileSync(path.join(dir, 'f.txt'), 'hi\n')
  execFileSync('git', ['add', '-A'], { cwd: dir })
  return dir
}

/**
 * MIRRORS the existing hermetic spawn pattern (scripts/wiki/__tests__/build.conventions.test.mjs).
 * Spreading `...process.env` is the load-bearing part: it inherits whatever GIT_CONFIG_* the
 * Vitest config injects, so the hermeticity invariant propagates to every test for free.
 *
 * Returns the raw result — S4c *expects* a failure, so the exit status must be assertable
 * rather than thrown.
 */
const git = (cwd, args, extraEnv = {}) =>
  spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...extraEnv },
  })

afterAll(() => {
  for (const dir of dirs) rmSync(dir, { force: true, recursive: true })
})

describe('toolchain: runner preconditions', () => {
  // S1 — ESM wiring. If `type: module` is dropped, every migrated .mjs fails to import.
  it('runs as ESM with node: builtins available', () => {
    expect(import.meta.url).toMatch(/^file:\/\//)
    expect(path.isAbsolute(REPO_ROOT)).toBe(true)
  })

  // S2 — git binary. Without it, the 14 self-seeding tests arriving in P3 all die.
  it('can execute git', () => {
    expect(execFileSync('git', ['--version'], { encoding: 'utf8' })).toMatch(/^git version /)
  })

  // S3 — the positive half of the hermeticity pair. Without this, "every commit is blocked"
  // would also satisfy S4c, and P3's self-seeding tests would be silently broken.
  it('commits in a temp repo when identity env is injected', () => {
    const repo = makeRepo()

    const committed = git(repo, ['commit', '--no-gpg-sign', '-m', 'smoke'], IDENTITY)

    expect(committed.status).toBe(0)
    expect(git(repo, ['rev-parse', 'HEAD'], IDENTITY).stdout.trim()).toMatch(/^[0-9a-f]{40}$/)
  })
})

describe('toolchain: git hermeticity invariant', () => {
  // S4a — proves Vitest's `test.env` actually reached the worker. Environment-independent:
  // this flips red -> green on any machine, which is what makes the RED deterministic.
  it('injects the git config overrides into process.env', () => {
    expect(process.env.GIT_CONFIG_GLOBAL).toBe('/dev/null')
    expect(process.env.GIT_CONFIG_SYSTEM).toBe('/dev/null')
  })

  // S4b — proves git *honours* those overrides (a set variable that git ignores is worthless).
  it('neutralises the global git config', () => {
    const configured = git(REPO_ROOT, ['config', '--global', 'user.name'])

    expect(configured.stdout.trim()).toBe('')
  })

  // S4c — the assertion that matters. Without it, a developer's ~/.gitconfig silently supplies
  // the identity, so a test that forgets to inject GIT_AUTHOR_*/GIT_COMMITTER_* passes locally
  // and fails only on CI ("Please tell me who you are"). Hermeticity must be enforced, not lucky.
  it('refuses to commit when identity env is absent', () => {
    const repo = makeRepo()

    const committed = git(repo, ['commit', '--no-gpg-sign', '-m', 'smoke'])

    expect(committed.status).not.toBe(0)
  })
})
