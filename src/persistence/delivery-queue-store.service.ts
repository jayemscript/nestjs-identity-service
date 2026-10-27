import { Injectable } from '@nestjs/common';
import { validate as isUuid, version as uuidVersion } from 'uuid';
import { DatabaseService } from '../database/database.service.js';
import { mutationRows } from './mutation-rows.js';

export interface SealedDelivery {
  ciphertext: Buffer;
  iv: Buffer;
  tag: Buffer;
  keyId: string;
}

export interface DeliveryJobInput {
  /** Generate this UUIDv7 before sealing; bind it into the payload's AAD. */
  id: string;
  purpose:
    | 'verify_email'
    | 'reset_password'
    | 'magic_link'
    | 'email_otp'
    | 'security_notice';
  templateVersion: string;
  applicationId: string;
  sealed: SealedDelivery;
  deduplicationHmac: string;
  messageId: string;
  challengeExpiresAt: Date;
  notBefore: Date;
}

export interface LeasedDelivery {
  id: string;
  purpose: DeliveryJobInput['purpose'];
  application_id: string;
  payload_ciphertext: Buffer;
  payload_iv: Buffer;
  payload_tag: Buffer;
  payload_key_id: string;
  message_id: string;
  challenge_expires_at: Date;
  attempt_count: number;
  lease_until: Date;
  version: number;
}

/** Ciphertext-only queue persistence. Rendering and SMTP transport belong to Session 4. */
@Injectable()
export class DeliveryQueueStore {
  constructor(private readonly database: DatabaseService) {}

  async enqueueSealed(input: DeliveryJobInput): Promise<string> {
    if (
      !isUuid(input.id) ||
      uuidVersion(input.id) !== 7 ||
      input.sealed.iv.length !== 12 ||
      input.sealed.tag.length !== 16 ||
      input.sealed.ciphertext.length === 0 ||
      !input.sealed.keyId ||
      !input.deduplicationHmac ||
      !input.messageId ||
      input.challengeExpiresAt.getTime() <= Date.now() + 30_000 ||
      input.notBefore.getTime() > input.challengeExpiresAt.getTime()
    ) {
      throw new Error('Invalid sealed delivery');
    }
    const source = this.database.getDataSource();
    const inserted = await source.query<{ id: string }[]>(
      `INSERT INTO identity.email_deliveries (
        id, purpose, template_version, application_id,
        payload_ciphertext, payload_iv, payload_tag, payload_key_id,
        deduplication_hmac, message_id, challenge_expires_at, not_before,
        next_attempt_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12)
      ON CONFLICT (deduplication_hmac) DO NOTHING RETURNING id`,
      [
        input.id,
        input.purpose,
        input.templateVersion,
        input.applicationId,
        input.sealed.ciphertext,
        input.sealed.iv,
        input.sealed.tag,
        input.sealed.keyId,
        input.deduplicationHmac,
        input.messageId,
        input.challengeExpiresAt,
        input.notBefore,
      ],
    );
    if (inserted[0]) return inserted[0].id;
    const existing = await source.query<
      Array<{
        id: string;
        purpose: DeliveryJobInput['purpose'];
        template_version: string;
        application_id: string;
        message_id: string;
        challenge_expires_at: Date;
        not_before: Date;
      }>
    >(
      `SELECT id, purpose, template_version, application_id, message_id,
              challenge_expires_at, not_before
       FROM identity.email_deliveries WHERE deduplication_hmac = $1`,
      [input.deduplicationHmac],
    );
    const prior = existing[0];
    if (
      !prior ||
      prior.id !== input.id ||
      prior.purpose !== input.purpose ||
      prior.template_version !== input.templateVersion ||
      prior.application_id !== input.applicationId ||
      prior.message_id !== input.messageId ||
      prior.challenge_expires_at.getTime() !==
        input.challengeExpiresAt.getTime() ||
      prior.not_before.getTime() !== input.notBefore.getTime()
    ) {
      throw new Error('Delivery deduplication conflict');
    }
    return prior.id;
  }

