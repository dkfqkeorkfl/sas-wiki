#!/usr/bin/env node
// 1회성 마이그레이션 — 각 vault 문서 frontmatter 에 생성-커밋 시각으로 시드한 UUIDv7 doc id 를
// 주입한다(D1). 생성은 `uuid` 패키지의 v7({ msecs }) 에 위임한다(잘 관리되는 표준 구현).
//
// 시드 근거: RFC 9562 §6.1 은 실제 시각 근접을 요구하지 않고 과거 timestamp 를 허용한다 → 생성 커밋
// 시각(git author date)으로 시드해도 valid UUIDv7 이다. 같은-ms(같은 커밋 다수 문서) 타이는 랜덤
// tail 로 유일성을 얻는다(단조성 SHOULD 이나 문서 id 는 총순서 불요 → seq 미사용).
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { v7 as uuidv7 } from 'uuid'

import { getFileCommitDates, makeGitRunner } from './lib/git.mjs'
import {
  collectMarkdownFilesRecursive,
  derivePathAndBreadcrumb,
  parseFrontmatterYaml,
} from './lib/parse.mjs'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const WIKI_PREFIX = 'vault/wiki/'

/**
 * 생성 시각 ms 로 시드한 UUIDv7 문자열 — `uuid` v7 의 `msecs` 옵션에 위임한다(48-bit ms ‖ ver=7 ‖
 * var=10 ‖ 랜덤 tail). 같은 ms 여도 랜덤 tail 로 유일하다(문서 id 는 총순서 불요 → seq 미사용).
 *
 * @param {number} ms Date.parse(생성 커밋 ISO)
 * @returns {string}
 */
export function uuidv7FromMs(ms) {
  return uuidv7({ msecs: ms })
}

/**
 * frontmatter 에 `id: "<id>"`(따옴표 스칼라 — parse.mjs:199 분기 호환)를 삽입한다. 이미 id 가 있으면
 * 덮어쓰지 않고 skip 한다(idempotent). 순수 함수 — 파일을 읽거나 쓰지 않는다.
 *
 * @returns {{ changed: boolean, text: string }}
 */
export function insertFrontmatterId(md, id) {
  const open = md.match(/^---\r?\n/u)
  const block = md.match(/^---\r?\n([\s\S]*?)\r?\n---/u)
  if (!open || !block) return { changed: false, text: md }
  if (parseFrontmatterYaml(block[1]).id !== undefined) return { changed: false, text: md }
  const nl = md.includes('\r\n') ? '\r\n' : '\n'
  const text = `${md.slice(0, open[0].length)}id: "${id}"${nl}${md.slice(open[0].length)}`
  return { changed: true, text }
}

/**
 * vault 6문서에 생성-커밋 시각 시드 UUIDv7 을 주입한다(id 있으면 skip). 순수 M — A/D 0.
 *
 * @returns {{ changed: boolean, id: string, relPath: string }[]}
 */
export function migrate({ vault }) {
  const vaultDir = path.resolve(vault)
  const wikiDir = path.join(vaultDir, 'vault', 'wiki')
  const runGit = makeGitRunner(vaultDir)
  const results = []
  for (const filePath of collectMarkdownFilesRecursive(wikiDir)) {
    const { path: relPath } = derivePathAndBreadcrumb(filePath, wikiDir)
    const md = fs.readFileSync(filePath, 'utf8')
    const dates = getFileCommitDates(runGit, `${WIKI_PREFIX}${relPath}.md`)
    if (!dates.created) throw new Error(`생성 커밋을 찾을 수 없습니다(미커밋 문서?): ${relPath}`)
    const id = uuidv7FromMs(Date.parse(dates.created))
    const { changed, text } = insertFrontmatterId(md, id)
    if (changed) fs.writeFileSync(filePath, text)
    results.push({ changed, id: changed ? id : parseFrontmatterYaml(md.match(/^---\r?\n([\s\S]*?)\r?\n---/u)[1]).id, relPath }) // prettier-ignore
  }
  return results
}

function parseArgs(argv) {
  let vault = path.resolve(SCRIPT_DIR, '..')
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--vault') {
      vault = path.resolve(argv[i + 1] ?? '')
      i += 1
    }
  }
  return { vault }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const results = migrate(parseArgs(process.argv.slice(2)))
  for (const { changed, id, relPath } of results) {
    console.log(`[migrate] ${changed ? '주입' : 'skip'} ${relPath} ${id}`)
  }
}
