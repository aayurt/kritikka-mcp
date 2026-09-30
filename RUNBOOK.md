# Runbook

Operational procedures for running and maintaining this project. For the
development workflow see `CONTRIBUTING.md` and `docs/DEVELOPMENT.md`.

## Daily operations

- **Health check.** Confirm the service boots and responds; investigate any
  error-rate drift before deploying.
- **Log triage.** Route failures by subsystem: storage issues → ADR-0001
  context, queue issues → ADR-0002 context.

## Deployment

Follow `docs/guides/deployment.md`. Roll back by redeploying the previous
known-good build; note the rollback in the incident log.

## Escalation

1. Reproduce with `docs/guides/debugging.md`.
2. Consult `docs/guides/troubleshooting.md` for known failure signatures.
3. If unresolved, open an incident and page the on-call owner.

## Maintenance windows

Schema or storage-engine migrations (anything under ADR-0001 scope) require
a maintenance window and a tested rollback path.
