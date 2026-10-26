import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Service-owned application and policy records. Native Better Auth IDs remain opaque text. */
export class CoreIdentity1792972800003 implements MigrationInterface {
  name = 'CoreIdentity1792972800003';
  transaction = true;

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE identity.applications (
        id uuid PRIMARY KEY,
        slug text NOT NULL UNIQUE,
        name text NOT NULL,
        public_origin text NOT NULL UNIQUE,
        allowed_transports text[] NOT NULL DEFAULT ARRAY['cookie']::text[],
        status text NOT NULL DEFAULT 'disabled',
        self_registration boolean NOT NULL DEFAULT false,
        version integer NOT NULL DEFAULT 1,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT applications_slug_check CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' AND char_length(slug) <= 128),
        CONSTRAINT applications_name_check CHECK (char_length(name) BETWEEN 1 AND 255),
        CONSTRAINT applications_origin_check CHECK (public_origin ~ '^https?://[^/?#[:space:]]+$' AND char_length(public_origin) <= 2048),
        CONSTRAINT applications_transports_check CHECK (
          allowed_transports = ARRAY['cookie']::text[] OR
          allowed_transports = ARRAY['bearer']::text[] OR
          allowed_transports = ARRAY['cookie', 'bearer']::text[] OR
          allowed_transports = ARRAY['bearer', 'cookie']::text[]
        ),
        CONSTRAINT applications_status_check CHECK (status IN ('active', 'disabled')),
        CONSTRAINT applications_version_check CHECK (version > 0),
        CONSTRAINT applications_id_origin_unique UNIQUE (id, public_origin)
      );

      CREATE TABLE identity.mobile_clients (
        application_id uuid PRIMARY KEY REFERENCES identity.applications(id) ON DELETE RESTRICT,
        ios_bundle_id text,
        android_package_name text,
        android_signing_fingerprints text[] NOT NULL DEFAULT ARRAY[]::text[],
        auth_origin text NOT NULL,
        allowed_return_uris text[] NOT NULL,
        status text NOT NULL DEFAULT 'disabled',
        version integer NOT NULL DEFAULT 1,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT mobile_clients_origin_fk FOREIGN KEY (application_id, auth_origin)
          REFERENCES identity.applications(id, public_origin) ON UPDATE CASCADE ON DELETE RESTRICT,
        CONSTRAINT mobile_clients_platform_check CHECK (ios_bundle_id IS NOT NULL OR android_package_name IS NOT NULL),
        CONSTRAINT mobile_clients_android_fingerprints_check CHECK (
          android_package_name IS NULL OR cardinality(android_signing_fingerprints) > 0
        ),
        CONSTRAINT mobile_clients_auth_origin_check CHECK (auth_origin ~ '^https://[^/?#[:space:]]+$'),
        CONSTRAINT mobile_clients_return_uris_check CHECK (
          cardinality(allowed_return_uris) > 0 AND array_position(allowed_return_uris, NULL) IS NULL
        ),
        CONSTRAINT mobile_clients_text_bounds_check CHECK (
          (ios_bundle_id IS NULL OR char_length(ios_bundle_id) BETWEEN 1 AND 255)
          AND (android_package_name IS NULL OR char_length(android_package_name) BETWEEN 1 AND 255)
          AND char_length(auth_origin) <= 2048
          AND octet_length(array_to_string(android_signing_fingerprints, ',')) <= 8192
          AND octet_length(array_to_string(allowed_return_uris, ',')) <= 8192
          AND array_position(android_signing_fingerprints, NULL) IS NULL
        ),
        CONSTRAINT mobile_clients_status_check CHECK (status IN ('active', 'disabled')),
        CONSTRAINT mobile_clients_version_check CHECK (version > 0)
      );

