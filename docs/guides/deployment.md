# Deployment

How releases go out.

## Preconditions

- `validate_change` reports the release change set as valid (no `error` items).
- All required tests pass (`docs/TESTING.md`).
- If storage-layout changes are included, a maintenance window is booked
  (see `RUNBOOK.md`).

## Procedure

1. Build from a clean checkout of the release commit.
2. Deploy the request-serving process first, then queue workers (once
   ADR-0002 is accepted and workers exist).
3. Smoke-test: health check, one record read, one record write.
4. Record the deployment in the incident/ops log.

## Rollback

Redeploy the previous known-good build. If a storage migration ran, apply
its documented reverse step before rolling back the code.
