/**
 * Schema-inspection profile only. Never mount this instance as an HTTP handler.
 * The deployment migration runner remains TypeORM; `auth migrate` must not run.
 */
import { config as loadDotEnv } from 'dotenv';
import pg from 'pg';
import { betterAuth } from 'better-auth';
import {
  admin,
  bearer,
  emailOTP,
  magicLink,
  oneTimeToken,
  twoFactor,
  username,
} from 'better-auth/plugins';
import { passkey } from '@better-auth/passkey';
import { sso } from '@better-auth/sso';
import { apiKey } from '@better-auth/api-key';
import { createPgPoolConfig } from '../../src/database/database-config.js';

loadDotEnv();

const pool = new pg.Pool(createPgPoolConfig(process.env, 'auth'));
const inspectionOnly = async (): Promise<never> => {
  throw new Error('Schema-inspection callbacks cannot send or authenticate');
};

export const auth = betterAuth({
  database: pool,
  baseURL: 'http://localhost:3000',
  secret: 'schema-inspection-only-never-use-at-runtime',
  emailAndPassword: { enabled: true },
  rateLimit: { enabled: true, storage: 'database' },
  plugins: [
    username(),
    admin(),
    twoFactor(),
    magicLink({ sendMagicLink: inspectionOnly, disableSignUp: true, storeToken: 'hashed' }),
    emailOTP({ sendVerificationOTP: inspectionOnly, disableSignUp: true, storeOTP: 'hashed' }),
    passkey(),
    sso({ disableImplicitSignUp: true, organizationProvisioning: { disabled: true } }),
    apiKey({ enableSessionForAPIKeys: false, storage: 'database' }),
    bearer({ requireSignature: true }),
    oneTimeToken({
      disableClientRequest: true,
      storeToken: 'hashed',
      expiresIn: 1,
      disableSetSessionCookie: false,
      setOttHeaderOnNewSession: false,
    }),
  ],
});
