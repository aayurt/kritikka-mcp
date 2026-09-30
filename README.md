# Krittika MCP

<p align="center">
  <img src="assets/krittika-sword.png" alt="A hooded knight bearing the flaming Krittika sword; a stone tablet reads: cut through the noise, enforce the pattern, ship the code" width="720">
</p>

> **Cut through the noise. Enforce the pattern. Ship the code.**

**Krittika** is a repository-aware MCP server for AI software-engineering agents. It gives agents a structured understanding of a codebase — its architecture, conventions, ADRs, workflow, testing requirements, and safety rules — so they work according to the repository's rules instead of reinventing them on every task.

## Why "Krittika"?

The name comes from **Krittika**, the third nakshatra in Vedic astronomy — the Pleiades constellation. Its traditional associations are **cutting, separation, refinement, and discernment** (its presiding deity is Agni, the fire that refines).

The engineering interpretation is intentional:

> **Cut away irrelevant context. Separate concerns. Refine the implementation.**

Krittika exists to help AI agents work with the same discipline expected from a good software engineer.

## Why Krittika?

AI coding agents are powerful, but they commonly:

- consume excessive context while exploring a repository
- invent patterns that already exist elsewhere in the codebase
- mix conventions between projects
- ignore architectural boundaries
- modify unrelated files, generated files, or files outside the repo

Krittika acts as the **engineering layer between the repository and the agent**:

```text
Repository (AGENTS.md, docs/, ADRs, mcp-rules.json)
        │
   Krittika MCP  ──  rules · context · impact · safety
        │
Hermes / OpenCode / Jules / Claude / any MCP client
```

## Install

From npm (recommended):

```bash
npm install -g kritikka-mcp        # or: npx kritikka-mcp
```

From source:

```bash
git clone https://github.com/aayurt/kritikka-mcp
cd kritikka-mcp && npm --prefix project-mcp install && npm --prefix project-mcp run build
```

The server is a stdio MCP binary and requires **Node ≥ 20**.

## Using it with your MCP client

Run against any target repository:

```bash
kritikka-mcp --root /path/to/target-repo
# or: npx kritikka-mcp --root .
```

The repository root resolves from `--root`, then the `PROJECT_MCP_ROOT` environment variable, then the server's working directory.

**Generic client config** (`mcpServers` JSON):

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

**Claude Code:**

```bash
claude mcp add krittika -- npx -y kritikka-mcp --root .
```

> **The target repo must contain an `mcp-rules.json` at its root.** The server refuses to start without one — governance is mandatory, not optional.

## Governing a target repository

`mcp-rules.json` declares the rules Krittika enforces. All five rule types, as used by this repo:

```json
{
  "version": 1,
  "rules": [
    {
      "type": "forbidden",
      "id": "no-internal-state",
      "match": ["dist/**", "node_modules/**"],
      "reason": "Build output is not part of the reviewed repository.",
      "severity": "error"
    },
    {
      "type": "requireAdr",
      "id": "records-engine-governed",
      "match": ["src/records/**"],
      "adr": "0001",
      "reason": "Record persistence is governed by ADR-0001.",
      "severity": "error"
    },
    {
      "type": "requireTest",
      "id": "src-needs-tests",
      "match": ["src/**/*.ts"],
      "testMatch": ["**/*.test.ts", "test/**"],
      "testExempt": ["**/*.d.ts"],
      "reason": "Every source change ships tests.",
      "severity": "error"
    },
    {
      "type": "requireDocUpdate",
      "id": "architecture-docs-stale",
      "match": ["src/records/**"],
      "docs": ["docs/ARCHITECTURE.md"],
      "reason": "Keep architecture docs current.",
      "severity": "warning"
    },
    {
      "type": "layerDependency",
      "id": "layered-core",
      "layers": [
        { "name": "tools", "globs": ["project-mcp/src/tools/**"] },
        { "name": "engine", "globs": ["project-mcp/src/rules.ts"] },
        { "name": "foundation", "globs": ["project-mcp/src/config.ts"] }
      ],
      "direction": "inward-only",
      "reason": "Tools depend on engines; engines depend only on the foundation.",
      "severity": "error"
    }
  ]
}
```

