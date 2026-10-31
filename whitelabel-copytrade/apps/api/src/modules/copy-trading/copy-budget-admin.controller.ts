// # Responsibility: the operator's copy-budget surface — read the tenant ceiling and every follower at or near their cap, and change the ceiling under a platform permission, a fresh step-up proof and an audit event.
//
// WHY THIS IS ITS OWN CONTROLLER
// ------------------------------
// `/copy-trading/budget` is the follower's own cap: the user id comes from the JWT
// and the customer may only ever write their own row. These routes act on the whole
// tenant, including a ceiling that silently bounds every follower's cap, so they
// carry their own paths, their own permission and their own step-up action. Putting
// them in the customer controller would make "which of these handlers can touch
// someone else's money" a question you answer by reading the body.
//
// NO SECOND BUDGET ENGINE
// -----------------------
// The list is computed in `CopyBudgetService.listOverCapUsers`, which sums the same
// active-subscription allocations through the same `resolveEffectiveCap` and
// `sumActiveExposure` the execution path uses. This file validates input, applies
// authorisation and records the audit event; it contains no arithmetic.
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Put,
  Query,
} from '@nestjs/common';
import { Permission, type AuthenticatedActor } from '@wlct/shared-types';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequestMeta, type RequestMetadata } from '../../common/decorators/request-context.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { TenantId } from '../../common/decorators/current-tenant.decorator';
import { AuditService } from '../audit/audit.service';
import { AuditAction, AuditActorType, AuditOutcome } from '@wlct/shared-types';
import { RequireStepUp } from '../auth/step-up/require-step-up.decorator';
import { OverCapUsersQueryDto, SetCopyBudgetDefaultCapsDto } from './dto/copy-budget-admin.dto';
import {
  CopyBudgetService,
  type OverCapUserRow,
  type TenantDefaultCapsView,
} from './copy-budget.service';

/** `total` is expressed over the whole matching set; the page is a slice of it. */
export interface OverCapUsersPage {
  data: OverCapUserRow[];
  total: number;
}

/** What a successful ceiling update returns: the stored value, re-read. */
export interface CopyBudgetDefaultCapsResponse {
  caps: TenantDefaultCapsView;
}

@Controller('admin/copy-trading/budget')
export class CopyBudgetAdminController {
  constructor(
    private readonly budgets: CopyBudgetService,
    private readonly audit: AuditService,
  ) {}

  /**
   * The tenant ceiling. Readable by anyone who can read copy subscriptions: it is
   * the number their own cap is clamped to, so hiding it only produces support
   * tickets. It is not a secret - it is the tenant's published exposure limit.
   */
  @Get()
  @RequirePermissions(Permission.COPY_SUBSCRIPTION_READ)
  async getDefaultCaps(@TenantId() tenantId: string): Promise<CopyBudgetDefaultCapsResponse> {
    return { caps: await this.budgets.getTenantDefaultCaps(tenantId) };
  }

  /**
   * Followers over or near their effective cap.
   *
   * `NEAR` is bounded by `utilisationBps` (default 90%) and `OVER` is strict
   * `committed > effectiveCap`; both come from the service, which reports a mixed
   * allocation-unit follower as UNMEASURABLE instead of ranking it on a sum that
   * cannot be compared. Management permission, because the rows name customers.
   */
  @Get('over-cap')
  @RequirePermissions(Permission.COPY_SUBSCRIPTION_MANAGE)
  async listOverCapUsers(
    @TenantId() tenantId: string,
    @Query() query: OverCapUsersQueryDto,
  ): Promise<OverCapUsersPage> {
    return this.budgets.listOverCapUsers({
      tenantId,
      page: query.page,
      limit: query.limit,
      utilisationBps: query.utilisationBps,
      status: query.status,
    });
  }

  /**
   * Replaces the tenant ceiling.
   *
   * Three gates, all required: `copy_subscription:manage` (authorisation),
   * `COPY_BUDGET_DEFAULT_UPDATE` (a proof issued for this exact action, consumed by
   * the guard) and an audit event written after the write succeeded. The audit row
   * records the previous value as well as the new one - "who lowered the ceiling
   * and to what" is the question an incident review asks, and the old number is not
   * recoverable from the new one.
   */
  @Put()
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permission.COPY_SUBSCRIPTION_MANAGE)
  @RequireStepUp('COPY_BUDGET_DEFAULT_UPDATE')
  async setDefaultCaps(
    @CurrentUser() actor: AuthenticatedActor,
    @TenantId() tenantId: string,
    @Body() dto: SetCopyBudgetDefaultCapsDto,
    @RequestMeta() meta: RequestMetadata,
  ): Promise<CopyBudgetDefaultCapsResponse> {
    const before = await this.budgets.getTenantDefaultCaps(tenantId);
    const caps = await this.budgets.setTenantDefaultCaps({
      tenantId,
      maxActiveExposure: dto.maxActiveExposure,
      perTraderCap: dto.perTraderCap ?? null,
      currency: dto.currency,
      actorId: actor.userId,
    });

    await this.audit.record({
      tenantId,
      actorType: AuditActorType.USER,
      actorId: actor.userId,
      action: AuditAction.TENANT_SETTING_UPDATED,
      outcome: AuditOutcome.SUCCESS,
      resourceType: 'copy_budget_tenant_ceiling',
      resourceId: tenantId,
      description: 'Copy-trading tenant ceiling updated',
      metadata: {
        key: 'copy_budget.tenant_ceiling',
        // Amounts stay strings end to end; the audit trail must quote exactly what
        // was written, not a float rendering of it.
        previous: { amount: before.maxActiveExposure, currency: before.currency, status: before.status },
        next: { amount: caps.maxActiveExposure, perTraderCap: dto.perTraderCap ?? null, currency: caps.currency },
      },
      ipHash: meta.ipHash,
      requestId: meta.requestId,
    });

    return { caps };
  }
}
