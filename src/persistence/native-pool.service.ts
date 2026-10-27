import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import pg from 'pg';
import {
  createPgPoolConfig,
  databaseEnvFromConfigService,
} from '../database/database-config.js';

/** The native authentication library owns this pool and its auth-only search path. */
@Injectable()
export class NativePoolService implements OnModuleInit, OnModuleDestroy {
  private readonly pool: pg.Pool;

  constructor(config: ConfigService) {
    this.pool = new pg.Pool(
      createPgPoolConfig(databaseEnvFromConfigService(config), 'auth'),
    );
  }

  getPool(): pg.Pool {
    return this.pool;
  }

  async onModuleInit(): Promise<void> {
    await this.ping();
  }

  async ping(): Promise<void> {
    const connection = await this.pool.connect();
    try {
      const result = await connection.query<{
        schema_name: string | null;
        native_read: boolean;
        native_write: boolean;
        foreign_schema: boolean;
        can_create: boolean;
        public_access: boolean;
      }>(
        `SELECT current_schema() AS schema_name,
                has_table_privilege(current_user, 'auth."user"', 'SELECT')
                  AND has_table_privilege(current_user, 'auth."session"', 'SELECT')
                  AS native_read,
                has_table_privilege(current_user, 'auth."verification"', 'INSERT')
                  AS native_write,
                has_schema_privilege(current_user, 'identity', 'USAGE')
                  OR has_schema_privilege(current_user, 'audit', 'USAGE')
                  AS foreign_schema,
                has_schema_privilege(current_user, 'auth', 'CREATE') AS can_create,
                has_schema_privilege(current_user, 'public', 'USAGE')
                  OR has_schema_privilege(current_user, 'public', 'CREATE')
                  AS public_access`,
      );
      const row = result.rows[0];
      if (
        row?.schema_name !== 'auth' ||
        !row.native_read ||
        !row.native_write ||
        row.foreign_schema ||
        row.can_create ||
        row.public_access
      ) {
        throw new Error('Native database privilege profile is invalid');
      }
    } finally {
      connection.release();
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
