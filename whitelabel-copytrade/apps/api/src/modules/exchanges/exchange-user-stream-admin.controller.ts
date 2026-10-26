// # Operator list of every exchange account's user-data stream health, for the console's stream table.
//
// WHY THIS IS A SEPARATE FILE
// ---------------------------
// `check-web-api-contract` resolves one controller per file, and the customer route
// (`GET /v1/exchanges/:accountId/user-stream`) must stay exactly where it is. So the
// operator view - one row per account in the operator's tenant - is its own
// controller with its own permission.
//
// It adds no logic of its own: `ExchangeUserStreamService.listHealth` already
// answers per account, including UNKNOWN when the engine cannot be reached. The
// console must never see a filtered or optimistic version of that answer, so this
// handler forwards it as-is and sorts nothing - the order the engine reports is the
// order an operator can reason about stability from.
import { Controller, Get, Query } from '@nestjs/common';
import { Permission } from '@wlct/shared-types';

import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { TenantId } from '../../common/decorators/current-tenant.decorator';
import { ExchangeUserStreamService, type ExchangeUserStreamHealth } from './exchange-user-stream.service';

@Controller('admin/exchange-user-streams')
export class ExchangeUserStreamAdminController {
  constructor(private readonly userStreamHealth: ExchangeUserStreamService) {}

  @Get()
  @RequirePermissions(Permission.EXECUTION_READ)
  async list(
    @TenantId() tenantId: string,
    @Query('limit') limit?: string,
  ): Promise<{ data: ExchangeUserStreamHealth[]; total: number }> {
    const rows = await this.userStreamHealth.listHealth({ tenantId });
    // The cap is applied after the (bounded) engine read so `total` stays truthful:
    // an operator who is shown 100 of 140 rows should know there are 140.
    const parsed = Number.parseInt(String(limit ?? ''), 10);
    const capped = Number.isFinite(parsed) && parsed > 0 ? rows.slice(0, Math.min(parsed, 500)) : rows;
    return { data: capped, total: rows.length };
  }
}
