import { EntitySchema, type EntitySchemaColumnOptions } from 'typeorm';

const uuid = (primary = false, nullable = false): EntitySchemaColumnOptions => ({ type: 'uuid', primary, nullable });
const text = (primary = false, nullable = false): EntitySchemaColumnOptions => ({ type: 'text', primary, nullable });
const date = (nullable = false): EntitySchemaColumnOptions => ({ type: 'timestamptz', nullable });
const bytes = (nullable = false): EntitySchemaColumnOptions => ({ type: 'bytea', nullable });
const lifecycle = () => ({
  version: { type: 'integer' as const, default: 1 },
  created_at: { type: 'timestamptz' as const, default: () => 'now()' },
  updated_at: { type: 'timestamptz' as const, default: () => 'now()' },
});
const check = (name: string, expression: string) => ({ name, expression });

export const EmailDeliveryEntity = new EntitySchema({
  name: 'EmailDelivery', tableName: 'email_deliveries', schema: 'identity',
  columns: {
    id: uuid(true), purpose: text(), template_version: text(), application_id: uuid(),
    payload_ciphertext: bytes(true), payload_iv: bytes(true), payload_tag: bytes(true),
    payload_key_id: text(false, true), deduplication_hmac: text(), message_id: text(),
    challenge_expires_at: date(), not_before: date(), next_attempt_at: date(),
    state: { type: 'text', default: 'queued' }, attempt_count: { type: 'smallint', default: 0 },
    lease_owner: text(false, true), lease_until: date(true),
    accepted_at: date(true), terminal_at: date(true),
    last_error_code: text(false, true), last_smtp_class: text(false, true),
    ...lifecycle(),
  },
  uniques: [
    { name: 'email_deliveries_deduplication_hmac_key', columns: ['deduplication_hmac'] },
    { name: 'email_deliveries_message_id_key', columns: ['message_id'] },
  ],
  foreignKeys: [{ name: 'email_deliveries_application_id_fkey', target: 'Application', columnNames: ['application_id'], referencedColumnNames: ['id'], onDelete: 'RESTRICT' }],
  indices: [
    { name: 'email_deliveries_due_idx', columns: ['next_attempt_at', 'created_at'], where: "state IN ('queued', 'retry_wait')" },
    { name: 'email_deliveries_lease_idx', columns: ['lease_until'], where: "state = 'leased'" },
    { name: 'email_deliveries_expiry_idx', columns: ['challenge_expires_at'] },
    { name: 'email_deliveries_terminal_idx', columns: ['terminal_at'], where: 'terminal_at IS NOT NULL' },
  ],
  checks: [
    check('email_deliveries_purpose_check', "purpose IN ('verify_email', 'reset_password', 'magic_link', 'email_otp', 'security_notice')"),
    check('email_deliveries_state_check', "state IN ('queued', 'leased', 'retry_wait', 'accepted', 'failed', 'expired')"),
    check('email_deliveries_attempt_check', 'attempt_count BETWEEN 0 AND 4'),
    check('email_deliveries_version_check', 'version > 0'),
    check('email_deliveries_expiry_check', 'challenge_expires_at > created_at AND not_before <= challenge_expires_at AND next_attempt_at <= challenge_expires_at'),
    check('email_deliveries_payload_check', "(payload_ciphertext IS NULL AND payload_iv IS NULL AND payload_tag IS NULL AND payload_key_id IS NULL AND state IN ('accepted', 'failed', 'expired')) OR (payload_ciphertext IS NOT NULL AND payload_iv IS NOT NULL AND payload_tag IS NOT NULL AND octet_length(payload_iv) = 12 AND octet_length(payload_tag) = 16 AND payload_key_id IS NOT NULL)"),
    check('email_deliveries_lease_check', "(state = 'leased' AND lease_owner IS NOT NULL AND lease_until IS NOT NULL) OR (state <> 'leased' AND lease_owner IS NULL AND lease_until IS NULL)"),
    check('email_deliveries_terminal_check', "(state IN ('accepted', 'failed', 'expired') AND terminal_at IS NOT NULL) OR (state NOT IN ('accepted', 'failed', 'expired') AND terminal_at IS NULL)"),
    check('email_deliveries_acceptance_check', "accepted_at IS NULL OR state = 'accepted'"),
    check('email_deliveries_text_bounds_check', "char_length(template_version) BETWEEN 1 AND 128 AND char_length(deduplication_hmac) BETWEEN 1 AND 512 AND char_length(message_id) BETWEEN 1 AND 512 AND (payload_key_id IS NULL OR char_length(payload_key_id) <= 128) AND (payload_ciphertext IS NULL OR octet_length(payload_ciphertext) <= 16384) AND (lease_owner IS NULL OR char_length(lease_owner) <= 512) AND (last_error_code IS NULL OR char_length(last_error_code) <= 128) AND (last_smtp_class IS NULL OR char_length(last_smtp_class) <= 128)"),
  ],
});

