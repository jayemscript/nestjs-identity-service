import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { createTypeOrmDatabaseOptions } from './database-config.js';
import { SERVICE_ENTITIES } from './entities/index.js';

config({ quiet: true });

export const AppDataSource = new DataSource({
  ...createTypeOrmDatabaseOptions(
    process.env,
    'migration',
    SERVICE_ENTITIES,
  ),
  migrations: [fileURLToPath(new URL('../migrations/*.{ts,js}', import.meta.url))],
});
