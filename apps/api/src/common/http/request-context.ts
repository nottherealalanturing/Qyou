import type { Request } from 'express';

const MAX_UA = 255;

export function clientIp(req: Request): string | undefined {
  return req.ip ?? req.socket.remoteAddress ?? undefined;
}

export function clientUserAgent(req: Request): string | undefined {
  const ua = req.headers['user-agent'];
  return typeof ua === 'string' && ua.length > 0 ? ua.slice(0, MAX_UA) : undefined;
}
