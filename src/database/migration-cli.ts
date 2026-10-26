import 'reflect-metadata';
import { config as loadDotEnv } from 'dotenv';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { MigrationExecutor, type DataSource, type QueryRunner } from 'typeorm';

loadDotEnv({ quiet: true });

const SOURCE_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const MIGRATIONS_DIR = join(SOURCE_ROOT, 'src', 'migrations');
const LOCK_KEY = '4863046005709130034';
const LOCK_WAIT_MS = 2_000;
const PRIVILEGE_ROLES = [
  'identity_auth_runtime',
  'identity_policy_runtime',
  'identity_audit_runtime',
  'identity_audit_reader',
  'identity_retention_maintenance',
];

type MigrationCommand = 'create' | 'generate' | 'run' | 'show' | 'revert';
type LedgerRow = { id: number; timestamp: string; name: string };

function migrationName(input: string | undefined): string {
  if (!input || !/^[A-Z][A-Za-z0-9]{2,63}$/.test(input)) {
    throw new Error('Migration name must be 3-64 alphanumeric characters, starting with an uppercase letter');
  }
  return input;
}

async function acquireLock(queryRunner: QueryRunner): Promise<void> {
  const deadline = Date.now() + LOCK_WAIT_MS;
  while (true) {
    const rows = await queryRunner.query(
      'SELECT pg_try_advisory_lock($1::bigint) AS locked',
      [LOCK_KEY],
    ) as Array<{ locked: boolean }>;
    if (rows[0]?.locked) return;
    if (Date.now() >= deadline) {
      throw new Error('Another database migration job holds the lock');
    }
    await delay(100);
  }
}

async function appliedMigrations(queryRunner: QueryRunner): Promise<LedgerRow[]> {
  const rows = await queryRunner.query(
    `SELECT to_regclass('identity.schema_migrations') AS relation`,
  ) as Array<{ relation: string | null }>;
  if (!rows[0]?.relation) return [];
  return queryRunner.query(`
    SELECT id, timestamp::text, name
    FROM identity.schema_migrations
    ORDER BY id ASC
  `) as Promise<LedgerRow[]>;
}

function registeredNames(dataSource: DataSource): string[] {
  return dataSource.migrations.map((migration) =>
    migration.name || migration.constructor.name,
  );
}

function verifyLedger(dataSource: DataSource, applied: LedgerRow[]): void {
  const registered = new Set(registeredNames(dataSource));
  const missing = applied.filter((row) => !registered.has(row.name));
  if (missing.length > 0) {
    throw new Error(`Applied migration is absent from this release: ${missing[0].name}`);
  }
}

async function verifyPrivilegeRoles(queryRunner: QueryRunner): Promise<void> {
  const rows = await queryRunner.query(
    'SELECT rolname FROM pg_roles WHERE rolname = ANY($1::text[])',
    [PRIVILEGE_ROLES],
  ) as Array<{ rolname: string }>;
  const found = new Set(rows.map((row) => row.rolname));
  const missing = PRIVILEGE_ROLES.filter((name) => !found.has(name));
  if (missing.length) {
    throw new Error(`Provision privilege roles before migrations: ${missing.join(', ')}`);
  }
}

async function verifyPublicIsolation(queryRunner: QueryRunner): Promise<void> {
  const rows = await queryRunner.query(
    `SELECT rolname FROM pg_roles
     WHERE rolname = ANY($1::text[])
       AND (has_schema_privilege(rolname, 'public', 'USAGE')
         OR has_schema_privilege(rolname, 'public', 'CREATE'))`,
    [PRIVILEGE_ROLES],
  ) as Array<{ rolname: string }>;
  const migrationUsage = await queryRunner.query(
    `SELECT has_schema_privilege(current_user, 'public', 'USAGE')
       OR has_schema_privilege(current_user, 'public', 'CREATE') AS allowed`,
  ) as Array<{ allowed: boolean }>;
  if (rows.length || migrationUsage[0]?.allowed) {
    throw new Error('Administrator bootstrap must revoke public schema access before migrations');
  }
}

async function withMigrationConnection(
  command: 'run' | 'show' | 'revert' | 'generate',
  callback: (dataSource: DataSource, queryRunner: QueryRunner) => Promise<void>,
): Promise<void> {
  const { AppDataSource } = await import('./data-source.js');
  let queryRunner: QueryRunner | undefined;
  let locked = false;
  try {
    await AppDataSource.initialize();
    queryRunner = AppDataSource.createQueryRunner();
    await queryRunner.connect();
    if (command !== 'generate') {
      await acquireLock(queryRunner);
      locked = true;
    }
    await callback(AppDataSource, queryRunner);
  } finally {
    if (queryRunner) {
      if (locked) {
        try {
          await queryRunner.query('SELECT pg_advisory_unlock($1::bigint)', [LOCK_KEY]);
        } finally {
          await queryRunner.release();
        }
      } else {
        await queryRunner.release();
      }
    }
    if (AppDataSource.isInitialized) await AppDataSource.destroy();
  }
}

