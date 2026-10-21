import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { safeErrorDiagnostic, toApiError } from './api-error';

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<Request & { id?: unknown }>();
    const response = context.getResponse<Response>();
    const requestId = typeof request.id === 'string' ? request.id : undefined;
    const rendered = toApiError(exception, requestId);

    if (!(exception instanceof HttpException) || exception.getStatus() >= 500) {
      this.logger.error(safeErrorDiagnostic(exception));
    }

    response.status(rendered.statusCode).json(rendered.body);
  }
}
