import {
  HttpException,
  HttpStatus,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { clientIp } from '../http/request-context.js';
import { RATE_LIMIT_KEY, type RateLimitOptions } from './rate-limit.decorator.js';
import { RateLimiter } from './rate-limiter.js';

export function tooManyRequests(retryAfterSeconds: number): HttpException {
  return new HttpException(
    {
      statusCode: 429,
      error: 'Too Many Requests',
      message: 'Too many attempts. Please wait a while and try again.',
      retryAfterSeconds,
    },
    HttpStatus.TOO_MANY_REQUESTS,
  );
}

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly limiter: RateLimiter,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const options = this.reflector.get<RateLimitOptions | undefined>(
      RATE_LIMIT_KEY,
      context.getHandler(),
    );
    if (!options) return true;

    const http = context.switchToHttp();
    const ip = clientIp(http.getRequest<Request>()) ?? 'unknown';
    const result = await this.limiter.hit(
      `ip:${options.name}:${ip}`,
      options.limit,
      options.windowSeconds * 1000,
    );
    if (!result.allowed) {
      http.getResponse<Response>().setHeader('Retry-After', String(result.retryAfterSeconds));
      throw tooManyRequests(result.retryAfterSeconds);
    }
    return true;
  }
}
