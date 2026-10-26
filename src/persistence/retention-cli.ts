/** Restricted, bounded cleanup job; run separately from the HTTP service. */
import 'reflect-metadata';
import { config as loadDotEnv } from 'dotenv';
import { DataSource } from 'typeorm';
import { createTypeOrmDatabaseOptions } from '../database/database-config.js';
import { verifyMaintenanceProfile } from './maintenance-profile.js';
import { mutationRows } from './mutation-rows.js';

loadDotEnv({ quiet: true });

const BATCH_SIZE = 500;
const MAX_BATCHES = 20;

async function sweep(dataSource: DataSource, label: string, sql: string): Promise<void> {
  let total = 0;
  for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
    let rows: Array<{ id: string }>;
    try {
      rows = mutationRows<{ id: string }>(await dataSource.query(sql, [BATCH_SIZE]));
    } catch {
      throw new Error(`${label} sweep failed`);
    }
    total += rows.length;
    if (rows.length < BATCH_SIZE) break;
  }
  console.info(`${label}: ${total}`);
}

async function main(): Promise<void> {
  const source = new DataSource(
    createTypeOrmDatabaseOptions(process.env, 'retention', []),
  );
  try {
    await source.initialize();
    await verifyMaintenanceProfile(source);
    await sweep(source, 'expired delivery payloads', `
      WITH due AS (
        SELECT id FROM identity.email_deliveries
        WHERE challenge_expires_at <= now()
          AND (state IN ('queued', 'retry_wait') OR
            (state = 'leased' AND lease_until <= now()))
        ORDER BY challenge_expires_at LIMIT $1
      )
      UPDATE identity.email_deliveries d
      SET state = 'expired', payload_ciphertext = NULL, payload_iv = NULL,
          payload_tag = NULL, payload_key_id = NULL,
          lease_owner = NULL, lease_until = NULL,
          terminal_at = now(), version = version + 1, updated_at = now()
      FROM due WHERE d.id = due.id RETURNING d.id`);

    await sweep(source, 'restricted network fields purged', `
      WITH due AS (
        SELECT id FROM audit.security_events
        WHERE occurred_at < now() - interval '30 days'
          AND (ip_address IS NOT NULL OR user_agent IS NOT NULL)
        ORDER BY occurred_at, id LIMIT $1
      )
      UPDATE audit.security_events e
      SET ip_address = NULL, user_agent = NULL
      FROM due WHERE e.id = due.id RETURNING e.id`);

    await sweep(source, 'old audit events deleted', `
      WITH due AS (
        SELECT id FROM audit.security_events
        WHERE occurred_at < now() - interval '90 days'
        ORDER BY occurred_at, id LIMIT $1
      )
      DELETE FROM audit.security_events e USING due
      WHERE e.id = due.id RETURNING e.id`);

    await sweep(source, 'terminal deliveries deleted', `
      WITH due AS (
        SELECT id FROM identity.email_deliveries
        WHERE terminal_at < now() - interval '30 days'
        ORDER BY terminal_at, id LIMIT $1
      )
      DELETE FROM identity.email_deliveries d USING due
      WHERE d.id = due.id RETURNING d.id`);

    await sweep(source, 'expired mobile transactions deleted', `
      WITH due AS (
        SELECT id FROM identity.mobile_auth_transactions
        WHERE expires_at < now() - interval '1 day'
        ORDER BY expires_at, id LIMIT $1
      )
      DELETE FROM identity.mobile_auth_transactions t USING due
      WHERE t.id = due.id RETURNING t.id`);

    await sweep(source, 'expired primary assurance deleted', `
      WITH due AS (
        SELECT session_id FROM identity.session_assurance
        WHERE state = 'primary_only'
          AND pending_expires_at < now() - interval '1 day'
        ORDER BY pending_expires_at, session_id LIMIT $1
      )
      DELETE FROM identity.session_assurance s USING due
      WHERE s.session_id = due.session_id RETURNING s.session_id AS id`);

    await sweep(source, 'expired flow bindings deleted', `
      WITH due AS (
        SELECT id FROM identity.auth_flow_bindings
        WHERE expires_at < now()
        ORDER BY expires_at, id LIMIT $1
      )
      DELETE FROM identity.auth_flow_bindings f USING due
      WHERE f.id = due.id RETURNING f.id`);

    await sweep(source, 'expired abuse windows deleted', `
      WITH due AS (
        SELECT scope, subject_hmac, window_start FROM identity.abuse_windows
        WHERE expires_at < now() LIMIT $1
      )
      DELETE FROM identity.abuse_windows w USING due
      WHERE (w.scope, w.subject_hmac, w.window_start) =
        (due.scope, due.subject_hmac, due.window_start)
      RETURNING w.scope AS id`);

    await sweep(source, 'expired replay claims deleted', `
      WITH due AS (
        SELECT user_id, code_fingerprint FROM identity.mfa_replay_claims
        WHERE expires_at < now() LIMIT $1
      )
      DELETE FROM identity.mfa_replay_claims c USING due
      WHERE (c.user_id, c.code_fingerprint) = (due.user_id, due.code_fingerprint)
      RETURNING c.user_id AS id`);

    await sweep(source, 'expired operation leases deleted', `
      WITH due AS (
        SELECT resource, lease_key FROM identity.operation_leases
        WHERE lease_until < now() LIMIT $1
      )
      DELETE FROM identity.operation_leases l USING due
      WHERE (l.resource, l.lease_key) = (due.resource, due.lease_key)
      RETURNING l.resource AS id`);
  } finally {
    if (source.isInitialized) await source.destroy();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Retention job failed');
  process.exitCode = 1;
});
