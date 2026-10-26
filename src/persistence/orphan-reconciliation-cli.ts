/** Conservative cleanup for old assurance with absent, mismatched, or expired native sessions. */
import 'reflect-metadata';
import { config as loadDotEnv } from 'dotenv';
import { DataSource } from 'typeorm';
import { createTypeOrmDatabaseOptions } from '../database/database-config.js';
import { verifyMaintenanceProfile } from './maintenance-profile.js';
import { mutationRows } from './mutation-rows.js';

loadDotEnv({ quiet: true });

const BATCH_SIZE = 500;
const MAX_BATCHES = 20;
const GRACE_MS = 24 * 60 * 60 * 1000;

interface AssuranceCandidate {
  session_id: string;
  user_id: string;
  version: number;
  /** Text preserves PostgreSQL microseconds for the keyset cursor. */
  updated_at_cursor: string;
}

async function main(): Promise<void> {
  const retention = new DataSource(
    createTypeOrmDatabaseOptions(process.env, 'retention', []),
  );
  const cutoff = new Date(Date.now() - GRACE_MS);
  let scanned = 0;
  let removed = 0;
  let cursor: AssuranceCandidate | null = null;
  try {
    await retention.initialize();
    await verifyMaintenanceProfile(retention);
    await retention.query('SELECT id, "userId", "expiresAt" FROM auth."session" LIMIT 0');

    for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
      const candidates = await retention.query(
        `SELECT session_id, user_id, version,
                updated_at::text AS updated_at_cursor
         FROM identity.session_assurance
         WHERE updated_at < $1
           AND ($2::timestamptz IS NULL OR
                (updated_at, session_id) > ($2::timestamptz, $3::text))
         ORDER BY updated_at, session_id LIMIT $4`,
        [cutoff, cursor?.updated_at_cursor ?? null, cursor?.session_id ?? null, BATCH_SIZE],
      ) as AssuranceCandidate[];
      if (candidates.length === 0) break;
      scanned += candidates.length;

      const native = await retention.query(
        `SELECT id, "userId" AS user_id, "expiresAt" AS expires_at
         FROM auth."session"
         WHERE id = ANY($1::text[])`,
        [candidates.map((candidate) => candidate.session_id)],
      ) as Array<{ id: string; user_id: string; expires_at: Date }>;
      const nativeSessions = new Map(native.map((row) => [row.id, row]));
      for (const candidate of candidates) {
        const session = nativeSessions.get(candidate.session_id);
        if (session?.user_id === candidate.user_id &&
            session.expires_at.getTime() > cutoff.getTime()) {
          continue;
        }
        const deleted = mutationRows<{ session_id: string }>(await retention.query(
          `DELETE FROM identity.session_assurance
           WHERE session_id = $1 AND user_id = $2 AND version = $3
             AND updated_at < $4
           RETURNING session_id`,
          [candidate.session_id, candidate.user_id, candidate.version, cutoff],
        ));
        removed += deleted.length;
      }
      cursor = candidates.at(-1)!;
      if (candidates.length < BATCH_SIZE) break;
    }
    console.info(`old assurance rows scanned: ${scanned}; stale assurance rows removed: ${removed}`);
  } finally {
    if (retention.isInitialized) await retention.destroy();
  }
}

main().catch(() => {
  console.error('Orphan reconciliation failed; inspect restricted operational diagnostics');
  process.exitCode = 1;
});
