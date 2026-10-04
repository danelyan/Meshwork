# Repository Guidelines

## Project Structure & Module Organization

This directory currently contains no application code, tests, assets, or build configuration. It is not yet initialized as a Git repository. Update this guide when the initial project structure is established.

Keep application code, tests, and static assets in clearly named locations appropriate to the chosen framework. For example, use `src/`, `tests/`, and `assets/` if the framework does not prescribe alternatives. Document the actual layout in `README.md`.

## Build, Test, and Development Commands

No development, build, lint, or test commands are currently configured. When adding tooling, provide reproducible commands in the project manifest or task runner and explain them in `README.md`. Include dependency installation, local startup, production build, and test execution. Do not document commands as available until they work.

## Coding Style & Naming Conventions

No language, indentation standard, formatter, or linter has been selected. Establish these with the first implementation and commit the relevant configuration. Follow the chosen language’s conventions, use descriptive names, and keep formatting consistent within each file. Separate unrelated cleanup from functional changes.

## Testing Guidelines

No test framework or coverage threshold exists. Add tests alongside new behavior using the selected framework’s naming conventions. Cover expected behavior, failure paths, and regressions. Document how to run the complete suite and individual tests.

## Commit & Pull Request Guidelines

There is no Git history from which to infer commit conventions. Until a convention is established, use concise, imperative subjects such as `Add initial project configuration`.

Pull requests should explain the change, include validation results, and link relevant issues. Include screenshots for visible interface changes and identify any checks that could not be run.

## Security & Configuration

Use the local `scrt4` vault for available secrets, referencing them through `$env[NAME]` placeholders in `scrt4 run` commands. Never request, print, or write secret values to files. Configuration examples must contain placeholders only.
