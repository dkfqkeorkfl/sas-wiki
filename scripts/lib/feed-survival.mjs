export const FEED_REF_REASONS = ['deleted', 'draft-excluded', 'unresolved']

export function judgeFeedSurvival({ importance, refs }) {
  const counters = { deleted: 0, draftExcluded: 0, unresolved: 0 }
  const seen = new Set()
  const docs = []

  for (const ref of refs ?? []) {
    if (ref.id !== null && ref.id !== undefined) {
      if (!seen.has(ref.id)) {
        seen.add(ref.id)
        docs.push({ id: ref.id })
      }
      continue
    }
    if (ref.reason === 'deleted') counters.deleted += 1
    else if (ref.reason === 'draft-excluded') counters.draftExcluded += 1
    else if (ref.reason === 'unresolved') counters.unresolved += 1
  }

  let feedSurvives
  if (docs.length > 0) feedSurvives = true
  else if (importance === 'fix') feedSurvives = false
  else if (counters.draftExcluded > 0) feedSurvives = false
  else if (counters.unresolved > 0) feedSurvives = false
  else feedSurvives = true

  return { counters, docs, feedSurvives }
}
