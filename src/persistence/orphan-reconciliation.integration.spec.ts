import 'reflect-metadata';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { config as loadDotEnv } from 'dotenv';
import pg from 'pg';
import { DataSource } from 'typeorm';
import { v7 as uuidv7 } from 'uuid';
import { createPgPoolConfig, createTypeOrmDatabaseOptions } from '../database/database-config.js';

const maintenanceDescribe = process.env.RUN_DB_MAINTENANCE_INTEGRATION === '1'
  ? describe : describe.skip;

function runReconciliation(): Promise<{ code: number; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['--loader', 'ts-node/esm', 'src/persistence/orphan-reconciliation-cli.ts'],
      { cwd: process.cwd(), env: process.env, shell: false },
    );
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString(); });
    child.stderr.on('data', (chunk: Buffer) => { output += chunk.toString(); });
    child.once('error', reject);
    child.once('close', (code) => resolve({ code: code ?? 1, output }));
  });
}

maintenanceDescribe('native session orphan reconciliation', () => {
  it('removes absent and expired assurance while preserving a live native session', async () => {
    loadDotEnv({ quiet: true });
    const source = new DataSource(createTypeOrmDatabaseOptions(process.env, 'identity', []));
    const auth = new pg.Pool(createPgPoolConfig(process.env, 'auth'));
    const applicationId = uuidv7();
    const suffix = randomBytes(24).toString('base64url');
    const userId = `user-${suffix}`;
    const expiredSessionId = `expired-probe-${suffix}`;
    const liveSessionId = `live-probe-${suffix}`;
    try {
      await source.initialize();
      await source.query(
        `INSERT INTO identity.applications
          (id, slug, name, public_origin, status)
         VALUES ($1, $2, 'Orphan probe', $3, 'active')`,
        [applicationId, `probe-${applicationId}`, `https://auth-${applicationId}.example`],
      );
      await source.query(
        `INSERT INTO identity.session_assurance
          (session_id, user_id, application_id, security_epoch, primary_method,
           pending_expires_at, updated_at)
         SELECT $1 || n::text, $2, $3, 1, 'password',
                now() + interval '1 hour', now() - interval '2 days'
         FROM generate_series(1, 501) AS n`,
        [`orphan-probe-${suffix}-`, userId, applicationId],
      );
      await auth.query(
        `INSERT INTO auth."user" ("id", "name", "email", "emailVerified")
         VALUES ($1, 'Reconciliation probe', $2, true)`,
        [userId, `probe-${suffix}@example.test`],
      );
      await auth.query(
        `INSERT INTO auth."session"
           ("id", "expiresAt", "token", "updatedAt", "userId")
         VALUES ($1, now() - interval '2 days', $2, now() - interval '2 days', $3),
                ($4, now() + interval '1 day', $5, now(), $3)`,
        [expiredSessionId, `token-expired-${suffix}`, userId,
          liveSessionId, `token-live-${suffix}`],
      );
      await source.query(
        `INSERT INTO identity.session_assurance
          (session_id, user_id, application_id, security_epoch, state,
           primary_method, pending_expires_at, updated_at)
         VALUES ($1, $3, $4, 1, 'verified', 'password',
                 now() + interval '1 hour', now() - interval '2 days'),
                ($2, $3, $4, 1, 'verified', 'password',
                 now() + interval '1 hour', now() - interval '2 days')`,
        [expiredSessionId, liveSessionId, userId, applicationId],
      );

      const result = await runReconciliation();
      expect(result.code).toBe(0);
      const removed = /stale assurance rows removed: (\d+)/.exec(result.output);
      expect(removed).not.toBeNull();
      expect(Number(removed?.[1])).toBeGreaterThanOrEqual(502);
      const rows = await source.query(
        'SELECT session_id FROM identity.session_assurance WHERE application_id = $1',
        [applicationId],
      ) as Array<{ session_id: string }>;
      expect(rows).toEqual([{ session_id: liveSessionId }]);
    } finally {
      if (source.isInitialized) {
        await source.query('DELETE FROM identity.session_assurance WHERE application_id = $1', [applicationId]);
        await source.query('DELETE FROM identity.applications WHERE id = $1', [applicationId]);
        await source.destroy();
      }
      await auth.query('DELETE FROM auth."session" WHERE id = ANY($1::text[])', [[expiredSessionId, liveSessionId]]);
      await auth.query('DELETE FROM auth."user" WHERE id = $1', [userId]);
      await auth.end();
    }
  }, 30_000);
});
