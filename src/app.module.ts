import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { parseRuntimeConfig } from './config/runtime-config.js';
import { HealthController } from './health/health.controller.js';
import { PersistenceModule } from './persistence/persistence.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: parseRuntimeConfig,
    }),
    PersistenceModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
