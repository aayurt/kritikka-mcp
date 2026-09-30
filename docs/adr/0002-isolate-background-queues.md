---
id: "0002"
title: "Isolate background queues"
status: proposed
date: 2026-09-15
---

# ADR-0002: Isolate background queues

**Status:** Proposed · **Date:** 2026-09-15

## Context

Background work (retries, exports, maintenance jobs) currently runs in the
same process as request serving. A slow or crashing job can degrade request
latency or take the server down. Queues must be isolated so request-serving
capacity is never coupled to background work.

## Decision

Run queue workers in separate processes with their own connections. The
request-serving process enqueues work and never executes jobs. Queue
infrastructure lives under `src/queues/**`.

## Consequences

- **Easier:** independent scaling and restarts; request latency is decoupled
  from job duration.
- **Harder:** two deployment targets; health checks and observability must
  cover workers separately.
- **Status:** not yet accepted. Building on `src/queues/**` before acceptance
  violates `docs/ARCHITECTURE.md` rule 2 and the `requireAdr` rule for that
  path in `mcp-rules.json`.
