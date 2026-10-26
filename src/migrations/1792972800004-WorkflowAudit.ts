import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Durable service workflows, delivery metadata, security counters, and audit history. */
export class WorkflowAudit1792972800004 implements MigrationInterface {
  name = 'WorkflowAudit1792972800004';
  transaction = true;

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE identity.email_deliveries (
        id uuid PRIMARY KEY,
        purpose text NOT NULL,
        template_version text NOT NULL,
        application_id uuid NOT NULL REFERENCES identity.applications(id) ON DELETE RESTRICT,
        payload_ciphertext bytea,
        payload_iv bytea,
        payload_tag bytea,
        payload_key_id text,
        deduplication_hmac text NOT NULL UNIQUE,
        message_id text NOT NULL UNIQUE,
        challenge_expires_at timestamptz NOT NULL,
        not_before timestamptz NOT NULL,
        next_attempt_at timestamptz NOT NULL,
        state text NOT NULL DEFAULT 'queued',
        attempt_count smallint NOT NULL DEFAULT 0,
        lease_owner text,
        lease_until timestamptz,
        accepted_at timestamptz,
        terminal_at timestamptz,
        last_error_code text,
        last_smtp_class text,
        version integer NOT NULL DEFAULT 1,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT email_deliveries_purpose_check CHECK (
          purpose IN ('verify_email', 'reset_password', 'magic_link', 'email_otp', 'security_notice')
        ),
        CONSTRAINT email_deliveries_state_check CHECK (
          state IN ('queued', 'leased', 'retry_wait', 'accepted', 'failed', 'expired')
        ),
        CONSTRAINT email_deliveries_attempt_check CHECK (attempt_count BETWEEN 0 AND 4),
        CONSTRAINT email_deliveries_version_check CHECK (version > 0),
        CONSTRAINT email_deliveries_expiry_check CHECK (
          challenge_expires_at > created_at AND not_before <= challenge_expires_at
          AND next_attempt_at <= challenge_expires_at
        ),
        CONSTRAINT email_deliveries_payload_check CHECK (
          (payload_ciphertext IS NULL AND payload_iv IS NULL AND payload_tag IS NULL AND payload_key_id IS NULL
            AND state IN ('accepted', 'failed', 'expired'))
          OR (payload_ciphertext IS NOT NULL AND payload_iv IS NOT NULL AND payload_tag IS NOT NULL
            AND octet_length(payload_iv) = 12 AND octet_length(payload_tag) = 16
            AND payload_key_id IS NOT NULL)
        ),
        CONSTRAINT email_deliveries_lease_check CHECK (
          (state = 'leased' AND lease_owner IS NOT NULL AND lease_until IS NOT NULL)
          OR (state <> 'leased' AND lease_owner IS NULL AND lease_until IS NULL)
        ),
        CONSTRAINT email_deliveries_terminal_check CHECK (
          (state IN ('accepted', 'failed', 'expired') AND terminal_at IS NOT NULL)
          OR (state NOT IN ('accepted', 'failed', 'expired') AND terminal_at IS NULL)
        ),
        CONSTRAINT email_deliveries_acceptance_check CHECK (accepted_at IS NULL OR state = 'accepted'),
        CONSTRAINT email_deliveries_text_bounds_check CHECK (
          char_length(template_version) BETWEEN 1 AND 128
          AND char_length(deduplication_hmac) BETWEEN 1 AND 512
          AND char_length(message_id) BETWEEN 1 AND 512
          AND (payload_key_id IS NULL OR char_length(payload_key_id) <= 128)
          AND (payload_ciphertext IS NULL OR octet_length(payload_ciphertext) <= 16384)
          AND (lease_owner IS NULL OR char_length(lease_owner) <= 512)
          AND (last_error_code IS NULL OR char_length(last_error_code) <= 128)
          AND (last_smtp_class IS NULL OR char_length(last_smtp_class) <= 128)
        )
      );
      CREATE INDEX email_deliveries_due_idx ON identity.email_deliveries (next_attempt_at, created_at)
        WHERE state IN ('queued', 'retry_wait');
      CREATE INDEX email_deliveries_lease_idx ON identity.email_deliveries (lease_until)
        WHERE state = 'leased';
      CREATE INDEX email_deliveries_expiry_idx ON identity.email_deliveries (challenge_expires_at);
      CREATE INDEX email_deliveries_terminal_idx ON identity.email_deliveries (terminal_at)
        WHERE terminal_at IS NOT NULL;

      CREATE TABLE identity.sso_provider_applications (
        id uuid PRIMARY KEY,
        provider_id text NOT NULL,
        application_id uuid NOT NULL REFERENCES identity.applications(id) ON DELETE RESTRICT,
        enabled boolean NOT NULL DEFAULT false,
        version integer NOT NULL DEFAULT 1,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT sso_provider_applications_pair_unique UNIQUE (provider_id, application_id),
        CONSTRAINT sso_provider_applications_provider_bound_check CHECK (char_length(provider_id) BETWEEN 1 AND 512),
        CONSTRAINT sso_provider_applications_version_check CHECK (version > 0)
      );
      CREATE INDEX sso_provider_applications_app_enabled_idx
        ON identity.sso_provider_applications (application_id, enabled);

