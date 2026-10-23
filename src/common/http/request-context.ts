import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export type RequestWithId = Request & { requestId: string };

const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export function requestIdMiddleware(
  request: Request,
  response: Response,
  next: NextFunction,
): void {
  const candidate = request.header('x-request-id');
  const requestId =
    candidate && REQUEST_ID_PATTERN.test(candidate) ? candidate : randomUUID();
  (request as RequestWithId).requestId = requestId;
  response.setHeader('X-Request-Id', requestId);
  next();
}

export function getRequestId(request: Request): string {
  return (request as RequestWithId).requestId;
}
