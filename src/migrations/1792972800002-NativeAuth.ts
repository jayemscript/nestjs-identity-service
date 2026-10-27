import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Better Auth 1.7.12 native core and enabled-plugin schema.
 * Generated with auth 1.7.12 from scripts/database/better-auth-inspection.ts;
 * generated SQL SHA-256: 87405399285778656abab74e75271839b126438d1f57f679e1713f9dad74754c.
 * Inspection config SHA-256: 5d1ea2d76c79a06e16ab445010e1f8f84ad7f646ad3d90a60a3e2f25608e996e.
 * Every table/reference/index was qualified into auth during review.
 * Neither this migration nor deployment invokes `auth migrate`.
 */
export class NativeAuth1792972800002 implements MigrationInterface {
  name = 'NativeAuth1792972800002';
  readonly safeToRevert = false;

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE auth."user" ("id" text NOT NULL PRIMARY KEY, "name" text NOT NULL, "email" text NOT NULL UNIQUE, "emailVerified" boolean NOT NULL, "image" text, "createdAt" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL, "updatedAt" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL, "username" text UNIQUE, "displayUsername" text, "role" text, "banned" boolean, "banReason" text, "banExpires" timestamptz, "twoFactorEnabled" boolean);

      CREATE TABLE auth."session" ("id" text NOT NULL PRIMARY KEY, "expiresAt" timestamptz NOT NULL, "token" text NOT NULL UNIQUE, "createdAt" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL, "updatedAt" timestamptz NOT NULL, "ipAddress" text, "userAgent" text, "userId" text NOT NULL REFERENCES auth."user" ("id") ON DELETE CASCADE, "impersonatedBy" text);

      CREATE TABLE auth."account" ("id" text NOT NULL PRIMARY KEY, "accountId" text NOT NULL, "providerId" text NOT NULL, "userId" text NOT NULL REFERENCES auth."user" ("id") ON DELETE CASCADE, "accessToken" text, "refreshToken" text, "idToken" text, "accessTokenExpiresAt" timestamptz, "refreshTokenExpiresAt" timestamptz, "scope" text, "password" text, "createdAt" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL, "updatedAt" timestamptz NOT NULL);

      CREATE TABLE auth."verification" ("id" text NOT NULL PRIMARY KEY, "identifier" text NOT NULL, "value" text NOT NULL, "expiresAt" timestamptz NOT NULL, "createdAt" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL, "updatedAt" timestamptz DEFAULT CURRENT_TIMESTAMP NOT NULL);

      CREATE TABLE auth."twoFactor" ("id" text NOT NULL PRIMARY KEY, "secret" text NOT NULL, "backupCodes" text NOT NULL, "userId" text NOT NULL REFERENCES auth."user" ("id") ON DELETE CASCADE, "verified" boolean, "failedVerificationCount" integer, "lockedUntil" timestamptz);

      CREATE TABLE auth."passkey" ("id" text NOT NULL PRIMARY KEY, "name" text, "publicKey" text NOT NULL, "userId" text NOT NULL REFERENCES auth."user" ("id") ON DELETE CASCADE, "credentialID" text NOT NULL, "counter" integer NOT NULL, "deviceType" text NOT NULL, "backedUp" boolean NOT NULL, "transports" text, "createdAt" timestamptz, "aaguid" text);

      CREATE TABLE auth."ssoProvider" ("id" text NOT NULL PRIMARY KEY, "issuer" text NOT NULL, "oidcConfig" text, "samlConfig" text, "userId" text NOT NULL REFERENCES auth."user" ("id") ON DELETE CASCADE, "providerId" text NOT NULL UNIQUE, "organizationId" text, "domain" text NOT NULL);

      CREATE TABLE auth."apikey" ("id" text NOT NULL PRIMARY KEY, "configId" text NOT NULL, "name" text, "start" text, "referenceId" text NOT NULL, "prefix" text, "key" text NOT NULL, "refillInterval" integer, "refillAmount" integer, "lastRefillAt" timestamptz, "enabled" boolean, "rateLimitEnabled" boolean, "rateLimitTimeWindow" integer, "rateLimitMax" integer, "requestCount" integer, "remaining" integer, "lastRequest" timestamptz, "expiresAt" timestamptz, "createdAt" timestamptz NOT NULL, "updatedAt" timestamptz NOT NULL, "permissions" text, "metadata" text);

      CREATE TABLE auth."rateLimit" ("id" text NOT NULL PRIMARY KEY, "key" text NOT NULL UNIQUE, "count" integer NOT NULL, "lastRequest" bigint NOT NULL);

      CREATE INDEX "session_userId_idx" ON auth."session" ("userId");
      CREATE INDEX "account_userId_idx" ON auth."account" ("userId");
      CREATE INDEX "verification_identifier_idx" ON auth."verification" ("identifier");
      CREATE INDEX "twoFactor_secret_idx" ON auth."twoFactor" ("secret");
      CREATE INDEX "twoFactor_userId_idx" ON auth."twoFactor" ("userId");
      CREATE INDEX "passkey_userId_idx" ON auth."passkey" ("userId");
      CREATE INDEX "passkey_credentialID_idx" ON auth."passkey" ("credentialID");
      CREATE INDEX "apikey_configId_idx" ON auth."apikey" ("configId");
      CREATE INDEX "apikey_referenceId_idx" ON auth."apikey" ("referenceId");
      CREATE INDEX "apikey_key_idx" ON auth."apikey" ("key");

      GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA auth TO identity_auth_runtime;
    `);
  }

  down(): Promise<void> {
    return Promise.reject(
      new Error(
        'Native authentication data requires a reviewed forward repair',
      ),
    );
  }
}
