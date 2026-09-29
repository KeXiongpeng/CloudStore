import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Request, Response } from 'express';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const request = host.switchToHttp().getRequest<Request>();
    const response = host.switchToHttp().getResponse<Response>();
    const isHttp = exception instanceof HttpException;
    const status = isHttp ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const payload = isHttp ? exception.getResponse() : 'INTERNAL_ERROR';
    const structured =
      typeof payload === 'object' && payload !== null
        ? (payload as { code?: string; message?: string | string[] })
        : undefined;
    const rawCode = structured?.code ?? structured?.message ?? payload;
    const details = structured?.message;

    const requestId = randomUUID();
    if (status >= 500) {
      this.logger.error(
        JSON.stringify({
          method: request.method,
          url: request.originalUrl,
          status,
          exception: (exception as Error)?.name,
          message: (exception as Error)?.message,
          requestId,
        }),
      );
      this.logger.error((exception as Error).stack);
    } else {
      this.logger.warn(
        JSON.stringify({
          method: request.method,
          url: request.originalUrl,
          status,
          code: rawCode,
          requestId,
        }),
      );
    }

    response.status(status).json({
      success: false,
      code: Array.isArray(rawCode) ? 'VALIDATION_ERROR' : rawCode,
      message: Array.isArray(rawCode) ? '请求参数无效' : rawCode,
      details: Array.isArray(details) ? details : [],
      requestId,
    });
  }
}
