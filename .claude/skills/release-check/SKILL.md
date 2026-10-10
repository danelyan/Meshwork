---
name: release-check
description: Pre-push and final-submission checklist for platform/. Run before any push to main (it auto-deploys to the jury stand) and before the 11 October 2026 23:59 MSK submission freeze. Manual only.
disable-model-invocation: true
---

# Release check

A push to `main` touching `platform/**` deploys to https://fsp2.ru with no test gate.
After 11 October 2026, 23:59 Moscow time, commits are not accepted. Report each step as
command + result; a skipped step is reported as skipped, with the reason.

## 1. Before push

1. Time: `TZ=Europe/Moscow date`. Past 23:59 on 11 October — stop, do not commit.
2. Branch state: `git fetch && git status -sb`. Must not be behind `origin/main`; nothing
   staged or untracked that you did not mean to ship. Diverged — merge `origin/main` first.
3. Diff review: `git diff origin/main...HEAD --stat`, then the diff itself. No `.env`, keys,
   tokens, personal data, `console.log` debugging, `.only` in tests.
4. Load: `uptime`. If the 1-minute load is above 1.5x `sysctl -n hw.ncpu`, wait.
5. From `platform/`, one at a time:
   ```bash
   npm run typecheck && npm run lint && npm run test:unit
   npm run test:integration   # if TEST_DATABASE_URL is set; otherwise say "not run"
   npm run build              # needs network: next/font downloads Golos Text
   ```
   Paste pass/fail counts. Any red step blocks the push.
6. If `prisma/schema.prisma` changed: a new migration exists and applies on a fresh DB
   (`npx prisma migrate deploy` against an empty database).

## 2. After push

1. Deploy run: `gh run list --workflow deploy.yml --limit 1`, then `gh run watch <id>`.
   Red build leaves the previous containers running; the stand is then stale, not down.
2. Health: `curl -s https://fsp2.ru/api/health` returns `"ok":true`.
3. Walk the jury path on the stand following `docs/demo-script.md`: `/demo` sign-in, consultant
   with a demo resume, profile, grade test, employer search and invitation. Check one narrow
   (mobile) viewport. Note anything broken.
4. Rollback if the stand is broken: `git revert <sha>` and push (migrations do not roll back).

## 3. Final submission only (11 October)

- [ ] Last commit is before 23:59 MSK; `main` on GitHub equals what is deployed.
- [ ] Experts can open the repository and the stand (repo is private: confirm their access
      the way organizers require).
- [ ] Stand runs in demo mode (`DEMO_LOGIN=true`) and survives a container restart.
- [ ] Submission document (DOCX/PDF) is built — see the `submission-doc` skill.
- [ ] Presentation and backup demo video are uploaded.
- [ ] Tick the boxes in `docs/delivery.md`.
