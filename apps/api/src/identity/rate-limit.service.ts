import { Injectable } from '@nestjs/common';
import { HttpStatus } from '@nestjs/common';
import { fail } from './http';

type Bucket = number[];

const FIFTEEN_MINUTES = 15 * 60 * 1000;
const ONE_HOUR = 60 * 60 * 1000;

@Injectable()
export class AuthRateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  hitLogin(ip: string, subjectHash: string): void {
    this.consume(`login-ip:${ip}`, 40, FIFTEEN_MINUTES);
    this.consume(`login-subject:${subjectHash}`, 8, FIFTEEN_MINUTES);
  }

  clearLogin(subjectHash: string): void {
    this.buckets.delete(`login-subject:${subjectHash}`);
  }

  hitRegister(ip: string): void {
    this.consume(`register:${ip}`, 30, ONE_HOUR);
  }

  hitForgot(ip: string): void {
    this.consume(`forgot:${ip}`, 8, ONE_HOUR);
  }

  hitResend(subjectHash: string): void {
    this.consume(`resend:${subjectHash}`, 5, ONE_HOUR);
  }

  hitVerify(ip: string): void {
    this.consume(`verify:${ip}`, 20, ONE_HOUR);
  }

  private consume(key: string, limit: number, windowMs: number): void {
    const now = Date.now();
    const recent = (this.buckets.get(key) ?? []).filter((timestamp) => now - timestamp < windowMs);
    if (recent.length >= limit) {
      this.buckets.set(key, recent);
      throw fail(
        HttpStatus.TOO_MANY_REQUESTS,
        'rate_limited',
        'Muitas tentativas. Aguarde e tente de novo.',
      );
    }
    recent.push(now);
    this.buckets.set(key, recent);
  }
}
