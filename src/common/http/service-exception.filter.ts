import { ArgumentsHost, Catch, HttpException } from '@nestjs/common';
import type { ExceptionFilter } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ErrorResponseDto } from '../dto/error-response.dto.js';
import { getRequestId } from './request-context.js';
import { ServiceException } from './service.exception.js';

const STANDARD_ERRORS: Record<number, { code: string; message: string }> = {
  400: { code: 'BAD_REQUEST', message: 'Bad request' },
  401: { code: 'UNAUTHORIZED', message: 'Unauthorized' },
  403: { code: 'FORBIDDEN', message: 'Forbidden' },
  404: { code: 'NOT_FOUND', message: 'Not found' },
  409: { code: 'CONFLICT', message: 'Conflict' },
  412: { code: 'PRECONDITION_FAILED', message: 'Precondition failed' },
  413: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body too large' },
  428: { code: 'PRECONDITION_REQUIRED', message: 'Precondition required' },
  429: { code: 'TOO_MANY_REQUESTS', message: 'Too many requests' },
  503: { code: 'SERVICE_UNAVAILABLE', message: 'Service unavailable' },
};

@Catch()
export class ServiceExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const response = context.getResponse<Response>();
    if (response.headersSent) return;

    const request = context.getRequest<Request>();
    const parserError = exception as { type?: unknown; status?: unknown };
    const statusCode =
      exception instanceof HttpException
        ? exception.getStatus()
        : parserError?.type === 'entity.too.large' && parserError.status === 413
          ? 413
          : parserError?.type === 'entity.parse.failed' &&
              parserError.status === 400
            ? 400
            : 500;
    const standard =
      STANDARD_ERRORS[statusCode] ??
      (statusCode >= 500
        ? { code: 'INTERNAL_ERROR', message: 'Internal server error' }
        : { code: 'HTTP_ERROR', message: 'Request failed' });

    let code = standard.code;
    let message = standard.message;
    let details: Record<string, string[]> | undefined;
    if (exception instanceof ServiceException) {
      const publicResponse = exception.getResponse() as {
        code: string;
        message: string;
        details?: Record<string, string[]>;
      };
      code = publicResponse.code;
      message = publicResponse.message;
      details = publicResponse.details;
    }

    const body: ErrorResponseDto = {
      statusCode,
      code,
      message,
      timestamp: new Date().toISOString(),
      requestId: getRequestId(request),
      ...(details ? { details } : {}),
    };
    response.status(statusCode).json(body);
  }
}
