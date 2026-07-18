# sas-wiki data contract

This document is the self-contained data contract for the vault build pipeline in this repository.

## Source repository

The build input is this repository's git history plus markdown files under `vault/wiki/**/*.md`.
Both are required:

| Input                | Purpose                                                                                |
| -------------------- | -------------------------------------------------------------------------------------- |
| `vault/wiki/**/*.md` | Current document contents and frontmatter                                              |
| Full git history     | Document ids, creation/update dates, feed items, rename tracking, and deletion pruning |

Shallow and partial clones are invalid build inputs. A shallow clone can hide creation commits and
change document ids; a partial clone can hide blobs needed for validation. The build must fail before
writing payloads when either condition is detected.

## Branch policy

Example data belongs only on `test` or `test-*` branches. Service data belongs on `main`, with any
staging branch kept separate from example history. The build cannot tell example `feed:` commits from
real `feed:` commits, so example history must not be merged into service branches.

## Commit convention

Vault commits use three wiki-specific types:

| Type    | Meaning                                           | Vault file rule                           | Emits feed item |
| ------- | ------------------------------------------------- | ----------------------------------------- | --------------- |
| `cwiki` | Create one new document                           | Exactly one new `vault/wiki/**/*.md` file | No              |
| `uwiki` | Update existing documents without publishing news | Existing files only                       | No              |
| `feed`  | Update existing documents and publish news        | Existing files only                       | Yes             |

`cwiki` must create exactly one document because a document id is the 12-character prefix of its
creation commit hash. If one commit creates two documents, both documents get the same id and refs can
point at the wrong document. The build must fail on duplicate document ids.

Feed commit messages map to feed payload fields:

```text
feed: Samsung HBM4 roadmap update

Body text shown on the feed card.

Keywords: HBM, roadmap
Importance: breaking
```

| Commit data                  | Feed field                           |
| ---------------------------- | ------------------------------------ |
| Commit sha prefix            | `id`                                 |
| Author date                  | `ts`                                 |
| Subject after `feed: `       | `title`                              |
| Body without trailers        | `body`                               |
| `Keywords:` trailer          | `keywords[]`                         |
| `Importance:` trailer        | `importance`                         |
| Diff-touched vault documents | `docs[].id`                          |
| Diff hunk to heading mapping | `docs[].anchor`, `docs[].anchorText` |

Feed refs use document ids, not paths. Paths in a historical diff are resolved through git rename
tracking to the current document id so old feeds survive document moves.

## Document id

Document id is the first 12 characters of the creation commit hash. It remains stable across renames
and normal edits. If a deleted path is later recreated, that is a new document with a new creation
commit and a new id.

Use ids for references that cross time: feeds, tags, and tree document entries. Use current paths for
current snapshots and URLs: `breadcrumb.join('/')` and `wiki_body.json.docs` keys.

## Payload invariants

The build writes three payloads: `wiki_summary.json`, `wiki_feeds.json`, and `wiki_body.json`. It must
validate these invariants before writing successful output:

| #   | Invariant                                                                                                                     | Failure mode                                    |
| --- | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| 1   | Every `feeds.items[].docs[].id` exists in `summary.docs[].id`, including disabled docs                                        | Feed cards lose title/tag/jump metadata         |
| 2   | `Object.keys(body.docs)` equals the current paths of active docs only                                                         | Document click can find no body                 |
| 3   | `tree[].docs[]` contains active summary doc ids, and every active doc belongs to exactly one tree node                        | Sidebar rows are empty or missing               |
| 4   | `tags[*]` contains active summary doc ids only                                                                                | Tag pages show empty rows or polluted counts    |
| 5   | Each `tree[].path` matches its documents' folder path, `breadcrumb.slice(0, -1).join('/')`                                    | Subtree filtering returns wrong docs            |
| 6   | Each feed doc anchor is either `null` or exists in that document's current headings, and `anchorText` equals the heading text | Jump links fail or show the wrong section label |
| 7   | The three payloads have the same `sourceCommit` and are consumed only as a matching set                                       | Mixed generations silently break refs           |
| 8   | `summary.docs[].id` is unique                                                                                                 | Refs can resolve to the wrong document          |

Disabled documents remain as four-key stubs in summary so historical feeds and wikilinks can still
resolve. Deleted documents are pruned from feed refs; if all refs in a feed are pruned, the feed item is
pruned too. Prune counts must be reported because large prune spikes are a rename-tracking warning sign.
