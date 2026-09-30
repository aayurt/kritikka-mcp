# Troubleshooting

Known failure signatures and fixes.

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| MCP tool returns `{ "found": false }` | Doc missing or wrong `--root` | Check root resolution (`--root` → `PROJECT_MCP_ROOT` → cwd); add the missing doc |
| `validate_change` flags a path you did not touch | Over-broad glob in `mcp-rules.json` | Tighten the rule's `match` patterns |
| ADR rule fires although the ADR is accepted | ADR frontmatter `status` misspelled | Frontmatter must be `status: accepted` |
| Path rejected as outside the repository | Traversal (`../`) or absolute path | Pass repository-relative paths |
| Queue code rejected outright | ADR-0002 still `proposed` | Get the ADR accepted or change non-governed paths |
| Tests skipped in CI | `it.skip` landed | Remove skips per `docs/TESTING.md` |
