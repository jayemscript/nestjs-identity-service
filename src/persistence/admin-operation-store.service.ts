import { Injectable } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import { DatabaseService } from '../database/database.service.js';
import { mutationRows } from './mutation-rows.js';

export type AdminOperationPhase =
  | 'pending' | 'native_applied' | 'policy_applied' | 'completed' | 'failed';

export interface AdminOperationRecord {
  id: string;
  kind: string;
  actor_id: string;
  application_id: string | null;
  request_fingerprint: string;
  target_reference: string;
  phase: AdminOperationPhase;
  result_reference: string | null;
}

export class AdminOperationConflictError extends Error {
  constructor() { super('Idempotency key was used for a different operation'); }
}

/** Durable phases for native/custom writes that cannot share a transaction. */
@Injectable()
export class AdminOperationStore {
  constructor(private readonly database: DatabaseService) {}

  async begin(input: {
    kind: string;
    actorId: string;
    applicationId?: string;
    idempotencyKeyHmac: string;
    requestFingerprint: string;
    targetReference: string;
  }): Promise<{ operation: AdminOperationRecord; created: boolean }> {
    if (!input.kind || !input.actorId || !input.idempotencyKeyHmac ||
        !input.requestFingerprint || !input.targetReference) {
      throw new Error('Invalid administration intent');
    }
    const source = this.database.getDataSource();
    const id = uuidv7();
    const inserted = (await source.query(
      `INSERT INTO identity.admin_operations (
         id, kind, actor_id, application_id, idempotency_key_hmac,
         request_fingerprint, target_reference
       ) VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (actor_id, kind, idempotency_key_hmac) DO NOTHING
       RETURNING id, kind, actor_id, application_id, request_fingerprint,
         target_reference, phase, result_reference`,
      [id, input.kind, input.actorId, input.applicationId ?? null,
        input.idempotencyKeyHmac, input.requestFingerprint, input.targetReference],
    )) as AdminOperationRecord[];
    if (inserted[0]) return { operation: inserted[0], created: true };
    const existing = (await source.query(
      `SELECT id, kind, actor_id, application_id, request_fingerprint,
              target_reference, phase, result_reference
       FROM identity.admin_operations
       WHERE actor_id = $1 AND kind = $2 AND idempotency_key_hmac = $3`,
      [input.actorId, input.kind, input.idempotencyKeyHmac],
    )) as AdminOperationRecord[];
    const operation = existing[0];
    if (!operation || operation.request_fingerprint !== input.requestFingerprint ||
        operation.target_reference !== input.targetReference ||
        operation.application_id !== (input.applicationId ?? null)) {
      throw new AdminOperationConflictError();
    }
    return { operation, created: false };
  }

  async advance(input: {
    id: string;
    from: AdminOperationPhase;
    to: AdminOperationPhase;
    resultReference?: string;
  }): Promise<boolean> {
    const valid: Record<AdminOperationPhase, AdminOperationPhase[]> = {
      pending: ['native_applied', 'failed'],
      native_applied: ['policy_applied', 'failed'],
      policy_applied: ['completed', 'failed'],
      completed: [],
      failed: [],
    };
    if (!valid[input.from].includes(input.to)) {
      throw new Error('Invalid administration phase transition');
    }
    const rows = mutationRows<{ id: string }>(await this.database.getDataSource().query(
      `UPDATE identity.admin_operations
       SET phase = $3, result_reference = $4, updated_at = now()
       WHERE id = $1 AND phase = $2 RETURNING id`,
      [input.id, input.from, input.to, input.resultReference ?? null],
    ));
    return rows.length === 1;
  }
}
