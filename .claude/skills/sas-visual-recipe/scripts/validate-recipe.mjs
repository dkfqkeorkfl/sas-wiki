#!/usr/bin/env node
/**
 * Validates a P3 recipe+rubric file against RECIPE-FORMAT.md's structural rules.
 * Dependency-free (no yaml/markdown parser) — regex-based presence checks only,
 * matching the "구조 규칙" section of ../RECIPE-FORMAT.md line-for-line.
 *
 * Also does an immediate (one-time, not persistent) check that any code
 * citation (`<file>#<type>{<value>}` inline-code spans, type = symbol|css|code)
 * currently resolves against the real project. This is NOT the persistent
 * regression guard — it only proves the citation is correct right now.
 * Whether to install a persistent test (for future drift) is decided by the
 * caller (sas-tdd-guide's harness diagnosis) — reuse `checkCitations` below
 * when authoring that guard instead of reimplementing the check.
 *
 * Usage: node validate-recipe.mjs <path-to-recipe.md> [project-root]
 *   project-root defaults to process.cwd() — citation file paths resolve against it.
 * Exit 0 = pass, 1 = fail (reasons on stderr).
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/

/**
 * Extracts `<file>#<type>{<value>}` citations (type = symbol|css|code) from
 * recipe body text and checks each against the actual filesystem.
 *
 * - symbol/code: <value> must be a bare identifier (no spaces/brackets) —
 *   verified with a word-boundary match against the file's source text.
 *   `code` is intentionally the same mechanical check as `symbol` today —
 *   the type is kept separate because it signals weaker author intent
 *   ("a related identifier", not "the exact declared symbol") and may earn
 *   stricter verification (e.g. Serena-based) later without touching callers.
 * - css: <value> is a literal string (may contain spaces/hyphens/brackets,
 *   e.g. Tailwind arbitrary values like `w-[42px]`) — verified with an exact
 *   substring match. `{`/`}` cannot appear in the value (they close the
 *   citation), which is why `{}` — not `[]` — is the outer delimiter: real
 *   CSS/Tailwind class strings essentially never contain literal braces.
 *
 * Reusable: a persistent citation-guard test (installed per sas-tdd-guide's
 * harness diagnosis, for ongoing protection against future code drift)
 * should import this function rather than reimplementing the check.
 *
 * Returns [{ file, type, value, ok, reason }].
 */
function checkCitations(bodyText, projectRoot) {
  const pattern = /`([^`\n#]+)#(symbol|css|code)\{([^`\n{}]+)\}`/g
  const results = []
  let m
  while ((m = pattern.exec(bodyText)) !== null) {
    const [, file, type, value] = m
    const absPath = path.resolve(projectRoot, file)
    if (!fs.existsSync(absPath)) {
      results.push({ file, type, value, ok: false, reason: `파일 없음: ${file}` })
      continue
    }
    if ((type === 'symbol' || type === 'code') && !IDENTIFIER.test(value)) {
      results.push({
        file,
        type,
        value,
        ok: false,
        reason: `${type} 타입 값은 공백·괄호 없는 단순 식별자여야 함(표현식 전체 대신 핵심 식별자 하나만 인용): "${value}"`,
      })
      continue
    }
    const source = fs.readFileSync(absPath, 'utf8')
    const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const found =
      type === 'css' ? source.includes(value) : new RegExp(`\\b${escaped}\\b`).test(source)
    if (!found) {
      results.push({
        file,
        type,
        value,
        ok: false,
        reason: `${type === 'css' ? '문자열' : '식별자'} "${value}" 이 ${file} 에 없음`,
      })
      continue
    }
    results.push({ file, type, value, ok: true, reason: null })
  }
  return results
}

