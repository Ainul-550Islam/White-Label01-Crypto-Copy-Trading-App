// # Responsibility: bind partner-portal reads and writes to the authenticated owner and require explicit payout authority.
import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { Permission, hasAnyPermission, type AuthenticatedActor } from '@wlct/shared-types';
import { RequireAnyPermission } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PartnerProfileService } from '../partners/partner-profile.service';
import { PartnerReferralService } from '../partners/partner-referral.service';
import { PartnerAttributionService } from '../partners/partner-attribution.service';
import { PartnerCommissionLedgerService } from '../partners/partner-commission-ledger.service';
import { PartnerPayoutService } from '../partners/partner-payout.service';
import { PartnerPortalService } from '../partners/partner-portal.service';
import {
  CreateReferralDto,
  RequestPayoutDto,
} from '../partners/dto/partner-campaign.dto';
import {
  PartnerCommissionQueryDto,
  PartnerPayoutQueryDto,
  PartnerPortalQueryDto,
} from '../partners/dto/partner-query.dto';

const PARTNER_PORTAL_PERMISSIONS = [
  Permission.REPORT_READ,
  Permission.PAYOUT_MANAGE,
  Permission.PLATFORM_MANAGE,
] as const;

@Controller('partner')
@RequireAnyPermission(...PARTNER_PORTAL_PERMISSIONS)
export class PartnerPortalController {
  constructor(
    private readonly profileService: PartnerProfileService,
    private readonly referralService: PartnerReferralService,
    private readonly attributionService: PartnerAttributionService,
    private readonly commissionLedger: PartnerCommissionLedgerService,
    private readonly payoutService: PartnerPayoutService,
    private readonly portalService: PartnerPortalService,
  ) {}

  private async resolvePartnerId(user: AuthenticatedActor, explicitPartnerId?: string): Promise<string> {
    if (!user.userId) {
      throw new ForbiddenException('An authenticated user identity is required');
    }

    if (explicitPartnerId) {
      const profile = await this.profileService.getProfile(explicitPartnerId);
      const platformManager = user.isPlatformUser
        && hasAnyPermission(user.permissions, [Permission.PLATFORM_MANAGE]);
      if (profile.ownerUserId !== user.userId && !platformManager) {
        throw new ForbiddenException('Partner profile is outside the authenticated user scope');
      }
      return profile.id;
    }

    const profiles = await this.profileService.listProfiles({ ownerUserId: user.userId });
    const ownedProfiles = profiles.filter((profile) => profile.ownerUserId === user.userId);
    if (ownedProfiles.length === 0) {
      throw new BadRequestException('No partner profile found for current user');
    }
    if (ownedProfiles.length > 1) {
      throw new BadRequestException('An explicit owned partner profile is required');
    }
    return ownedProfiles[0].id;
  }

  @Get('profile')
  async getMyPartnerProfile(
    @CurrentUser() user: AuthenticatedActor,
    @Query() query: PartnerPortalQueryDto,
  ) {
    const partnerId = await this.resolvePartnerId(user, query.partnerId);
    const profile = await this.profileService.getProfile(partnerId);
    let portalSummary: Awaited<ReturnType<PartnerPortalService['getPortalData']>> | null = null;
    try {
      portalSummary = await this.portalService.getPortalData({
        partnerId,
        userId: user.userId,
        correlationId: query.correlationId ?? `corr_${Date.now()}`,
        currency: query.currency,
        periodStart: query.periodStart,
        periodEnd: query.periodEnd,
      });
    } catch {
      portalSummary = null;
    }
    return {
      profile,
      summary: portalSummary,
    };
  }

  @Get('referrals')
  async listMyReferrals(
    @CurrentUser() user: AuthenticatedActor,
    @Query('partnerId') partnerIdQuery?: string,
  ) {
    const partnerId = await this.resolvePartnerId(user, partnerIdQuery);
    const [referrals, attributions] = await Promise.all([
      this.referralService.listReferrals(partnerId),
      this.attributionService.listAttributionsForPartner(partnerId),
    ]);
    return {
      partnerId,
      referrals,
      attributions,
    };
  }

  @Post('referrals')
  async createMyReferral(
    @CurrentUser() user: AuthenticatedActor,
    @Body() dto: CreateReferralDto,
  ) {
    const partnerId = await this.resolvePartnerId(user, dto.partnerId);
    return this.referralService.createReferral({
      partnerId,
      campaignId: dto.campaignId,
      code: dto.code,
      maxUses: dto.maxUses,
      expiresAt: dto.expiresAt ?? null,
      createdBy: user.userId,
      correlationId: dto.correlationId || `corr_${Date.now()}`,
      idempotencyKey: dto.idempotencyKey || `idem_${Date.now()}`,
    });
  }

  @Get('commissions')
  async listMyCommissions(
    @CurrentUser() user: AuthenticatedActor,
    @Query() query: PartnerCommissionQueryDto,
  ) {
    const partnerId = await this.resolvePartnerId(user, query.partnerId);
    const items = await this.commissionLedger.listCommissions(partnerId, {
      tenantId: query.tenantId,
      state: query.state,
      settlementId: query.settlementId,
      currency: query.currency,
    });
    return {
      partnerId,
      items,
    };
  }

  @Get('payouts')
  async listMyPayouts(
    @CurrentUser() user: AuthenticatedActor,
    @Query() query: PartnerPayoutQueryDto,
  ) {
    const partnerId = await this.resolvePartnerId(user, query.partnerId);
    const items = await this.payoutService.listPayouts(partnerId, {
      settlementId: query.settlementId,
      state: query.state,
    });
    return {
      partnerId,
      items,
    };
  }

  @Post('payouts')
  @RequireAnyPermission(Permission.PAYOUT_MANAGE, Permission.PLATFORM_MANAGE)
  async requestMyPayout(
    @CurrentUser() user: AuthenticatedActor,
    @Body() dto: RequestPayoutDto,
  ) {
    const partnerId = await this.resolvePartnerId(user, dto.partnerId);
    return this.payoutService.requestPayout({
      partnerId,
      settlementId: dto.settlementId,
      amount: dto.amount,
      currency: dto.currency,
      method: dto.method,
      requestedBy: user.userId,
      correlationId: dto.correlationId || `corr_${Date.now()}`,
      idempotencyKey: dto.idempotencyKey || `idem_${Date.now()}`,
    });
  }
}
