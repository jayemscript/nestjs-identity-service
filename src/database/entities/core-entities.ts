import { EntitySchema, type EntitySchemaColumnOptions } from 'typeorm';

// These mappings describe service-owned tables for TypeORM reads and reviewed diffs.
// IDs and versions are assigned/compared by repositories; no ORM auto-generation or soft delete.
const uuid = (
  primary = false,
  nullable = false,
): EntitySchemaColumnOptions => ({ type: 'uuid', primary, nullable });
const text = (
  primary = false,
  nullable = false,
): EntitySchemaColumnOptions => ({ type: 'text', primary, nullable });
const date = (nullable = false): EntitySchemaColumnOptions => ({
  type: 'timestamptz',
  nullable,
});
const bytes = (nullable = false): EntitySchemaColumnOptions => ({
  type: 'bytea',
  nullable,
});
const textArray = (
  defaultValue?: string | string[],
): EntitySchemaColumnOptions => ({
  type: 'text',
  array: true,
  ...(defaultValue === undefined
    ? {}
    : {
        default: Array.isArray(defaultValue)
          ? defaultValue
          : () => defaultValue,
      }),
});
const lifecycle = () => ({
  version: { type: 'integer' as const, default: 1 },
  created_at: { type: 'timestamptz' as const, default: () => 'now()' },
  updated_at: { type: 'timestamptz' as const, default: () => 'now()' },
});
const check = (name: string, expression: string) => ({ name, expression });

export const ApplicationEntity = new EntitySchema({
  name: 'Application',
  tableName: 'applications',
  schema: 'identity',
  columns: {
    id: uuid(true),
    slug: text(),
    name: text(),
    public_origin: text(),
    allowed_transports: textArray(['cookie']),
    status: { type: 'text', default: 'disabled' },
    self_registration: { type: 'boolean', default: false },
    ...lifecycle(),
  },
  uniques: [
    { name: 'applications_slug_key', columns: ['slug'] },
    { name: 'applications_public_origin_key', columns: ['public_origin'] },
    { name: 'applications_id_origin_unique', columns: ['id', 'public_origin'] },
  ],
  checks: [
    check(
      'applications_slug_check',
      "slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' AND char_length(slug) <= 128",
    ),
    check('applications_name_check', 'char_length(name) BETWEEN 1 AND 255'),
    check(
      'applications_origin_check',
      "public_origin ~ '^https?://[^/?#[:space:]]+$' AND char_length(public_origin) <= 2048",
    ),
    check(
      'applications_transports_check',
      "allowed_transports = ARRAY['cookie']::text[] OR allowed_transports = ARRAY['bearer']::text[] OR allowed_transports = ARRAY['cookie', 'bearer']::text[] OR allowed_transports = ARRAY['bearer', 'cookie']::text[]",
    ),
    check('applications_status_check', "status IN ('active', 'disabled')"),
    check('applications_version_check', 'version > 0'),
  ],
});

export const MobileClientEntity = new EntitySchema({
  name: 'MobileClient',
  tableName: 'mobile_clients',
  schema: 'identity',
  columns: {
    application_id: uuid(true),
    ios_bundle_id: text(false, true),
    android_package_name: text(false, true),
    android_signing_fingerprints: textArray('ARRAY[]'),
    auth_origin: text(),
    allowed_return_uris: textArray(),
    status: { type: 'text', default: 'disabled' },
    ...lifecycle(),
  },
  foreignKeys: [
    {
      name: 'mobile_clients_application_id_fkey',
      target: 'Application',
      columnNames: ['application_id'],
      referencedColumnNames: ['id'],
      onDelete: 'RESTRICT',
    },
    {
      name: 'mobile_clients_origin_fk',
      target: 'Application',
      columnNames: ['application_id', 'auth_origin'],
      referencedColumnNames: ['id', 'public_origin'],
      onUpdate: 'CASCADE',
      onDelete: 'RESTRICT',
    },
  ],
  checks: [
    check(
      'mobile_clients_platform_check',
      'ios_bundle_id IS NOT NULL OR android_package_name IS NOT NULL',
    ),
    check(
      'mobile_clients_android_fingerprints_check',
      'android_package_name IS NULL OR cardinality(android_signing_fingerprints) > 0',
    ),
    check(
      'mobile_clients_auth_origin_check',
      "auth_origin ~ '^https://[^/?#[:space:]]+$'",
    ),
    check(
      'mobile_clients_return_uris_check',
      'cardinality(allowed_return_uris) > 0 AND array_position(allowed_return_uris, NULL) IS NULL',
    ),
    check(
      'mobile_clients_text_bounds_check',
      "(ios_bundle_id IS NULL OR char_length(ios_bundle_id) BETWEEN 1 AND 255) AND (android_package_name IS NULL OR char_length(android_package_name) BETWEEN 1 AND 255) AND char_length(auth_origin) <= 2048 AND octet_length(array_to_string(android_signing_fingerprints, ',')) <= 8192 AND octet_length(array_to_string(allowed_return_uris, ',')) <= 8192 AND array_position(android_signing_fingerprints, NULL) IS NULL",
    ),
    check('mobile_clients_status_check', "status IN ('active', 'disabled')"),
    check('mobile_clients_version_check', 'version > 0'),
  ],
});