export const SsoProviderApplicationEntity = new EntitySchema({
  name: 'SsoProviderApplication', tableName: 'sso_provider_applications', schema: 'identity',
  columns: {
    id: uuid(true), provider_id: text(), application_id: uuid(),
    enabled: { type: 'boolean', default: false }, ...lifecycle(),
  },
  uniques: [{ name: 'sso_provider_applications_pair_unique', columns: ['provider_id', 'application_id'] }],
  foreignKeys: [{ name: 'sso_provider_applications_application_id_fkey', target: 'Application', columnNames: ['application_id'], referencedColumnNames: ['id'], onDelete: 'RESTRICT' }],
  indices: [{ name: 'sso_provider_applications_app_enabled_idx', columns: ['application_id', 'enabled'] }],
  checks: [
    check('sso_provider_applications_provider_bound_check', 'char_length(provider_id) BETWEEN 1 AND 512'),
    check('sso_provider_applications_version_check', 'version > 0'),
  ],
});

export const SsoProviderPolicyEntity = new EntitySchema({
  name: 'SsoProviderPolicy', tableName: 'sso_provider_policies', schema: 'identity',
  columns: {
    provider_id: text(true), status: { type: 'text', default: 'provisioning' },
    last_operation_id: uuid(false, true), ...lifecycle(),
  },
  checks: [
    check('sso_provider_policies_status_check', "status IN ('provisioning', 'active', 'disabled', 'failed')"),
    check('sso_provider_policies_provider_bound_check', 'char_length(provider_id) BETWEEN 1 AND 512'),
    check('sso_provider_policies_version_check', 'version > 0'),
  ],
});

export const SsoIdentityBindingEntity = new EntitySchema({
  name: 'SsoIdentityBinding', tableName: 'sso_identity_bindings', schema: 'identity',
  columns: {
    id: uuid(true), provider_id: text(), issuer: text(), subject: text(), user_id: text(),
    status: { type: 'text', default: 'active' }, approver: text(), evidence_reference: text(),
    ...lifecycle(),
  },
  uniques: [{ name: 'sso_identity_bindings_identity_unique', columns: ['provider_id', 'issuer', 'subject'] }],
  indices: [{ name: 'sso_identity_bindings_user_state_idx', columns: ['user_id', 'status'] }],
  checks: [
    check('sso_identity_bindings_status_check', "status IN ('active', 'revoked')"),
    check('sso_identity_bindings_version_check', 'version > 0'),
    check('sso_identity_bindings_evidence_check', 'char_length(approver) BETWEEN 1 AND 512 AND char_length(evidence_reference) BETWEEN 1 AND 2048'),
    check('sso_identity_bindings_text_bounds_check', 'char_length(provider_id) BETWEEN 1 AND 512 AND char_length(issuer) BETWEEN 1 AND 2048 AND char_length(subject) BETWEEN 1 AND 2048 AND char_length(user_id) BETWEEN 1 AND 512'),
  ],
});

