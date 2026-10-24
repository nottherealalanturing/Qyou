import {
  Injectable,
  UseInterceptors,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import type { Response } from 'express';
import { tap } from 'rxjs';

const PUBLIC_READ_CACHE = 'public, max-age=60, stale-while-revalidate=120';

/**
 * Sets the cache header only AFTER the handler succeeded. (`@Header()` would set it before the
 * handler runs, so 404/400 responses would carry it too and a shared cache could keep serving a
 * stale "not found" for a record that has just been approved.)
 */
@Injectable()
export class PublicCacheInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {
    const response = context.switchToHttp().getResponse<Response>();
    return next.handle().pipe(tap(() => response.setHeader('Cache-Control', PUBLIC_READ_CACHE)));
  }
}

/**
 * Shared-cache hint for PUBLIC reference-data reads (identical for every visitor, never varies by
 * cookie). Deliberately short so a deactivated record disappears within a minute.
 */
export const PublicCache = () => UseInterceptors(PublicCacheInterceptor);
