# Agent Instructions

Rules for AI agents working in this repository. Agents must read these rules
before making changes and follow them alongside `docs/ARCHITECTURE.md`.

## Non-negotiables

1. **Read before write.** Fetch `get_architecture_rules`, `get_conventions`,
   and `get_current_adrs` (via the `kritikka_mcp` server) before proposing or
   making any change.
2. **Validate every change.** Pass the proposed change set through
   `validate_change` before writing files. Do not write files that produce
   `error`-severity violations.
3. **Respect the repository boundary.** Never write outside the repository.
   Use `check_repository_boundary` when any path is ambiguous.
4. **ADR-first for architecture.** Changes matching a `requireAdr` rule in
   `mcp-rules.json` require an accepted ADR first. Draft the ADR, get it
   accepted, then implement.

## Working style

- Keep diffs minimal and focused; do not reformat unrelated code.
- Follow the testing policy in `docs/TESTING.md`; a change without its
  required tests is an incomplete change.
- If a tool returns `{ "found": false }`, do not invent content — report the
  miss and stop.
