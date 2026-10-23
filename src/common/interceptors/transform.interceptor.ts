import { ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { CallHandler } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Response } from 'express';
import type { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { CommonResponseDto } from '../dto/common-response.dto.js';
import { getRequestId } from '../http/request-context.js';
import { RAW_RESPONSE_KEY } from '../http/raw-response.decorator.js';
import type { Request } from 'express';

@Injectable()
export class TransformInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const rawResponse = this.reflector.getAllAndOverride<boolean>(
      RAW_RESPONSE_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (rawResponse) return next.handle();

    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    return next.handle().pipe(
      map((data: unknown) => {
        const statusCode = response.statusCode;
        if (statusCode === 204 || response.headersSent) return undefined;

        const body: CommonResponseDto<unknown> = {
          statusCode,
          message: statusCode === 201 ? 'Created' : 'Success',
          data,
          timestamp: new Date().toISOString(),
          requestId: getRequestId(request),
        };
        return body;
      }),
    );
  }
}
