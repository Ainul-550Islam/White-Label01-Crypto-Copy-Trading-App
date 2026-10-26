// # Responsibility: exposes the Batch 04 tenant-scoped API endpoints for this capability.
// # Provides authenticated reads, explicit affirmative acceptance, and auditable withdrawal for current policy versions.
import { Body, Controller, Get, Post } from '@nestjs/common';
import { Permission, type AuthenticatedActor } from '@wlct/shared-types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { PolicyAcceptanceDto, PolicyWithdrawalDto } from './dto/policy-acceptance.dto';
import { PolicyAcceptanceService } from './policy-acceptance.service';

@Controller({ path: 'compliance/policies', version: '1' })
export class PolicyAcceptanceController {
  constructor(private readonly policies: PolicyAcceptanceService) {}

  @Get('current')
  @RequirePermissions(Permission.USER_READ)
  current() { return this.policies.current(); }

  @Post('accept')
  @RequirePermissions(Permission.USER_UPDATE)
  accept(@CurrentUser() actor: AuthenticatedActor, @Body() dto: PolicyAcceptanceDto) {
    return this.policies.accept({ tenantId: actor.tenantId, userId: actor.userId, ...dto });
  }

  @Post('withdraw')
  @RequirePermissions(Permission.USER_UPDATE)
  async withdraw(@CurrentUser() actor: AuthenticatedActor, @Body() dto: PolicyWithdrawalDto) {
    await this.policies.withdraw({ tenantId: actor.tenantId, userId: actor.userId, document: dto.document });
    return { withdrawn: true, document: dto.document };
  }
}
