// # Registers the independent, permission-gated referral-abuse review API.
import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { PrismaModule } from '../../infrastructure/prisma/prisma.module';
import { ReferralAbuseReviewController } from './referral-abuse-review.controller';
import { ReferralAbuseService } from './referral-abuse.service';

@Module({
  imports: [PrismaModule, AuditModule],
  controllers: [ReferralAbuseReviewController],
  providers: [ReferralAbuseService],
  exports: [ReferralAbuseService],
})
export class ReferralAbuseModule {}