export const MobileAuthTransactionEntity = new EntitySchema({
  name: 'MobileAuthTransaction',
  tableName: 'mobile_auth_transactions',
  schema: 'identity',
  columns: {
    id: uuid(true),
    application_id: uuid(),
    return_uri: text(),
    platform: text(),
    code_challenge: { type: 'character', length: 43 },
    client_state_hash: text(),
    client_state_ciphertext: bytes(true),
    client_state_iv: bytes(true),
    client_state_tag: bytes(true),
    client_state_key_id: text(false, true),
    browser_binding_hmac: text(false, true),
    native_session_id: text(false, true),
    one_time_token_hmac: text(false, true),
    status: { type: 'text', default: 'pending' },
    expires_at: date(),
    code_expires_at: date(true),
    ...lifecycle(),
  },
  foreignKeys: [
    {
      name: 'mobile_auth_transactions_application_id_fkey',
      target: 'Application',
      columnNames: ['application_id'],
      referencedColumnNames: ['id'],
      onDelete: 'RESTRICT',
    },
  ],
  indices: [
    {
      name: 'mobile_auth_transactions_app_state_expiry_idx',
      columns: ['application_id', 'status', 'expires_at'],
    },
    {
      name: 'mobile_auth_transactions_token_hmac_idx',
      columns: ['one_time_token_hmac'],
      unique: true,
      where: 'one_time_token_hmac IS NOT NULL',
    },
  ],
  checks: [
    check(
      'mobile_auth_transactions_platform_check',
      "platform IN ('ios', 'android')",
    ),
    check(
      'mobile_auth_transactions_challenge_check',
      "code_challenge ~ '^[A-Za-z0-9_-]{43}$'",
    ),
    check(
      'mobile_auth_transactions_status_check',
      "status IN ('pending', 'browser_verified', 'code_issued', 'exchanging', 'completed', 'failed', 'expired')",
    ),
    check(
      'mobile_auth_transactions_expiry_check',
      'expires_at > created_at AND (code_expires_at IS NULL OR code_expires_at <= expires_at)',
    ),
    check(
      'mobile_auth_transactions_state_envelope_check',
      '(client_state_ciphertext IS NULL AND client_state_iv IS NULL AND client_state_tag IS NULL AND client_state_key_id IS NULL) OR (client_state_ciphertext IS NOT NULL AND client_state_iv IS NOT NULL AND client_state_tag IS NOT NULL AND octet_length(client_state_iv) = 12 AND octet_length(client_state_tag) = 16 AND client_state_key_id IS NOT NULL)',
    ),
    check(
      'mobile_auth_transactions_text_bounds_check',
      'char_length(return_uri) BETWEEN 1 AND 2048 AND char_length(client_state_hash) BETWEEN 1 AND 512 AND (browser_binding_hmac IS NULL OR char_length(browser_binding_hmac) <= 512) AND (native_session_id IS NULL OR char_length(native_session_id) <= 512) AND (one_time_token_hmac IS NULL OR char_length(one_time_token_hmac) <= 512) AND (client_state_key_id IS NULL OR char_length(client_state_key_id) <= 128) AND (client_state_ciphertext IS NULL OR octet_length(client_state_ciphertext) <= 4096)',
    ),
    check('mobile_auth_transactions_version_check', 'version > 0'),
  ],
});

export const ApplicationMembershipEntity = new EntitySchema({
  name: 'ApplicationMembership',
  tableName: 'application_memberships',
  schema: 'identity',
  columns: {
    application_id: uuid(true),
    user_id: text(true),
    role: { type: 'text', default: 'member' },
    status: { type: 'text', default: 'active' },
    ...lifecycle(),
  },
  foreignKeys: [
    {
      name: 'application_memberships_application_id_fkey',
      target: 'Application',
      columnNames: ['application_id'],
      referencedColumnNames: ['id'],
      onDelete: 'RESTRICT',
    },
  ],
  indices: [
    {
      name: 'application_memberships_user_state_app_idx',
      columns: ['user_id', 'status', 'application_id'],
    },
  ],
  checks: [
    check(
      'application_memberships_role_check',
      "role IN ('member', 'app_admin')",
    ),
    check(
      'application_memberships_status_check',
      "status IN ('active', 'suspended')",
    ),
    check(
      'application_memberships_user_bound_check',
      'char_length(user_id) BETWEEN 1 AND 512',
    ),
    check('application_memberships_version_check', 'version > 0'),
  ],
});

