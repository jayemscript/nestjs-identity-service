import { Injectable } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import { DatabaseService } from '../database/database.service.js';
import { mutationRows } from './mutation-rows.js';

export interface MobileClientStateEnvelope {
  ciphertext: Buffer;
  iv: Buffer;
  tag: Buffer;
  keyId: string;
}

/** Atomic persistence transitions; the hosted gateway performs browser and PKCE proof. */
@Injectable()
export class MobileTransactionStore {
  constructor(private readonly database: DatabaseService) {}

  async create(input: {
    applicationId: string;
    returnUri: string;
    platform: 'ios' | 'android';
    codeChallenge: string;
    clientStateHash: string;
    clientState: MobileClientStateEnvelope;
  }): Promise<string | null> {
    if (
      !/^[A-Za-z0-9_-]{43}$/.test(input.codeChallenge) ||
      input.clientState.iv.length !== 12 ||
      input.clientState.tag.length !== 16 ||
      input.clientState.ciphertext.length === 0 ||
      !input.clientState.keyId
    ) {
      throw new Error('Invalid mobile transaction');
    }
    const id = uuidv7();
    const rows = await this.database.getDataSource().query<{ id: string }[]>(
      `INSERT INTO identity.mobile_auth_transactions (
         id, application_id, return_uri, platform, code_challenge,
         client_state_hash, client_state_ciphertext, client_state_iv,
         client_state_tag, client_state_key_id, expires_at
       )
       SELECT $1, a.id, $3, $4, $5, $6, $7, $8, $9, $10,
              now() + interval '10 minutes'
       FROM identity.applications a
       JOIN identity.mobile_clients m ON m.application_id = a.id
       WHERE a.id = $2 AND a.status = 'active' AND m.status = 'active'
         AND 'bearer' = ANY(a.allowed_transports)
         AND m.auth_origin = a.public_origin
         AND $3 = ANY(m.allowed_return_uris)
         AND (($4 = 'ios' AND m.ios_bundle_id IS NOT NULL)
              OR ($4 = 'android' AND m.android_package_name IS NOT NULL))
       RETURNING id`,
      [
        id,
        input.applicationId,
        input.returnUri,
        input.platform,
        input.codeChallenge,
        input.clientStateHash,
        input.clientState.ciphertext,
        input.clientState.iv,
        input.clientState.tag,
        input.clientState.keyId,
      ],
    );
    return rows[0]?.id ?? null;
  }

  async markBrowserVerified(input: {
    id: string;
    applicationId: string;
    version: number;
    nativeSessionId: string;
    browserBindingHmac: string;
  }): Promise<number | null> {
    const rows = mutationRows<{ version: number }>(
      await this.database.getDataSource().query(
        `UPDATE identity.mobile_auth_transactions
       SET status = 'browser_verified', native_session_id = $4,
           browser_binding_hmac = $5, version = version + 1, updated_at = now()
       WHERE id = $1 AND application_id = $2 AND version = $3
         AND status = 'pending' AND expires_at > now()
       RETURNING version`,
        [
          input.id,
          input.applicationId,
          input.version,
          input.nativeSessionId,
          input.browserBindingHmac,
        ],
      ),
    );
    return rows[0]?.version ?? null;
  }

  async markCodeIssued(input: {
    id: string;
    applicationId: string;
    version: number;
    oneTimeTokenHmac: string;
  }): Promise<number | null> {
    const rows = mutationRows<{ version: number }>(
      await this.database.getDataSource().query(
        `UPDATE identity.mobile_auth_transactions
       SET status = 'code_issued', one_time_token_hmac = $4,
           code_expires_at = LEAST(expires_at, now() + interval '1 minute'),
           version = version + 1, updated_at = now()
       WHERE id = $1 AND application_id = $2 AND version = $3
         AND status = 'browser_verified' AND expires_at > now()
       RETURNING version`,
        [input.id, input.applicationId, input.version, input.oneTimeTokenHmac],
      ),
    );
    return rows[0]?.version ?? null;
  }

  async beginExchange(input: {
    id: string;
    applicationId: string;
    version: number;
    oneTimeTokenHmac: string;
  }): Promise<number | null> {
    const rows = mutationRows<{ version: number }>(
      await this.database.getDataSource().query(
        `UPDATE identity.mobile_auth_transactions
       SET status = 'exchanging', version = version + 1, updated_at = now()
       WHERE id = $1 AND application_id = $2 AND version = $3
         AND status = 'code_issued' AND one_time_token_hmac = $4
         AND expires_at > now() AND code_expires_at > now()
       RETURNING version`,
        [input.id, input.applicationId, input.version, input.oneTimeTokenHmac],
      ),
    );
    return rows[0]?.version ?? null;
  }

  /** Never allow a completed, failed, expired, or in-flight exchange to restart. */
  async finishExchange(input: {
    id: string;
    applicationId: string;
    version: number;
    result: 'completed' | 'failed';
  }): Promise<boolean> {
    const rows = mutationRows<{ id: string }>(
      await this.database.getDataSource().query(
        `UPDATE identity.mobile_auth_transactions
       SET status = $4, client_state_ciphertext = NULL, client_state_iv = NULL,
           client_state_tag = NULL, client_state_key_id = NULL,
           browser_binding_hmac = NULL, version = version + 1, updated_at = now()
       WHERE id = $1 AND application_id = $2 AND version = $3
         AND status = 'exchanging' AND expires_at > now()
       RETURNING id`,
        [input.id, input.applicationId, input.version, input.result],
      ),
    );
    return rows.length === 1;
  }

  async expireDue(limit = 100): Promise<number> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
      throw new Error('Invalid mobile expiry batch size');
    }
    const rows = mutationRows<{ id: string }>(
      await this.database.getDataSource().query(
        `WITH due AS (
         SELECT id FROM identity.mobile_auth_transactions
         WHERE status NOT IN ('completed', 'failed', 'expired') AND expires_at <= now()
         ORDER BY expires_at FOR UPDATE SKIP LOCKED LIMIT $1
       )
       UPDATE identity.mobile_auth_transactions t
       SET status = 'expired', client_state_ciphertext = NULL,
           client_state_iv = NULL, client_state_tag = NULL,
           client_state_key_id = NULL, browser_binding_hmac = NULL,
           version = version + 1, updated_at = now()
       FROM due WHERE t.id = due.id RETURNING t.id`,
        [limit],
      ),
    );
    return rows.length;
  }
}
