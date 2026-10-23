import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { AuthenticatedRequest, PublicUser } from './auth.types.js';

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const user = ctx.switchToHttp().getRequest<AuthenticatedRequest>().auth?.user;
  if (!user) throw new Error('CurrentUser used on a route without an authenticated session');
  return user satisfies PublicUser;
});
