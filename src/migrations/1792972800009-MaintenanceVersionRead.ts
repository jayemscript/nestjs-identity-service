import type { MigrationInterface, QueryRunner } from 'typeorm';

/** The bounded expiry update increments version and needs to read its old value. */
export class MaintenanceVersionRead1792972800009 implements MigrationInterface {
  name = 'MaintenanceVersionRead1792972800009';
  readonly safeToRevert = false;

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      GRANT SELECT (version) ON identity.email_deliveries
        TO identity_retention_maintenance;
    `);
  }

  down(): Promise<void> {
    return Promise.reject(
      new Error('Use a reviewed forward migration for maintenance privileges'),
    );
  }
}