export const AccountPolicyEntity = new EntitySchema({
  name: 'AccountPolicy',
  tableName: 'account_policies',
  schema: 'identity',
  columns: {
    user_id: text(true),
    security_epoch: { type: 'bigint', default: 1 },
    bootstrap_state: { type: 'text', default: 'active' },
    kind: { type: 'text', default: 'human' },
    lifecycle: { type: 'text', default: 'active' },
    ...lifecycle(),
  },
  checks: [
    check('account_policies_epoch_check', 'security_epoch > 0'),
    check(
      'account_policies_bootstrap_check',
      "bootstrap_state IN ('password_change_required', 'mfa_enrollment_required', 'active')",
    ),
    check('account_policies_kind_check', "kind IN ('human', 'service')"),
    check(
      'account_policies_lifecycle_check',
      "lifecycle IN ('active', 'deleting', 'disabled')",
    ),
    check(
      'account_policies_user_bound_check',
      'char_length(user_id) BETWEEN 1 AND 512',
    ),
    check('account_policies_version_check', 'version > 0'),
  ],
});

export const SessionAssuranceEntity = new EntitySchema({
  name: 'SessionAssurance',
  tableName: 'session_assurance',
  schema: 'identity',
  columns: {
    session_id: text(true),
    user_id: text(),
    application_id: uuid(),
    security_epoch: { type: 'bigint' },
    state: { type: 'text', default: 'primary_only' },
    primary_method: text(),
    mfa_method: text(false, true),
    mfa_verified_at: date(true),
    pending_expires_at: date(),
    provider_id: text(false, true),
    provider_policy_version: { type: 'integer', nullable: true },
    application_mapping_version: { type: 'integer', nullable: true },
    identity_binding_version: { type: 'integer', nullable: true },
    ...lifecycle(),
  },
  foreignKeys: [
    {
      name: 'session_assurance_application_id_fkey',
      target: 'Application',
      columnNames: ['application_id'],
      referencedColumnNames: ['id'],
      onDelete: 'RESTRICT',
    },
  ],
  indices: [
    {
      name: 'session_assurance_user_epoch_idx',
      columns: ['user_id', 'security_epoch'],
    },
    {
      name: 'session_assurance_user_app_idx',
      columns: ['user_id', 'application_id'],
    },
    {
      name: 'session_assurance_provider_idx',
      columns: ['provider_id'],
      where: 'provider_id IS NOT NULL',
    },
    {
      name: 'session_assurance_pending_expiry_idx',
      columns: ['pending_expires_at'],
      where: "state = 'primary_only'",
    },
  ],
  checks: [
    check('session_assurance_epoch_check', 'security_epoch > 0'),
    check(
      'session_assurance_state_check',
      "state IN ('primary_only', 'verified')",
    ),
    check(
      'session_assurance_mfa_check',
      'mfa_verified_at IS NULL OR mfa_method IS NOT NULL',
    ),
    check(
      'session_assurance_provider_versions_check',
      '(provider_policy_version IS NULL OR provider_policy_version > 0) AND (application_mapping_version IS NULL OR application_mapping_version > 0) AND (identity_binding_version IS NULL OR identity_binding_version > 0)',
    ),
    check(
      'session_assurance_text_bounds_check',
      'char_length(session_id) BETWEEN 1 AND 512 AND char_length(user_id) BETWEEN 1 AND 512 AND char_length(primary_method) BETWEEN 1 AND 128 AND (mfa_method IS NULL OR char_length(mfa_method) <= 128) AND (provider_id IS NULL OR char_length(provider_id) <= 512)',
    ),
    check('session_assurance_version_check', 'version > 0'),
  ],
});

