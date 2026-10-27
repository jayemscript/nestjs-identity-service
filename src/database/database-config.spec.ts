import {
  createPgPoolConfig,
  createTypeOrmDatabaseOptions,
  parseDatabaseConfig,
} from './database-config.js';

describe('database connection profiles', () => {
  const valid = {
    NODE_ENV: 'development',
    DB_HOST: 'localhost',
    DB_PORT: '5432',
    DB_NAME: 'auth_db',
    DB_SSL: 'false',
    AUTH_DB_USER: 'auth_login',
    AUTH_DB_PASS: 'private-auth-value',
    IDENTITY_DB_USER: 'identity_login',
    IDENTITY_DB_PASS: 'private-identity-value',
    AUDIT_DB_USER: 'audit_login',
    AUDIT_DB_PASS: 'private-audit-value',
    MIGRATION_DB_USER: 'migration_login',
    MIGRATION_DB_PASS: 'private-migration-value',
    RETENTION_DB_USER: 'retention_login',
    RETENTION_DB_PASS: 'private-retention-value',
  };

  it('uses fixed schema-specific logins, budgets, and search paths', () => {
    expect(parseDatabaseConfig(valid, 'auth')).toMatchObject({
      username: 'auth_login',
      schema: 'auth',
      poolMax: 5,
    });
    expect(parseDatabaseConfig(valid, 'audit')).toMatchObject({
      username: 'audit_login',
      schema: 'audit',
      poolMax: 2,
    });
    expect(parseDatabaseConfig(valid, 'retention')).toMatchObject({
      username: 'retention_login',
      schema: 'identity',
      poolMax: 1,
    });
    const native = createPgPoolConfig(valid, 'auth');
    expect(native.options).toContain('search_path=auth');
    expect(native.options).not.toContain('public');
    const service = createTypeOrmDatabaseOptions(valid, 'identity', []);
    expect(service).toMatchObject({
      schema: 'identity',
      synchronize: false,
      migrationsRun: false,
      poolSize: 5,
    });
  });

  it.each([
    [{ ...valid, DB_PORT: '5432.5' }, 'DB_PORT'],
    [{ ...valid, DB_SSL: 'maybe' }, 'DB_SSL'],
    [{ ...valid, NODE_ENV: 'production' }, 'TLS'],
    [{ ...valid, DB_SSL: 'true' }, 'DB_CA_CERT'],
    [{ ...valid, AUTH_DB_SCHEMA: 'public' }, 'AUTH_DB_SCHEMA'],
    [{ ...valid, AUTH_DB_PASS: '' }, 'AUTH_DB_PASS'],
  ])(
    'rejects unsafe configuration without exposing credentials',
    (env, errorPart) => {
      expect(() => parseDatabaseConfig(env, 'auth')).toThrow(errorPart);
      try {
        parseDatabaseConfig(env, 'auth');
      } catch (error) {
        expect(String(error)).not.toContain('private-auth-value');
      }
    },
  );
});
