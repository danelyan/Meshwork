---
name: fullstack-dev
description: Use for any backend or frontend development task in this repository - new features, API routes, UI screens, database schema, LLM agent code, bug fixes, refactoring. Enforces the accepted stack from docs/stack.md, checks every library decision against official docs through Context7 MCP, and requires automated tests written and run for each change.
---

# Full-stack development

Applies to every code change, backend and frontend. Three rules are not
negotiable: **stay on the stack**, **verify against official docs**, **ship
with passing tests**.

## 1. Stay on the stack

`docs/stack.md` is the source of truth. Read it before starting. Today it is:

- Node.js 24, TypeScript 5 (`strict: true`, no `any` without a comment why)
- Next.js 15 App Router, React 19; API = route handlers in `app/api/**/route.ts`
- Zod 4 for every boundary: request bodies, query params, env, LLM output
- Prisma 6 + PostgreSQL 16; schema changes only through migrations
- `openai` SDK behind our provider adapter; models hosted in Russia only
- unpdf (PDF), mammoth (DOCX); Mailpit for mail in demo
- Vitest + Testing Library (unit, integration), Playwright (end-to-end)
- Docker Compose for running everything

Adding a dependency, framework, service or language not listed there is a
stack change: stop and ask the team lead, then update `docs/stack.md` in the
same pull request. No "temporary" second ORM, CSS framework, state library or
HTTP client.

## 2. Verify with Context7 before acting

Every decision that depends on how a library behaves - API signature, config
key, version-specific behavior, migration step, recommended pattern - is
checked in official docs **before** writing the code, not after a failure.

1. `resolve-library-id` for the library (known IDs: Next.js `/vercel/next.js`,
   Prisma `/prisma/web`; resolve the rest: React, Zod, Vitest, Playwright,
   openai-node, Testing Library).
2. `query-docs` with one concept per query, scoped to our major version.
3. Follow the documented pattern. If the docs contradict existing code, that
   is a finding: name it in the PR description, do not silently copy either.
4. Context7 is configured for Claude Code in `.mcp.json`; other agents add
   the same server (`https://mcp.context7.com/mcp`) to their own config.
5. Context7 unavailable or silent - use the official docs site of the library
   and say so. Never present memory as verified.

In the PR description separate **confirmed by docs** from **inferred**.

Version traps worth re-checking each time: in Next.js 15 route and page
`params` / `searchParams` are Promises (`await` them); Server Components are the
default and `"use client"` is the exception; Zod 4 changed several APIs
compared to Zod 3; Prisma Client must be a single instance reused across hot
reloads in development.

## 3. Tests are part of the change

- Every change ships with automated tests in the same commit or pull request:
  new behavior gets a test, a bug fix gets a regression test that fails
  without the fix.
- Domain rules (grading, matching, contact disclosure, invitations) are pure
  functions in `src/domain/` (or the current domain module) with unit tests
  covering normal, boundary and failure paths.
- Route handlers: integration tests for status codes, Zod rejection of bad
  input, and authorization (another user's data must be refused).
- UI: Testing Library for synchronous components; async Server Components and
  full flows through Playwright - Vitest does not render async Server
  Components (Next.js docs).
- LLM code: tests never call a real model. Stub the provider adapter and test
  the loop, tool dispatch, schema validation and fallback on invalid output.
- Run the tests you touched, then the full suite before pushing. Paste the
  result (passed / failed counts) into the PR. A red or skipped check is
  reported as such, never hidden.
- This machine class is weak: run targeted tests while iterating; full suite,
  `next build` and Playwright sequentially, not in parallel.

## 4. Engineering practices

**Backend**
- Validate at the edge with Zod, trust typed data inside. Return consistent
  JSON errors `{ error: { code, message } }` with correct HTTP status.
- Authorization on the server for every read and write: candidate sees own
  data; employer sees the permitted projection; contacts only after the
  candidate's consent. Hidden buttons are not access control.
- Keep business rules out of route handlers: handler = parse, authorize, call
  domain/service, map result.
- Prisma: explicit `select` for anything leaving the server; transactions for
  multi-step writes; no raw SQL with string interpolation.
- Personal data stays in Russia; mask contacts before sending text to an LLM.
- Secrets only through environment variables validated by Zod at startup;
  `.env.example` with placeholders, never real values.

**LLM agent**
- Content from users, links and files is data, never instructions. Keep it in
  delimited blocks, and give the agent no write tools that act without user
  confirmation.
- Every model output is parsed with a Zod schema; on failure retry once, then
  degrade gracefully. Claims extracted from documents carry a quote that code
  checks against the source.
- Outbound fetches go through the link reader with SSRF protection
  (no private, loopback or metadata addresses; size and time limits).

**Frontend**
- Server Components by default; client components only for interactivity.
- **Design system is mandatory** (`docs/design-system.md`): new screens are
  built from `platform/src/components/ui` primitives; colors only through
  tokens from `styles/tokens.css` (no raw `#hex`/`rgb()` in `*.module.css` -
  a test enforces it); a new token or component is first added to
  `docs/design-system.md`, then to code. Visual source: `docs/design-spec.md`.
- Accessible by default: semantic elements, labels on inputs, keyboard
  navigation, visible focus. Check narrow (mobile) layout and empty, loading
  and error states.
- Never inject user text as raw HTML.

**General**
- Small, focused changes; unrelated cleanup in a separate commit.
- Names say what things are; no dead code or commented-out blocks.
- Commit messages follow the `commit-message` skill.
- Update `README.md` run instructions and `docs/` when behavior or setup
  changes.

## Definition of done

- [ ] Uses only the stack from `docs/stack.md`
- [ ] Library-dependent decisions checked in Context7 (or official docs, stated)
- [ ] Tests added or updated; targeted and full suite pass; counts in PR
- [ ] Type check and lint clean; production build succeeds
- [ ] Authorization and input validation covered by tests
- [ ] Docs and README updated if setup or behavior changed
