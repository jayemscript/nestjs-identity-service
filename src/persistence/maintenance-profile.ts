import type { DataSource } from 'typeorm';

/** Reject a misprovisioned cleanup credential before it touches retained data. */
export async function verifyMaintenanceProfile(source: DataSource): Promise<void> {
  const rows = await source.query(`
    SELECT current_schema() AS schema_name,
           has_schema_privilege(current_user, 'public', 'USAGE')
             OR has_schema_privilege(current_user, 'public', 'CREATE')
             AS public_access,
           has_schema_privilege(current_user, 'identity', 'CREATE')
             OR has_schema_privilege(current_user, 'audit', 'CREATE')
             AS can_create,
           has_column_privilege(current_user, 'auth."session"', 'token', 'SELECT')
             AS native_token_read
  `) as Array<{
    schema_name: string | null;
    public_access: boolean;
    can_create: boolean;
    native_token_read: boolean;
  }>;
  const row = rows[0];
  if (row?.schema_name !== 'identity' || row.public_access || row.can_create ||
      row.native_token_read) {
    throw new Error('Maintenance database privilege profile is invalid');
  }
}