| Rule type | Enforces |
| --- | --- |
| `forbidden` | Paths agents must never touch |
| `requireAdr` | Changes in an area must reference a governing ADR |
| `requireTest` | Matched sources must have corresponding tests |
| `requireDocUpdate` | Matched changes should update the listed docs |
| `layerDependency` | Import direction between architectural layers (`inward-only`) |

## Tools (20, all read-only)

| Tool | Purpose |
| --- | --- |
| `get_project_identity` | Name, description, doc inventory with presence |
| `get_architecture_rules` | `docs/ARCHITECTURE.md` + `AGENTS.md` + ADR index |
| `get_conventions` | `docs/CONVENTIONS.md` + `CONTRIBUTING.md` |
| `get_current_adrs` | ADRs with parsed status and `supersedes`; filter by `status`/`id` |
| `get_workflow` | `RUNBOOK.md` + `CONTRIBUTING.md` + `docs/DEVELOPMENT.md` |
| `get_testing_requirements` | `docs/TESTING.md` |
| `get_constraints` | Constraints relevant to a planned task |
| `validate_change` | Rule-engine report: `{ valid, violations, warnings, requiredActions }` |
| `check_repository_boundary` | Per-path `{ insideRepo, allowed, reason, matchedRule }` |
| `validate_architecture` | Import-direction scan against `layerDependency` rules |
| `detect_secrets` | Credential-shaped string scan with redacted evidence |
| `inspect_task` | Which rules, ADRs, layers, and test requirements a task touches |
| `analyze_impact` | Static impact analysis for candidate paths |
| `validate_contracts` | Cross-check contracts between modules |
| `retrieve_relevant_context` | Task-scoped context retrieval |
| `compress_context` | Compress retrieved context to a token budget |
| `find_existing_pattern` | Find existing implementations before inventing new ones |
| `validate_jules_ready` | Pre-dispatch guardrail for a Jules session |
| `prepare_jules_task` | Render the Jules dispatch contract (CLI template) |
| `validate_jules_result` | Check a finished Jules session against the rules |

Every tool is annotated `readOnlyHint`. Missing files return structured `{ found: false, hint }` responses rather than errors.

## Safety model

- **Read-only, forever.** The server never writes, executes, or dispatches anything. Jules integration is guardrail-only: it validates readiness and results, it never launches sessions.
- **The repository is the source of truth.** Krittika structures `AGENTS.md`, `docs/`, and ADRs; it never replaces them.
- **Don't rediscover existing patterns.** `find_existing_pattern` before `write_new_one`.

A Krittika-enabled agent follows the same lifecycle every time:

```text
UNDERSTAND → PLAN → IMPLEMENT → TEST → VALIDATE
```

## Repository layout (this repo)

```text
.
├── AGENTS.md                  # How AI agents should work in this repo
├── CONTRIBUTING.md            # How humans contribute
├── RUNBOOK.md                 # Operational procedures
├── mcp-rules.json             # Declarative rules evaluated by the server
├── docs/
│   ├── ARCHITECTURE.md        # Architecture rules and constraints
│   ├── CONVENTIONS.md         # Coding and naming conventions
│   ├── DEVELOPMENT.md         # Developer workflow
│   ├── TESTING.md             # Testing policy
│   └── adr/                   # Architecture decision records
└── project-mcp/               # The MCP server (TypeScript, ESM)
    ├── src/                   # tools/, config, readers, rules, scanner, jules
    ├── test/                  # vitest unit + stdio integration suites
    └── scripts/smoke.mjs      # 24-check live-client smoke test
```

## Development

```bash
npm --prefix project-mcp install
npm --prefix project-mcp run typecheck     # src + tests
npm --prefix project-mcp test              # build + 117 tests
node project-mcp/scripts/smoke.mjs "$(pwd)"  # live MCP client smoke
```

Releases use [changesets](https://github.com/changesets/changesets): add a changeset in `project-mcp/.changeset/`, merge the Version Packages PR, and CI publishes to npm.

## License

[MIT](LICENSE)
