// # Exposes the tenant-scoped referral-abuse review queue to platform reviewers.
import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { Permission, type AuthenticatedActor } from '@wlct/shared-types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequireAnyPermission } from '../../common/decorators/permissions.decorator';
import { ReferralAbuseService, type ReferralAbuseReviewDecision } from './referral-abuse.service';

export class ReferralAbuseReviewDecisionDto {
  @IsIn(['APPROVE', 'REJECT'])
  decision!: ReferralAbuseReviewDecision;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  correlationId!: string;
}

@Controller('partner/referral-abuse')
@RequireAnyPermission(Permission.PLATFORM_MANAGE)
export class ReferralAbuseReviewController {
  constructor(private readonly referralAbuse: ReferralAbuseService) {}

  @Get('reviews')
  @RequireAnyPermission(Permission.PLATFORM_MANAGE)
  listReviewQueue(@CurrentUser() user: AuthenticatedActor, @Query('limit') rawLimit?: string) {
    const limit = rawLimit === undefined ? 50 : Number(rawLimit);
    return this.referralAbuse.listReviewQueue(user.tenantId, limit);
  }

  @Post('reviews/:caseId/decision')
  @RequireAnyPermission(Permission.PLATFORM_MANAGE)
  resolveReview(
    @CurrentUser() user: AuthenticatedActor,
    @Param('caseId') caseId: string,
    @Body() dto: ReferralAbuseReviewDecisionDto,
  ) {
    return this.referralAbuse.resolveReview({
      tenantId: user.tenantId,
      caseId,
      reviewerUserId: user.userId,
      decision: dto.decision,
      note: dto.note,
      correlationId: dto.correlationId,
    });
  }
}
