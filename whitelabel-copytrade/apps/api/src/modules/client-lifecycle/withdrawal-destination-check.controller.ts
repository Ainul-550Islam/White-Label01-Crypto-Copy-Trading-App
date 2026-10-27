import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { IsIn, IsString, Length } from 'class-validator';
import { Permission, type AuthenticatedActor } from '@wlct/shared-types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { TenantId } from '../../common/decorators/current-tenant.decorator';
import { RequireAnyPermission } from '../../common/decorators/permissions.decorator';
import { WITHDRAWAL_NETWORKS, type WithdrawalNetwork } from '../custody/dto/withdrawal-destination.dto';
import { WithdrawalDestinationPolicyService, type DestinationDecisionCode } from '../custody/withdrawal-destination-policy.service';

class CheckWithdrawalDestinationDto {
  @IsIn(WITHDRAWAL_NETWORKS as unknown as string[])
  network!: WithdrawalNetwork;

  @IsString()
  @Length(16, 128)
  address!: string;
}

/**
 * A read-only allowlist check for the signed-in customer. This is not a
 * withdrawal, reservation, or authorization to transfer funds; the actual
 * withdrawal path must re-evaluate every policy under its transaction.
 * POST keeps the address out of URLs and access logs. No state is changed.
 */
@Controller('client-lifecycle/withdrawal-destination-check')
export class WithdrawalDestinationCheckController {
  constructor(private readonly policy: WithdrawalDestinationPolicyService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @RequireAnyPermission(Permission.PORTFOLIO_READ, Permission.PAYOUT_MANAGE)
  async check(
    @TenantId() tenantId: string,
    @CurrentUser() actor: AuthenticatedActor,
    @Body() dto: CheckWithdrawalDestinationDto,
  ): Promise<{ network: WithdrawalNetwork; decision: 'ALLOW' | 'DENY'; code: DestinationDecisionCode; destinationId: string | null; activatesAt: string | null }> {
    const result = await this.policy.evaluateWithdrawal({ tenantId, userId: actor.userId, network: dto.network, address: dto.address });
    return { network: dto.network, decision: result.decision, code: result.code, destinationId: result.destinationId, activatesAt: result.activatesAt };
  }
}
