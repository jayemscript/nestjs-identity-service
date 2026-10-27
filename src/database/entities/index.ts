import { CORE_ENTITIES } from './core-entities.js';
import {
  AUDIT_ENTITIES,
  WORKFLOW_ENTITIES,
} from './workflow-audit-entities.js';

/** The only TypeORM metadata registered by the service; native auth tables stay native-owned. */
export const IDENTITY_ENTITIES = [...CORE_ENTITIES, ...WORKFLOW_ENTITIES];
export const SERVICE_ENTITIES = [...IDENTITY_ENTITIES, ...AUDIT_ENTITIES];

export * from './core-entities.js';
export * from './workflow-audit-entities.js';
