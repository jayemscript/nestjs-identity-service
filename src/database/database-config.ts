import type { ConfigService } from '@nestjs/config';
import type { PoolConfig } from 'pg';
import type { DataSourceOptions } from 'typeorm';

export type DatabaseProfile =
  'auth' | 'identity' | 'audit' | 'retention' | 'migration';

export interface DatabaseConnectionConfig {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  schema: 'auth' | 'identity' | 'audit';
  ssl: false | { rejectUnauthorized: true; ca: string };
  poolMax: number;
  connectionTimeoutMillis: number;
  statementTimeoutMs: number;
  lockTimeoutMs: number;
  idleTransactionTimeoutMs: number;
}

const PROFILES = {
  auth: { prefix: 'AUTH', schema: 'auth', max: 5 },
  identity: { prefix: 'IDENTITY', schema: 'identity', max: 5 },
  audit: { prefix: 'AUDIT', schema: 'audit', max: 2 },
  retention: { prefix: 'RETENTION', schema: 'identity', max: 1 },
  migration: { prefix: 'MIGRATION', schema: 'identity', max: 1 },
} as const;

const DATABASE_ENV_KEYS = [
  'NODE_ENV',
  'DB_HOST',
  'DB_PORT',
  'DB_NAME',
  'DB_SSL',
  'DB_CA_CERT',
  'AUTH_DB_USER',
  'AUTH_DB_PASS',
  'AUTH_DB_SCHEMA',
  'IDENTITY_DB_USER',
  'IDENTITY_DB_PASS',
  'IDENTITY_DB_SCHEMA',
  'AUDIT_DB_USER',
  'AUDIT_DB_PASS',
  'AUDIT_DB_SCHEMA',
  'RETENTION_DB_USER',
  'RETENTION_DB_PASS',
  'MIGRATION_DB_USER',
  'MIGRATION_DB_PASS',
] as const;

function required(env: Record<string, unknown>, key: string): string {
  const value = env[key];
  const hasControlCharacter =
    typeof value === 'string' &&
    Array.from(value).some((character) => {
      const codeUnit = character.charCodeAt(0);
      return codeUnit < 32 || codeUnit === 127;
    });
  if (typeof value !== 'string' || !value.trim() || hasControlCharacter) {
    throw new Error(`${key} must be a nonempty string`);
  }
  return value;
}

function fixedSchema(
  env: Record<string, unknown>,
  key: string,
  expected: 'auth' | 'identity' | 'audit',
): void {
  const configured = env[key];
  if (configured !== undefined && configured !== expected) {
    throw new Error(`${key} must be ${expected}`);
  }
}

export function databaseEnvFromConfigService(
  config: ConfigService,
): Record<string, unknown> {
  return Object.fromEntries(
    DATABASE_ENV_KEYS.map((key) => [key, config.get(key)]),
  );
}

export function parseDatabaseConfig(
  env: Record<string, unknown>,
  profile: DatabaseProfile,
): DatabaseConnectionConfig {
  const selected = PROFILES[profile];
  const portInput = required(env, 'DB_PORT');
  const port = Number(portInput);
  if (!/^\d{1,5}$/.test(portInput) || port < 1 || port > 65535) {
    throw new Error('DB_PORT must be an integer between 1 and 65535');
  }

  fixedSchema(env, 'AUTH_DB_SCHEMA', 'auth');
  fixedSchema(env, 'IDENTITY_DB_SCHEMA', 'identity');
  fixedSchema(env, 'AUDIT_DB_SCHEMA', 'audit');

  const sslFlag = env.DB_SSL;
  if (sslFlag !== 'true' && sslFlag !== 'false') {
    throw new Error('DB_SSL must be true or false');
  }
  if (env.NODE_ENV === 'production' && sslFlag !== 'true') {
    throw new Error('Production database connections require verified TLS');
  }
  const caInput = env.DB_CA_CERT;
  const ca =
    sslFlag === 'true' && typeof caInput === 'string'
      ? caInput.replace(/\\n/g, '\n')
      : undefined;
  if (sslFlag === 'true' && !ca) {
    throw new Error('DB_CA_CERT is required for verified TLS');
  }
  if (
    ca &&
    (!ca.includes('-----BEGIN CERTIFICATE-----') ||
      !ca.includes('-----END CERTIFICATE-----'))
  ) {
    throw new Error('DB_CA_CERT must contain a PEM certificate');
  }

  return {
    host: required(env, 'DB_HOST'),
    port,
    database: required(env, 'DB_NAME'),
    username: required(env, `${selected.prefix}_DB_USER`),
    password: required(env, `${selected.prefix}_DB_PASS`),
    schema: selected.schema,
    ssl: ca ? { rejectUnauthorized: true, ca } : false,
    poolMax: selected.max,
    connectionTimeoutMillis: 5_000,
    statementTimeoutMs: profile === 'migration' ? 300_000 : 5_000,
    lockTimeoutMs: profile === 'migration' ? 10_000 : 2_000,
    idleTransactionTimeoutMs: profile === 'migration' ? 60_000 : 10_000,
  };
}

function startupOptions(config: DatabaseConnectionConfig): string {
  return [
    `-c search_path=${config.schema}`,
    `-c statement_timeout=${config.statementTimeoutMs}`,
    `-c lock_timeout=${config.lockTimeoutMs}`,
    `-c idle_in_transaction_session_timeout=${config.idleTransactionTimeoutMs}`,
  ].join(' ');
}

export function createPgPoolConfig(
  env: Record<string, unknown>,
  profile: DatabaseProfile,
): PoolConfig {
  const config = parseDatabaseConfig(env, profile);
  return {
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.username,
    password: config.password,
    ssl: config.ssl,
    max: config.poolMax,
    connectionTimeoutMillis: config.connectionTimeoutMillis,
    options: startupOptions(config),
    application_name: `identity-service-${profile}`,
  };
}

export function createTypeOrmDatabaseOptions(
  env: Record<string, unknown>,
  profile: 'identity' | 'audit' | 'retention' | 'migration',
  entities: DataSourceOptions['entities'] = [],
): DataSourceOptions {
  const config = parseDatabaseConfig(env, profile);
  return {
    type: 'postgres',
    host: config.host,
    port: config.port,
    username: config.username,
    password: config.password,
    database: config.database,
    schema: config.schema,
    ssl: config.ssl,
    entities,
    synchronize: false,
    migrationsRun: false,
    migrationsTableName: 'schema_migrations',
    migrationsTransactionMode: 'each',
    poolSize: config.poolMax,
    extra: {
      max: config.poolMax,
      connectionTimeoutMillis: config.connectionTimeoutMillis,
      options: startupOptions(config),
      application_name: `identity-service-${profile}`,
    },
  };
}
