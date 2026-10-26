import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Only the restricted job may purge aged metadata and expired ciphertext. */
export class MaintenancePrivileges1792972800006 implements MigrationInterface {
  name = 'MaintenancePrivileges1792972800006';
  readonly safeToRevert = false;

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      GRANT SELECT (ip_address, user_agent)
        ON audit.security_events TO identity_retention_maintenance;
      GRANT UPDATE (state, payload_ciphertext, payload_iv, payload_tag,
        payload_key_id, terminal_at, lease_owner, lease_until,
        version, updated_at)
        ON identity.email_deliveries TO identity_retention_maintenance;
    `);
  }

  async down(): Promise<void> {
    throw new Error('Use a reviewed forward migration for retention privileges');
  }
}