export const AuthFlowBindingEntity = new EntitySchema({
  name: 'AuthFlowBinding',
  tableName: 'auth_flow_bindings',
  schema: 'identity',
  columns: {
    id: uuid(true),
    flow_ref_hmac: text(),
    purpose: text(),
    user_id: text(false, true),
    application_id: uuid(),
    public_origin: text(),
    expires_at: date(),
    created_at: { type: 'timestamptz', default: () => 'now()' },
    otp_generation: { type: 'bigint', nullable: true },
    browser_correlation_hmac: text(false, true),
    consumed_at: date(true),
    provider_id: text(false, true),
  },
  uniques: [
    {
      name: 'auth_flow_bindings_flow_ref_hmac_key',
      columns: ['flow_ref_hmac'],
    },
  ],
  foreignKeys: [
    {
      name: 'auth_flow_bindings_application_id_fkey',
      target: 'Application',
      columnNames: ['application_id'],
      referencedColumnNames: ['id'],
      onDelete: 'RESTRICT',
    },
    {
      name: 'auth_flow_bindings_origin_fk',
      target: 'Application',
      columnNames: ['application_id', 'public_origin'],
      referencedColumnNames: ['id', 'public_origin'],
      onUpdate: 'CASCADE',
      onDelete: 'RESTRICT',
    },
  ],
  indices: [{ name: 'auth_flow_bindings_expiry_idx', columns: ['expires_at'] }],
  checks: [
    check(
      'auth_flow_bindings_generation_check',
      'otp_generation IS NULL OR otp_generation > 0',
    ),
    check(
      'auth_flow_bindings_text_bounds_check',
      'char_length(flow_ref_hmac) BETWEEN 1 AND 512 AND char_length(purpose) BETWEEN 1 AND 128 AND char_length(public_origin) <= 2048 AND (user_id IS NULL OR char_length(user_id) <= 512) AND (browser_correlation_hmac IS NULL OR char_length(browser_correlation_hmac) <= 512) AND (provider_id IS NULL OR char_length(provider_id) <= 512)',
    ),
    check('auth_flow_bindings_expiry_check', 'expires_at > created_at'),
  ],
});

export const ServiceClientEntity = new EntitySchema({
  name: 'ServiceClient',
  tableName: 'service_clients',
  schema: 'identity',
  columns: {
    id: uuid(true),
    application_id: uuid(),
    service_user_id: text(),
    name: text(),
    allowed_scopes: textArray('ARRAY[]'),
    status: { type: 'text', default: 'disabled' },
    ...lifecycle(),
  },
  uniques: [
    {
      name: 'service_clients_service_user_id_key',
      columns: ['service_user_id'],
    },
  ],
  foreignKeys: [
    {
      name: 'service_clients_application_id_fkey',
      target: 'Application',
      columnNames: ['application_id'],
      referencedColumnNames: ['id'],
      onDelete: 'RESTRICT',
    },
  ],
  indices: [
    {
      name: 'service_clients_app_state_idx',
      columns: ['application_id', 'status'],
    },
  ],
  checks: [
    check('service_clients_name_check', 'char_length(name) BETWEEN 1 AND 255'),
    check(
      'service_clients_text_bounds_check',
      "char_length(service_user_id) BETWEEN 1 AND 512 AND octet_length(array_to_string(allowed_scopes, ',')) <= 8192 AND array_position(allowed_scopes, NULL) IS NULL",
    ),
    check('service_clients_status_check', "status IN ('active', 'disabled')"),
    check('service_clients_version_check', 'version > 0'),
  ],
});

export const ServiceCredentialEntity = new EntitySchema({
  name: 'ServiceCredential',
  tableName: 'service_credentials',
  schema: 'identity',
  columns: {
    id: uuid(true),
    plugin_key_id: text(),
    service_client_id: uuid(),
    state: { type: 'text', default: 'active' },
    ...lifecycle(),
    revoked_at: date(true),
  },
  uniques: [
    {
      name: 'service_credentials_plugin_key_id_key',
      columns: ['plugin_key_id'],
    },
  ],
  foreignKeys: [
    {
      name: 'service_credentials_service_client_id_fkey',
      target: 'ServiceClient',
      columnNames: ['service_client_id'],
      referencedColumnNames: ['id'],
      onDelete: 'RESTRICT',
    },
  ],
  indices: [
    {
      name: 'service_credentials_client_state_idx',
      columns: ['service_client_id', 'state'],
    },
  ],
  checks: [
    check('service_credentials_state_check', "state IN ('active', 'revoked')"),
    check(
      'service_credentials_revocation_check',
      "(state = 'active' AND revoked_at IS NULL) OR (state = 'revoked' AND revoked_at IS NOT NULL)",
    ),
    check(
      'service_credentials_key_bound_check',
      'char_length(plugin_key_id) BETWEEN 1 AND 512',
    ),
    check('service_credentials_version_check', 'version > 0'),
  ],
});

export const CORE_ENTITIES = [
  ApplicationEntity,
  MobileClientEntity,
  MobileAuthTransactionEntity,
  ApplicationMembershipEntity,
  AccountPolicyEntity,
  SessionAssuranceEntity,
  AuthFlowBindingEntity,
  ServiceClientEntity,
  ServiceCredentialEntity,
];
