import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Requires the NOLOGIN privilege roles from scripts/database/bootstrap-roles.sql.
 * The migration job itself owns these schemas and every object created later.
 */
export class CreateDatabaseFoundation1792972800001
  implements MigrationInterface
{
  name = 'CreateDatabaseFoundation1792972800001';
  readonly safeToRevert = false;

  async up(queryRunner: QueryRunner): Promise<void> {
    // The DBA bootstrap creates these schemas with this migration login as owner.
    // No database-wide CREATE or cluster role administration is needed here.
    // The administrator bootstrap revokes PUBLIC access to public. The
    // migration login does not own that schema, so it cannot do that here.
    await queryRunner.query(`
      GRANT USAGE ON SCHEMA auth TO identity_auth_runtime;
      GRANT USAGE ON SCHEMA identity TO identity_policy_runtime,
        identity_retention_maintenance;
      GRANT USAGE ON SCHEMA audit TO identity_audit_runtime,
        identity_audit_reader, identity_retention_maintenance;

      REVOKE ALL ON identity.schema_migrations FROM PUBLIC;
      GRANT SELECT ON identity.schema_migrations TO identity_policy_runtime;

      ALTER DEFAULT PRIVILEGES IN SCHEMA auth
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO identity_auth_runtime;
      ALTER DEFAULT PRIVILEGES IN SCHEMA auth
        GRANT USAGE, SELECT ON SEQUENCES TO identity_auth_runtime;

      ALTER DEFAULT PRIVILEGES IN SCHEMA identity
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO identity_policy_runtime;
      ALTER DEFAULT PRIVILEGES IN SCHEMA identity
        GRANT USAGE, SELECT ON SEQUENCES TO identity_policy_runtime;

      ALTER DEFAULT PRIVILEGES IN SCHEMA audit
        GRANT INSERT ON TABLES TO identity_audit_runtime;
      ALTER DEFAULT PRIVILEGES IN SCHEMA audit
        GRANT SELECT ON TABLES TO identity_audit_reader;
    `);

    // CONNECT grants are also part of the administrator bootstrap because
    // this migration login is not the database owner.
  }

  async down(): Promise<void> {
    throw new Error('The database foundation cannot be reverted');
  }
}
