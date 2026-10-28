import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Req } from '@nestjs/common';
import { IsString, Matches, MaxLength } from 'class-validator';
import { Throttle } from '@nestjs/throttler';
import { Permission, type AuthenticatedActor } from '@wlct/shared-types';
import type { Request } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { TenantId } from '../../common/decorators/current-tenant.decorator';
import { RequireAnyPermission } from '../../common/decorators/permissions.decorator';
import { RequireStepUp } from '../auth/step-up/require-step-up.decorator';
import { requireMutationKey } from '../developer-platform/developer-mutation-intent';
import { CustomerDepositAddressService, type CustomerDepositAddressView, type CustomerDepositAssetOption, type CustomerDepositObservationView } from './customer-deposit-address.service';

class DepositAddressSelectionDto {
  @IsString()
  @MaxLength(128)
  @Matches(/^[A-Za-z0-9][A-Za-z0-9._-]*$/)
  assetId!: string;

  @IsString()
  @MaxLength(64)
  @Matches(/^[A-Za-z0-9][A-Za-z0-9._-]*$/)
  networkId!: string;
}

/**
 * Customer funding surface, deliberately separate from the operator custody
 * API. Both routes resolve tenant/user from authentication, never from the
 * body. An address proves neither a transfer nor a settled account credit.
 */
@Controller('client-lifecycle/funding/:fundingRequestId/deposit-address')
export class CustomerDepositAddressController {
  constructor(private readonly addresses: CustomerDepositAddressService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @RequireAnyPermission(Permission.PORTFOLIO_READ, Permission.PAYOUT_MANAGE)
  @RequireStepUp('CUSTODY_ADDRESS_ISSUE')
  issue(
    @TenantId() tenantId: string,
    @CurrentUser() actor: AuthenticatedActor,
    @Param('fundingRequestId') fundingRequestId: string,
    @Body() selection: DepositAddressSelectionDto,
    @Req() request: Request,
  ): Promise<CustomerDepositAddressView> {
    return this.addresses.issue({ tenantId, userId: actor.userId, fundingRequestId,
      assetId: selection.assetId, networkId: selection.networkId, idempotencyKey: requireMutationKey(request) });
  }

  @Get('assets')
  @RequireAnyPermission(Permission.PORTFOLIO_READ, Permission.PAYOUT_MANAGE)
  listAssets(
    @TenantId() tenantId: string,
    @CurrentUser() actor: AuthenticatedActor,
    @Param('fundingRequestId') fundingRequestId: string,
  ): Promise<CustomerDepositAssetOption[]> {
    return this.addresses.listAssets({ tenantId, userId: actor.userId, fundingRequestId });
  }

  @Get('transactions/:transactionHash')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @RequireAnyPermission(Permission.PORTFOLIO_READ, Permission.PAYOUT_MANAGE)
  observeTransfer(
    @TenantId() tenantId: string,
    @CurrentUser() actor: AuthenticatedActor,
    @Param('fundingRequestId') fundingRequestId: string,
    @Param('transactionHash') transactionHash: string,
    @Query() selection: DepositAddressSelectionDto,
  ): Promise<CustomerDepositObservationView> {
    return this.addresses.observeTransfer({ tenantId, userId: actor.userId, fundingRequestId,
      assetId: selection.assetId, networkId: selection.networkId, transactionHash });
  }

  @Get()
  @RequireAnyPermission(Permission.PORTFOLIO_READ, Permission.PAYOUT_MANAGE)
  get(
    @TenantId() tenantId: string,
    @CurrentUser() actor: AuthenticatedActor,
    @Param('fundingRequestId') fundingRequestId: string,
    @Query() selection: DepositAddressSelectionDto,
  ): Promise<CustomerDepositAddressView> {
    return this.addresses.get({ tenantId, userId: actor.userId, fundingRequestId,
      assetId: selection.assetId, networkId: selection.networkId });
  }
}
