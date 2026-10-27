import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';
import { mutationRows } from './mutation-rows.js';

export interface ServicePolicyState {
  user_id: string;
  application_id: string;
  application_version: number;
  membership_role: 'member' | 'app_admin';
  membership_version: number;
  security_epoch: string;
  account_kind: 'human' | 'service';
  assurance_state: 'primary_only' | 'verified';
  assurance_version: number;
  mfa_verified_at: Date | null;
  provider_id: string | null;
}

/**
 * Primary-database policy state. This is not an authorization decision: callers
 * must also validate the current native user/session and required assurance.
 */
@Injectable()
export class IdentityRepository {
  constructor(private readonly database: DatabaseService) {}

  async loadServicePolicyState(
    userId: string,
    applicationId: string,
    sessionId: string,
  ): Promise<ServicePolicyState | null> {
    const rows = await this.database
      .getDataSource()
      .query<ServicePolicyState[]>(
        `SELECT p.user_id, a.id AS application_id, a.version AS application_version,
              m.role AS membership_role, m.version AS membership_version,
              p.security_epoch, p.kind AS account_kind,
              s.state AS assurance_state, s.version AS assurance_version,
              s.mfa_verified_at, s.provider_id
       FROM identity.account_policies p
       JOIN identity.application_memberships m ON m.user_id = p.user_id
       JOIN identity.applications a ON a.id = m.application_id
       JOIN identity.session_assurance s ON s.user_id = p.user_id
         AND s.application_id = a.id AND s.security_epoch = p.security_epoch
       WHERE p.user_id = $1 AND a.id = $2 AND s.session_id = $3
         AND p.lifecycle = 'active' AND p.bootstrap_state = 'active'
         AND a.status = 'active' AND m.status = 'active'`,
        [userId, applicationId, sessionId],
      );
    return rows[0] ?? null;
  }

  /** Versioned policy edit; a competing edit must reload before retrying. */
  async updateMembership(input: {
    applicationId: string;
    userId: string;
    version: number;
    role: 'member' | 'app_admin';
    status: 'active' | 'suspended';
  }): Promise<number | null> {
    if (
      !input.applicationId ||
      !input.userId ||
      !Number.isInteger(input.version) ||
      input.version < 1 ||
      !['member', 'app_admin'].includes(input.role) ||
      !['active', 'suspended'].includes(input.status)
    ) {
      throw new Error('Invalid membership update');
    }
    const rows = mutationRows<{ version: number }>(
      await this.database.getDataSource().query(
        `UPDATE identity.application_memberships
       SET role = $4, status = $5, version = version + 1, updated_at = now()
       WHERE application_id = $1 AND user_id = $2 AND version = $3
       RETURNING version`,
        [
          input.applicationId,
          input.userId,
          input.version,
          input.role,
          input.status,
        ],
      ),
    );
    return rows[0]?.version ?? null;
  }

  /** Call only after the native factor succeeds for this exact user/session. */
  async promoteAssuranceAfterFactor(input: {
    sessionId: string;
    userId: string;
    applicationId: string;
    version: number;
    securityEpoch: string;
    mfaMethod: 'totp' | 'recovery_code';
  }): Promise<number | null> {
    if (
      !input.sessionId ||
      !input.userId ||
      !input.applicationId ||
      !Number.isInteger(input.version) ||
      input.version < 1 ||
      !/^[1-9]\d{0,18}$/.test(input.securityEpoch) ||
      BigInt(input.securityEpoch) > 9_223_372_036_854_775_807n ||
      !['totp', 'recovery_code'].includes(input.mfaMethod)
    ) {
      throw new Error('Invalid assurance promotion');
    }
    const rows = mutationRows<{ version: number }>(
      await this.database.getDataSource().query(
        `UPDATE identity.session_assurance s
       SET state = 'verified', mfa_method = $6, mfa_verified_at = now(),
           version = s.version + 1, updated_at = now()
       WHERE s.session_id = $1 AND s.user_id = $2 AND s.application_id = $3
         AND s.version = $4 AND s.security_epoch = $5::bigint
         AND s.state = 'primary_only' AND s.pending_expires_at > now()
         AND EXISTS (
           SELECT 1 FROM identity.account_policies p
           JOIN identity.application_memberships m
             ON m.user_id = p.user_id AND m.application_id = s.application_id
           JOIN identity.applications a ON a.id = m.application_id
           WHERE p.user_id = s.user_id AND p.security_epoch = s.security_epoch
             AND p.lifecycle = 'active' AND m.status = 'active'
             AND a.status = 'active'
         )
       RETURNING s.version`,
        [
          input.sessionId,
          input.userId,
          input.applicationId,
          input.version,
          input.securityEpoch,
          input.mfaMethod,
        ],
      ),
    );
    return rows[0]?.version ?? null;
  }