      CREATE TABLE identity.mobile_auth_transactions (
        id uuid PRIMARY KEY,
        application_id uuid NOT NULL REFERENCES identity.applications(id) ON DELETE RESTRICT,
        return_uri text NOT NULL,
        platform text NOT NULL,
        code_challenge char(43) NOT NULL,
        client_state_hash text NOT NULL,
        client_state_ciphertext bytea,
        client_state_iv bytea,
        client_state_tag bytea,
        client_state_key_id text,
        browser_binding_hmac text,
        native_session_id text,
        one_time_token_hmac text,
        status text NOT NULL DEFAULT 'pending',
        expires_at timestamptz NOT NULL,
        code_expires_at timestamptz,
        version integer NOT NULL DEFAULT 1,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT mobile_auth_transactions_platform_check CHECK (platform IN ('ios', 'android')),
        CONSTRAINT mobile_auth_transactions_challenge_check CHECK (code_challenge ~ '^[A-Za-z0-9_-]{43}$'),
        CONSTRAINT mobile_auth_transactions_status_check CHECK (
          status IN ('pending', 'browser_verified', 'code_issued', 'exchanging', 'completed', 'failed', 'expired')
        ),
        CONSTRAINT mobile_auth_transactions_expiry_check CHECK (
          expires_at > created_at AND (code_expires_at IS NULL OR code_expires_at <= expires_at)
        ),
        CONSTRAINT mobile_auth_transactions_state_envelope_check CHECK (
          (client_state_ciphertext IS NULL AND client_state_iv IS NULL AND client_state_tag IS NULL AND client_state_key_id IS NULL)
          OR (client_state_ciphertext IS NOT NULL AND client_state_iv IS NOT NULL
              AND client_state_tag IS NOT NULL AND octet_length(client_state_iv) = 12
              AND octet_length(client_state_tag) = 16 AND client_state_key_id IS NOT NULL)
        ),
        CONSTRAINT mobile_auth_transactions_text_bounds_check CHECK (
          char_length(return_uri) BETWEEN 1 AND 2048
          AND char_length(client_state_hash) BETWEEN 1 AND 512
          AND (browser_binding_hmac IS NULL OR char_length(browser_binding_hmac) <= 512)
          AND (native_session_id IS NULL OR char_length(native_session_id) <= 512)
          AND (one_time_token_hmac IS NULL OR char_length(one_time_token_hmac) <= 512)
          AND (client_state_key_id IS NULL OR char_length(client_state_key_id) <= 128)
          AND (client_state_ciphertext IS NULL OR octet_length(client_state_ciphertext) <= 4096)
        ),
        CONSTRAINT mobile_auth_transactions_version_check CHECK (version > 0)
      );
      CREATE INDEX mobile_auth_transactions_app_state_expiry_idx
        ON identity.mobile_auth_transactions (application_id, status, expires_at);
      CREATE UNIQUE INDEX mobile_auth_transactions_token_hmac_idx
        ON identity.mobile_auth_transactions (one_time_token_hmac) WHERE one_time_token_hmac IS NOT NULL;

      CREATE TABLE identity.application_memberships (
        application_id uuid NOT NULL REFERENCES identity.applications(id) ON DELETE RESTRICT,
        user_id text NOT NULL,
        role text NOT NULL DEFAULT 'member',
        status text NOT NULL DEFAULT 'active',
        version integer NOT NULL DEFAULT 1,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (application_id, user_id),
        CONSTRAINT application_memberships_role_check CHECK (role IN ('member', 'app_admin')),
        CONSTRAINT application_memberships_status_check CHECK (status IN ('active', 'suspended')),
        CONSTRAINT application_memberships_user_bound_check CHECK (char_length(user_id) BETWEEN 1 AND 512),
        CONSTRAINT application_memberships_version_check CHECK (version > 0)
      );
      CREATE INDEX application_memberships_user_state_app_idx
        ON identity.application_memberships (user_id, status, application_id);

