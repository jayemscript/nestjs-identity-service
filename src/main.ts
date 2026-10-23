import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { configureApplication } from './bootstrap.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  configureApplication(app);

  const port = app.get(ConfigService).getOrThrow<number>('PORT');
  await app.listen(port);
  Logger.log(`Identity service listening on port ${port}`, 'Bootstrap');
}

void bootstrap().catch(() => {
  Logger.error('Identity service failed to start', undefined, 'Bootstrap');
  process.exitCode = 1;
});