export const AdminOperationEntity = new EntitySchema({
  name: 'AdminOperation', tableName: 'admin_operations', schema: 'identity',
  columns: {
    id: uuid(true), kind: text(), actor_id: text(), application_id: uuid(false, true),
    idempotency_key_hmac: text(), request_fingerprint: text(), target_reference: text(),
    phase: { type: 'text', default: 'pending' }, result_reference: text(false, true),
    lease_owner: text(false, true), lease_until: date(true),
    created_at: { type: 'timestamptz', default: () => 'now()' },
    updated_at: { type: 'timestamptz', default: () => 'now()' },
  },
  uniques: [{ name: 'admin_operations_idempotency_unique', columns: ['actor_id', 'kind', 'idempotency_key_hmac'] }],
  foreignKeys: [{ name: 'admin_operations_application_id_fkey', target: 'Application', columnNames: ['application_id'], referencedColumnNames: ['id'], onDelete: 'RESTRICT' }],
  indices: [
    { name: 'admin_operations_phase_updated_idx', columns: ['phase', 'updated_at'] },
    { name: 'admin_operations_target_idx', columns: ['target_reference'] },
  ],
  checks: [
    check('admin_operations_phase_check', "phase IN ('pending', 'native_applied', 'policy_applied', 'completed', 'failed')"),
    check('admin_operations_lease_check', '(lease_owner IS NULL AND lease_until IS NULL) OR (lease_owner IS NOT NULL AND lease_until IS NOT NULL)'),
    check('admin_operations_text_bounds_check', 'char_length(kind) BETWEEN 1 AND 128 AND char_length(actor_id) BETWEEN 1 AND 512 AND char_length(idempotency_key_hmac) BETWEEN 1 AND 512 AND char_length(request_fingerprint) BETWEEN 1 AND 512 AND char_length(target_reference) BETWEEN 1 AND 2048 AND (result_reference IS NULL OR char_length(result_reference) <= 2048) AND (lease_owner IS NULL OR char_length(lease_owner) <= 512)'),
  ],
});

export const BootstrapRunEntity = new EntitySchema({
  name: 'BootstrapRun', tableName: 'bootstrap_runs', schema: 'identity',
  columns: {
    id: uuid(true), application_id: uuid(), normalized_identity_hmac: text(),
    native_user_id: text(false, true), phase: { type: 'text', default: 'pending' },
    ...lifecycle(),
  },
  uniques: [{ name: 'bootstrap_runs_normalized_identity_hmac_key', columns: ['normalized_identity_hmac'] }],
  foreignKeys: [{ name: 'bootstrap_runs_application_id_fkey', target: 'Application', columnNames: ['application_id'], referencedColumnNames: ['id'], onDelete: 'RESTRICT' }],
  checks: [
    check('bootstrap_runs_phase_check', "phase IN ('pending', 'native_applied', 'policy_applied', 'verification_pending', 'password_change_required', 'mfa_enrollment_required', 'completed', 'failed')"),
    check('bootstrap_runs_text_bounds_check', 'char_length(normalized_identity_hmac) BETWEEN 1 AND 512 AND (native_user_id IS NULL OR char_length(native_user_id) <= 512)'),
    check('bootstrap_runs_version_check', 'version > 0'),
  ],
});

export const AbuseWindowEntity = new EntitySchema({
  name: 'AbuseWindow', tableName: 'abuse_windows', schema: 'identity',
  columns: {
    scope: text(true), subject_hmac: text(true), window_start: { type: 'timestamptz', primary: true },
    count: { type: 'integer', default: 0 }, expires_at: date(),
  },
  indices: [{ name: 'abuse_windows_expiry_idx', columns: ['expires_at'] }],
  checks: [
    check('abuse_windows_count_check', 'count >= 0'),
    check('abuse_windows_text_bounds_check', 'char_length(scope) BETWEEN 1 AND 128 AND char_length(subject_hmac) BETWEEN 1 AND 512'),
    check('abuse_windows_expiry_check', 'expires_at > window_start'),
  ],
});

