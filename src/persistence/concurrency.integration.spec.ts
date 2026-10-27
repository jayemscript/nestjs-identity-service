import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import { config as loadDotEnv } from 'dotenv';
import { DataSource, type QueryRunner } from 'typeorm';
import { v7 as uuidv7 } from 'uuid';
import { createTypeOrmDatabaseOptions } from '../database/database-config.js';
import { DatabaseService } from '../database/database.service.js';
import { AdminOperationStore } from './admin-operation-store.service.js';
import { DeliveryQueueStore } from './delivery-queue-store.service.js';
import { IdentityRepository } from './identity-repository.service.js';
import { MobileTransactionStore } from './mobile-transaction-store.service.js';

const databaseDescribe =
  process.env.RUN_DB_INTEGRATION === '1' ? describe : describe.skip;

function transactionBoundDatabase(runner: QueryRunner): DatabaseService {
  return new DatabaseService({
    query: (sql: string, parameters?: unknown[]) =>
      runner.query(sql, parameters),
  } as unknown as DataSource);
}

databaseDescribe('PostgreSQL competing persistence claims', () => {
  it('permits one owner on separate connections for policy edits, intents, leases, mail, and mobile exchange', async () => {
    loadDotEnv({ quiet: true });
    const sourceA = new DataSource(
      createTypeOrmDatabaseOptions(process.env, 'identity', []),
    );
    const sourceB = new DataSource(
      createTypeOrmDatabaseOptions(process.env, 'identity', []),
    );
    let runnerA: QueryRunner | undefined;
    let runnerB: QueryRunner | undefined;
    const applicationId = uuidv7();
    const deliveryId = uuidv7();
    const suffix = randomBytes(24).toString('base64url');
    const userId = `user-${suffix}`;
    const sessionId = `session-${suffix}`;
    const pendingSessionId = `pending-${suffix}`;
    const origin = `https://auth-${applicationId}.example`;
    const returnUri = `https://mobile-${applicationId}.example/callback`;
    let mobileId: string | null = null;
    try {
      await Promise.all([sourceA.initialize(), sourceB.initialize()]);
      runnerA = sourceA.createQueryRunner();
      runnerB = sourceB.createQueryRunner();
      await Promise.all([runnerA.connect(), runnerB.connect()]);
      const [pidA, pidB] = await Promise.all([
        runnerA.query('SELECT pg_backend_pid() AS pid') as Promise<
          Array<{ pid: number }>
        >,
        runnerB.query('SELECT pg_backend_pid() AS pid') as Promise<
          Array<{ pid: number }>
        >,
      ]);
      expect(pidA[0].pid).not.toBe(pidB[0].pid);

      const identityA = new IdentityRepository(
        transactionBoundDatabase(runnerA),
      );
      const identityB = new IdentityRepository(
        transactionBoundDatabase(runnerB),
      );
      const leaseA = {
        resource: 'concurrency-probe',
        key: suffix,
        ownerToken: `owner-a-${suffix}`,
        durationSeconds: 60,
      };
      const leaseB = { ...leaseA, ownerToken: `owner-b-${suffix}` };
      const leaseClaims = await Promise.all([
        identityA.acquireLease(leaseA),
        identityB.acquireLease(leaseB),
      ]);
      expect(leaseClaims.filter((value) => value === 1)).toHaveLength(1);
      expect(leaseClaims.filter((value) => value === null)).toHaveLength(1);

      await sourceA.query(
        `INSERT INTO identity.applications
          (id, slug, name, public_origin, allowed_transports, status)
         VALUES ($1, $2, 'Concurrency probe', $3, ARRAY['cookie','bearer'], 'active')`,
        [applicationId, `probe-${applicationId}`, origin],
      );
      await sourceA.query(
        `INSERT INTO identity.mobile_clients
          (application_id, ios_bundle_id, auth_origin, allowed_return_uris, status)
         VALUES ($1, 'example.probe', $2, ARRAY[$3]::text[], 'active')`,
        [applicationId, origin, returnUri],
      );
      await sourceA.query(
        `INSERT INTO identity.account_policies (user_id) VALUES ($1)`,
        [userId],
      );
      await sourceA.query(
        `INSERT INTO identity.application_memberships (application_id, user_id)
         VALUES ($1, $2)`,
        [applicationId, userId],
      );
      await sourceA.query(
        `INSERT INTO identity.session_assurance
          (session_id, user_id, application_id, security_epoch,
           primary_method, pending_expires_at)
         VALUES ($1, $2, $3, 1, 'password', now() + interval '1 hour')`,
        [sessionId, userId, applicationId],
      );
      const assuranceInput = {
        sessionId,
        userId,
        applicationId,
        version: 1,
        securityEpoch: '1',
        mfaMethod: 'totp' as const,
      };
      const assuranceClaims = await Promise.all([
        identityA.promoteAssuranceAfterFactor(assuranceInput),
        identityB.promoteAssuranceAfterFactor(assuranceInput),
      ]);
      expect(assuranceClaims.filter((value) => value === 2)).toHaveLength(1);
      expect(assuranceClaims.filter((value) => value === null)).toHaveLength(1);

      const membershipInput = { applicationId, userId, version: 1 };
      const membershipClaims = await Promise.all([
        identityA.updateMembership({
          ...membershipInput,
          role: 'app_admin',
          status: 'active',
        }),
        identityB.updateMembership({
          ...membershipInput,
          role: 'member',
          status: 'suspended',
        }),
      ]);
      expect(membershipClaims.filter((value) => value === 2)).toHaveLength(1);
      expect(membershipClaims.filter((value) => value === null)).toHaveLength(
        1,
      );
      await sourceA.query(
        `INSERT INTO identity.session_assurance
          (session_id, user_id, application_id, security_epoch,
           primary_method, pending_expires_at)
         VALUES ($1, $2, $3, 1, 'password', now() + interval '1 hour')`,
        [pendingSessionId, userId, applicationId],
      );
      expect(
        await identityA.updateMembership({
          ...membershipInput,
          version: 2,
          role: 'member',
          status: 'suspended',
        }),
      ).toBe(3);
      expect(
        await identityA.promoteAssuranceAfterFactor({
          ...assuranceInput,
          sessionId: pendingSessionId,
        }),
      ).toBeNull();

      const adminA = new AdminOperationStore(transactionBoundDatabase(runnerA));
      const adminB = new AdminOperationStore(transactionBoundDatabase(runnerB));
      const intent = {
        kind: 'bootstrap',
        actorId: userId,
        applicationId,
        idempotencyKeyHmac: `intent-${suffix}`,
        requestFingerprint: `fingerprint-${suffix}`,
        targetReference: `target-${suffix}`,
      };
      const intents = await Promise.all([
        adminA.begin(intent),
        adminB.begin(intent),
      ]);
      expect(intents.filter((result) => result.created)).toHaveLength(1);
      expect(intents[0].operation.id).toBe(intents[1].operation.id);

      const deliveryA = new DeliveryQueueStore(
        transactionBoundDatabase(runnerA),
      );
      const deliveryB = new DeliveryQueueStore(
        transactionBoundDatabase(runnerB),
      );
      await deliveryA.enqueueSealed({
        id: deliveryId,
        purpose: 'verify_email',
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
      });
      const ownerA = `mail-a-${suffix}`;
      const ownerB = `mail-b-${suffix}`;
      const deliveryClaims = await Promise.all([
        deliveryA.claimDue(ownerA),
        deliveryB.claimDue(ownerB),
      ]);
      const winners = deliveryClaims.filter(
        (value) => value?.id === deliveryId,
      );
      expect(winners).toHaveLength(1);
      expect(deliveryClaims.filter((value) => value === null)).toHaveLength(1);
      expect(winners[0]).toMatchObject({ attempt_count: 1, version: 2 });
      const winnerOwner = deliveryClaims[0] ? ownerA : ownerB;
      expect(
        await deliveryA.finish({
          id: deliveryId,
          ownerToken: winnerOwner,
          version: 2,
          outcome: 'accepted',
        }),
      ).toBe(true);

      const mobileA = new MobileTransactionStore(
        transactionBoundDatabase(runnerA),
      );
      const mobileB = new MobileTransactionStore(
        transactionBoundDatabase(runnerB),
      );
      mobileId = await mobileA.create({
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
      expect(mobileId).toBeTruthy();
      const common = { id: mobileId!, applicationId };
      expect(
        await mobileA.markBrowserVerified({
          ...common,
          version: 1,
          nativeSessionId: 'session-probe',
          browserBindingHmac: suffix,
        }),
      ).toBe(2);
      expect(
        await mobileA.markCodeIssued({
          ...common,
          version: 2,
          oneTimeTokenHmac: suffix,
        }),
      ).toBe(3);
      const exchanges = await Promise.all([
        mobileA.beginExchange({
          ...common,
          version: 3,
          oneTimeTokenHmac: suffix,
        }),
        mobileB.beginExchange({
          ...common,
          version: 3,
          oneTimeTokenHmac: suffix,
        }),
      ]);
      expect(exchanges.filter((value) => value === 4)).toHaveLength(1);
      expect(exchanges.filter((value) => value === null)).toHaveLength(1);
      expect(
        await mobileA.finishExchange({
          ...common,
          version: 4,
          result: 'completed',
        }),
      ).toBe(true);
    } finally {
      if (sourceA.isInitialized) {
        await sourceA.query(
          'DELETE FROM identity.admin_operations WHERE actor_id = $1 AND kind = $2 AND idempotency_key_hmac = $3',
          [userId, 'bootstrap', `intent-${suffix}`],
        );
        await sourceA.query(
          'DELETE FROM identity.session_assurance WHERE session_id = ANY($1::text[])',
          [[sessionId, pendingSessionId]],
        );
        await sourceA.query(
          'DELETE FROM identity.application_memberships WHERE application_id = $1 AND user_id = $2',
          [applicationId, userId],
        );
        await sourceA.query(
          'DELETE FROM identity.account_policies WHERE user_id = $1',
          [userId],
        );
        await sourceA.query(
          'DELETE FROM identity.email_deliveries WHERE id = $1',
          [deliveryId],
        );
        if (mobileId) {
          await sourceA.query(
            'DELETE FROM identity.mobile_auth_transactions WHERE id = $1',
            [mobileId],
          );
        }
        await sourceA.query(
          'DELETE FROM identity.mobile_clients WHERE application_id = $1',
          [applicationId],
        );
        await sourceA.query('DELETE FROM identity.applications WHERE id = $1', [
          applicationId,
        ]);
        await sourceA.query(
          'DELETE FROM identity.operation_leases WHERE resource = $1 AND lease_key = $2',
          ['concurrency-probe', suffix],
        );
      }
      if (runnerA && !runnerA.isReleased) await runnerA.release();
      if (runnerB && !runnerB.isReleased) await runnerB.release();
      if (sourceA.isInitialized) await sourceA.destroy();
      if (sourceB.isInitialized) await sourceB.destroy();
    }
  }, 30_000);
});