      CREATE TABLE identity.account_policies (
        user_id text PRIMARY KEY,
        security_epoch bigint NOT NULL DEFAULT 1,
        bootstrap_state text NOT NULL DEFAULT 'active',
        kind text NOT NULL DEFAULT 'human',
        lifecycle text NOT NULL DEFAULT 'active',
        version integer NOT NULL DEFAULT 1,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT account_policies_epoch_check CHECK (security_epoch > 0),
        CONSTRAINT account_policies_bootstrap_check CHECK (
          bootstrap_state IN ('password_change_required', 'mfa_enrollment_required', 'active')
        ),
        CONSTRAINT account_policies_kind_check CHECK (kind IN ('human', 'service')),
        CONSTRAINT account_policies_lifecycle_check CHECK (lifecycle IN ('active', 'deleting', 'disabled')),
        CONSTRAINT account_policies_user_bound_check CHECK (char_length(user_id) BETWEEN 1 AND 512),
        CONSTRAINT account_policies_version_check CHECK (version > 0)
      );

      CREATE TABLE identity.session_assurance (
        session_id text PRIMARY KEY,
        user_id text NOT NULL,
        application_id uuid NOT NULL REFERENCES identity.applications(id) ON DELETE RESTRICT,
        security_epoch bigint NOT NULL,
        state text NOT NULL DEFAULT 'primary_only',
        primary_method text NOT NULL,
        mfa_method text,
        mfa_verified_at timestamptz,
        pending_expires_at timestamptz NOT NULL,
        provider_id text,
        provider_policy_version integer,
        application_mapping_version integer,
        identity_binding_version integer,
        version integer NOT NULL DEFAULT 1,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT session_assurance_epoch_check CHECK (security_epoch > 0),
        CONSTRAINT session_assurance_state_check CHECK (state IN ('primary_only', 'verified')),
        CONSTRAINT session_assurance_mfa_check CHECK (mfa_verified_at IS NULL OR mfa_method IS NOT NULL),
        CONSTRAINT session_assurance_provider_versions_check CHECK (
          (provider_policy_version IS NULL OR provider_policy_version > 0) AND
          (application_mapping_version IS NULL OR application_mapping_version > 0) AND
          (identity_binding_version IS NULL OR identity_binding_version > 0)
        ),
        CONSTRAINT session_assurance_text_bounds_check CHECK (
          char_length(session_id) BETWEEN 1 AND 512 AND char_length(user_id) BETWEEN 1 AND 512
          AND char_length(primary_method) BETWEEN 1 AND 128
          AND (mfa_method IS NULL OR char_length(mfa_method) <= 128)
          AND (provider_id IS NULL OR char_length(provider_id) <= 512)
        ),
        CONSTRAINT session_assurance_version_check CHECK (version > 0)
      );
      CREATE INDEX session_assurance_user_epoch_idx ON identity.session_assurance (user_id, security_epoch);
      CREATE INDEX session_assurance_user_app_idx ON identity.session_assurance (user_id, application_id);
      CREATE INDEX session_assurance_provider_idx ON identity.session_assurance (provider_id) WHERE provider_id IS NOT NULL;
      CREATE INDEX session_assurance_pending_expiry_idx ON identity.session_assurance (pending_expires_at)
        WHERE state = 'primary_only';