  /** One atomic per-scope attempt budget shared by all service replicas. */
  async countAbuseAttempt(input: {
    scope: string;
    subjectHmac: string;
    windowStart: Date;
    expiresAt: Date;
    limit: number;
  }): Promise<{ allowed: boolean; count: number | null }> {
    if (!/^[a-z][a-z0-9_.-]{0,63}$/.test(input.scope)) {
      throw new Error('Invalid abuse scope');
    }
    if (!/^[A-Za-z0-9_-]{32,256}$/.test(input.subjectHmac)) {
      throw new Error('Invalid abuse subject HMAC');
    }
    if (
      !Number.isInteger(input.limit) ||
      input.limit < 1 ||
      input.limit > 100_000
    ) {
      throw new Error('Invalid abuse limit');
    }
    const now = Date.now();
    if (
      Number.isNaN(input.windowStart.getTime()) ||
      Number.isNaN(input.expiresAt.getTime()) ||
      input.windowStart.getTime() > now ||
      input.expiresAt.getTime() <= now ||
      input.expiresAt.getTime() > now + 24 * 60 * 60 * 1000
    ) {
      throw new Error('Invalid abuse window');
    }
    const rows = await this.database
      .getDataSource()
      .query<Array<{ count: number }>>(
        `INSERT INTO identity.abuse_windows
         (scope, subject_hmac, window_start, count, expires_at)
       VALUES ($1, $2, $3, 1, $4)
       ON CONFLICT (scope, subject_hmac, window_start) DO UPDATE
         SET count = CASE WHEN identity.abuse_windows.expires_at <= now()
                          THEN 1 ELSE identity.abuse_windows.count + 1 END,
             expires_at = CASE WHEN identity.abuse_windows.expires_at <= now()
                               THEN EXCLUDED.expires_at ELSE identity.abuse_windows.expires_at END
       WHERE identity.abuse_windows.expires_at <= now()
          OR identity.abuse_windows.count < $5
       RETURNING count`,
        [
          input.scope,
          input.subjectHmac,
          input.windowStart,
          input.expiresAt,
          input.limit,
        ],
      );
    return { allowed: rows.length === 1, count: rows[0]?.count ?? null };
  }

  /** Call only after native TOTP verification succeeds; an unexpired claim wins. */
  async claimMfaReplay(
    userId: string,
    codeFingerprint: string,
  ): Promise<boolean> {
    if (!userId || !/^[A-Za-z0-9_-]{32,256}$/.test(codeFingerprint)) {
      throw new Error('Invalid MFA replay claim');
    }
    const rows = await this.database
      .getDataSource()
      .query<Array<{ user_id: string }>>(
        `INSERT INTO identity.mfa_replay_claims (user_id, code_fingerprint, expires_at)
       VALUES ($1, $2, now() + interval '90 seconds')
       ON CONFLICT (user_id, code_fingerprint) DO UPDATE
         SET expires_at = EXCLUDED.expires_at
       WHERE identity.mfa_replay_claims.expires_at <= now()
       RETURNING user_id`,
        [userId, codeFingerprint],
      );
    return rows.length === 1;
  }

  async acquireLease(input: {
    resource: string;
    key: string;
    ownerToken: string;
    durationSeconds: number;
  }): Promise<number | null> {
    if (
      !input.resource ||
      !input.key ||
      !input.ownerToken ||
      !Number.isInteger(input.durationSeconds) ||
      input.durationSeconds < 1 ||
      input.durationSeconds > 600
    ) {
      throw new Error('Invalid operation lease');
    }
    const rows = await this.database
      .getDataSource()
      .query<Array<{ version: number }>>(
        `INSERT INTO identity.operation_leases
         (resource, lease_key, owner_token, lease_until, version)
       VALUES ($1, $2, $3, now() + $4 * interval '1 second', 1)
       ON CONFLICT (resource, lease_key) DO UPDATE
         SET owner_token = EXCLUDED.owner_token,
             lease_until = EXCLUDED.lease_until,
             version = identity.operation_leases.version + 1
       WHERE identity.operation_leases.lease_until <= now()
       RETURNING version`,
        [input.resource, input.key, input.ownerToken, input.durationSeconds],
      );
    return rows[0]?.version ?? null;
  }

  async renewLease(input: {
    resource: string;
    key: string;
    ownerToken: string;
    version: number;
    durationSeconds: number;
  }): Promise<number | null> {
    if (
      !Number.isInteger(input.version) ||
      input.version < 1 ||
      !Number.isInteger(input.durationSeconds) ||
      input.durationSeconds < 1 ||
      input.durationSeconds > 600
    ) {
      throw new Error('Invalid operation lease renewal');
    }
    const rows = mutationRows<{ version: number }>(
      await this.database.getDataSource().query(
        `UPDATE identity.operation_leases
       SET lease_until = now() + $5 * interval '1 second', version = version + 1
       WHERE resource = $1 AND lease_key = $2 AND owner_token = $3
         AND version = $4 AND lease_until > now()
       RETURNING version`,
        [
          input.resource,
          input.key,
          input.ownerToken,
          input.version,
          input.durationSeconds,
        ],
      ),
    );
    return rows[0]?.version ?? null;
  }

  async releaseLease(input: {
    resource: string;
    key: string;
    ownerToken: string;
    version: number;
  }): Promise<boolean> {
    const rows = mutationRows<{ version: number }>(
      await this.database.getDataSource().query(
        `DELETE FROM identity.operation_leases
       WHERE resource = $1 AND lease_key = $2 AND owner_token = $3 AND version = $4
       RETURNING version`,
        [input.resource, input.key, input.ownerToken, input.version],
      ),
    );
    return rows.length === 1;
  }
}
