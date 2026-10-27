import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import { config as loadDotEnv } from 'dotenv';
import { DataSource, type QueryRunner } from 'typeorm';
import { v7 as uuidv7 } from 'uuid';
import { createTypeOrmDatabaseOptions } from '../database/database-config.js';
import { DatabaseService } from '../database/database.service.js';
import {
  AdminOperationConflictError,
  AdminOperationStore,
} from './admin-operation-store.service.js';
import { DeliveryQueueStore } from './delivery-queue-store.service.js';
import { IdentityRepository } from './identity-repository.service.js';
import { MobileTransactionStore } from './mobile-transaction-store.service.js';

const databaseDescribe =
  process.env.RUN_DB_INTEGRATION === '1' ? describe : describe.skip;

databaseDescribe('PostgreSQL persistence transitions', () => {
  let source: DataSource;
  let runner: QueryRunner;
  let identity: IdentityRepository;
  let delivery: DeliveryQueueStore;
  let mobile: MobileTransactionStore;
  let administration: AdminOperationStore;

  const applicationId = uuidv7();
  const returnUri = `https://mobile-${applicationId}.example/callback`;
  const origin = `https://auth-${applicationId}.example`;
  const suffix = randomBytes(24).toString('base64url');

  beforeAll(async () => {
    loadDotEnv({ quiet: true });
    source = new DataSource(
      createTypeOrmDatabaseOptions(process.env, 'identity', []),
    );
    await source.initialize();
    runner = source.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();

    const transactionSource = {
      query: (sql: string, parameters?: unknown[]) =>
        runner.query(sql, parameters),
    } as unknown as DataSource;
    const database = new DatabaseService(transactionSource);
    identity = new IdentityRepository(database);
    delivery = new DeliveryQueueStore(database);
    mobile = new MobileTransactionStore(database);
    administration = new AdminOperationStore(database);

    await runner.query(
      `INSERT INTO identity.applications
        (id, slug, name, public_origin, allowed_transports, status)
       VALUES ($1, $2, 'Persistence probe', $3, ARRAY['cookie','bearer'], 'active')`,
      [applicationId, `probe-${applicationId}`, origin],
    );
    await runner.query(
      `INSERT INTO identity.mobile_clients
        (application_id, ios_bundle_id, auth_origin, allowed_return_uris, status)
       VALUES ($1, 'example.probe', $2, ARRAY[$3]::text[], 'active')`,
      [applicationId, origin, returnUri],
    );
  });

  afterAll(async () => {
    if (runner && !runner.isReleased) {
      if (runner.isTransactionActive) await runner.rollbackTransaction();
      await runner.release();
    }
    if (source?.isInitialized) await source.destroy();
  });

  it('returns no policy state when required service records are missing or suspended', async () => {
    const userId = `policy-user-${suffix}`;
    const sessionId = `policy-session-${suffix}`;
    expect(
      await identity.loadServicePolicyState(userId, applicationId, sessionId),
    ).toBeNull();
    await runner.query(
      'INSERT INTO identity.account_policies (user_id) VALUES ($1)',
      [userId],
    );
    await runner.query(
      `INSERT INTO identity.application_memberships (application_id, user_id)
       VALUES ($1, $2)`,
      [applicationId, userId],
    );
    expect(
      await identity.loadServicePolicyState(userId, applicationId, sessionId),
    ).toBeNull();
    await runner.query(
      `INSERT INTO identity.session_assurance
        (session_id, user_id, application_id, security_epoch, primary_method,
         pending_expires_at)
       VALUES ($1, $2, $3, 1, 'password', now() + interval '10 minutes')`,
      [sessionId, userId, applicationId],
    );
    expect(
      await identity.loadServicePolicyState(userId, applicationId, sessionId),
    ).toMatchObject({ assurance_state: 'primary_only' });
    await runner.query(
      `UPDATE identity.application_memberships SET status = 'suspended'
       WHERE application_id = $1 AND user_id = $2`,
      [applicationId, userId],
    );
    expect(
      await identity.loadServicePolicyState(userId, applicationId, sessionId),
    ).toBeNull();
  });

  it('enforces abuse, replay, and lease ownership atomically', async () => {
    const attempt = {
      scope: 'probe',
      subjectHmac: suffix,
      windowStart: new Date(Date.now() - 1_000),
      expiresAt: new Date(Date.now() + 60_000),
      limit: 2,
    };
    expect(await identity.countAbuseAttempt(attempt)).toEqual({
      allowed: true,
      count: 1,
    });
    expect(await identity.countAbuseAttempt(attempt)).toEqual({
      allowed: true,
      count: 2,
    });
    expect(await identity.countAbuseAttempt(attempt)).toEqual({
      allowed: false,
      count: null,
    });

    expect(await identity.claimMfaReplay(`probe-${suffix}`, suffix)).toBe(true);
    expect(await identity.claimMfaReplay(`probe-${suffix}`, suffix)).toBe(
      false,
    );

    const lease = {
      resource: 'probe',
      key: suffix,
      ownerToken: `owner-${suffix}`,
      durationSeconds: 60,
    };
    expect(await identity.acquireLease(lease)).toBe(1);
    expect(
      await identity.acquireLease({ ...lease, ownerToken: `other-${suffix}` }),
    ).toBeNull();
    expect(await identity.renewLease({ ...lease, version: 1 })).toBe(2);
    expect(await identity.renewLease({ ...lease, version: 1 })).toBeNull();
    expect(
      await identity.releaseLease({
        ...lease,
        ownerToken: `other-${suffix}`,
        version: 2,
      }),
    ).toBe(false);
    expect(await identity.releaseLease({ ...lease, version: 2 })).toBe(true);
  });

  it('deduplicates, fences, and erases terminal delivery ciphertext', async () => {
    const input = {
      id: uuidv7(),
      purpose: 'verify_email' as const,
      templateVersion: 'v1',
      applicationId,
      sealed: {
        ciphertext: Buffer.from('sealed-probe'),
        iv: randomBytes(12),
        tag: randomBytes(16),
        keyId: 'probe-key',
      },
      deduplicationHmac: `dedup-${suffix}`,
      messageId: `message-${suffix}`,
      challengeExpiresAt: new Date(Date.now() + 600_000),
      notBefore: new Date(Date.now() - 1_000),
    };
    expect(await delivery.enqueueSealed(input)).toBe(input.id);
    expect(await delivery.enqueueSealed(input)).toBe(input.id);
    await expect(
      delivery.enqueueSealed({ ...input, templateVersion: 'v2' }),
    ).rejects.toThrow('Delivery deduplication conflict');

    const ownerToken = `owner-${suffix}`;
    const claimed = await delivery.claimDue(ownerToken);
    expect(claimed).toMatchObject({
      id: input.id,
      attempt_count: 1,
      version: 2,
    });
    expect(await delivery.claimDue(`other-${suffix}`)).toBeNull();
    expect(
      await delivery.finish({
        id: input.id,
        ownerToken,
        version: 1,
        outcome: 'accepted',
      }),
    ).toBe(false);
    expect(
      await delivery.finish({
        id: input.id,
        ownerToken,
        version: 2,
        outcome: 'accepted',
      }),
    ).toBe(true);
    expect(
      await delivery.finish({
        id: input.id,
        ownerToken,
        version: 2,
        outcome: 'accepted',
      }),
    ).toBe(false);
    const rows = (await runner.query(
      'SELECT payload_ciphertext, state FROM identity.email_deliveries WHERE id = $1',
      [input.id],
    )) as Array<{ payload_ciphertext: Buffer | null; state: string }>;
    expect(rows[0]).toMatchObject({
      payload_ciphertext: null,
      state: 'accepted',
    });
  });

  it('fences mobile exchanges and erases completed client state', async () => {
    const id = await mobile.create({
      applicationId,
      returnUri,
      platform: 'ios',
      codeChallenge: 'a'.repeat(43),
      clientStateHash: suffix,
      clientState: {
        ciphertext: Buffer.from('sealed-state'),
        iv: randomBytes(12),
        tag: randomBytes(16),
        keyId: 'probe-key',
      },
    });
    expect(id).toBeTruthy();
    const transactionId = id!;
    const common = { id: transactionId, applicationId };
    expect(
      await mobile.markBrowserVerified({
        ...common,
        version: 1,
        nativeSessionId: 'session-probe',
        browserBindingHmac: suffix,
      }),
    ).toBe(2);
    expect(
      await mobile.markBrowserVerified({
        ...common,
        version: 1,
        nativeSessionId: 'session-probe',
        browserBindingHmac: suffix,
      }),
    ).toBeNull();
    expect(
      await mobile.markCodeIssued({
        ...common,
        version: 2,
        oneTimeTokenHmac: suffix,
      }),
    ).toBe(3);
    expect(
      await mobile.beginExchange({
        ...common,
        version: 3,
        oneTimeTokenHmac: suffix,
      }),
    ).toBe(4);
    expect(
      await mobile.beginExchange({
        ...common,
        version: 3,
        oneTimeTokenHmac: suffix,
      }),
    ).toBeNull();
    expect(
      await mobile.finishExchange({
        ...common,
        version: 4,
        result: 'completed',
      }),
    ).toBe(true);
    expect(
      await mobile.finishExchange({
        ...common,
        version: 4,
        result: 'completed',
      }),
    ).toBe(false);
    const rows = (await runner.query(
      'SELECT client_state_ciphertext, status FROM identity.mobile_auth_transactions WHERE id = $1',
      [transactionId],
    )) as Array<{ client_state_ciphertext: Buffer | null; status: string }>;
    expect(rows[0]).toMatchObject({
      client_state_ciphertext: null,
      status: 'completed',
    });
  });

  it('rejects conflicting administration idempotency and stale phases', async () => {
    const input = {
      kind: 'probe',
      actorId: `actor-${suffix}`,
      applicationId,
      idempotencyKeyHmac: `key-${suffix}`,
      requestFingerprint: `request-${suffix}`,
      targetReference: `target-${suffix}`,
    };
    const first = await administration.begin(input);
    expect(first.created).toBe(true);
    const again = await administration.begin(input);
    expect(again).toMatchObject({
      created: false,
      operation: { id: first.operation.id },
    });
    await expect(
      administration.begin({ ...input, requestFingerprint: 'different' }),
    ).rejects.toBeInstanceOf(AdminOperationConflictError);
    expect(
      await administration.advance({
        id: first.operation.id,
        from: 'pending',
        to: 'native_applied',
      }),
    ).toBe(true);
    expect(
      await administration.advance({
        id: first.operation.id,
        from: 'pending',
        to: 'native_applied',
      }),
    ).toBe(false);
  });
});
