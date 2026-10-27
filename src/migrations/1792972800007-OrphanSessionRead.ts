import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Narrow native-session lookup for the separate retention/orphan job. */
export class OrphanSessionRead1792972800007 implements MigrationInterface {
  name = 'OrphanSessionRead1792972800007';
  readonly safeToRevert = false;

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      GRANT USAGE ON SCHEMA auth TO identity_retention_maintenance;
      GRANT SELECT (id, "userId") ON auth."session"
        TO identity_retention_maintenance;
    `);
  }

  down(): Promise<void> {
    return Promise.reject(
      new Error(
        'Use a reviewed forward migration for reconciliation privileges',
      ),
    );
  }
}
