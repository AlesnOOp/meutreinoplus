import { Injectable } from '@nestjs/common';
import { Algorithm, hash, verify } from '@node-rs/argon2';

export const ARGON2_PARAMETERS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

@Injectable()
export class PasswordService {
  hash(password: string): Promise<string> {
    return hash(password, ARGON2_PARAMETERS);
  }

  verify(passwordHash: string, password: string): Promise<boolean> {
    return verify(passwordHash, password, ARGON2_PARAMETERS);
  }
}