  /** Claim and fence one due job in a single PostgreSQL statement. */
  async claimDue(ownerToken: string): Promise<LeasedDelivery | null> {
    if (!/^[A-Za-z0-9_-]{16,128}$/.test(ownerToken)) {
      throw new Error('Invalid delivery lease owner');
    }
    const rows = mutationRows<LeasedDelivery>(
      await this.database.getDataSource().query(
        `WITH candidate AS (
         SELECT id FROM identity.email_deliveries
         WHERE state IN ('queued', 'retry_wait') AND next_attempt_at <= now()
           AND challenge_expires_at > now() + interval '30 seconds'
           AND attempt_count < 4
         ORDER BY next_attempt_at, created_at
         FOR UPDATE SKIP LOCKED LIMIT 1
       )
       UPDATE identity.email_deliveries d
       SET state = 'leased', attempt_count = attempt_count + 1,
           lease_owner = $1, lease_until = now() + interval '60 seconds',
           version = version + 1, updated_at = now()
       FROM candidate WHERE d.id = candidate.id
       RETURNING d.id, d.purpose, d.application_id, d.payload_ciphertext,
         d.payload_iv, d.payload_tag, d.payload_key_id, d.message_id,
         d.challenge_expires_at, d.attempt_count, d.lease_until, d.version`,
        [ownerToken],
      ),
    );
    return rows[0] ?? null;
  }

  /** Purge ciphertext as part of the terminal update; stale workers cannot finalize. */
  async finish(input: {
    id: string;
    ownerToken: string;
    version: number;
    outcome: 'accepted' | 'failed' | 'expired';
    errorCode?: string;
    smtpClass?: string;
  }): Promise<boolean> {
    const rows = mutationRows<{ id: string }>(
      await this.database.getDataSource().query(
        `UPDATE identity.email_deliveries
       SET state = $4, payload_ciphertext = NULL, payload_iv = NULL,
           payload_tag = NULL, payload_key_id = NULL,
           lease_owner = NULL, lease_until = NULL,
           accepted_at = CASE WHEN $4 = 'accepted' THEN now() ELSE NULL END,
           terminal_at = now(), last_error_code = $5, last_smtp_class = $6,
           version = version + 1, updated_at = now()
       WHERE id = $1 AND lease_owner = $2 AND version = $3
         AND state = 'leased' AND lease_until > now()
       RETURNING id`,
        [
          input.id,
          input.ownerToken,
          input.version,
          input.outcome,
          input.errorCode ?? null,
          input.smtpClass ?? null,
        ],
      ),
    );
    return rows.length === 1;
  }

  /** Delay from failure time: 15, 60, or 180 seconds after attempts 1–3. */
  async retry(input: {
    id: string;
    ownerToken: string;
    version: number;
    errorCode: string;
    smtpClass?: string;
  }): Promise<boolean> {
    const rows = mutationRows<{ id: string }>(
      await this.database.getDataSource().query(
        `UPDATE identity.email_deliveries
       SET state = 'retry_wait', lease_owner = NULL, lease_until = NULL,
           next_attempt_at = now() + CASE attempt_count
             WHEN 1 THEN interval '15 seconds'
             WHEN 2 THEN interval '60 seconds'
             WHEN 3 THEN interval '180 seconds' END,
           last_error_code = $4, last_smtp_class = $5,
           version = version + 1, updated_at = now()
       WHERE id = $1 AND lease_owner = $2 AND version = $3
         AND state = 'leased' AND lease_until > now() AND attempt_count < 4
         AND challenge_expires_at > now() + interval '30 seconds' +
           CASE attempt_count WHEN 1 THEN interval '15 seconds'
             WHEN 2 THEN interval '60 seconds' WHEN 3 THEN interval '180 seconds' END
       RETURNING id`,
        [
          input.id,
          input.ownerToken,
          input.version,
          input.errorCode,
          input.smtpClass ?? null,
        ],
      ),
    );
    return rows.length === 1;
  }

