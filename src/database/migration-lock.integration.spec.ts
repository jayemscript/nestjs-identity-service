import { spawn } from 'node:child_process';
import { config as loadDotEnv } from 'dotenv';
import pg from 'pg';
import { createPgPoolConfig } from './database-config.js';

const databaseDescribe = process.env.RUN_DB_INTEGRATION === '1' ? describe : describe.skip;
const LOCK_KEY = '4863046005709130034';

function runMigrationCommand(command: 'run' | 'show'): Promise<{ code: number; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['--loader', 'ts-node/esm', 'src/database/migration-cli.ts', command],
      { cwd: process.cwd(), env: process.env, shell: false },
    );
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString(); });
    child.stderr.on('data', (chunk: Buffer) => { output += chunk.toString(); });
    child.once('error', reject);
    child.once('close', (code) => resolve({ code: code ?? 1, output }));
  });
}

databaseDescribe('deployment migration lock', () => {
  it('rejects a second runner within the bounded wait, then releases cleanly', async () => {
    loadDotEnv({ quiet: true });
    const pool = new pg.Pool(createPgPoolConfig(process.env, 'migration'));
    const client = await pool.connect();
    try {
      await client.query('SELECT pg_advisory_lock($1::bigint)', [LOCK_KEY]);
      const blocked = await runMigrationCommand('run');
      expect(blocked.code).toBe(1);
      expect(blocked.output).toContain('Another database migration job holds the lock');
    } finally {
      await client.query('SELECT pg_advisory_unlock($1::bigint)', [LOCK_KEY]);
      client.release();
      await pool.end();
    }
    const released = await runMigrationCommand('show');
    expect(released.code).toBe(0);
    expect(released.output).toContain('applied  MaintenanceVersionRead1792972800009');
  }, 30_000);
});
