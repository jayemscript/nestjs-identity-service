import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import {
  createTypeOrmDatabaseOptions,
  databaseEnvFromConfigService,
} from '../database/database-config.js';

/** Separate insert-only audit connection. No native or identity credentials are reused. */
@Injectable()
export class AuditDataSourceService implements OnModuleInit, OnModuleDestroy {
  private readonly dataSource: DataSource;

  constructor(config: ConfigService) {
    this.dataSource = new DataSource(
      createTypeOrmDatabaseOptions(
        databaseEnvFromConfigService(config),
        'audit',
        [],
      ),
    );
  }

  getDataSource(): DataSource {
    return this.dataSource;
  }

  async onModuleInit(): Promise<void> {
    await this.dataSource.initialize();
  }

  async ping(): Promise<void> {
    const rows = await this.dataSource.query<
      Array<{
        schema_name: string | null;
        can_append: boolean;
        can_change: boolean;
        can_create: boolean;
        foreign_schema: boolean;
        public_access: boolean;
      }>
    >(
      `SELECT current_schema() AS schema_name,
              has_table_privilege(current_user, 'audit.security_events', 'INSERT') AS can_append,
              has_table_privilege(current_user, 'audit.security_events', 'SELECT')
                OR has_table_privilege(current_user, 'audit.security_events', 'UPDATE')
                OR has_table_privilege(current_user, 'audit.security_events', 'DELETE')
                AS can_change,
              has_schema_privilege(current_user, 'audit', 'CREATE') AS can_create,
              has_schema_privilege(current_user, 'auth', 'USAGE')
                OR has_schema_privilege(current_user, 'identity', 'USAGE')
                AS foreign_schema,
              has_schema_privilege(current_user, 'public', 'USAGE')
                OR has_schema_privilege(current_user, 'public', 'CREATE')
                AS public_access`,
    );
    const row = rows[0];
    if (
      row?.schema_name !== 'audit' ||
      !row.can_append ||
      row.can_change ||
      row.can_create ||
      row.foreign_schema ||
      row.public_access
    ) {
      throw new Error('Audit database privilege profile is invalid');
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.dataSource.isInitialized) await this.dataSource.destroy();
  }
}