async function runMigrations(): Promise<void> {
  await withMigrationConnection('run', async (dataSource, queryRunner) => {
    await verifyPrivilegeRoles(queryRunner);
    await verifyPublicIsolation(queryRunner);
    const schemas = await queryRunner.query(
      `SELECT nspname FROM pg_namespace
       WHERE nspname IN ('auth', 'identity', 'audit')
         AND nspowner = (SELECT oid FROM pg_roles WHERE rolname = current_user)`,
    ) as Array<{ nspname: string }>;
    if (schemas.length !== 3) {
      throw new Error('Run the administrator role/schema bootstrap before migrations');
    }
    verifyLedger(dataSource, await appliedMigrations(queryRunner));
    const executor = new MigrationExecutor(dataSource, queryRunner);
    executor.transaction = 'each';
    const applied = await executor.executePendingMigrations();
    console.info(`Applied ${applied.length} migration(s).`);
  });
}

async function showMigrations(): Promise<void> {
  await withMigrationConnection('show', async (dataSource, queryRunner) => {
    const applied = await appliedMigrations(queryRunner);
    verifyLedger(dataSource, applied);
    const appliedNames = new Set(applied.map((row) => row.name));
    for (const name of registeredNames(dataSource)) {
      console.info(`${appliedNames.has(name) ? 'applied' : 'pending'}  ${name}`);
    }
  });
}

async function revertLatest(confirm: string | undefined): Promise<void> {
  if (process.env.NODE_ENV !== 'development' && process.env.NODE_ENV !== 'test') {
    throw new Error('Migration rollback is restricted to development and test');
  }
  if (confirm !== 'REVERT_LATEST') {
    throw new Error('Pass REVERT_LATEST explicitly to confirm local rollback');
  }
  await withMigrationConnection('revert', async (dataSource, queryRunner) => {
    const applied = await appliedMigrations(queryRunner);
    verifyLedger(dataSource, applied);
    const latest = applied.at(-1);
    if (!latest) throw new Error('There is no applied migration to revert');
    const migration = dataSource.migrations.find((item) =>
      (item.name || item.constructor.name) === latest.name,
    ) as (typeof dataSource.migrations[number] & { safeToRevert?: boolean }) | undefined;
    if (!migration?.safeToRevert || latest.name === 'CreateDatabaseFoundation1792972800001') {
      throw new Error(`${latest.name} has no reviewed safe local rollback`);
    }
    const executor = new MigrationExecutor(dataSource, queryRunner);
    executor.transaction = 'each';
    await executor.undoLastMigration();
    console.info(`Reverted ${latest.name}.`);
  });
}

async function createEmptyMigration(name: string): Promise<void> {
  const timestamp = Date.now();
  const path = join(MIGRATIONS_DIR, `${timestamp}-${name}.ts`);
  const source = `import type { MigrationInterface, QueryRunner } from 'typeorm';\n\n` +
    `export class ${name}${timestamp} implements MigrationInterface {\n` +
    `  name = '${name}${timestamp}';\n` +
    `  readonly safeToRevert = false;\n\n` +
    `  async up(_queryRunner: QueryRunner): Promise<void> {\n` +
    `    throw new Error('Implement and review this migration before running it');\n` +
    `  }\n\n` +
    `  async down(_queryRunner: QueryRunner): Promise<void> {\n` +
    `    throw new Error('No reviewed rollback is available');\n` +
    `  }\n` +
    `}\n`;
  await mkdir(MIGRATIONS_DIR, { recursive: true });
  await writeFile(path, source, { flag: 'wx' });
  console.info(`Created ${path}`);
}

async function generateMigration(name: string): Promise<void> {
  await withMigrationConnection('generate', async (dataSource, queryRunner) => {
    const applied = await appliedMigrations(queryRunner);
    verifyLedger(dataSource, applied);
    const appliedNames = new Set(applied.map((row) => row.name));
    const pending = registeredNames(dataSource).filter((entry) => !appliedNames.has(entry));
    if (pending.length) {
      throw new Error('Apply and review pending migrations before generating a new diff');
    }
    if (!dataSource.entityMetadatas.some((metadata) => metadata.schema === 'identity')) {
      throw new Error('No service-owned identity entity metadata is registered');
    }
  });

  const cli = join(SOURCE_ROOT, 'node_modules', 'typeorm', 'cli.js');
  const dataSource = join(SOURCE_ROOT, 'src', 'database', 'data-source.ts');
  const target = join(MIGRATIONS_DIR, name);
  const child = spawn(
    process.execPath,
    ['--loader', 'ts-node/esm', cli, 'migration:generate', '-d', dataSource, target],
    { cwd: SOURCE_ROOT, stdio: 'inherit', shell: false },
  );
  const exitCode = await new Promise<number>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => resolve(code ?? 1));
  });
  if (exitCode !== 0) throw new Error(`TypeORM migration generation exited with ${exitCode}`);
}

async function main(): Promise<void> {
  const [command, argument] = process.argv.slice(2) as [MigrationCommand?, string?];
  switch (command) {
    case 'create':
      await createEmptyMigration(migrationName(argument ?? process.env.name));
      break;
    case 'generate':
      await generateMigration(migrationName(argument ?? process.env.name));
      break;
    case 'run':
      await runMigrations();
      break;
    case 'show':
      await showMigrations();
      break;
    case 'revert':
      await revertLatest(argument ?? process.env.confirm);
      break;
    default:
      throw new Error('Use create, generate, run, show, or revert');
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Migration command failed');
  process.exitCode = 1;
});
