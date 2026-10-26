import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Restrict cleanup reads to predicate and cursor columns; never expose ciphertext. */
export class NarrowMaintenanceReads1792972800008 implements MigrationInterface {
  name = 'NarrowMaintenanceReads1792972800008';
  readonly safeToRevert = false;

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      REVOKE SELECT ON
        identity.email_deliveries, identity.mobile_auth_transactions,
        identity.session_assurance, identity.auth_flow_bindings,
        identity.abuse_windows, identity.mfa_replay_claims,
        identity.operation_leases
      FROM identity_retention_maintenance;

      GRANT SELECT (id, challenge_expires_at, state, lease_until, terminal_at)
        ON identity.email_deliveries TO identity_retention_maintenance;
      GRANT SELECT (id, expires_at)
        ON identity.mobile_auth_transactions TO identity_retention_maintenance;
      GRANT SELECT (session_id, user_id, version, updated_at, state, pending_expires_at)
        ON identity.session_assurance TO identity_retention_maintenance;
      GRANT SELECT (id, expires_at)
        ON identity.auth_flow_bindings TO identity_retention_maintenance;
      GRANT SELECT (scope, subject_hmac, window_start, expires_at)
        ON identity.abuse_windows TO identity_retention_maintenance;
      GRANT SELECT (user_id, code_fingerprint, expires_at)
        ON identity.mfa_replay_claims TO identity_retention_maintenance;
      GRANT SELECT (resource, lease_key, lease_until)
        ON identity.operation_leases TO identity_retention_maintenance;

      GRANT SELECT ("expiresAt") ON auth."session"
        TO identity_retention_maintenance;
      REVOKE UPDATE (actor_id, user_id, target_reference, metadata)
        ON audit.security_events FROM identity_retention_maintenance;
    `);
  }

  async down(): Promise<void> {
    throw new Error('Use a reviewed forward migration for maintenance privileges');
  }
}