      CREATE TABLE identity.auth_flow_bindings (
        id uuid PRIMARY KEY,
        flow_ref_hmac text NOT NULL UNIQUE,
        purpose text NOT NULL,
        user_id text,
        application_id uuid NOT NULL REFERENCES identity.applications(id) ON DELETE RESTRICT,
        public_origin text NOT NULL,
        expires_at timestamptz NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        otp_generation bigint,
        browser_correlation_hmac text,
        consumed_at timestamptz,
        provider_id text,
        CONSTRAINT auth_flow_bindings_origin_fk FOREIGN KEY (application_id, public_origin)
          REFERENCES identity.applications(id, public_origin) ON UPDATE CASCADE ON DELETE RESTRICT,
        CONSTRAINT auth_flow_bindings_generation_check CHECK (otp_generation IS NULL OR otp_generation > 0),
        CONSTRAINT auth_flow_bindings_text_bounds_check CHECK (
          char_length(flow_ref_hmac) BETWEEN 1 AND 512 AND char_length(purpose) BETWEEN 1 AND 128
          AND char_length(public_origin) <= 2048
          AND (user_id IS NULL OR char_length(user_id) <= 512)
          AND (browser_correlation_hmac IS NULL OR char_length(browser_correlation_hmac) <= 512)
          AND (provider_id IS NULL OR char_length(provider_id) <= 512)
        ),
        CONSTRAINT auth_flow_bindings_expiry_check CHECK (expires_at > created_at)
      );
      CREATE INDEX auth_flow_bindings_expiry_idx ON identity.auth_flow_bindings (expires_at);

      CREATE TABLE identity.service_clients (
        id uuid PRIMARY KEY,
        application_id uuid NOT NULL REFERENCES identity.applications(id) ON DELETE RESTRICT,
        service_user_id text NOT NULL UNIQUE,
        name text NOT NULL,
        allowed_scopes text[] NOT NULL DEFAULT ARRAY[]::text[],
        status text NOT NULL DEFAULT 'disabled',
        version integer NOT NULL DEFAULT 1,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT service_clients_name_check CHECK (char_length(name) BETWEEN 1 AND 255),
        CONSTRAINT service_clients_text_bounds_check CHECK (
          char_length(service_user_id) BETWEEN 1 AND 512
          AND octet_length(array_to_string(allowed_scopes, ',')) <= 8192
          AND array_position(allowed_scopes, NULL) IS NULL
        ),
        CONSTRAINT service_clients_status_check CHECK (status IN ('active', 'disabled')),
        CONSTRAINT service_clients_version_check CHECK (version > 0)
      );
      CREATE INDEX service_clients_app_state_idx ON identity.service_clients (application_id, status);

      CREATE TABLE identity.service_credentials (
        id uuid PRIMARY KEY,
        plugin_key_id text NOT NULL UNIQUE,
        service_client_id uuid NOT NULL REFERENCES identity.service_clients(id) ON DELETE RESTRICT,
        state text NOT NULL DEFAULT 'active',
        version integer NOT NULL DEFAULT 1,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        revoked_at timestamptz,
        CONSTRAINT service_credentials_state_check CHECK (state IN ('active', 'revoked')),
        CONSTRAINT service_credentials_revocation_check CHECK (
          (state = 'active' AND revoked_at IS NULL) OR (state = 'revoked' AND revoked_at IS NOT NULL)
        ),
        CONSTRAINT service_credentials_key_bound_check CHECK (char_length(plugin_key_id) BETWEEN 1 AND 512),
        CONSTRAINT service_credentials_version_check CHECK (version > 0)
      );
      CREATE INDEX service_credentials_client_state_idx ON identity.service_credentials (service_client_id, state);

      GRANT SELECT, INSERT, UPDATE, DELETE ON
        identity.applications, identity.mobile_clients, identity.mobile_auth_transactions,
        identity.application_memberships, identity.account_policies, identity.session_assurance,
        identity.auth_flow_bindings, identity.service_clients, identity.service_credentials
      TO identity_policy_runtime;
      GRANT SELECT, DELETE ON
        identity.mobile_auth_transactions, identity.session_assurance, identity.auth_flow_bindings
      TO identity_retention_maintenance;
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TABLE identity.service_credentials;
      DROP TABLE identity.service_clients;
      DROP TABLE identity.auth_flow_bindings;
      DROP TABLE identity.session_assurance;
      DROP TABLE identity.account_policies;
      DROP TABLE identity.application_memberships;
      DROP TABLE identity.mobile_auth_transactions;
      DROP TABLE identity.mobile_clients;
      DROP TABLE identity.applications;
    `);
  }
}