      CREATE TABLE identity.sso_provider_policies (
        provider_id text PRIMARY KEY,
        status text NOT NULL DEFAULT 'provisioning',
        last_operation_id uuid,
        version integer NOT NULL DEFAULT 1,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT sso_provider_policies_status_check CHECK (
          status IN ('provisioning', 'active', 'disabled', 'failed')
        ),
        CONSTRAINT sso_provider_policies_provider_bound_check CHECK (char_length(provider_id) BETWEEN 1 AND 512),
        CONSTRAINT sso_provider_policies_version_check CHECK (version > 0)
      );

      CREATE TABLE identity.sso_identity_bindings (
        id uuid PRIMARY KEY,
        provider_id text NOT NULL,
        issuer text NOT NULL,
        subject text NOT NULL,
        user_id text NOT NULL,
        status text NOT NULL DEFAULT 'active',
        approver text NOT NULL,
        evidence_reference text NOT NULL,
        version integer NOT NULL DEFAULT 1,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT sso_identity_bindings_identity_unique UNIQUE (provider_id, issuer, subject),
        CONSTRAINT sso_identity_bindings_status_check CHECK (status IN ('active', 'revoked')),
        CONSTRAINT sso_identity_bindings_version_check CHECK (version > 0),
        CONSTRAINT sso_identity_bindings_evidence_check CHECK (
          char_length(approver) BETWEEN 1 AND 512 AND char_length(evidence_reference) BETWEEN 1 AND 2048
        ),
        CONSTRAINT sso_identity_bindings_text_bounds_check CHECK (
          char_length(provider_id) BETWEEN 1 AND 512 AND char_length(issuer) BETWEEN 1 AND 2048
          AND char_length(subject) BETWEEN 1 AND 2048 AND char_length(user_id) BETWEEN 1 AND 512
        )
      );
      CREATE INDEX sso_identity_bindings_user_state_idx ON identity.sso_identity_bindings (user_id, status);

      CREATE TABLE identity.admin_operations (
        id uuid PRIMARY KEY,
        kind text NOT NULL,
        actor_id text NOT NULL,
        application_id uuid REFERENCES identity.applications(id) ON DELETE RESTRICT,
        idempotency_key_hmac text NOT NULL,
        request_fingerprint text NOT NULL,
        target_reference text NOT NULL,
        phase text NOT NULL DEFAULT 'pending',
        result_reference text,
        lease_owner text,
        lease_until timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT admin_operations_idempotency_unique UNIQUE (actor_id, kind, idempotency_key_hmac),
        CONSTRAINT admin_operations_phase_check CHECK (
          phase IN ('pending', 'native_applied', 'policy_applied', 'completed', 'failed')
        ),
        CONSTRAINT admin_operations_lease_check CHECK (
          (lease_owner IS NULL AND lease_until IS NULL) OR
          (lease_owner IS NOT NULL AND lease_until IS NOT NULL)
        ),
        CONSTRAINT admin_operations_text_bounds_check CHECK (
          char_length(kind) BETWEEN 1 AND 128 AND char_length(actor_id) BETWEEN 1 AND 512
          AND char_length(idempotency_key_hmac) BETWEEN 1 AND 512
          AND char_length(request_fingerprint) BETWEEN 1 AND 512
          AND char_length(target_reference) BETWEEN 1 AND 2048
          AND (result_reference IS NULL OR char_length(result_reference) <= 2048)
          AND (lease_owner IS NULL OR char_length(lease_owner) <= 512)
        )
      );
      CREATE INDEX admin_operations_phase_updated_idx ON identity.admin_operations (phase, updated_at);
      CREATE INDEX admin_operations_target_idx ON identity.admin_operations (target_reference);

      CREATE TABLE identity.bootstrap_runs (
        id uuid PRIMARY KEY,
        application_id uuid NOT NULL REFERENCES identity.applications(id) ON DELETE RESTRICT,
        normalized_identity_hmac text NOT NULL UNIQUE,
        native_user_id text,
        phase text NOT NULL DEFAULT 'pending',
        version integer NOT NULL DEFAULT 1,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT bootstrap_runs_phase_check CHECK (
          phase IN ('pending', 'native_applied', 'policy_applied', 'verification_pending',
            'password_change_required', 'mfa_enrollment_required', 'completed', 'failed')
        ),
        CONSTRAINT bootstrap_runs_text_bounds_check CHECK (
          char_length(normalized_identity_hmac) BETWEEN 1 AND 512
          AND (native_user_id IS NULL OR char_length(native_user_id) <= 512)
        ),
        CONSTRAINT bootstrap_runs_version_check CHECK (version > 0)
      );

