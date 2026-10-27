# Session 2 PostgreSQL operations and handoff

Status: local persistence baseline verified on 2026-10-27 (Asia/Singapore). This is not a production launch runbook.

[Database design](README.md) · [Deployment requirements](../16-deployment-and-operations/README.md)

## What this session provides

Session 2 creates `auth`, `identity`, and `audit` in one PostgreSQL database. Nine TypeORM migrations own one ledger, `identity.schema_migrations`. The pinned Better Auth 1.7.12 core/plugin schema is reviewed and imported into migration 0002. Service records, audit events, runtime stores, bounded retention and stale-assurance cleanup, and internal readiness are implemented in the remaining migrations and code. The native handler, sign-in, authorization, SMTP transport, SSO field encryption, and the public readiness endpoint are not enabled yet.

| Connection | Purpose | Database privilege role |
| --- | --- | --- |
| `AUTH_DB_*` | Native pool for current startup checks and the future Better Auth handler; `auth` search path | `identity_auth_runtime` |
| `IDENTITY_DB_*` | TypeORM service records and policy reads | `identity_policy_runtime` |
| `AUDIT_DB_*` | Insert-only event writer | `identity_audit_runtime` |
| `MIGRATION_DB_*` | Single reviewed schema migration job | Owner of the three schemas |
| `RETENTION_DB_*` | Separate bounded cleanup and stale-assurance job | `identity_retention_maintenance`, with only native session ID/user ID/expiry read access |

Keep migration and retention credentials out of the HTTP process in deployments. `.env.example` contains placeholders; local `.env` is ignored by Git. Never put live credentials in `.env.example`, migration files, commands, or screenshots.

## Prepare a local database

1. Create a dedicated PostgreSQL database and set `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_SSL`, and the five role login/password pairs in local `.env` or a secure environment source. PostgreSQL 18.2 and `auth_db` were used for this session. Production connections require `DB_SSL=true` and `DB_CA_CERT` with a verified PEM CA.
2. As the dedicated database owner or administrator, export the five `*_DB_USER`/`*_DB_PASS` pairs and normal `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, and `PGPASSWORD` variables to the shell running `psql`. Execute `psql -X -v ON_ERROR_STOP=1 -f scripts/database/bootstrap-roles.sql`. The script provisions distinct logins, privilege roles, and owned schemas, and revokes implicit `public` schema access. It leaves existing login passwords unchanged on reruns. Rerun it on databases initialized before the `public` grant correction.
3. `bootstrap-roles.sql` uses psql `\getenv` and `\gexec`, so run it with psql, including pgAdmin's PSQL Tool if its environment has those variables. pgAdmin Query Tool is useful for the read-only checks below, but it does not execute those psql meta-commands. Do not paste passwords into Query Tool history.

The migration login needs schema ownership but no PostgreSQL `SUPERUSER`, `CREATEROLE`, or database-wide `CREATE`. Runtime logins do not own schemas or get DDL rights. Separate connection profiles enforce fixed search paths and pool/statement limits; service object queries are schema-qualified.

## Apply and inspect migrations

From the repository root, with the dedicated migration profile configured:

```text
make show_migration
make run_migration
make show_migration
```

`run_migration` checks that the administrator bootstrap removed `public` access, acquires a PostgreSQL advisory lock on one dedicated connection, waits at most two seconds for another job, and applies each pending migration in its own transaction. A repeated run should say `Applied 0 migration(s).` Application startup never runs migrations or synchronization. The current ledger order is:

1. `CreateDatabaseFoundation1792972800001`
2. `NativeAuth1792972800002`
3. `CoreIdentity1792972800003`
4. `WorkflowAudit1792972800004`
5. `AlignArrayDefault1792972800005`
6. `MaintenancePrivileges1792972800006`
7. `OrphanSessionRead1792972800007`
8. `NarrowMaintenanceReads1792972800008`
9. `MaintenanceVersionRead1792972800009`

The native migration records the exact `auth` CLI, Better Auth/plugin version, generated SQL SHA-256, and inspection-config SHA-256. Use `scripts/database/better-auth-inspection.ts` only to review native schema changes. Do not run `auth migrate` against this database. Native authentication tables are never TypeORM service entities.

`make empty_migration name=DescriptiveName` creates a stub that intentionally fails until reviewed. `make generate_migration name=DescriptiveName` compares only service-owned entity metadata after pending migrations are applied; a no-diff exit is expected when entities and schema match. Review all generated SQL before applying it. `make revert_migration confirm=REVERT_LATEST` is restricted to development/test and a specifically reviewed safe latest migration. Migration 0009 is currently latest and has no safe down path, so use a reviewed forward migration for repairs.

If a migration fails, stop application promotion, inspect the failed migration and ledger, repair the reviewed source/SQL, and rerun under the same lock. Earlier committed migrations remain applied; do not reset the database or bypass the ledger. Restore or incompatible rollback requires the separate launch runbook and a rehearsed recovery plan.

In pgAdmin Query Tool, use read-only checks such as:

```sql
SELECT schemaname, count(*) AS table_count
FROM pg_tables
WHERE schemaname IN ('auth', 'identity', 'audit', 'public')
GROUP BY schemaname ORDER BY schemaname;

