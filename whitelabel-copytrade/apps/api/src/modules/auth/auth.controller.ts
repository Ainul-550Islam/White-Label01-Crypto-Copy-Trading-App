import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBody, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type {
  AuthenticatedActor,
  AuthenticatedSessionDto,
  LoginResultDto,
  UserDto,
} from '@wlct/shared-types';

import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { LogoutDto } from './dto/logout.dto';
import { VerifyTwoFactorDto } from './dto/verify-two-factor.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { UsersService } from '../users/users.service';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { RequestMeta, type RequestMetadata } from '../../common/decorators/request-context.decorator';
import { ApiStandardResponses } from '../../common/decorators/api-standard-responses.decorator';
import type { AppRequest, TenantContext } from '../../common/types/request.types';

/**
 * Authentication endpoints.
 *
 * Every route here is on the strict `auth` throttler bucket because these are
 * the endpoints an attacker targets first.
 */
@ApiTags('Authentication')
@Controller({ path: 'auth', version: '1' })
@ApiStandardResponses()
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly usersService: UsersService,
  ) {}

  @Post('register')
  @Public()
  @Throttle({ auth: { limit: 5, ttl: 300_000 } })
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Register a new account within the resolved tenant',
    description:
      'The organisation is resolved from the request host or the X-Tenant-Slug header. New accounts receive the FOLLOWER role by default.',
  })
  @ApiBody({ type: RegisterDto })
  @ApiCreatedResponse({ description: 'Account created and signed in.' })
  async register(
    @Body() dto: RegisterDto,
    @CurrentTenant() tenant: TenantContext,
    @RequestMeta() meta: RequestMetadata,
  ): Promise<AuthenticatedSessionDto> {
    return this.authService.register(tenant, dto, {
      ipHash: meta.ipHash,
      userAgent: meta.userAgent,
      requestId: meta.requestId,
      locale: meta.locale,
    });
  }

  @Post('login')
  @Public()
  @Throttle({ auth: { limit: 10, ttl: 300_000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Authenticate with email and password',
    description:
      'Returns a token pair, or a two-factor challenge when the account has 2FA enabled.',
  })
  @ApiOkResponse({ description: 'A session or a two-factor challenge.' })
  async login(
    @Body() dto: LoginDto,
    @CurrentTenant() tenant: TenantContext,
    @RequestMeta() meta: RequestMetadata,
  ): Promise<LoginResultDto> {
    return this.authService.login(tenant, dto, {
      ipHash: meta.ipHash,
      userAgent: meta.userAgent,
      requestId: meta.requestId,
      locale: meta.locale,
    });
  }

  @Post('two-factor/verify')
  @Public()
  @Throttle({ auth: { limit: 10, ttl: 300_000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Complete a two-factor login challenge' })
  @ApiOkResponse({ description: 'Authenticated session.' })
  async verifyTwoFactor(
    @Body() dto: VerifyTwoFactorDto,
    @CurrentTenant() tenant: TenantContext,
    @RequestMeta() meta: RequestMetadata,
  ): Promise<AuthenticatedSessionDto> {
    return this.authService.verifyTwoFactor(tenant, dto, {
      ipHash: meta.ipHash,
      userAgent: meta.userAgent,
      requestId: meta.requestId,
      locale: meta.locale,
    });
  }

  @Post('refresh')
  @Public()
  @Throttle({ auth: { limit: 30, ttl: 300_000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Exchange a refresh token for a new token pair',
    description:
      'Refresh tokens rotate on every use. Presenting a consumed token revokes the whole family and signs the user out everywhere.',
  })
  @ApiOkResponse({ description: 'A new token pair.' })
  async refresh(
    @Body() dto: RefreshTokenDto,
    @RequestMeta() meta: RequestMetadata,
  ): Promise<AuthenticatedSessionDto> {
    return this.authService.refresh(dto.refreshToken, dto.deviceId, {
      ipHash: meta.ipHash,
      userAgent: meta.userAgent,
      requestId: meta.requestId,
      locale: meta.locale,
    });
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Sign out of the current device, or every device' })
  @ApiOkResponse({ description: 'Logout acknowledgement.' })
  async logout(
    @Body() dto: LogoutDto,
    @CurrentUser() actor: AuthenticatedActor,
    @Req() request: AppRequest,
    @RequestMeta() meta: RequestMetadata,
  ): Promise<{ loggedOut: true; sessionsRevoked: number }> {
    // The token expiry is needed to size the blacklist entry precisely.
    const authHeader = request.headers.authorization ?? '';
    const rawToken = authHeader.replace(/^Bearer\s+/i, '');
    const payloadSegment = rawToken.split('.')[1] ?? '';
    let expiry = Math.floor(Date.now() / 1000) + 900;
    try {
      const decoded = JSON.parse(Buffer.from(payloadSegment, 'base64url').toString('utf8')) as {
        exp?: number;
      };
      if (typeof decoded.exp === 'number') {
        expiry = decoded.exp;
      }
    } catch {
      // Fall back to the default TTL when the payload cannot be parsed.
    }

    return this.authService.logout(
      actor.userId,
      actor.tenantId,
      actor.sessionId,
      actor.tokenId,
      expiry,
      dto.allDevices,
      {
        ipHash: meta.ipHash,
        userAgent: meta.userAgent,
        requestId: meta.requestId,
        locale: meta.locale,
      },
    );
  }

  @Get('me')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Return the authenticated user with roles and permissions' })
  @ApiOkResponse({ description: 'The current user profile.' })
  async me(@CurrentUser() actor: AuthenticatedActor): Promise<UserDto> {
    return this.usersService.findByIdForSession(actor.userId, actor.tenantId);
  }

  @Post('change-password')
  @Throttle({ auth: { limit: 5, ttl: 300_000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Change the password of the authenticated account' })
  @ApiOkResponse({ description: 'Password changed.' })
  async changePassword(
    @Body() dto: ChangePasswordDto,
    @CurrentUser() actor: AuthenticatedActor,
    @RequestMeta() meta: RequestMetadata,
  ): Promise<{ changed: true; sessionsRevoked: number }> {
    return this.authService.changePassword(actor.userId, actor.tenantId, actor.sessionId, dto, {
      ipHash: meta.ipHash,
      userAgent: meta.userAgent,
      requestId: meta.requestId,
      locale: meta.locale,
    });
  }
}
