import { Module, Global } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { DatabaseService } from './database.service.js';
import {
  createTypeOrmDatabaseOptions,
  databaseEnvFromConfigService,
} from './database-config.js';
import { IDENTITY_ENTITIES } from './entities/index.js';

@Global()
@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) =>
        createTypeOrmDatabaseOptions(
          databaseEnvFromConfigService(configService),
          'identity',
          IDENTITY_ENTITIES,
        ),
    }),
  ],
  providers: [DatabaseService],
  exports: [DatabaseService, TypeOrmModule],
})
export class DatabaseModule {}
