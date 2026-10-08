# Repository Guidelines

## Project Structure & Module Organization

The Git repository contains the FSP Career frontend prototype and product documentation. `src/app.js` owns screens, hash routing and local state; `src/domain.js` contains pure business rules; `src/data.js` contains synthetic fixtures; `src/styles.css` contains design tokens and responsive styles. `public/assets/` contains logos and local fonts. `scripts/` contains the HTTP server and static build; `tests/` uses `node:test`. Product sources and proposals live in `docs/`. The accepted target stack (Next.js + TypeScript, PostgreSQL) is in `docs/stack.md`; update this section when the code moves to it.

Keep application code, tests, and static assets in clearly named locations appropriate to the chosen framework. For example, use `src/`, `tests/`, and `assets/` if the framework does not prescribe alternatives. Document the actual layout in `README.md`.

## Build, Test, and Development Commands

Node.js 22+ is required. No external runtime dependencies are used. Run `npm ci`, then `npm run dev` for http://127.0.0.1:5173. `npm run check` checks JavaScript syntax; `npm test` runs all tests; `node --test tests/domain.test.js` runs the individual suite. `npm run build` writes ignored `dist/`; `npm start` serves that build. Stop dev first or set another PORT. Keep reproducible commands documented in README.md.

## Coding Style & Naming Conventions

Use JavaScript ES modules, descriptive camelCase names and two-space indentation; follow `.editorconfig`. Keep domain rules separate from rendering. Escape user-authored text before HTML interpolation. Follow the dark mockup tokens and use semantic accessible controls. Separate unrelated cleanup from functional changes.

## Testing Guidelines

Use `node:test` in `tests/*.test.js` for behavior, failure paths and regressions. Run syntax checks, the full suite and production build after functional changes. Verify browser interactions, narrow layouts and empty states for visible changes. Document validation and limitations in `docs/prototype.md`.

## Commit & Pull Request Guidelines

Follow the existing Git history: use concise, imperative English subjects such as `Add career platform prototype` or `Document validation results`. The full format (verbs, length, body, AI attribution) is in `.claude/skills/commit-message/SKILL.md`; every person and agent follows it.

Pull requests should explain the change, include validation results, and link relevant issues. Include screenshots for visible interface changes and identify any checks that could not be run.

## Security & Configuration

Use the local `scrt4` vault for available secrets, referencing them through `$env[NAME]` placeholders in `scrt4 run` commands. Never request, print, or write secret values to files. Configuration examples must contain placeholders only.

The prototype uses synthetic data and browser-local storage. Do not present it as authenticated, connected to FSP ID, an official registry, a validated matching engine or an AI evaluator. Real authorization and contact privacy require server enforcement before real data is used. The local server must not expose `.git`, secrets or repository documents.
