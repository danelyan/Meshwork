---
name: commit-message
description: Use when writing or reviewing a git commit message in this repository, including commits made by agents. Defines the team's single commit message format so history stays uniform.
---

# Commit messages

One format for everyone, people and agents. It follows the existing history
(`Add interactive design prototype`, `Document FSP expert meeting and organizer answers`).

## Subject line

- English, imperative mood: `Add`, `Fix`, `Update`, `Remove`, `Document`, `Refactor`, `Test`.
- Capital first letter, no trailing period, at most 72 characters.
- Says what changes in the product or docs, not which files were touched.
- No prefixes like `feat:` or `[WIP]`, no emoji, no ticket-only subjects.

Good:

```text
Add consultant chat endpoint with link reader
Fix salary filter for open-ended ranges
Document accepted stack
```

Bad: `fix`, `updates`, `Added stuff.`, `feat: chat`, `правки`.

## Verb guide

| Verb | Use for |
| --- | --- |
| Add | New feature, screen, endpoint, file or dependency |
| Fix | Wrong behavior |
| Update | Change existing behavior or content without fixing a bug |
| Remove | Delete code, feature or file |
| Refactor | Restructure without behavior change |
| Test | Tests only |
| Document | Docs only |

## Body (optional)

Blank line after the subject, then plain text wrapped at 72 characters:
why the change was made and anything a reviewer must know (limitations,
skipped checks). Russian is allowed in the body. Do not list files.

## Scope of a commit

- One logical change per commit. Unrelated cleanup goes in a separate commit
  (see `AGENTS.md`).
- Never commit secrets, `.env` files or generated `dist/`.

## AI attribution

Commits written with an AI agent end with a `Co-Authored-By:` trailer naming
the model, after a blank line. Nothing else is added to the message.
