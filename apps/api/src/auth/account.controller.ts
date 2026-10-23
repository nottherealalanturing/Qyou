import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBody, ApiCookieAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { clientIp, clientUserAgent } from '../common/http/request-context.js';
import { RateLimit } from '../common/rate-limit/rate-limit.decorator.js';
import { RateLimitGuard } from '../common/rate-limit/rate-limit.guard.js';
import { zodBodySchema } from '../common/zod/openapi.js';
import { AccountSecurityService, type SessionSummary } from './account-security.service.js';
import { ChangePasswordDto, EmailVerificationConfirmDto } from './auth.schemas.js';
import type { AuthContext, PublicUser, RequestContext } from './auth.types.js';
import { CurrentAuth } from './current-user.decorator.js';
import {
  EmailVerificationService,
  type VerificationOutcome,
} from './email-verification.service.js';
import { Public } from './public.decorator.js';
import { SessionCookieService } from './session-cookie.service.js';

function contextOf(req: Request): RequestContext {
  return { ip: clientIp(req), userAgent: clientUserAgent(req) };
}

/** Account-security operations of a signed-in user (plus the public verification link target). */
@ApiTags('account security')
@Controller('auth')
@UseGuards(RateLimitGuard)
export class AccountController {
  constructor(
    private readonly security: AccountSecurityService,
    private readonly verification: EmailVerificationService,
    private readonly cookies: SessionCookieService,
  ) {}

  @Post('email-verification/request')
  @HttpCode(200)
  @RateLimit({ name: 'verify-request', limit: 10, windowSeconds: 60 * 60 })
  @ApiCookieAuth()
  @ApiOperation({ summary: 'Email a new verification link to the signed-in user' })
  @ApiResponse({ status: 200, description: '`sent`, or `already_verified` (idempotent)' })
  @ApiResponse({ status: 429, description: 'Too many requests' })
  async requestVerification(
    @CurrentAuth() auth: AuthContext,
    @Req() req: Request,
  ): Promise<{ status: 'sent' | 'already_verified' }> {
    return { status: await this.verification.resend(auth.user, contextOf(req)) };
  }

  @Public()
  @Post('email-verification/confirm')
  @HttpCode(200)
  @RateLimit({ name: 'verify-confirm', limit: 20, windowSeconds: 15 * 60 })
  @ApiOperation({ summary: 'Verify an email address with a single-use token' })
  @ApiBody(zodBodySchema(EmailVerificationConfirmDto))
  @ApiResponse({ status: 200, description: '`verified`, or `already_verified` when replayed' })
  @ApiResponse({ status: 400, description: 'Token invalid, expired or superseded' })
  async confirmVerification(
    @Body() dto: EmailVerificationConfirmDto,
    @Req() req: Request,
  ): Promise<{ status: VerificationOutcome }> {
    return { status: await this.verification.confirm(dto.token, contextOf(req)) };
  }

  @Post('password/change')
  @HttpCode(200)
  @RateLimit({ name: 'password-change', limit: 20, windowSeconds: 15 * 60 })
  @ApiCookieAuth()
  @ApiOperation({
    summary: 'Change password (requires the current password)',
    description:
      'Revokes ALL sessions of the user and issues a fresh session to the calling device, so ' +
      'only this device stays signed in (with a rotated token).',
  })
  @ApiBody(zodBodySchema(ChangePasswordDto))
  @ApiResponse({ status: 200, description: 'Password changed; new session cookie set' })
  @ApiResponse({ status: 400, description: 'Current password wrong, or new password invalid' })
  @ApiResponse({ status: 429, description: 'Too many wrong current-password attempts' })
  async changePassword(
    @CurrentAuth() auth: AuthContext,
    @Body() dto: ChangePasswordDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ user: PublicUser }> {
    const grant = await this.security.changePassword(auth.user, dto, contextOf(req));
    this.cookies.set(res, grant.token, grant.expiresAt);
    return { user: grant.user };
  }

  @Post('logout-all')
  @HttpCode(204)
  @ApiCookieAuth()
  @ApiOperation({ summary: 'Revoke every session of the user, including this one' })
  async logoutEverywhere(
    @CurrentAuth() auth: AuthContext,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.security.logoutEverywhere(auth.user, contextOf(req));
    this.cookies.clear(res);
  }

  @Get('sessions')
  @ApiCookieAuth()
  @ApiOperation({ summary: 'List the signed-in user’s active sessions' })
  async sessions(@CurrentAuth() auth: AuthContext): Promise<{ sessions: SessionSummary[] }> {
    return { sessions: await this.security.listSessions(auth.user, auth.sessionId) };
  }

  @Delete('sessions/:id')
  @HttpCode(204)
  @ApiCookieAuth()
  @ApiOperation({ summary: 'Revoke one of the caller’s own sessions (404 for anyone else’s)' })
  async revokeSession(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.security.revokeSession(auth.user, id, contextOf(req));
    if (id === auth.sessionId) this.cookies.clear(res);
  }
}
