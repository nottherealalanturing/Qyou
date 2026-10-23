import type { Request } from 'express';
import type { UserRole } from '../generated/prisma/client.js';

/** The user as exposed to clients. Never includes the password hash or status internals. */
export interface PublicUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  createdAt: Date;
}

export interface AuthContext {
  user: PublicUser;
  sessionId: string;
}

export type AuthenticatedRequest = Request & { auth?: AuthContext };

export interface RequestContext {
  ip: string | undefined;
  userAgent: string | undefined;
}

export const SESSION_ABSOLUTE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const SESSION_IDLE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** `lastSeenAt` is refreshed at most this often, to avoid a write on every request. */
export const SESSION_TOUCH_INTERVAL_MS = 5 * 60 * 1000;
export const PASSWORD_RESET_TTL_MS = 30 * 60 * 1000;
