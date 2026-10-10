# Repository Guidelines

## Project Structure & Module Organization

The Git repository contains the supplied final FSP Career design mockup in `site/` and product documentation in `docs/`. `site/index.html` owns the landing page and modal onboarding; `site/map.html`, `site/app.js` and `site/styles.css` own the map; `site/interview.html` contains the scripted interview; `site/onboarding*.html` contain alternate onboarding layouts. Assets live in `site/assets/`. `scripts/` contains the HTTP server, clean static build and syntax checker; `tests/site.test.js` uses `node:test`. The prior frontend was removed at the user's explicit request on 9 October. This import preserves the supplied static design; the accepted target application stack (Next.js + TypeScript, PostgreSQL) remains in `docs/stack.md`. Application development follows `.claude/skills/fullstack-dev/SKILL.md`.

`platform/` is the working application (Next.js 15 App Router, TypeScript, Prisma/PostgreSQL, Vitest): `src/app` routes, `src/components` UI (primitives in `src/components/ui`), `src/styles/tokens.css` design tokens, `src/server` domain and agent code, `prisma/` schema, `tests/` unit and integration. `site/` stays as the static design reference. Run and layout details: `platform/README.md`.

Keep application code, tests, and static assets in clearly named locations appropriate to the chosen framework. For example, use `src/`, `tests/`, and `assets/` if the framework does not prescribe alternatives. Document the actual layout in `README.md`.

## Build, Test, and Development Commands

Node.js 22+ is required. No npm runtime dependencies are used; Google Fonts remains an external resource from the supplied mockup. Run `npm ci`, then `npm run dev` for http://127.0.0.1:5173. `npm run check` checks external and inline JavaScript; `npm test` runs all tests; `node --test tests/site.test.js` runs the individual suite. `npm run build` creates a clean ignored `dist/`; `npm start` serves that build. Stop dev first or set another PORT. Keep commands documented in README.md. In `platform/`, a new or changed route under `src/app/api` → run `npx tsx scripts/build-openapi.ts` from `platform/` and commit the regenerated `docs/openapi.yaml` (`tests/unit/openapi` fails on a stale file).

## Coding Style & Naming Conventions

Tooling uses JavaScript ES modules and two-space indentation; follow `.editorconfig`. Preserve the supplied page scripts and their behavior during design import. Escape user-authored text before HTML interpolation. The current visual source is `docs/design-spec.md` (light square layout, Golos Text and JetBrains Mono), explicitly selected by the user to replace the former dark design. Use semantic accessible controls and keep unrelated cleanup separate.

**Design system (mandatory for `platform/`):** `docs/design-system.md` is the code rule set (`docs/design-spec.md` stays the visual source). Build new screens from `platform/src/components/ui` primitives, take colors only from tokens in `platform/src/styles/tokens.css` (no raw `#hex`/`rgb()` in `*.module.css`; `tests/unit/design-tokens.test.ts` fails on them), and add any new token or component to `docs/design-system.md` first.

## Testing Guidelines

Use `node:test` in `tests/*.test.js` for behavior, failure paths and regressions. Run syntax checks, the full suite and production build after functional changes. Verify browser interactions, narrow layouts and empty states for visible changes. Document validation and limitations in `docs/prototype.md`.

## Commit & Pull Request Guidelines

Follow the existing Git history: use concise, imperative English subjects such as `Add career platform prototype` or `Document validation results`. The full format (verbs, length, body, AI attribution) is in `.claude/skills/commit-message/SKILL.md`; every person and agent follows it.

Pull requests should explain the change, include validation results, and link relevant issues. Include screenshots for visible interface changes and identify any checks that could not be run.

## Security & Configuration

Use the local `scrt4` vault for available secrets, referencing them through `$env[NAME]` placeholders in `scrt4 run` commands. Never request, print, or write secret values to files. Configuration examples must contain placeholders only.

The mockup uses synthetic data and in-memory state. FSP ID, PDF parsing, company lookup, voice input and interview scoring are simulations. Do not present it as authenticated, connected to FSP ID, an official registry, a validated matching engine or an AI evaluator. Real authorization and contact privacy require server enforcement before real data is used. The local server must not expose `.git`, secrets or repository documents.
