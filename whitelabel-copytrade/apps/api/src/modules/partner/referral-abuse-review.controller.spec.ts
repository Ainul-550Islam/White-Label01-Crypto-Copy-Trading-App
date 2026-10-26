// # Ensures the review queue is tenant-scoped and platform-management permission gated.
import { Permission } from '@wlct/shared-types';
import { PERMISSIONS_KEY, PERMISSIONS_MODE_KEY } from '../../common/constants/metadata.constants';
import { ReferralAbuseReviewController } from './referral-abuse-review.controller';
import type { ReferralAbuseService } from './referral-abuse.service';

const actor = {
  userId: 'reviewer-user',
  tenantId: '11111111-1111-4111-8111-111111111111',
  sessionId: 'session-1',
  roles: ['platform-admin'],
  permissions: [Permission.PLATFORM_MANAGE],
  isPlatformUser: true,
  tokenId: 'token-1',
};

describe('ReferralAbuseReviewController', () => {
  it('requires platform management permission for the review routes', () => {
    expect(Reflect.getMetadata(PERMISSIONS_KEY, ReferralAbuseReviewController)).toEqual([
      Permission.PLATFORM_MANAGE,
    ]);
    expect(Reflect.getMetadata(PERMISSIONS_MODE_KEY, ReferralAbuseReviewController)).toBe('any');
  });

  it('lists reviews for the authenticated tenant and applies the requested page size', async () => {
    const listReviewQueue = jest.fn().mockResolvedValue([]);
    const controller = new ReferralAbuseReviewController({
      listReviewQueue,
    } as unknown as ReferralAbuseService);

    await controller.listReviewQueue(actor, '25');

    expect(listReviewQueue).toHaveBeenCalledWith(actor.tenantId, 25);
  });

  it('resolves a review using the authenticated reviewer identity', async () => {
    const resolveReview = jest.fn().mockResolvedValue({ id: 'case-1' });
    const controller = new ReferralAbuseReviewController({
      resolveReview,
    } as unknown as ReferralAbuseService);
    const dto = {
      decision: 'REJECT' as const,
      note: 'Evidence was inconsistent.',
      correlationId: 'request-1',
    };

    await controller.resolveReview(actor, 'case-1', dto);

    expect(resolveReview).toHaveBeenCalledWith({
      tenantId: actor.tenantId,
      caseId: 'case-1',
      reviewerUserId: actor.userId,
      decision: 'REJECT',
      note: 'Evidence was inconsistent.',
      correlationId: 'request-1',
    });
  });
});
