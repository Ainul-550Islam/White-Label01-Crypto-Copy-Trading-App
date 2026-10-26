// # Read-only operator audit of withdrawal destinations and their cooldown state, per tenant.
//
// THE ONLY TENANT-WIDE READ IN THE DESTINATION FEATURE
// ---------------------------------------------------
// Everything a customer can do to their allowlist goes through
// `WithdrawalDestinationController`, which resolves tenant and user from the JWT. This
// controller exists for the opposite case: support needs to answer "where is this
// customer's money allowed to go, and since when" while the customer is on the phone.
//
// It is GET-only on purpose. An operator who could add a destination for a customer
// would defeat the entire control - the cooldown exists because a stolen session must
// not be able to redirect funds, and an operator persuaded by a support call is
// exactly the social-engineering path that replaces that session. There is no
// override, no "force activate", and no delete on this surface.
//
// `decisions` is returned per destination and is empty today: the policy decision is
// logged to the custody audit trail rather than stored on the destination row, and
// this route does not join that trail. The field is present so the console's shape
// does not change when the join is added.
import { Controller, Get, Query } from '@nestjs/common';
import { Permission } from '@wlct/shared-types';

import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { TenantId } from '../../common/decorators/current-tenant.decorator';
import {
  WithdrawalDestinationPolicyService,
  type WithdrawalDestinationRecord,
} from './withdrawal-destination-policy.service';

export interface DestinationAuditView {
  id: string;
  tenantId: string;
  userId: string;
  network: string;
  address: string;
  label: string;
  status: string;
  activatesAt: string;
  revokedAt: string | null;
  createdAt: string;
  remainingCooldownMs: number;
  decisions: Array<{ at: string; decision: string; reason: string }>;
}

function toView(row: WithdrawalDestinationRecord & { remainingCooldownMs: number }): DestinationAuditView {
  return {
    id: row.id,
    tenantId: row.tenantId,
    userId: row.userId,
    network: row.network,
    address: row.address,
    label: row.label,
    status: row.status,
    activatesAt: row.activatesAt.toISOString(),
    revokedAt: row.revokedAt ? row.revokedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    remainingCooldownMs: row.remainingCooldownMs,
    decisions: [],
  };
}

@Controller('admin/custody/destinations')
export class WithdrawalDestinationAdminController {
  constructor(private readonly policy: WithdrawalDestinationPolicyService) {}

  /**
   * `PAYOUT_MANAGE` is the finance/support permission for "I am answering a question
   * about this customer's money". It is a read permission in practice: no route on
   * this controller can change anything.
   */
  @Get()
  @RequirePermissions(Permission.PAYOUT_MANAGE)
  async list(
    @TenantId() tenantId: string,
    @Query('limit') limit?: string,
  ): Promise<{ data: DestinationAuditView[]; total: number }> {
    const parsed = Number.parseInt(String(limit ?? ''), 10);
    // The sweep is deliberately NOT run here: activating a destination is a service
    // decision tied to the owner's own view of it, and an operator opening an audit
    // page should not change state as a side effect.
    const rows = await this.policy.listForTenant({
      tenantId,
      ...(Number.isFinite(parsed) && parsed > 0 ? { limit: parsed } : {}),
    });
    return { data: rows.map(toView), total: rows.length };
  }
}
