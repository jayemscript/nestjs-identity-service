import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { AuditDataSourceService } from './audit-data-source.service.js';
import { AuditWriter } from './audit-writer.service.js';
import { AdminOperationStore } from './admin-operation-store.service.js';
import { DeliveryQueueStore } from './delivery-queue-store.service.js';
import { IdentityRepository } from './identity-repository.service.js';
import { MobileTransactionStore } from './mobile-transaction-store.service.js';
import { NativePoolService } from './native-pool.service.js';
import { ReadinessService } from './readiness.service.js';

@Module({
  imports: [DatabaseModule],
  providers: [
    NativePoolService,
    AuditDataSourceService,
    AuditWriter,
    AdminOperationStore,
    IdentityRepository,
    DeliveryQueueStore,
    MobileTransactionStore,
    ReadinessService,
  ],
  exports: [
    NativePoolService,
    AuditWriter,
    AdminOperationStore,
    IdentityRepository,
    DeliveryQueueStore,
    MobileTransactionStore,
    ReadinessService,
  ],
})
export class PersistenceModule {}
