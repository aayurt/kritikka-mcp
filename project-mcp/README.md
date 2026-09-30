# kritikka-mcp

<p align="center">
  <img src="https://raw.githubusercontent.com/aayurt/kritikka-mcp/main/assets/krittika-sword.png" alt="A hooded knight bearing the flaming Krittika sword; a stone tablet reads: cut through the noise, enforce the pattern, ship the code" width="560">
</p>

> **Cut through the noise. Enforce the pattern. Ship the code.**

A repository-aware [MCP](https://modelcontextprotocol.io) server for AI software-engineering agents: it gives them your repo's architecture rules, conventions, ADRs, workflow, and safety guardrails — read-only, enforced, and versioned in `mcp-rules.json`.

The name comes from **Krittika**, the third nakshatra (the Pleiades). Its traditional associations are cutting, separation, refinement, and discernment — *cut away irrelevant context, separate concerns, refine the implementation.*

## Quick start

```bash
# in the repo you want governed (must contain an mcp-rules.json)
npx kritikka-mcp --root .
```

**Claude Code:**

```bash
claude mcp add krittika -- npx -y kritikka-mcp --root .
```

**Generic MCP client config:**

```json
{
  "mcpServers": {
    "krittika": {
      "command": "npx",
      "args": ["-y", "kritikka-mcp", "--root", "."]
    }
  }
}
```

The root resolves from `--root`, then `PROJECT_MCP_ROOT`, then cwd. Requires Node ≥ 20.

## What it does

20 read-only tools across five areas:

- **Docs & rules** — identity, architecture rules, conventions, workflow, testing requirements, ADRs (with status + `supersedes`)
- **Validation** — rule-engine change validation, repository boundary checks, architecture (import-direction) validation, secret detection, contract checks
- **Planning** — task inspection, static impact analysis, constraints, existing-pattern discovery
- **Context** — task-scoped retrieval and compression to a token budget
- **Jules guardrails** — validate readiness, render the dispatch contract, check results (never dispatches)

Missing files return structured `{ found: false, hint }` responses, never errors.

## Governing a repository

Drop an `mcp-rules.json` at the target repo's root (the server refuses to start without one). Example — all five rule types:

```json
{
  "version": 1,
  "rules": [
    { "type": "forbidden", "id": "no-dist", "match": ["dist/**"], "severity": "error", "reason": "Build output is off-limits." },
    { "type": "requireAdr", "id": "core-governed", "match": ["src/core/**"], "adr": "0001", "severity": "error", "reason": "Core is governed by ADR-0001." },
    { "type": "requireTest", "id": "src-needs-tests", "match": ["src/**/*.ts"], "testMatch": ["**/*.test.ts"], "severity": "error", "reason": "Every source change ships tests." },
    { "type": "requireDocUpdate", "id": "keep-arch-docs", "match": ["src/core/**"], "docs": ["docs/ARCHITECTURE.md"], "severity": "warning", "reason": "Keep architecture docs current." },
    { "type": "layerDependency", "id": "layered", "direction": "inward-only",
      "layers": [
        { "name": "tools", "globs": ["src/tools/**"] },
        { "name": "engine", "globs": ["src/engine/**"] },
        { "name": "foundation", "globs": ["src/foundation/**"] }
      ], "severity": "error", "reason": "Dependencies point inward only." }
  ]
}
```

Rule types: `forbidden`, `requireAdr`, `requireTest`, `requireDocUpdate`, `layerDependency`.

## Docs & source

Full documentation, design philosophy, and the server source live at
[github.com/aayurt/kritikka-mcp](https://github.com/aayurt/kritikka-mcp).

## License

[MIT](./LICENSE)
