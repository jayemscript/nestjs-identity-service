import { Body, Controller, Get, HttpCode, Logger, Post } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { jest } from '@jest/globals';
import { IsString, MinLength } from 'class-validator';
import request from 'supertest';
import { configureApplication } from '../src/bootstrap.js';

class FixtureDto {
  @IsString()
  @MinLength(2)
  value!: string;
}

@Controller('api/v1/contract-fixture')
class ContractFixtureController {
  @Post()
  create(@Body() body: FixtureDto): { value: string } {
    return { value: body.value };
  }

  @Get('failure')
  fail(): never {
    throw new Error('private failure detail');
  }

  @Get('empty')
  @HttpCode(204)
  empty(): { shouldNotAppear: boolean } {
    return { shouldNotAppear: true };
  }
}

describe('application HTTP contracts (e2e)', () => {
  let app: INestApplication;
  type SupertestApp = Parameters<typeof request>[0];
  const server = (): SupertestApp => app.getHttpServer() as SupertestApp;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.PORT = '7000';
    process.env.SWAGGER_ENABLED = 'true';
    process.env.CORS_ORIGINS = 'http://localhost:3000';
    const { AppModule } = await import('../src/app.module.js');
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [ContractFixtureController],
    }).compile();
    app = moduleFixture.createNestApplication({ bodyParser: false });
    configureApplication(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('serves a raw liveness response with a request ID', async () => {
    const response = await request(server())
      .get('/health/live')
      .set('X-Request-Id', 'safe_123')
      .expect(200);
    expect(response.body).toEqual({ status: 'ok' });
    expect(response.headers['x-request-id']).toBe('safe_123');
  });

  it('rejects an invalid request ID and generates a safe one', async () => {
    const response = await request(server())
      .get('/health/live')
      .set('X-Request-Id', 'bad/id?token=secret')
      .expect(200);
    expect(response.headers['x-request-id']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it('wraps custom success and rejects unknown fields', async () => {
    const success = await request(server())
      .post('/api/v1/contract-fixture')
      .send({ value: 'ok' })
      .expect(201);
    expect(success.body).toMatchObject({
      statusCode: 201,
      message: 'Created',
      data: { value: 'ok' },
      requestId: success.headers['x-request-id'],
    });
    expect((success.body as { timestamp?: unknown }).timestamp).toEqual(
      expect.any(String),
    );

    const invalid = await request(server())
      .post('/api/v1/contract-fixture')
      .send({ value: 'ok', role: 'admin' })
      .expect(400);
    expect(invalid.body).toMatchObject({
      statusCode: 400,
      code: 'VALIDATION_FAILED',
      message: 'Validation failed',
      details: { role: ['whitelistValidation'] },
    });
    expect(invalid.body).not.toHaveProperty('path');
  });

  it('sends one safe error and keeps 204 empty', async () => {
    const failure = await request(server())
      .get('/api/v1/contract-fixture/failure')
      .expect(500);
    expect(failure.body).toMatchObject({
      statusCode: 500,
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
      requestId: failure.headers['x-request-id'],
    });
    expect(JSON.stringify(failure.body)).not.toContain(
      'private failure detail',
    );

    const empty = await request(server())
      .get('/api/v1/contract-fixture/empty')
      .expect(204);
    expect(empty.text).toBe('');
  });

  it('returns safe errors for malformed and oversized JSON', async () => {
    const malformed = await request(server())
      .post('/api/v1/contract-fixture')
      .set('Content-Type', 'application/json')
      .send('{"value":')
      .expect(400);
    expect(malformed.body).toMatchObject({
      statusCode: 400,
      code: 'BAD_REQUEST',
      requestId: malformed.headers['x-request-id'],
    });

    const spy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    try {
      const oversized = await request(server())
        .post('/api/v1/contract-fixture')
        .send({ value: 'x'.repeat(65536) })
        .expect(413);
      expect(oversized.body).toMatchObject({
        statusCode: 413,
        code: 'PAYLOAD_TOO_LARGE',
        requestId: oversized.headers['x-request-id'],
      });
      expect(
        spy.mock.calls.map((call) => String(call[0])).join('\n'),
      ).toContain('POST <unmatched> 413');
    } finally {
      spy.mockRestore();
    }
  });

  it('does not log query strings or invalid request IDs', async () => {
    const spy = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    try {
      await request(server())
        .get('/health/live?resetToken=very-secret')
        .set('X-Request-Id', 'bad/very-secret')
        .expect(200);
      const logText = spy.mock.calls.map((call) => String(call[0])).join('\n');
      expect(logText).toContain('GET /health/live 200');
      expect(logText).not.toContain('very-secret');
      expect(logText).not.toContain('resetToken');
    } finally {
      spy.mockRestore();
    }
  });

  it('documents only implemented routes without fictional auth schemes', async () => {
    const response = await request(server()).get('/docs-json').expect(200);
    const document = response.body as {
      paths: Record<string, { get?: { summary?: string } }>;
      components?: { securitySchemes?: Record<string, unknown> };
    };
    expect(document.paths['/health/live']?.get).toMatchObject({
      summary: 'Check whether the process is responding',
    });
    expect(document.paths).not.toHaveProperty('/health/ready');
    expect(document.paths).not.toHaveProperty('/api/auth/sign-in/email');
    expect(document.components?.securitySchemes ?? {}).toEqual({});
  });
});
