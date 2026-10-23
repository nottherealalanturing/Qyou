import { Body, Controller, Get, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ApiBody, ApiCookieAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { clientIp, clientUserAgent } from '../common/http/request-context.js';
import { RateLimit } from '../common/rate-limit/rate-limit.decorator.js';
import { RateLimitGuard } from '../common/rate-limit/rate-limit.guard.js';
import { zodBodySchema } from '../common/zod/openapi.js';
import {
  LoginDto,
  PasswordResetConfirmDto,
  PasswordResetRequestDto,
  RegisterDto,
} from './auth.schemas.js';
import { AuthService, type SessionGrant } from './auth.service.js';
import type { PublicUser, RequestContext } from './auth.types.js';
import { CurrentUser } from './current-user.decorator.js';
import { Public } from './public.decorator.js';
import { SessionCookieService } from './session-cookie.service.js';

const GENERIC_RESET_MESSAGE =
  'If an account exists for that email, we have sent a link to reset the password.';

function contextOf(req: Request): RequestContext {
  return { ip: clientIp(req), userAgent: clientUserAgent(req) };
}

@ApiTags('auth')
@Controller('auth')
@UseGuards(RateLimitGuard)
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly cookies: SessionCookieService,
  ) {}

  private startSession(res: Response, grant: SessionGrant): { user: PublicUser } {
    this.cookies.set(res, grant.token, grant.expiresAt);
    return { user: grant.user };
  }

  @Public()
  @Post('register')
  @RateLimit({ name: 'register', limit: 10, windowSeconds: 60 * 60 })
  @ApiOperation({ summary: 'Create a customer account and sign in' })
  @ApiBody(zodBodySchema(RegisterDto))
  @ApiResponse({ status: 201, description: 'Account created; session cookie set' })
  @ApiResponse({ status: 409, description: 'Email already registered' })
  async register(
    @Body() dto: RegisterDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ user: PublicUser }> {
    return this.startSession(res, await this.auth.register(dto, contextOf(req)));
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  @RateLimit({ name: 'login', limit: 30, windowSeconds: 15 * 60 })
  @ApiOperation({ summary: 'Sign in with email and password' })
  @ApiBody(zodBodySchema(LoginDto))
  @ApiResponse({ status: 200, description: 'Signed in; session cookie set (previous one rotated)' })
  @ApiResponse({ status: 401, description: 'Invalid email or password' })
  @ApiResponse({ status: 429, description: 'Too many failed attempts' })
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ user: PublicUser }> {
    const grant = await this.auth.login(dto, contextOf(req), this.cookies.read(req));
    return this.startSession(res, grant);
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  @ApiOperation({ summary: 'Revoke the current session (idempotent)' })
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.auth.logout(this.cookies.read(req), contextOf(req));
    this.cookies.clear(res);
  }

  @Get('me')
  @ApiCookieAuth()
  @ApiOperation({ summary: 'The signed-in user' })
  @ApiResponse({ status: 200, description: 'Current user' })
  @ApiResponse({ status: 401, description: 'Not signed in' })
  me(@CurrentUser() user: PublicUser): { user: PublicUser } {
    return { user };
  }

  @Public()
  @Post('password-reset/request')
  @HttpCode(202)
  @RateLimit({ name: 'password-reset-request', limit: 10, windowSeconds: 60 * 60 })
  @ApiOperation({ summary: 'Email a password-reset link (identical response for every address)' })
  @ApiBody(zodBodySchema(PasswordResetRequestDto))
  @ApiResponse({
    status: 202,
    description: 'Accepted; says nothing about whether the account exists',
  })
  async requestReset(
    @Body() dto: PasswordResetRequestDto,
    @Req() req: Request,
  ): Promise<{ message: string }> {
    await this.auth.requestPasswordReset(dto.email, contextOf(req));
    return { message: GENERIC_RESET_MESSAGE };
  }

  @Public()
  @Post('password-reset/confirm')
  @HttpCode(200)
  @RateLimit({ name: 'password-reset-confirm', limit: 10, windowSeconds: 15 * 60 })
  @ApiOperation({ summary: 'Set a new password using a single-use reset token' })
  @ApiBody(zodBodySchema(PasswordResetConfirmDto))
  @ApiResponse({ status: 200, description: 'Password changed; all sessions revoked' })
  @ApiResponse({ status: 400, description: 'Token invalid, expired or already used' })
  async confirmReset(
    @Body() dto: PasswordResetConfirmDto,
    @Req() req: Request,
  ): Promise<{ message: string }> {
    await this.auth.confirmPasswordReset(dto, contextOf(req));
    return { message: 'Your password has been updated. You can now log in.' };
  }
}
