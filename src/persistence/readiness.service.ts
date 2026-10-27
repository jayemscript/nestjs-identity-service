import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';
import { AuditDataSourceService } from './audit-data-source.service.js';
import { NativePoolService } from './native-pool.service.js';

const REQUIRED_MIGRATIONS = [
  'CreateDatabaseFoundation1792972800001',
  'NativeAuth1792972800002',
  'CoreIdentity1792972800003',
  'WorkflowAudit1792972800004',
  'AlignArrayDefault1792972800005',
  'MaintenancePrivileges1792972800006',
  'OrphanSessionRead1792972800007',
  'NarrowMaintenanceReads1792972800008',
  'MaintenanceVersionRead1792972800009',
] as const;

@Injectable()
export class ReadinessService {
  private draining = false;

  constructor(
    private readonly identity: DatabaseService,
    private readonly native: NativePoolService,
    private readonly audit: AuditDataSourceService,
  ) {}

  withdraw(): void {
    this.draining = true;
  }

  async isReady(): Promise<boolean> {
    if (this.draining) return false;
    try {
      const [identityRows] = await Promise.all([
        this.identity.getDataSource().query<
          Array<{
            schema_name: string | null;
            applied_count: number;
            policy_access: boolean;
            can_create: boolean;
            foreign_schema: boolean;
            public_access: boolean;
          }>
        >(
          `SELECT current_schema() AS schema_name,
                  (SELECT count(DISTINCT name)::integer
                   FROM identity.schema_migrations
                   WHERE name = ANY($1::text[])) AS applied_count,
                  has_table_privilege(current_user, 'identity.account_policies', 'SELECT')
                    AND has_table_privilege(current_user, 'identity.session_assurance', 'SELECT')
                    AND has_table_privilege(current_user, 'identity.email_deliveries', 'UPDATE')
                    AS policy_access,
                  has_schema_privilege(current_user, 'identity', 'CREATE') AS can_create,
                  has_schema_privilege(current_user, 'auth', 'USAGE')
                    OR has_schema_privilege(current_user, 'audit', 'USAGE')
                    AS foreign_schema,
                  has_schema_privilege(current_user, 'public', 'USAGE')
                    OR has_schema_privilege(current_user, 'public', 'CREATE')
                    AS public_access`,
          [REQUIRED_MIGRATIONS],
        ),
        this.native.ping(),
        this.audit.ping(),
      ]);
      const row = identityRows[0];
      return (
        row?.schema_name === 'identity' &&
        row.policy_access &&
        !row.can_create &&
        !row.foreign_schema &&
        !row.public_access &&
        row.applied_count === REQUIRED_MIGRATIONS.length
      );
    } catch {
      return false;
    }
  }
}
