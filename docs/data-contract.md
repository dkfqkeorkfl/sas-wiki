# sas-wiki data contract

This document is the self-contained data contract for the vault build pipeline in this repository.

## Source repository

The build input is this repository's git history plus markdown files under `vault/wiki/**/*.md`.
Both are required:

| Input                | Purpose                                                                                         |
| -------------------- | ----------------------------------------------------------------------------------------------- |
| `vault/wiki/**/*.md` | Current document contents and frontmatter, including the authored UUIDv7 document `id`          |
| Full git history     | Creation/update dates, feed items, rename tracking, deletion pruning, and id-immutability check |

Shallow and partial clones are invalid build inputs. A shallow clone can hide creation commits and
silently change creation/update dates and feed items; a partial clone can hide blobs needed for
validation (including the creation-commit frontmatter the immutability gate reads). The build must fail
before writing payloads when either condition is detected.

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

`cwiki` must create exactly one document to keep each creation atomic and legible in the audit trail —
one creation commit per document born, which the feed derivation and rename tracking assume. The
document id is authored as an immutable UUIDv7 in frontmatter (see below), and the build still fails on
duplicate document ids and on any id changed after its creation commit.

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

Document id is a UUIDv7 authored in the document's frontmatter (`id: "…"`). Because the id lives in the
content, it remains stable across renames, moves, and full rewrites — not just normal edits. The build
enforces three gates: format (must match UUIDv7), uniqueness (invariant 8), and immutability (the id in
the creation-commit blob must equal the current frontmatter id; documents authored before this scheme
carry no id at creation and pass the immutability gate). If a deleted path is later recreated, that is a
new document with a newly authored id.

Feed ids stay distinct in width: a feed id is the 12-character prefix of its commit hash (the "Commit
sha prefix" above), so document ids (UUIDv7) and feed ids (12-hex) never collide.

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