      CREATE TABLE identity.abuse_windows (
        scope text NOT NULL,
        subject_hmac text NOT NULL,
        window_start timestamptz NOT NULL,
        count integer NOT NULL DEFAULT 0,
        expires_at timestamptz NOT NULL,
        PRIMARY KEY (scope, subject_hmac, window_start),
        CONSTRAINT abuse_windows_count_check CHECK (count >= 0),
        CONSTRAINT abuse_windows_text_bounds_check CHECK (
          char_length(scope) BETWEEN 1 AND 128 AND char_length(subject_hmac) BETWEEN 1 AND 512
        ),
        CONSTRAINT abuse_windows_expiry_check CHECK (expires_at > window_start)
      );
      CREATE INDEX abuse_windows_expiry_idx ON identity.abuse_windows (expires_at);

      CREATE TABLE identity.mfa_replay_claims (
        user_id text NOT NULL,
        code_fingerprint text NOT NULL,
        expires_at timestamptz NOT NULL,
        PRIMARY KEY (user_id, code_fingerprint),
        CONSTRAINT mfa_replay_claims_text_bounds_check CHECK (
          char_length(user_id) BETWEEN 1 AND 512 AND char_length(code_fingerprint) BETWEEN 1 AND 512
        )
      );
      CREATE INDEX mfa_replay_claims_expiry_idx ON identity.mfa_replay_claims (expires_at);

      CREATE TABLE identity.operation_leases (
        resource text NOT NULL,
        lease_key text NOT NULL,
        owner_token text NOT NULL,
        lease_until timestamptz NOT NULL,
        version integer NOT NULL DEFAULT 1,
        PRIMARY KEY (resource, lease_key),
        CONSTRAINT operation_leases_text_bounds_check CHECK (
          char_length(resource) BETWEEN 1 AND 128 AND char_length(lease_key) BETWEEN 1 AND 512
          AND char_length(owner_token) BETWEEN 1 AND 512
        ),
        CONSTRAINT operation_leases_version_check CHECK (version > 0)
      );
      CREATE INDEX operation_leases_expiry_idx ON identity.operation_leases (lease_until);

      CREATE TABLE audit.security_events (
        id uuid PRIMARY KEY,
        occurred_at timestamptz NOT NULL DEFAULT now(),
        request_id text NOT NULL,
        event_name text NOT NULL,
        action text NOT NULL,
        actor_id text,
        user_id text,
        application_id uuid,
        target_reference text,
        result text NOT NULL,
        reason_code text,
        metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
        ip_address inet,
        user_agent text,
        operation_id uuid,
        CONSTRAINT security_events_result_check CHECK (result IN ('success', 'denied', 'failure', 'pending')),
        CONSTRAINT security_events_names_check CHECK (
          char_length(request_id) BETWEEN 1 AND 128 AND char_length(event_name) BETWEEN 1 AND 128
          AND char_length(action) BETWEEN 1 AND 128
        ),
        CONSTRAINT security_events_metadata_check CHECK (
          jsonb_typeof(metadata) = 'object' AND octet_length(metadata::text) <= 8192
        ),
        CONSTRAINT security_events_agent_check CHECK (user_agent IS NULL OR char_length(user_agent) <= 2048),
        CONSTRAINT security_events_text_bounds_check CHECK (
          (actor_id IS NULL OR char_length(actor_id) <= 512)
          AND (user_id IS NULL OR char_length(user_id) <= 512)
          AND (target_reference IS NULL OR char_length(target_reference) <= 2048)
          AND (reason_code IS NULL OR char_length(reason_code) <= 128)
        )
      );
      CREATE INDEX security_events_occurred_idx ON audit.security_events (occurred_at, id);
      CREATE INDEX security_events_user_occurred_idx ON audit.security_events (user_id, occurred_at);
      CREATE INDEX security_events_app_occurred_idx ON audit.security_events (application_id, occurred_at);
      CREATE INDEX security_events_operation_idx ON audit.security_events (operation_id)
        WHERE operation_id IS NOT NULL;

      GRANT SELECT, INSERT, UPDATE, DELETE ON
        identity.email_deliveries, identity.sso_provider_applications,
        identity.sso_provider_policies, identity.sso_identity_bindings,
        identity.admin_operations, identity.bootstrap_runs,
        identity.abuse_windows, identity.mfa_replay_claims, identity.operation_leases
      TO identity_policy_runtime;
      GRANT SELECT, DELETE ON
        identity.email_deliveries, identity.abuse_windows, identity.mfa_replay_claims,
        identity.operation_leases
      TO identity_retention_maintenance;
      GRANT INSERT ON audit.security_events TO identity_audit_runtime;
      GRANT SELECT ON audit.security_events TO identity_audit_reader;
      GRANT SELECT (id, occurred_at, user_id), DELETE ON audit.security_events TO identity_retention_maintenance;
      GRANT UPDATE (actor_id, user_id, target_reference, metadata, ip_address, user_agent)
        ON audit.security_events TO identity_retention_maintenance;
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TABLE audit.security_events;
      DROP TABLE identity.operation_leases;
      DROP TABLE identity.mfa_replay_claims;
      DROP TABLE identity.abuse_windows;
      DROP TABLE identity.bootstrap_runs;
      DROP TABLE identity.admin_operations;
      DROP TABLE identity.sso_identity_bindings;
      DROP TABLE identity.sso_provider_policies;
      DROP TABLE identity.sso_provider_applications;
      DROP TABLE identity.email_deliveries;
    `);
  }
}
