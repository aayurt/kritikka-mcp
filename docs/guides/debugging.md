# Debugging

First steps when something misbehaves.

1. **Reproduce deterministically.** Find the smallest input that triggers the
   failure; if it is time- or ordering-dependent, say so in the bug report.
2. **Check the boundary.** Path-related bugs are usually containment bugs —
   verify the path stays inside the repository root.
3. **Check the rule engine.** If validation behaves unexpectedly, inspect
   `mcp-rules.json` first; most surprises are a glob that matches more than
   intended.
4. **Isolate the layer.** Storage problems (ADR-0001 scope) and queue problems
   (ADR-0002 scope) fail differently — see `troubleshooting.md`.
