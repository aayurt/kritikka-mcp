# Contributing

Thank you for contributing. This document defines the contribution workflow;
operational procedures live in `RUNBOOK.md`.

## Workflow

1. **Branch** from the default branch using `feature/<topic>` or `fix/<topic>`.
2. **Read the docs first**: `docs/ARCHITECTURE.md`, `docs/CONVENTIONS.md`,
   and the current ADRs in `docs/adr/`.
3. **Check ADR requirements.** If your change touches paths covered by a
   `requireAdr` rule in `mcp-rules.json`, the referenced ADR must be
   accepted before the change lands.
4. **Write tests with the change**, per `docs/TESTING.md`.
5. **Validate** the change set with the `project_mcp` server
   (`validate_change`) before opening a pull request.
6. **Open a PR** with a description that references any ADRs involved.

## Pull request checklist

- [ ] `validate_change` reports `valid: true` (errors are blocking; warnings need a note)
- [ ] Required tests added or updated
- [ ] Docs updated when `requireDocUpdate` rules flag the touched paths
- [ ] No changes to paths matched by `forbidden` rules

## Code style

See `docs/CONVENTIONS.md` for naming, formatting, and commit message rules.
