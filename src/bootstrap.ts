import { HttpStatus, ValidationPipe } from '@nestjs/common';
import type { INestApplication, ValidationError } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import bodyParser from 'body-parser';
import type { Express } from 'express';
import { ServiceException } from './common/http/service.exception.js';
import { requestIdMiddleware } from './common/http/request-context.js';
import { requestLoggingMiddleware } from './common/http/request-logging.middleware.js';
import { ServiceExceptionFilter } from './common/http/service-exception.filter.js';
import { TransformInterceptor } from './common/interceptors/transform.interceptor.js';

function validationDetails(
  errors: ValidationError[],
): Record<string, string[]> {
  const details: Record<string, string[]> = {};
  const visit = (items: ValidationError[], prefix = ''): void => {
    for (const item of items) {
      const field = prefix ? `${prefix}.${item.property}` : item.property;
      if (field.length > 128) continue;
      if (item.constraints)
        details[field] = Object.keys(item.constraints).sort();
      if (item.children?.length) visit(item.children, field);
    }
  };
  visit(errors);
  return details;
}

export function configureApplication(app: INestApplication): void {
  const config = app.get(ConfigService);
  const expressApp = app.getHttpAdapter().getInstance() as Express;
  expressApp.set('trust proxy', false);
  expressApp.disable('x-powered-by');
  expressApp.enable('strict routing');

  app.use(requestIdMiddleware);
  app.use(requestLoggingMiddleware);
  // Only service-owned routes consume request bodies. /api/auth remains raw.
  app.use('/api/v1', bodyParser.json({ limit: '64kb' }));
  app.use('/api/v1', bodyParser.urlencoded({ limit: '64kb', extended: false }));

  app.enableCors({
    origin: config.getOrThrow<string[]>('CORS_ORIGINS'),
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: (errors) =>
        new ServiceException(
          HttpStatus.BAD_REQUEST,
          'VALIDATION_FAILED',
          'Validation failed',
          validationDetails(errors),
        ),
    }),
  );
  app.useGlobalFilters(new ServiceExceptionFilter());
  app.useGlobalInterceptors(new TransformInterceptor(app.get(Reflector)));

  if (config.getOrThrow<boolean>('SWAGGER_ENABLED')) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Identity service')
      .setDescription('Implemented service-owned HTTP routes')
      .setVersion('0.0.1')
      .build();
    SwaggerModule.setup(
      'docs',
      app,
      SwaggerModule.createDocument(app, swaggerConfig),
    );
  }
}
