import { HttpException, HttpStatus } from '@nestjs/common';
import type { ApiErrorBody } from '@meutreino/shared';

type ApiErrorResponse = {
  statusCode: number;
  body: ApiErrorBody;
};

const STATUS_MAP: Record<number, { code: string; message: string }> = {
  [HttpStatus.BAD_REQUEST]: { code: 'validation_error', message: 'Validation failed' },
  [HttpStatus.UNAUTHORIZED]: { code: 'unauthenticated', message: 'Authentication required' },
  [HttpStatus.FORBIDDEN]: { code: 'forbidden', message: 'Forbidden' },
  [HttpStatus.NOT_FOUND]: { code: 'not_found', message: 'Resource not found' },
  [HttpStatus.CONFLICT]: { code: 'conflict', message: 'Conflict' },
  [HttpStatus.TOO_MANY_REQUESTS]: { code: 'rate_limited', message: 'Too many requests' },
};

export function toApiError(exception: unknown, requestId?: string): ApiErrorResponse {
  if (!(exception instanceof HttpException) || exception.getStatus() >= 500) {
    return internalError(requestId);
  }

  const statusCode = exception.getStatus();
  const structured = readStructuredError(exception.getResponse());
  const error = structured ??
    STATUS_MAP[statusCode] ?? {
      code: 'request_error',
      message: 'Request failed',
    };

  return {
    statusCode,
    body: {
      error: requestId ? { ...error, requestId } : error,
    },
  };
}

export function safeErrorDiagnostic(error: unknown): string {
  const text = error instanceof Error ? `${error.name}: ${error.message}` : 'Unknown error';
  if (/postgres(ql)?:\/\//i.test(text) || /password|authorization|bearer/i.test(text)) {
    return error instanceof Error ? error.name : 'Sensitive error redacted';
  }
  return text;
}

function internalError(requestId?: string): ApiErrorResponse {
  return {
    statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
    body: {
      error: requestId
        ? { code: 'internal_error', message: 'Internal server error', requestId }
        : { code: 'internal_error', message: 'Internal server error' },
    },
  };
}

function readStructuredError(
  response: unknown,
): { code: string; message: string; details?: { path: string; message: string }[] } | null {
  if (typeof response !== 'object' || response === null || !('code' in response)) {
    return null;
  }

  const record = response as Record<string, unknown>;
  if (typeof record.code !== 'string' || typeof record.message !== 'string') {
    return null;
  }

  if (!Array.isArray(record.details)) {
    return { code: record.code, message: record.message };
  }

  const details = record.details.flatMap((detail) => {
    if (typeof detail !== 'object' || detail === null) {
      return [];
    }
    const item = detail as Record<string, unknown>;
    if (typeof item.path !== 'string' || typeof item.message !== 'string') {
      return [];
    }
    return [{ path: item.path, message: item.message }];
  });

  return details.length > 0
    ? { code: record.code, message: record.message, details }
    : { code: record.code, message: record.message };
}
