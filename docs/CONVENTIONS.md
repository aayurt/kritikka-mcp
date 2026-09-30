# Conventions

Coding and naming conventions for this repository. `CONTRIBUTING.md` covers
the contribution workflow; this file covers the code itself.

## Naming

- Files and directories: `kebab-case` (`record-store.ts`, not `RecordStore.ts`).
- Types, classes, and components: `PascalCase`.
- Functions and variables: `camelCase`.
- Constants: `SCREAMING_SNAKE_CASE`.
- Tests mirror the file they test: `record-store.test.ts` next to
  `record-store.ts`, or under `test/` when centralized.

## Code style

- One responsibility per module; prefer many small files over few large ones.
- No default exports in shared libraries; use named exports.
- Errors are thrown as `Error` subclasses with a machine-readable `code`.
- No secrets or absolute paths in source; configuration comes from
  environment variables or config files at the repo root.

## Commits

- Imperative mood, 50-char subject line, body explains *why*.
- Reference ADR numbers when a change implements or affects one
  (`Implements ADR-0001`).

## Documentation

- Every architecturally significant decision gets an ADR in `docs/adr/`.
- Public APIs get doc comments; internal helpers may stay lean.
