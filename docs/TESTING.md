# Testing

Testing policy and requirements enforced (advised) through the
`project_mcp` server's `requireTest` rules in `mcp-rules.json`.

## Requirements

1. **Every source change ships tests.** A change to any file under `src/**`
   must add or update a corresponding test, except files matched by the
   `testExempt` list in `mcp-rules.json`.
2. **Tests live beside the code** as `*.test.ts`, or under `test/**` when
   centralized integration tests.
3. **No skipped tests.** `describe.skip` / `it.skip` are forbidden in landed
   code; if a test cannot run yet, do not land the change it guards.
4. **Behavior over implementation.** Assert on outputs and side effects, not
   internal call orders.

## What to test

| Layer | Minimum bar |
| --- | --- |
| Pure functions | Inputs → outputs, including error paths |
| File/system boundaries | Containment: traversal attempts (`../`, absolute paths) are rejected |
| Rule engine | Each rule type produces its documented severity and message |
| MCP tools | Missing-file behavior returns `{ found: false, hint }`, not a throw |

## Running tests

```bash
npm --prefix project-mcp test
```

## Coverage

No numeric coverage gate. The requirement is that each new behavior has at
least one test that would fail without it.
