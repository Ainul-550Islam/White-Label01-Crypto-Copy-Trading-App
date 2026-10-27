import { Body, Controller, Headers, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import { Public } from '../../common/decorators/public.decorator';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { RequestMeta, type RequestMetadata } from '../../common/decorators/request-context.decorator';
import type { TenantContext } from '../../common/types/request.types';
import { AccountRecoveryRuntimeService } from './account-recovery-runtime.service';
import { CompleteAccountRecoveryDto, RequestAccountRecoveryDto, VerifyAccountRecoveryDto } from './dto/account-recovery.dto';

/** Public, tenant-bound recovery; the request endpoint never reveals account existence. */
@Controller('auth/recovery')
export class AccountRecoveryController {
  constructor(private readonly recovery: AccountRecoveryRuntimeService) {}

  @Public()
  @Post('request')
  @HttpCode(HttpStatus.ACCEPTED)
  // A web BFF can aggregate clients behind one IP; per-address limits are
  // enforced independently in Redis rather than blocking all tenants at five.
  @Throttle({ default: { limit: 1000, ttl: 60 * 60 * 1_000 } })
  async request(@CurrentTenant() tenant: TenantContext, @Body() dto: RequestAccountRecoveryDto, @Headers('idempotency-key') idempotencyKey?: string) {
    // A body slug is never an authority; the existing host/header resolver owns tenant selection.
    return this.recovery.request(tenant.tenantId, { email: dto.email, idempotencyKey });
  }

  @Public()
  @Post('verify')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 1000, ttl: 60 * 60 * 1_000 } })
  async verify(@CurrentTenant() tenant: TenantContext, @Body() dto: VerifyAccountRecoveryDto) {
    return this.recovery.verify(tenant.tenantId, dto.token);
  }

  @Public()
  @Post('complete')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 1000, ttl: 60 * 60 * 1_000 } })
  async complete(@CurrentTenant() tenant: TenantContext, @Body() dto: CompleteAccountRecoveryDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined, @RequestMeta() meta: RequestMetadata) {
    return this.recovery.complete(tenant.tenantId, { token: dto.token, newPassword: dto.newPassword, idempotencyKey,
      ipHash: meta.ipHash, requestId: meta.requestId });
  }
}
