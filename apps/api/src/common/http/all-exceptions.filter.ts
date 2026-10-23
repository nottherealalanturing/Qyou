import {
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Response } from 'express';

/** Client-error messages for errors raised by Express middleware (body-parser et al.). */
const MIDDLEWARE_ERRORS: Record<string, { status: number; message: string }> = {
  'entity.too.large': { status: 413, message: 'Request body is too large' },
  'entity.parse.failed': { status: 400, message: 'Request body is not valid JSON' },
  'encoding.unsupported': { status: 415, message: 'Unsupported content encoding' },
  'charset.unsupported': { status: 415, message: 'Unsupported charset' },
};

/**
 * Last-resort filter. HTTP exceptions pass through; known body-parser client errors map to their
 * 4xx status; anything else becomes a generic 500. Unexpected errors are logged by name/code
 * only: ORM and driver error messages can embed query parameters (emails, password hashes), so
 * they must not be written to logs or returned to clients.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Unhandled');

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const payload = typeof body === 'string' ? { statusCode: status, message: body } : body;
      const retryAfter = (payload as { retryAfterSeconds?: unknown }).retryAfterSeconds;
      if (status === 429 && typeof retryAfter === 'number') {
        res.setHeader('Retry-After', String(retryAfter));
      }
      res.status(status).json(payload);
      return;
    }

    const code = (exception as { code?: unknown; type?: unknown } | null)?.code;
    const type = (exception as { type?: unknown } | null)?.type;
    const known = typeof type === 'string' ? MIDDLEWARE_ERRORS[type] : undefined;
    if (known) {
      res.status(known.status).json({
        statusCode: known.status,
        error: known.status === 413 ? 'Payload Too Large' : 'Bad Request',
        message: known.message,
      });
      return;
    }

    const name = exception instanceof Error ? exception.name : typeof exception;
    this.logger.error(`Unhandled ${name}${typeof code === 'string' ? ` (${code})` : ''}`);
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: 500,
      error: 'Internal Server Error',
      message: 'Something went wrong. Please try again.',
    });
  }
}
