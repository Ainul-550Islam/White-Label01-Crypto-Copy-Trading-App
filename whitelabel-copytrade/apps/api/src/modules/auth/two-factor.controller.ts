import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthenticatedActor, TwoFactorSetupDto } from '@wlct/shared-types';

import { TwoFactorService } from './services/two-factor.service';
import {
  BeginTwoFactorSetupDto,
  ConfirmTwoFactorSetupDto,
  DisableTwoFactorDto,
  RegenerateRecoveryCodesDto,
} from './dto/two-factor.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequestMeta, type RequestMetadata } from '../../common/decorators/request-context.decorator';
import { ApiStandardResponses } from '../../common/decorators/api-standard-responses.decorator';
import { UsersService } from '../users/users.service';

/**
 * Two-factor enrolment and management for the authenticated account.
 *
 * The secret and recovery codes are returned exactly once, at enrolment time.
 * There is no endpoint that can read them back.
 */
@ApiTags('Two-Factor Authentication')
@Controller({ path: 'auth/two-factor', version: '1' })
@ApiStandardResponses()
export class TwoFactorController {
  constructor(
    private readonly twoFactorService: TwoFactorService,
    private readonly usersService: UsersService,
  ) {}

  @Post('setup')
  @Throttle({ auth: { limit: 5, ttl: 300_000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Begin two-factor enrolment',
    description:
      'Generates a TOTP secret, a QR code and one-time recovery codes. 2FA is not enforced until the setup is confirmed.',
  })
  @ApiOkResponse({ description: 'Provisioning material. Shown once, never retrievable again.' })
  async setup(
    @Body() dto: BeginTwoFactorSetupDto,
    @CurrentUser() actor: AuthenticatedActor,
  ): Promise<TwoFactorSetupDto> {
    const user = await this.usersService.findByIdForSession(actor.userId, actor.tenantId);
    return this.twoFactorService.beginSetup(actor.userId, actor.tenantId, user.email, dto.password);
  }

  @Post('confirm')
  @Throttle({ auth: { limit: 10, ttl: 300_000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Confirm enrolment and activate two-factor authentication' })
  @ApiOkResponse({ description: 'Two-factor authentication is now active.' })
  async confirm(
    @Body() dto: ConfirmTwoFactorSetupDto,
    @CurrentUser() actor: AuthenticatedActor,
    @RequestMeta() meta: RequestMetadata,
  ): Promise<{ enabled: true }> {
    return this.twoFactorService.confirmSetup(actor.userId, actor.tenantId, dto.code, {
      ipHash: meta.ipHash,
      requestId: meta.requestId,
    });
  }

  @Post('disable')
  @Throttle({ auth: { limit: 5, ttl: 300_000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Disable two-factor authentication' })
  @ApiOkResponse({ description: 'Two-factor authentication disabled.' })
  async disable(
    @Body() dto: DisableTwoFactorDto,
    @CurrentUser() actor: AuthenticatedActor,
    @RequestMeta() meta: RequestMetadata,
  ): Promise<{ disabled: true }> {
    return this.twoFactorService.disable(
      actor.userId,
      actor.tenantId,
      dto.password,
      { code: dto.code, recoveryCode: dto.recoveryCode },
      { ipHash: meta.ipHash, requestId: meta.requestId },
    );
  }

  @Post('recovery-codes')
  @Throttle({ auth: { limit: 3, ttl: 300_000 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Regenerate recovery codes',
    description: 'Invalidates the previous set. The new codes are shown once.',
  })
  @ApiOkResponse({ description: 'Freshly generated recovery codes.' })
  async regenerate(
    @Body() dto: RegenerateRecoveryCodesDto,
    @CurrentUser() actor: AuthenticatedActor,
  ): Promise<{ recoveryCodes: string[] }> {
    const recoveryCodes = await this.twoFactorService.regenerateRecoveryCodes(
      actor.userId,
      dto.password,
    );
    return { recoveryCodes };
  }
}
