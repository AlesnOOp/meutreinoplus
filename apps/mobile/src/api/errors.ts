import { apiErrorSchema } from '@meutreino/shared';

export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status: number, code: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function isNetworkError(error: unknown): boolean {
  return error instanceof ApiClientError && error.code === 'network_error';
}

export function readApiError(status: number, body: unknown): ApiClientError {
  const parsed = apiErrorSchema.safeParse(body);
  if (!parsed.success) {
    return new ApiClientError('Não foi possível concluir a solicitação.', status, 'request_failed');
  }
  const detail = parsed.data.error.details?.[0]?.message;
  return new ApiClientError(detail ?? parsed.data.error.message, status, parsed.data.error.code);
}
