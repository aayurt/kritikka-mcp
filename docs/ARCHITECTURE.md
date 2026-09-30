# Architecture

Architectural rules and constraints for this repository. Binding decisions
live in `docs/adr/`; this document states the standing rules that any change
must respect.

## Rules

1. **Records go through the storage engine.** All record persistence must use
   the storage engine chosen in ADR-0001. No ad-hoc persistence layers
   alongside it.
2. **Background queues are isolated.** Queue workers must not share processes
   or connections with request-serving code, per ADR-0002. Queues are optional
   until accepted; do not build on them beforehand.
3. **Docs are the contract.** `docs/ARCHITECTURE.md`, `docs/CONVENTIONS.md`,
   and `docs/TESTING.md` describe the expected structure; a change that
   contradicts them must update them in the same change set or justify why not.
4. **Boundary discipline.** Code must never read or write outside the
   repository root. Paths that escape the root (`../`, absolute paths) are
   rejected by policy, not by accident.
5. **Layer direction is mechanical.** `mcp-rules.json` declares a
   `layerDependency` rule (tools → engines → foundation); `validate_architecture`
   scans static imports and fails on outward imports. Adding a layer means
   editing the rule, not trusting reviewers to remember.

## Layering

- `src/records/**` — record types and storage-engine access (ADR-0001 scope)
- `src/queues/**` — background queue workers (ADR-0002 scope, not yet accepted)
- `src/**` (everything else) — application logic; depends on the above, never the reverse

## Changing the architecture

Architecture changes require an ADR: copy `docs/adr/0000-template.md`, fill
it in, and follow the ADR lifecycle (proposed → accepted → superseded) before
implementing.
