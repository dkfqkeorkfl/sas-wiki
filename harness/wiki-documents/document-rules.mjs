const DATED_ROOT = /^(?:TREND|REPORT)\//
const DATED_PATH = /^(?:TREND|REPORT)\/(\d{4})-(\d{2})\/(\d{2})\. ([^/\r\n]+)\.md$/u

/** relativeFile은 wiki/ 기준 POSIX 경로다. 검사 실패는 파일을 고치지 않고 사유로 반환한다. */
export function inspectDocument(relativeFile, parsed) {
  if (!parsed?.frontmatter) {
    return [
      {
        code: 'FRONTMATTER',
        message: 'frontmatter가 없거나 해석할 수 없습니다.',
      },
    ]
  }
  const issues = []
  const add = (code, message) => issues.push({ code, message })
  if (Object.hasOwn(parsed.frontmatter, 'title')) {
    add('AUTHORED_TITLE', 'title을 적지 마세요. 표시 제목은 확장자를 뺀 파일명 전체입니다.')
  }
  if (!DATED_ROOT.test(relativeFile)) return issues

  const match = relativeFile.match(DATED_PATH)
  if (
    !match ||
    !match[4].trim() ||
    match[4] !== match[4].trim() ||
    /^\d{2}-\d{2}-\d{2}(?: |$)/.test(match[4])
  ) {
    add(
      'PATH',
      'TREND·REPORT는 YYYY-MM/DD. 제목.md 형식으로 작성하세요. 시각과 추가 하위 폴더는 허용하지 않습니다.',
    )
    return issues
  }
  const [, year, month, day] = match
  const asOf = `${year}-${month}-${day}`
  const date = new Date(`${asOf}T00:00:00Z`)
  if (
    year === '0000' ||
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== asOf
  ) {
    add('DATE', `실제 존재하지 않는 기준일입니다: ${asOf}`)
  }
  if (parsed.frontmatter.type !== 'concept') {
    add('TYPE', 'TREND·REPORT의 type은 concept이어야 합니다.')
  }
  if (parsed.frontmatter.meta?.asOf !== asOf) {
    add('AS_OF', `meta.asOf를 경로의 기준일과 같은 문자열 '${asOf}'로 작성하세요.`)
  }
  const firstLine = (parsed.body ?? '').trimStart().split(/\r?\n/)[0]
  const noticeDate = new RegExp(`(?<!\\d)${asOf}(?!\\d)`)
  if (!noticeDate.test(firstLine) || !firstLine.includes('기준')) {
    add('AS_OF_NOTICE', `본문 첫 줄에 ${asOf} 기준이라는 안내를 작성하세요.`)
  }
  return issues
}