SELECT name, timestamp FROM identity.schema_migrations ORDER BY id;

SELECT rolname,
       has_schema_privilege(rolname, 'public', 'USAGE') AS public_usage,
       has_schema_privilege(rolname, 'public', 'CREATE') AS public_create
FROM pg_roles
WHERE rolname IN (
  'identity_auth_runtime', 'identity_policy_runtime',
  'identity_audit_runtime', 'identity_retention_maintenance'
)
ORDER BY rolname;
```

The current local layout has nine `auth` tables, nineteen `identity` tables including the ledger, one `audit` table, and no application table in `public`.

## Runtime and retention

Start the local application with `pnpm start:dev` or `node --loader ts-node/esm src/main.ts`. Initialization checks the native, identity, and audit connection profiles plus all required migrations before listening. `GET /health/live` responds without a database query. Internal readiness is withdrawn on SIGINT/SIGTERM, then HTTP drains for at most 30 seconds before pools close. The public `/health/ready` route and SMTP worker belong to later sessions.

Run the cleanup job separately with retention credentials:

```text
node --loader ts-node/esm src/persistence/retention-cli.ts
```

It processes at most twenty batches of 500 per sweep, expires/purges delivery ciphertext, removes restricted audit network fields after 30 days and old events after 90 days, removes terminal delivery metadata after 30 days, and clears expired mobile, assurance, flow, abuse, replay, and lease records. It reports affected row counts. Schedule it and alert on failures when deploying; the HTTP role cannot perform audit cleanup.

Run the separate orphan job with the retention profile:

```text
node --loader ts-node/esm src/persistence/orphan-reconciliation-cli.ts
```

It scans at most twenty batches of 500 assurance records older than 24 hours, compares each to native `auth.session` using only its `id`, `userId`, and `expiresAt` column grants, and deletes a service assurance when its native session is absent, belongs to another user, or expired more than 24 hours ago. It cannot read the native session token. The deletion rechecks the row version and age. Native outage stops the job before it treats missing data as an orphan. This narrow job does not reconcile account policies, provider bindings, service keys, or partial native operations; those require the future authenticated workflows and their recovery rules.

## Local evidence and limits

- All nine migrations applied on local PostgreSQL 18.2; `make show_migration` listed all as applied and a repeated `make run_migration` applied zero. The administrator bootstrap removed runtime `public` schema usage, and the migration runner now rejects that grant if it reappears.
- `make test` passed all 28 tests across eight suites with the opt-in database flags enabled. That includes seven database-configuration cases, five rollback-only policy/store scenarios, three actual role-boundary scenarios, and separate-connection competition for assurance promotion, membership edits, administration intent, leases, one delivery claim, and one mobile exchange. A suspended membership blocked a new assurance promotion. A migration-lock test proved a competing runner fails within the bounded wait and the lock releases.
- A local administrator transaction created and rolled back a same-named `public.applications` decoy; schema-qualified identity lookups ignored it even under an intentionally hostile search path. The orphan job removed 501 synthetic missing-session rows plus one expired-session row across two batches while preserving a live-session row. The retention job completed with zero affected rows on an empty due set after maintenance reads were narrowed.
- Source and compiled startup passed the internal database-readiness gate; `/health/live` responded 200, `/health/ready` responded 404, and an emitted SIGTERM completed the shutdown path. `make build` passed after excluding the one-off schema-inspection script from the production build. The compiled migration CLI listed all nine applied migrations. Seven HTTP end-to-end tests passed, including a check that Swagger exposes no readiness or authentication route.
- Run the opt-in database tests with `RUN_DB_INTEGRATION=1` and the existing local `.env`; they skip otherwise. Target files are `src/persistence/persistence.integration.spec.ts`, `src/persistence/database-roles.integration.spec.ts`, `src/persistence/concurrency.integration.spec.ts`, and `src/database/migration-lock.integration.spec.ts`. The public-decoy transaction additionally requires `RUN_DB_ADMIN_INTEGRATION=1` and local administrator credentials. The orphan-job test requires `RUN_DB_MAINTENANCE_INTEGRATION=1`; it runs the real cleanup job, which can remove other due orphan assurance rows in that database.
- A follow-up `make lint` passed after formatting the Session 2 TypeScript files and resolving the remaining typed-query and migration-method diagnostics. The latest local Node runtime was 24.19.0, below the declared 24.22.1 target. Container startup, staging restore, SMTP/IdP integrations, native session behavior, and live platform flows remain unverified. No `.pnpm-store` was created.

The remaining M1 work includes native handler wiring, SSO field protection, authenticated provisioning/ingress, encryption and SMTP worker behavior, policy hooks, and orphan/partial-operation reconciliation. This baseline alone must not be exposed as an authentication service.