export const MfaReplayClaimEntity = new EntitySchema({
  name: 'MfaReplayClaim', tableName: 'mfa_replay_claims', schema: 'identity',
  columns: {
    user_id: text(true), code_fingerprint: text(true), expires_at: date(),
  },
  indices: [{ name: 'mfa_replay_claims_expiry_idx', columns: ['expires_at'] }],
  checks: [check('mfa_replay_claims_text_bounds_check', 'char_length(user_id) BETWEEN 1 AND 512 AND char_length(code_fingerprint) BETWEEN 1 AND 512')],
});

export const OperationLeaseEntity = new EntitySchema({
  name: 'OperationLease', tableName: 'operation_leases', schema: 'identity',
  columns: {
    resource: text(true), lease_key: text(true), owner_token: text(), lease_until: date(),
    version: { type: 'integer', default: 1 },
  },
  indices: [{ name: 'operation_leases_expiry_idx', columns: ['lease_until'] }],
  checks: [
    check('operation_leases_text_bounds_check', 'char_length(resource) BETWEEN 1 AND 128 AND char_length(lease_key) BETWEEN 1 AND 512 AND char_length(owner_token) BETWEEN 1 AND 512'),
    check('operation_leases_version_check', 'version > 0'),
  ],
});

export const SecurityEventEntity = new EntitySchema({
  name: 'SecurityEvent', tableName: 'security_events', schema: 'audit',
  columns: {
    id: uuid(true), occurred_at: { type: 'timestamptz', default: () => 'now()' },
    request_id: text(), event_name: text(), action: text(), actor_id: text(false, true),
    user_id: text(false, true), application_id: uuid(false, true),
    target_reference: text(false, true), result: text(), reason_code: text(false, true),
    metadata: { type: 'jsonb', default: () => "'{}'" },
    ip_address: { type: 'inet', nullable: true }, user_agent: text(false, true),
    operation_id: uuid(false, true),
  },
  indices: [
    { name: 'security_events_occurred_idx', columns: ['occurred_at', 'id'] },
    { name: 'security_events_user_occurred_idx', columns: ['user_id', 'occurred_at'] },
    { name: 'security_events_app_occurred_idx', columns: ['application_id', 'occurred_at'] },
    { name: 'security_events_operation_idx', columns: ['operation_id'], where: 'operation_id IS NOT NULL' },
  ],
  checks: [
    check('security_events_result_check', "result IN ('success', 'denied', 'failure', 'pending')"),
    check('security_events_names_check', 'char_length(request_id) BETWEEN 1 AND 128 AND char_length(event_name) BETWEEN 1 AND 128 AND char_length(action) BETWEEN 1 AND 128'),
    check('security_events_metadata_check', "jsonb_typeof(metadata) = 'object' AND octet_length(metadata::text) <= 8192"),
    check('security_events_agent_check', 'user_agent IS NULL OR char_length(user_agent) <= 2048'),
    check('security_events_text_bounds_check', '(actor_id IS NULL OR char_length(actor_id) <= 512) AND (user_id IS NULL OR char_length(user_id) <= 512) AND (target_reference IS NULL OR char_length(target_reference) <= 2048) AND (reason_code IS NULL OR char_length(reason_code) <= 128)'),
  ],
});

export const WORKFLOW_ENTITIES = [
  EmailDeliveryEntity, SsoProviderApplicationEntity, SsoProviderPolicyEntity,
  SsoIdentityBindingEntity, AdminOperationEntity, BootstrapRunEntity,
  AbuseWindowEntity, MfaReplayClaimEntity, OperationLeaseEntity,
];

export const AUDIT_ENTITIES = [SecurityEventEntity];
