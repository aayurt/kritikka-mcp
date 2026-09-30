---
id: "0001"
title: "Record storage engine"
status: accepted
date: 2026-09-01
---

# ADR-0001: Record storage engine

**Status:** Accepted · **Date:** 2026-09-01

## Context

Records need durable, queryable persistence. Candidates were a relational
database, an embedded key-value store, and document storage. Constraints:
records are write-heavy, read patterns are prefix scans by record key, and
operations must run without a separate database server for local development.

## Decision

All record persistence goes through the record storage engine built on an
embedded key-value store with a thin query layer. Direct file access, ad-hoc
JSON blobs, and secondary persistence layers are forbidden for record data.

## Consequences

- **Easier:** consistent backup/restore story; one code path to test and
  optimize; local development needs no external services.
- **Harder:** cross-record joins happen in the query layer, not the engine;
  schema evolution needs explicit migration steps.
- **Required:** changes touching `src/records/**` must stay compatible with
  this decision or supersede it with a new ADR.
