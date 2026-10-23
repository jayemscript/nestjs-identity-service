import { HttpException } from '@nestjs/common';

export class ServiceException extends HttpException {
  constructor(
    statusCode: number,
    code: string,
    message: string,
    details?: Record<string, string[]>,
  ) {
    super({ code, message, ...(details ? { details } : {}) }, statusCode);
  }
}
