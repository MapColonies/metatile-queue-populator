# Pg-Boss v12 Upgrade Plan

## Goals

- Upgrade pg-boss usage from v7 to v12 across code, tests, and configuration.
- Align configuration keys and Helm values with v12 options.
- Update README to reflect any config changes.
- Ensure migrations and runtime initialization remain correct.

## Code Changes

### 1) Update pg-boss API usage

- `sendOnce` is not in v12 typings; replace with `send(queue, data, { singletonKey })` in tests.
- `insert` signature is `insert(queueName, jobs, options?)`; remove `name` from each `JobInsert` and pass queue name as the first argument in:
  - `src/tiles/models/tilesManager.ts`
  - mocks in `tests/unit/tiles/models/tilesManager.spec.ts`
- `getJobById` now requires queue name: `getJobById(queueName, id)`.
  - Update usage in `tests/integration/tiles/tiles.spec.ts` or use `findJobs`.
- Update job metadata property casing in tests (camelCase, e.g. `completedOn`).
- Replace v7-only types (e.g., `JobWithDoneCallback`) with v12 types where referenced in tests.

### 2) Queue/job options mapping

- v12 queue/job options use seconds-based retention (`retentionSeconds` or `deleteAfterSeconds`).
- Replace `retentionHours` in config and mapping:
  - Update `config/default.json` to use `retentionSeconds`.
  - Update `helm/values.yaml` and `helm/templates/configmap.yaml` to use `retentionSeconds` and rename env var to `QUEUE_JOBS_RETENTION_SECONDS`.
  - Update `README.md` config section to document the new key and units.
- Update `src/tiles/models/tilesManager.ts` to map config to v12 `SendOptions`/`JobInsert` options.

### 3) pg-boss initialization and migrations

- Confirm whether `pgBoss.start()` is sufficient to run migrations in this project.
- If needed, set constructor options (`migrate: true`, `createSchema: true`) in `src/tiles/jobQueueProvider/pgbossFactory.ts` and document the migration process in the README.

## Tests and Verification

- Update unit tests in `tests/unit/tiles/models/tilesManager.spec.ts` for new API signatures and types.
- Update integration tests in `tests/integration/tiles/tiles.spec.ts` for new job metadata casing and queue-aware job lookups.
- Run:
  - `npm test`
  - `npm run build`

## Documentation Updates

- Update `README.md` config section with new retention key name and units.
- Ensure Helm values and config map documentation align with code changes.

## Deliverables

- Updated source and tests for pg-boss v12 APIs.
- Updated config/Helm/README for new retention config.
- Passing tests and build.
