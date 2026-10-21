import { BadRequestException, HttpException } from '@nestjs/common';
import { toApiError } from './api-error';

describe('toApiError', () => {
  it('exposes a validation payload without echoing the submitted value', () => {
    const exception = new BadRequestException({
      code: 'validation_error',
      message: 'Validation failed',
      details: [{ path: 'email', message: 'Invalid email', received: 'secret-value' }],
    });

    expect(toApiError(exception, 'req-1')).toEqual({
      statusCode: 400,
      body: {
        error: {
          code: 'validation_error',
          message: 'Validation failed',
          requestId: 'req-1',
          details: [{ path: 'email', message: 'Invalid email' }],
        },
      },
    });
  });

  it('hides unexpected failures', () => {
    expect(toApiError(new Error('postgresql://meutreino:meutreino@localhost/db'))).toEqual({
      statusCode: 500,
      body: { error: { code: 'internal_error', message: 'Internal server error' } },
    });
  });

  it('maps a throttled response to a stable code', () => {
    expect(toApiError(new HttpException('Too many', 429)).body.error.code).toBe('rate_limited');
  });
});
