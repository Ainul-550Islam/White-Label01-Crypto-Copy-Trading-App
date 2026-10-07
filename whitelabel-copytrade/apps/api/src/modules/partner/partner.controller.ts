// # Exposes /v1/partner/profile, /referrals, /commissions, /payouts endpoints
import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  BadRequestException,
} from '@nestjs/common';
import { Permission } from '@wlct/shared-types';
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
  Permission.USER_READ_SELF,
  Permission.REPORT_READ,
  Permission.PAYOUT_READ,
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

  private async resolvePartnerId(user: any, explicitPartnerId?: string): Promise<string> {
    if (explicitPartnerId) return explicitPartnerId;
    const userId = user?.id || user?.userId;
    if (userId) {
      const profiles = await this.profileService.listProfiles({ ownerUserId: userId });
      if (profiles.length > 0) return profiles[0].id;
    }
    const allProfiles = await this.profileService.listProfiles({});
    if (allProfiles.length > 0) return allProfiles[0].id;
    throw new BadRequestException('No partner profile found for current user');
  }

  @Get('profile')
  async getMyPartnerProfile(
    @CurrentUser() user: any,
    @Query() query: PartnerPortalQueryDto,
  ) {
    const partnerId = await this.resolvePartnerId(user, query.partnerId);
    const profile = await this.profileService.getProfile(partnerId);
    let portalSummary: any = null;
    try {
      portalSummary = await this.portalService.getPortalData({
        partnerId,
        userId: user?.id || user?.userId,
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
    @CurrentUser() user: any,
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
    @CurrentUser() user: any,
    @Body() dto: CreateReferralDto,
  ) {
    const partnerId = await this.resolvePartnerId(user, dto.partnerId);
    return this.referralService.createReferral({
      partnerId,
      campaignId: dto.campaignId,
      code: dto.code,
      maxUses: dto.maxUses,
      expiresAt: dto.expiresAt ?? null,
      createdBy: dto.createdBy || user?.id || user?.userId || 'partner-user',
      correlationId: dto.correlationId || `corr_${Date.now()}`,
      idempotencyKey: dto.idempotencyKey || `idem_${Date.now()}`,
    });
  }

  @Get('commissions')
  async listMyCommissions(
    @CurrentUser() user: any,
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
    @CurrentUser() user: any,
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
  async requestMyPayout(
    @CurrentUser() user: any,
    @Body() dto: RequestPayoutDto,
  ) {
    const partnerId = await this.resolvePartnerId(user, dto.partnerId);
    return this.payoutService.requestPayout({
      partnerId,
      settlementId: dto.settlementId,
      amount: dto.amount,
      currency: dto.currency,
      method: dto.method,
      requestedBy: dto.requestedBy || user?.id || user?.userId || 'partner-user',
      correlationId: dto.correlationId || `corr_${Date.now()}`,
      idempotencyKey: dto.idempotencyKey || `idem_${Date.now()}`,
    });
  }
}
