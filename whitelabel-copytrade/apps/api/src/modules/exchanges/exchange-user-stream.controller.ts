// # Exposes one exchange account's private user-data stream health, tenant-scoped from the JWT.
import { BadRequestException, Controller, Get, NotFoundException, Param } from '@nestjs/common';
import { Permission } from '@wlct/shared-types';
import { RequireAnyPermission } from '../../common/decorators/permissions.decorator';
import { TenantId } from '../../common/decorators/current-tenant.decorator';
import { ExchangeUserStreamService, type ExchangeUserStreamHealth } from './exchange-user-stream.service';

/**
 * `/v1/exchanges/:accountId/user-stream`.
 *
 * The account id in the path is a claim, not a permission: the service resolves
 * it inside the caller's tenant and returns null for anything else, which
 * becomes a 404 here. A 403 would confirm the account exists in another tenant,
 * and that is a fact this route has no reason to disclose.
 */
@Controller('exchanges')
export class ExchangeUserStreamController {
  constructor(private readonly userStreamService: ExchangeUserStreamService) {}

  @Get(':accountId/user-stream')
  @RequireAnyPermission(Permission.EXCHANGE_ACCOUNT_READ, Permission.EXECUTION_READ)
  async getUserStream(
    @TenantId() tenantId: string,
    @Param('accountId') accountId: string,
  ): Promise<ExchangeUserStreamHealth> {
    if (typeof accountId !== 'string' || accountId.trim().length === 0) {
      throw new BadRequestException('accountId is required');
    }
    const health = await this.userStreamService.getHealth({ tenantId, accountId });
    if (!health) throw new NotFoundException('Exchange account not found');
    return health;
  }
}
