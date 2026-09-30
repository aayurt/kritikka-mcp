# Development

Developer workflow for day-to-day work. Contribution policy is in
`CONTRIBUTING.md`; operational procedures are in `RUNBOOK.md`.

## Setup

```bash
npm --prefix project-mcp install   # install MCP server dependencies
npm --prefix project-mcp run build # build the server
```

## Daily loop

1. Pick an issue; note whether it touches ADR-governed paths
   (see `mcp-rules.json`).
2. Branch, implement, test.
3. Run `validate_change` (via the `project_mcp` server) on your change set.
4. Open a PR per `CONTRIBUTING.md`.

## Working with the MCP server

- The server (`project-mcp/`) is a read-only advisor over this repository.
- It resolves the repository root from `--root`, then `PROJECT_MCP_ROOT`,
  then the current working directory.
- Its rules come from `mcp-rules.json` at the repository root.

## Common tasks

| Task | How |
| --- | --- |
| Add an architectural decision | Copy `docs/adr/0000-template.md`, fill it, set `status: proposed` |
| Accept an ADR | Flip `status` to `accepted` |
| Add a governance rule | Edit `mcp-rules.json` (schema is validated by the server) |
| Debug a failure | Start at `docs/guides/debugging.md` |