  /** Expire unsendable jobs and erase their secret-bearing payloads. */
  async expireDue(limit = 100): Promise<number> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
      throw new Error('Invalid delivery expiry batch size');
    }
    const rows = mutationRows<{ id: string }>(
      await this.database.getDataSource().query(
        `WITH due AS (
         SELECT id FROM identity.email_deliveries
         WHERE state IN ('queued', 'retry_wait')
           AND challenge_expires_at <= now() + interval '30 seconds'
         ORDER BY challenge_expires_at FOR UPDATE SKIP LOCKED LIMIT $1
       )
       UPDATE identity.email_deliveries d
       SET state = 'expired', payload_ciphertext = NULL, payload_iv = NULL,
           payload_tag = NULL, payload_key_id = NULL, terminal_at = now(),
           version = version + 1, updated_at = now()
       FROM due WHERE d.id = due.id RETURNING d.id`,
        [limit],
      ),
    );
    return rows.length;
  }

  /** Recover abandoned claims without granting a stale worker completion rights. */
  async recoverExpiredLeases(limit = 100): Promise<number> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
      throw new Error('Invalid delivery recovery batch size');
    }
    const rows = mutationRows<{ id: string }>(
      await this.database.getDataSource().query(
        `WITH due AS (
         SELECT id FROM identity.email_deliveries
         WHERE state = 'leased' AND lease_until <= now()
         ORDER BY lease_until FOR UPDATE SKIP LOCKED LIMIT $1
       ), classified AS (
         SELECT d.id,
           CASE d.attempt_count WHEN 1 THEN interval '15 seconds'
             WHEN 2 THEN interval '60 seconds'
             WHEN 3 THEN interval '180 seconds' ELSE NULL END AS delay,
           d.challenge_expires_at, d.attempt_count
         FROM identity.email_deliveries d JOIN due ON due.id = d.id
       )
       UPDATE identity.email_deliveries d
       SET state = CASE WHEN c.delay IS NOT NULL AND
                  c.challenge_expires_at > now() + c.delay + interval '30 seconds'
                  THEN 'retry_wait' ELSE 'expired' END,
           next_attempt_at = CASE WHEN c.delay IS NOT NULL AND
                  c.challenge_expires_at > now() + c.delay + interval '30 seconds'
                  THEN now() + c.delay ELSE d.next_attempt_at END,
           payload_ciphertext = CASE WHEN c.delay IS NOT NULL AND
                  c.challenge_expires_at > now() + c.delay + interval '30 seconds'
                  THEN d.payload_ciphertext ELSE NULL END,
           payload_iv = CASE WHEN c.delay IS NOT NULL AND
                  c.challenge_expires_at > now() + c.delay + interval '30 seconds'
                  THEN d.payload_iv ELSE NULL END,
           payload_tag = CASE WHEN c.delay IS NOT NULL AND
                  c.challenge_expires_at > now() + c.delay + interval '30 seconds'
                  THEN d.payload_tag ELSE NULL END,
           payload_key_id = CASE WHEN c.delay IS NOT NULL AND
                  c.challenge_expires_at > now() + c.delay + interval '30 seconds'
                  THEN d.payload_key_id ELSE NULL END,
           terminal_at = CASE WHEN c.delay IS NOT NULL AND
                  c.challenge_expires_at > now() + c.delay + interval '30 seconds'
                  THEN NULL ELSE now() END,
           lease_owner = NULL, lease_until = NULL,
           last_error_code = 'LEASE_EXPIRED',
           version = d.version + 1, updated_at = now()
       FROM classified c WHERE d.id = c.id RETURNING d.id`,
        [limit],
      ),
    );
    return rows.length;
  }
}
