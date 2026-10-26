import { Injectable } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import { AuditDataSourceService } from './audit-data-source.service.js';

const metadataKeys = new Set([
  'method',
  'transport',
  'providerId',
  'factor',
  'operationPhase',
  'clientPlatform',
  'credentialKind',
  'scope',
]);

export interface SecurityEventInput {
  requestId: string;
  eventName: string;
  action: string;
  result: 'success' | 'denied' | 'failure' | 'pending';
  actorId?: string;
  userId?: string;
  applicationId?: string;
  targetReference?: string;
  reasonCode?: string;
  operationId?: string;
  metadata?: Record<string, string | number | boolean | null>;
  ipAddress?: string;
  userAgent?: string;
}

function safeMetadata(value: SecurityEventInput['metadata']): Record<string, string | number | boolean | null> {
  if (!value) return {};
  const result: Record<string, string | number | boolean | null> = {};
  for (const [key, item] of Object.entries(value)) {
    if (!metadataKeys.has(key)) throw new Error('Unsupported audit metadata field');
    if (typeof item === 'string' && item.length > 128) {
      throw new Error('Audit metadata value is too long');
    }
    if (typeof item === 'number' && !Number.isFinite(item)) {
      throw new Error('Audit metadata value is invalid');
    }
    result[key] = item;
  }
  if (Buffer.byteLength(JSON.stringify(result), 'utf8') > 4096) {
    throw new Error('Audit metadata is too large');
  }
  return result;
}

/** Appends a complete event without SELECT/RETURNING, matching the audit runtime grant. */
@Injectable()
export class AuditWriter {
  constructor(private readonly audit: AuditDataSourceService) {}

  async append(input: SecurityEventInput): Promise<string> {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(input.requestId)) {
      throw new Error('Invalid audit request ID');
    }
    for (const value of [input.eventName, input.action]) {
      if (!/^[a-z][a-z0-9_.-]{0,127}$/.test(value)) {
        throw new Error('Invalid audit event name');
      }
    }
    const id = uuidv7();
    await this.audit.getDataSource().query(
      `INSERT INTO audit.security_events (
        id, request_id, event_name, action, actor_id, user_id, application_id,
        target_reference, result, reason_code, metadata, ip_address, user_agent, operation_id
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::inet,$13,$14)`,
      [
        id,
        input.requestId,
        input.eventName,
        input.action,
        input.actorId ?? null,
        input.userId ?? null,
        input.applicationId ?? null,
        input.targetReference ?? null,
        input.result,
        input.reasonCode ?? null,
        JSON.stringify(safeMetadata(input.metadata)),
        input.ipAddress ?? null,
        input.userAgent ?? null,
        input.operationId ?? null,
      ],
    );
    return id;
  }
}
