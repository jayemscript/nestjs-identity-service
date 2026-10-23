import { Logger } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { getRequestId } from './request-context.js';

const logger = new Logger('HttpRequest');

export function requestLoggingMiddleware(
  request: Request,
  response: Response,
  next: NextFunction,
): void {
  const startedAt = Date.now();
  response.once('finish', () => {
    const route = (request.route as { path?: unknown } | undefined)?.path;
    const routePattern =
      typeof route === 'string' ? `${request.baseUrl}${route}` : '<unmatched>';
    logger.log(
      `${request.method} ${routePattern} ${response.statusCode} ${Date.now() - startedAt}ms requestId=${getRequestId(request)}`,
    );
  });
  next();
}
