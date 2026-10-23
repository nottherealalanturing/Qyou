import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { AuthContext, AuthenticatedRequest, PublicUser } from './auth.types.js';

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const user = ctx.switchToHttp().getRequest<AuthenticatedRequest>().auth?.user;
  if (!user) throw new Error('CurrentUser used on a route without an authenticated session');
  return user satisfies PublicUser;
});

/** The authenticated user plus the id of the session making the request. */
export const CurrentAuth = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const auth = ctx.switchToHttp().getRequest<AuthenticatedRequest>().auth;
  if (!auth) throw new Error('CurrentAuth used on a route without an authenticated session');
  return auth satisfies AuthContext;
});
