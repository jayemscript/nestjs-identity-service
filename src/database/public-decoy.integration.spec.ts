import { config as loadDotEnv } from 'dotenv';
import pg from 'pg';
import { v7 as uuidv7 } from 'uuid';
import { createPgPoolConfig } from './database-config.js';

const adminDescribe =
  process.env.RUN_DB_ADMIN_INTEGRATION === '1' ? describe : describe.skip;

adminDescribe('public-schema decoy isolation', () => {
  it('keeps identity lookups on identity when public has the same table name', async () => {
    loadDotEnv({ quiet: true });
    if (!process.env.DB_USER || !process.env.DB_PASS) {
      throw new Error(
        'Local database administrator credentials are required for this probe',
      );
    }
    const config = createPgPoolConfig(process.env, 'migration');
    const pool = new pg.Pool({
      ...config,
      user: process.env.DB_USER,
      password: process.env.DB_PASS,
      max: 1,
    });
    const client = await pool.connect();
    const decoyId = uuidv7();
    try {
      const existing = await client.query<{ relation: string | null }>(
        "SELECT to_regclass('public.applications') AS relation",
      );
      if (existing.rows[0]?.relation) {
        throw new Error(
          'A public applications table already exists; leave it untouched',
        );
      }
      await client.query('BEGIN');
      try {
        await client.query(
          'CREATE TABLE public.applications (id uuid PRIMARY KEY)',
        );
        await client.query('INSERT INTO public.applications (id) VALUES ($1)', [
          decoyId,
        ]);
        // Temporarily expose this decoy to prove schema-qualified lookups stay
        // on identity even under an intentionally hostile search path.
        await client.query(
          'GRANT USAGE ON SCHEMA public TO identity_policy_runtime',
        );
        await client.query(
          'GRANT SELECT ON public.applications TO identity_policy_runtime',
        );
        await client.query('SET LOCAL ROLE identity_policy_runtime');
        await client.query('SET LOCAL search_path = public, identity');
        const schema = await client.query<{ schema_name: string | null }>(
          'SELECT current_schema() AS schema_name',
        );
        expect(schema.rows[0].schema_name).toBe('public');
        const qualified = await client.query(
          'SELECT id FROM identity.applications WHERE id = $1',
          [decoyId],
        );
        const unqualified = await client.query(
          'SELECT id FROM applications WHERE id = $1',
          [decoyId],
        );
        expect(qualified.rows).toHaveLength(0);
        expect(unqualified.rows).toHaveLength(1);
      } finally {
        await client.query('ROLLBACK');
      }
      const removed = await client.query<{ relation: string | null }>(
        "SELECT to_regclass('public.applications') AS relation",
      );
      expect(removed.rows[0].relation).toBeNull();
    } finally {
      client.release();
      await pool.end();
    }
  });
});
