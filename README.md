# Project MCP Playground

A repository designed to exercise the `project_mcp` server: a docs-and-ADRs
tree that encodes architecture rules, conventions, workflow, and testing
requirements as plain files, so agents can read them instead of guessing.

## What this project is

The repository is intentionally simple: record storage and background queue
isolation are the two architecturally significant concerns, each captured in
an ADR. Everything else — conventions, workflow, testing policy — lives in
`docs/` and is enforced (advised) through `mcp-rules.json` at the repo root.

## Document map

| Path | Purpose |
| --- | --- |
| `AGENTS.md` | How AI agents should work in this repo |
| `CONTRIBUTING.md` | How humans contribute |
| `RUNBOOK.md` | Operational procedures |
| `docs/ARCHITECTURE.md` | Architecture rules and constraints |
| `docs/CONVENTIONS.md` | Coding and naming conventions |
| `docs/DEVELOPMENT.md` | Developer workflow |
| `docs/TESTING.md` | Testing policy and requirements |
| `docs/adr/` | Architecture decision records |
| `docs/guides/` | Debugging, deployment, troubleshooting guides |
| `mcp-rules.json` | Declarative rules evaluated by the `project_mcp` server |

## Quick start

```bash
npm --prefix project-mcp install
npm --prefix project-mcp run build
```

Then point your MCP client at `project-mcp/build/index.js`.

## MCP client configuration

The server speaks MCP over stdio. Register it with your client (paths are
relative to this repository root):

```json
{
  "mcpServers": {
    "project": {
      "command": "node",
      "args": ["project-mcp/build/index.js", "--root", "."]
    }
  }
}
```

The repository root resolves from `--root`, then the `PROJECT_MCP_ROOT`
environment variable, then the server's working directory.

### Tools

| Tool | Purpose |
| --- | --- |
| `get_project_identity` | Name, description, doc inventory with presence |
| `get_architecture_rules` | `docs/ARCHITECTURE.md` + `AGENTS.md` + ADR index |
| `get_conventions` | `docs/CONVENTIONS.md` + `CONTRIBUTING.md` |
| `get_current_adrs` | ADRs with parsed status; filter by `status`/`id`, optional full content |
| `get_workflow` | `RUNBOOK.md` + `CONTRIBUTING.md` + `docs/DEVELOPMENT.md` |
| `get_testing_requirements` | `docs/TESTING.md` |
| `validate_change` | Rule-engine report: `{ valid, violations, warnings, requiredActions }` |
| `check_repository_boundary` | Per-path `{ insideRepo, allowed, reason, matchedRule }` |

All tools are read-only (`readOnlyHint`). Missing files return structured
`{ found: false, hint }` responses rather than errors.

### Smoke test

```bash
npm --prefix project-mcp run build
node project-mcp/scripts/smoke.mjs "$(pwd)"
```
