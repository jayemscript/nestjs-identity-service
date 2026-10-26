import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Use PostgreSQL's array literal form so reviewed ORM metadata has no diff. */
export class AlignArrayDefault1792972800005 implements MigrationInterface {
  name = 'AlignArrayDefault1792972800005';
  readonly safeToRevert = true;

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      "ALTER TABLE identity.applications ALTER COLUMN allowed_transports SET DEFAULT '{cookie}'::text[]",
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      "ALTER TABLE identity.applications ALTER COLUMN allowed_transports SET DEFAULT ARRAY['cookie']::text[]",
    );
  }
}
