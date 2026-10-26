import { config as loadDotEnv } from 'dotenv';
import pg from 'pg';
import { v7 as uuidv7 } from 'uuid';
import { createPgPoolConfig } from '../database/database-config.js';

const databaseDescribe = process.env.RUN_DB_INTEGRATION === '1' ? describe : describe.skip;

databaseDescribe('PostgreSQL role separation', () => {
  let auth: pg.Pool;
  let identity: pg.Pool;
  let audit: pg.Pool;
  let retention: pg.Pool;

  beforeAll(() => {
    loadDotEnv({ quiet: true });
    auth = new pg.Pool(createPgPoolConfig(process.env, 'auth'));
    identity = new pg.Pool(createPgPoolConfig(process.env, 'identity'));
    audit = new pg.Pool(createPgPoolConfig(process.env, 'audit'));
    retention = new pg.Pool(createPgPoolConfig(process.env, 'retention'));
  });

  afterAll(async () => {
    await Promise.all([auth?.end(), identity?.end(), audit?.end(), retention?.end()]);
  });

  it('keeps native and service runtime connections in their own schemas', async () => {
    for (const [pool, expectedSchema] of [
      [auth, 'auth'], [identity, 'identity'], [audit, 'audit'], [retention, 'identity'],
    ] as const) {
      const result = await pool.query(
        `SELECT current_schema() AS schema_name,
                current_setting('search_path') AS search_path,
                has_schema_privilege(current_user, 'public', 'USAGE') AS public_usage,
                has_schema_privilege(current_user, 'public', 'CREATE') AS public_create`,
      );
      expect(result.rows[0]).toMatchObject({
        schema_name: expectedSchema,
        search_path: expectedSchema,
        public_usage: false,
        public_create: false,
      });
    }
    await auth.query('SELECT id FROM auth."user" LIMIT 0');
    await identity.query('SELECT id FROM identity.applications LIMIT 0');
    await expect(auth.query('SELECT id FROM identity.applications LIMIT 0'))
      .rejects.toMatchObject({ code: '42501' });
    await expect(identity.query('SELECT id FROM auth."user" LIMIT 0'))
      .rejects.toMatchObject({ code: '42501' });
  });

  it('denies runtime DDL and audit reads or changes', async () => {
    await expect(identity.query('CREATE TABLE identity.unapproved_probe (id integer)'))
      .rejects.toMatchObject({ code: '42501' });
    await expect(auth.query('CREATE TABLE auth.unapproved_probe (id integer)'))
      .rejects.toMatchObject({ code: '42501' });
    await expect(audit.query('SELECT id FROM audit.security_events LIMIT 0'))
      .rejects.toMatchObject({ code: '42501' });
    await expect(audit.query('UPDATE audit.security_events SET reason_code = NULL WHERE false'))
      .rejects.toMatchObject({ code: '42501' });
  });

  it('allows append-only audit writes and restricted maintenance reads', async () => {
    const client = await audit.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO audit.security_events
          (id, request_id, event_name, action, result)
         VALUES ($1, 'probe', 'database.probe', 'append', 'success')`,
        [uuidv7()],
      );
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
    await retention.query('SELECT id, ip_address, user_agent FROM audit.security_events LIMIT 0');
    await retention.query('SELECT id, "userId", "expiresAt" FROM auth."session" LIMIT 0');
    await retention.query('SELECT id, state, challenge_expires_at FROM identity.email_deliveries LIMIT 0');
    await expect(retention.query('SELECT metadata FROM audit.security_events LIMIT 0'))
      .rejects.toMatchObject({ code: '42501' });
    await expect(retention.query('SELECT token FROM auth."session" LIMIT 0'))
      .rejects.toMatchObject({ code: '42501' });
    await expect(retention.query('SELECT payload_ciphertext FROM identity.email_deliveries LIMIT 0'))
      .rejects.toMatchObject({ code: '42501' });
    await expect(retention.query('SELECT client_state_ciphertext FROM identity.mobile_auth_transactions LIMIT 0'))
      .rejects.toMatchObject({ code: '42501' });
    await expect(retention.query('SELECT mfa_method FROM identity.session_assurance LIMIT 0'))
      .rejects.toMatchObject({ code: '42501' });
    await expect(retention.query('SELECT flow_ref_hmac FROM identity.auth_flow_bindings LIMIT 0'))
      .rejects.toMatchObject({ code: '42501' });
    await expect(retention.query("UPDATE audit.security_events SET metadata = '{}'::jsonb WHERE false"))
      .rejects.toMatchObject({ code: '42501' });
  });
});
