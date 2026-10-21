import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from './zod-validation.pipe';

describe('ZodValidationPipe', () => {
  const pipe = new ZodValidationPipe(z.object({ name: z.string().trim().min(1) }));

  it('returns the parsed value', () => {
    expect(pipe.transform({ name: '  Supino  ' })).toEqual({ name: 'Supino' });
  });

  it('rejects invalid input without returning the raw value', () => {
    expect(() => pipe.transform({ name: '' })).toThrow(BadRequestException);
    try {
      pipe.transform({ name: '' });
    } catch (error) {
      expect(JSON.stringify(error)).not.toContain('password');
      expect(error).toBeInstanceOf(BadRequestException);
    }
  });
});