function validateRecipe(filePath, projectRoot) {
  const failures = []
  const content = fs.readFileSync(filePath, 'utf8')

  // --- frontmatter ---
  const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!fmMatch) {
    failures.push('frontmatter(--- ... ---) 블록이 없다.')
  } else {
    const fm = fmMatch[1]
    for (const key of ['name', 'slug', 'target', 'viewports']) {
      if (!new RegExp(`^${key}\\s*:`, 'm').test(fm)) {
        failures.push(`frontmatter 필수 필드 누락: ${key}`)
      }
    }
    const hasLocales = /^locales\s*:/m.test(fm)
    const hasLocaleApply = /^localeApply\s*:/m.test(fm)
    if (hasLocales && !hasLocaleApply) {
      failures.push('locales 지정 시 localeApply 동반이 필수인데 없다.')
    }
  }

  // --- ## Recipe 서브섹션 ---
  if (!/^##\s+Recipe\s*$/m.test(content)) {
    failures.push('## Recipe 헤딩이 없다.')
  } else {
    for (const sub of ['Target', 'Surfaces', 'States', 'Masking', 'Slug']) {
      if (!new RegExp(`^###\\s+${sub}\\s*$`, 'm').test(content)) {
        failures.push(`## Recipe 하위에 ### ${sub} 서브섹션이 없다.`)
      }
    }
  }

  // --- ## Rubric 6 시각 카테고리 ---
  if (!/^##\s+Rubric\s*$/m.test(content)) {
    failures.push('## Rubric 헤딩이 없다.')
  } else {
    for (const cat of ['color', 'typography', 'spacing', 'hierarchy', 'state-feedback', 'layout']) {
      if (!new RegExp(`^###\\s+${cat}\\s*$`, 'm').test(content)) {
        failures.push(`## Rubric 하위에 ### ${cat} 시각 카테고리가 없다.`)
      }
    }
  }

  const body = fmMatch ? content.slice(fmMatch[0].length) : content

  // --- 줄번호 스타일 코드 인용 금지 ---
  // 인라인 코드는 `<file>.<ext>:<n>` 꼴만 잡는다. 주소는 줄번호 인용이 아니다:
  // `://` 가 든 것(`http://localhost:3000`)과 확장자 없는 호스트(`localhost:3000`)는 통과.
  const lineNumberPatterns = [
    /`(?![^`\n]*:\/\/)[^`\n]*\.[A-Za-z][A-Za-z0-9]*:\d+`/, // 예: `Button.tsx:42`
    /\bline\s+\d+\b/i, // "line 42"
    /\bL\d+\b/, // "L42"
  ]
  for (const pattern of lineNumberPatterns) {
    const m = body.match(pattern)
    if (m) {
      failures.push(`줄번호 스타일 코드 인용 발견(금지): "${m[0]}"`)
      break
    }
  }

  // --- 코드 인용 즉시 검증 (일회성 — 지속 보호는 별도 가드 제안 몫) ---
  const citations = checkCitations(body, projectRoot)
  for (const c of citations) {
    if (!c.ok) failures.push(`코드 인용 무효: ${c.reason}`)
  }

  return { failures, citationCount: citations.length }
}

export { checkCitations, validateRecipe }

// ESM has no require.main; compare the entry script with this module (symlinks resolved).
function isMainModule() {
  if (!process.argv[1]) return false
  try {
    return fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
  } catch {
    return false
  }
}

if (isMainModule()) {
  const filePath = process.argv[2]
  const projectRoot = process.argv[3] || process.cwd()
  if (!filePath) {
    console.error('Usage: node validate-recipe.mjs <path-to-recipe.md> [project-root]')
    process.exit(1)
  }
  if (!fs.existsSync(filePath)) {
    console.error(`파일 없음: ${filePath}`)
    process.exit(1)
  }
  const { failures, citationCount } = validateRecipe(filePath, projectRoot)
  if (failures.length > 0) {
    console.error(`[FAIL] ${filePath}`)
    for (const f of failures) console.error(`  - ${f}`)
    process.exit(1)
  }
  console.log(
    `[PASS] ${filePath}${citationCount > 0 ? ` (코드 인용 ${citationCount}건 검증됨)` : ''}`,
  )
  process.exit(0)
}
