// # Exposes the customer's withdrawal address allowlist: list, add and revoke, tenant-scoped from the JWT and step-up gated on every write.
//
// WHY THE WRITES ARE ON A CUSTOMER ROUTE AT ALL
// ---------------------------------------------
// The custody controller is an operator surface; this one is not. A customer must
// be able to whitelist their own withdrawal address without an operator, because
// otherwise the control is bypassed by asking support. The safety comes from the
// cooldown and the step-up proof, not from hiding the button.
//
// The writes therefore carry BOTH gates: a permission a normal customer role
// holds (adding an address to your own account is not a privileged act) and a
// fresh, single-use step-up proof (it is a privileged act *for a stolen session*,
// which is the case that matters). The guard consumes the proof before the
// handler runs, so the service's own `stepUpProven` flag is a defence-in-depth
// check for a future caller that forgets the decorator rather than a second proof
// exchange.
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import { Permission, type AuthenticatedActor } from '@wlct/shared-types';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { TenantId } from '../../common/decorators/current-tenant.decorator';
import { RequireAnyPermission } from '../../common/decorators/permissions.decorator';
import { RequireStepUp } from '../auth/step-up/require-step-up.decorator';
import {
  CreateWithdrawalDestinationDto,
  RevokeWithdrawalDestinationDto,
} from './dto/withdrawal-destination.dto';
import {
  WithdrawalDestinationPolicyService,
  type DestinationResult,
  type WithdrawalDestinationRecord,
} from './withdrawal-destination-policy.service';

/** What the customer's screen renders for one destination. */
export interface WithdrawalDestinationView {
  id: string;
  network: string;
  address: string;
  label: string;
  status: string;
  activatesAt: string;
  revokedAt: string | null;
  createdAt: string;
  /** Milliseconds until it can be used. 0 once ACTIVE or REVOKED. */
  remainingCooldownMs: number;
}

function toView(row: WithdrawalDestinationRecord & { remainingCooldownMs: number }): WithdrawalDestinationView {
  return {
    id: row.id,
    network: row.network,
    address: row.address,
    label: row.label,
    status: row.status,
    activatesAt: row.activatesAt.toISOString(),
    revokedAt: row.revokedAt ? row.revokedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    remainingCooldownMs: row.remainingCooldownMs,
  };
}

/**
 * The service's `destination` is the persistence record; what the customer gets back is
 * the view. `Omit<...>` rather than `&` because intersecting the two would demand a
 * value that is both the record and the view at once, which nothing can be - the
 * fields the view drops (tenantId, userId) exist only on the record.
 */
@Controller('custody/destinations')
export class WithdrawalDestinationController {
  constructor(private readonly policy: WithdrawalDestinationPolicyService) {}

  /**
   * The caller's own allowlist. `PORTFOLIO_READ` is the customer-side permission
   * for "my money"; `PAYOUT_MANAGE` is included so finance can look at a customer's
   * list while answering a ticket.
   */
  @Get()
  @RequireAnyPermission(Permission.PORTFOLIO_READ, Permission.PAYOUT_MANAGE)
  async list(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedActor,
  ): Promise<{ data: WithdrawalDestinationView[]; total: number }> {
    // Sweep first: a user opening this screen should see the destination they were
    // waiting for already ACTIVE, without depending on a scheduler's tick.
    await this.policy.activateDue({ tenantId, userId: user.userId });
    const rows = await this.policy.list({ tenantId, userId: user.userId });
    return { data: rows.map(toView), total: rows.length };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequireAnyPermission(Permission.EXCHANGE_ACCOUNT_MANAGE, Permission.PAYOUT_MANAGE)
  @RequireStepUp('PAYOUT_CREATE')
  async add(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedActor,
    @Body() dto: CreateWithdrawalDestinationDto,
  ): Promise<Omit<DestinationResult, 'destination'> & { destination?: WithdrawalDestinationView }> {
    const result = await this.policy.add({
      tenantId,
      userId: user.userId,
      network: dto.network,
      address: dto.address,
      label: dto.label,
      // The guard above already refused without a proof; this flag states that
      // fact to the service rather than re-deriving it.
      stepUpProven: true,
    });
    return {
      ...result,
      destination: result.destination
        ? toView({ ...result.destination, remainingCooldownMs: result.remainingCooldownMs ?? 0 })
        : undefined,
    };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @RequireAnyPermission(Permission.EXCHANGE_ACCOUNT_MANAGE, Permission.PAYOUT_MANAGE)
  @RequireStepUp('PAYOUT_CREATE')
  async revoke(
    @TenantId() tenantId: string,
    @CurrentUser() user: AuthenticatedActor,
    @Param('id') id: string,
    // Accepted and intentionally not surfaced: the body carries an optional note
    // for the audit trail, which the service records with the revocation.
    @Body() _dto: RevokeWithdrawalDestinationDto,
  ): Promise<Omit<DestinationResult, 'destination'> & { destination?: WithdrawalDestinationView }> {
    const result = await this.policy.revoke({
      tenantId,
      userId: user.userId,
      destinationId: id,
      stepUpProven: true,
    });
    return {
      ...result,
      destination: result.destination ? toView({ ...result.destination, remainingCooldownMs: 0 }) : undefined,
    };
  }
}
