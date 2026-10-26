// # Verifies the referral-abuse module registers its tenant-scoped review API and durable service.
import { MODULE_METADATA } from '@nestjs/common/constants';
import { ReferralAbuseReviewController } from './referral-abuse-review.controller';
import { ReferralAbuseModule } from './referral-abuse.module';
import { ReferralAbuseService } from './referral-abuse.service';

describe('ReferralAbuseModule', () => {
  it('registers the review controller and exports the referral-abuse service', () => {
    const controllers = Reflect.getMetadata(
      MODULE_METADATA.CONTROLLERS,
      ReferralAbuseModule,
    ) as unknown[];
    const providers = Reflect.getMetadata(
      MODULE_METADATA.PROVIDERS,
      ReferralAbuseModule,
    ) as unknown[];
    const exports = Reflect.getMetadata(MODULE_METADATA.EXPORTS, ReferralAbuseModule) as unknown[];

    expect(controllers).toContain(ReferralAbuseReviewController);
    expect(providers).toContain(ReferralAbuseService);
    expect(exports).toContain(ReferralAbuseService);
  });
});
