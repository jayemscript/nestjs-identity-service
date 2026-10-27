import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { Server } from 'node:http';
import { AppModule } from './app.module.js';
import { configureApplication } from './bootstrap.js';
import { ReadinessService } from './persistence/readiness.service.js';

const DRAIN_TIMEOUT_MS = 30_000;

async function drainHttp(server: Server): Promise<void> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
      timeout = setTimeout(
        () => server.closeAllConnections(),
        DRAIN_TIMEOUT_MS,
      );
    });
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  try {
    configureApplication(app);
    await app.init();
    const readiness = app.get(ReadinessService);
    if (!(await readiness.isReady())) {
      throw new Error('Required database state is not ready');
    }

    const port = app.get(ConfigService).getOrThrow<number>('PORT');
    await app.listen(port);
    Logger.log(`Identity service listening on port ${port}`, 'Bootstrap');

    let stopping = false;
    const shutdown = async (): Promise<void> => {
      if (stopping) return;
      stopping = true;
      readiness.withdraw();
      try {
        await drainHttp(app.getHttpServer() as Server);
        await app.close();
      } catch {
        Logger.error(
          'Identity service shutdown failed',
          undefined,
          'Bootstrap',
        );
        process.exitCode = 1;
      }
    };
    process.once('SIGINT', () => {
      void shutdown();
    });
    process.once('SIGTERM', () => {
      void shutdown();
    });
  } catch (error) {
    await app.close();
    throw error;
  }
}

void bootstrap().catch(() => {
  Logger.error('Identity service failed to start', undefined, 'Bootstrap');
  process.exitCode = 1;
});
