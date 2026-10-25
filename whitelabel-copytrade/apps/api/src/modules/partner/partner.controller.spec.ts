// # Responsibility: verify partner ownership, authenticated audit identity, and payout permission boundaries without broad mock casts.
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import {
  Permission,
  SystemRole,
  hasAnyPermission,
  type AuthenticatedActor,
} from '@wlct/shared-types';
import { PERMISSIONS_KEY, PERMISSIONS_MODE_KEY } from '../../common/constants/metadata.constants';
import { PartnerProfileService } from '../partners/partner-profile.service';
import { PartnerReferralService } from '../partners/partner-referral.service';
import { PartnerAttributionService } from '../partners/partner-attribution.service';
import { PartnerCommissionLedgerService } from '../partners/partner-commission-ledger.service';
import { PartnerPayoutService } from '../partners/partner-payout.service';
import { PartnerPortalService } from '../partners/partner-portal.service';
import { PartnerState, PartnerType, type PartnerProfile } from '../partners/partner.types';
import { PartnerPortalController } from './partner.controller';

const actor: AuthenticatedActor = {
  userId: '11111111-1111-4111-8111-111111111111',
  tenantId: '22222222-2222-4222-8222-222222222222',
  sessionId: '33333333-3333-4333-8333-333333333333',
  tokenId: 'token-owner',
  roles: [SystemRole.FOLLOWER],
  permissions: [Permission.REPORT_READ],
  isPlatformUser: false,
};

function profile(id: string, ownerUserId: string = actor.userId): PartnerProfile {
  return {
    id,
    code: id.toUpperCase(),
    name: id,
    legalName: null,
    type: PartnerType.REFERRAL_PARTNER,
    state: PartnerState.ACTIVE,
    ownerUserId,
    contactEmail: 'partner@example.test',
    contactName: null,
    website: null,
    countryCode: null,
    taxId: null,
    billingEmail: null,
    currency: 'USD',
    idempotencyKey: `profile-${id}`,
    createdAt: '2026-10-10T00:00:00.000Z',
    updatedAt: '2026-10-10T00:00:00.000Z',
    activatedAt: '2026-10-10T00:00:00.000Z',
    suspendedAt: null,
    terminatedAt: null,
    metadata: null,
    policyVersion: 'policy-1',
    agreementVersion: null,
  };
}

const owned = profile('owned-partner');
const foreign = profile('foreign-partner', '44444444-4444-4444-8444-444444444444');
const operationFailure = new Error('test provider did not submit a write');

function dependencies() {
  const profiles = new Map<string, PartnerProfile>([[owned.id, owned], [foreign.id, foreign]]);
  const profileService = {
    getProfile: jest.fn<PartnerProfileService['getProfile']>().mockImplementation(async (id) => {
      const found = profiles.get(id);
      if (!found) throw new NotFoundException('Partner profile not found');
      return found;
    }),
    listProfiles: jest.fn<PartnerProfileService['listProfiles']>().mockImplementation(async (filters) => (
      [...profiles.values()].filter((item) => !filters?.ownerUserId || item.ownerUserId === filters.ownerUserId)
    )),
  } satisfies Pick<PartnerProfileService, 'getProfile' | 'listProfiles'>;
  const referralService = {
    listReferrals: jest.fn<PartnerReferralService['listReferrals']>().mockResolvedValue([]),
    createReferral: jest.fn<PartnerReferralService['createReferral']>().mockRejectedValue(operationFailure),
  } satisfies Pick<PartnerReferralService, 'listReferrals' | 'createReferral'>;
  const attributionService = {
    listAttributionsForPartner: jest.fn<PartnerAttributionService['listAttributionsForPartner']>().mockResolvedValue([]),
  } satisfies Pick<PartnerAttributionService, 'listAttributionsForPartner'>;
  const commissionLedger = {
    listCommissions: jest.fn<PartnerCommissionLedgerService['listCommissions']>().mockResolvedValue([]),
  } satisfies Pick<PartnerCommissionLedgerService, 'listCommissions'>;
  const payoutService = {
    listPayouts: jest.fn<PartnerPayoutService['listPayouts']>().mockResolvedValue([]),
    requestPayout: jest.fn<PartnerPayoutService['requestPayout']>().mockRejectedValue(operationFailure),
  } satisfies Pick<PartnerPayoutService, 'listPayouts' | 'requestPayout'>;
  const portalService = {
    getPortalData: jest.fn<PartnerPortalService['getPortalData']>().mockRejectedValue(new Error('summary unavailable')),
  } satisfies Pick<PartnerPortalService, 'getPortalData'>;
  return { profileService, referralService, attributionService, commissionLedger, payoutService, portalService };
}

describe('PartnerPortalController authenticated scope', () => {
  let mocks: ReturnType<typeof dependencies>;
  let controller: PartnerPortalController;

  beforeEach(async () => {
    mocks = dependencies();
    const module = await Test.createTestingModule({
      controllers: [PartnerPortalController],
      providers: [
        { provide: PartnerProfileService, useValue: mocks.profileService },
        { provide: PartnerReferralService, useValue: mocks.referralService },
        { provide: PartnerAttributionService, useValue: mocks.attributionService },
        { provide: PartnerCommissionLedgerService, useValue: mocks.commissionLedger },
        { provide: PartnerPayoutService, useValue: mocks.payoutService },
        { provide: PartnerPortalService, useValue: mocks.portalService },
      ],
    }).compile();
    controller = module.get(PartnerPortalController);
  });

  it('resolves only a profile owned by the authenticated user', async () => {
    await expect(controller.listMyReferrals(actor)).resolves.toEqual({
      partnerId: owned.id,
      referrals: [],
      attributions: [],
    });
    expect(mocks.profileService.listProfiles).toHaveBeenCalledWith({ ownerUserId: actor.userId });
    expect(mocks.referralService.listReferrals).toHaveBeenCalledWith(owned.id);
  });

  it('defends against an unscoped profile list returned by a dependency', async () => {
    mocks.profileService.listProfiles.mockResolvedValueOnce([foreign, owned]);
    await controller.listMyReferrals(actor);
    expect(mocks.referralService.listReferrals).toHaveBeenCalledWith(owned.id);
  });

  it('never falls back to another user profile when no owned profile exists', async () => {
    mocks.profileService.listProfiles.mockResolvedValueOnce([foreign]);
    await expect(controller.listMyReferrals(actor)).rejects.toBeInstanceOf(BadRequestException);
    expect(mocks.profileService.listProfiles).toHaveBeenCalledTimes(1);
    expect(mocks.referralService.listReferrals).not.toHaveBeenCalled();
  });

  it('requires an explicit owned profile when the authenticated user owns several', async () => {
    mocks.profileService.listProfiles.mockResolvedValueOnce([owned, profile('second-owned-partner')]);
    await expect(controller.listMyReferrals(actor)).rejects.toBeInstanceOf(BadRequestException);
    expect(mocks.referralService.listReferrals).not.toHaveBeenCalled();
  });

  it('rejects a missing authenticated user identifier before reading profiles', async () => {
    await expect(controller.listMyReferrals({ ...actor, userId: '' })).rejects.toBeInstanceOf(ForbiddenException);
    expect(mocks.profileService.listProfiles).not.toHaveBeenCalled();
    expect(mocks.profileService.getProfile).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: 'profile',
      invoke: (ctrl: PartnerPortalController) => ctrl.getMyPartnerProfile(actor, { partnerId: foreign.id, userId: actor.userId }),
    },
    {
      name: 'referrals',
      invoke: (ctrl: PartnerPortalController) => ctrl.listMyReferrals(actor, foreign.id),
    },
    {
      name: 'commissions',
      invoke: (ctrl: PartnerPortalController) => ctrl.listMyCommissions(actor, { partnerId: foreign.id }),
    },
    {
      name: 'payouts',
      invoke: (ctrl: PartnerPortalController) => ctrl.listMyPayouts(actor, { partnerId: foreign.id }),
    },
  ])('blocks an explicit foreign partner for $name before reading financial data', async ({ invoke }) => {
    await expect(invoke(controller)).rejects.toBeInstanceOf(ForbiddenException);
    expect(mocks.referralService.listReferrals).not.toHaveBeenCalled();
    expect(mocks.attributionService.listAttributionsForPartner).not.toHaveBeenCalled();
    expect(mocks.commissionLedger.listCommissions).not.toHaveBeenCalled();
    expect(mocks.payoutService.listPayouts).not.toHaveBeenCalled();
    expect(mocks.portalService.getPortalData).not.toHaveBeenCalled();
  });

  it('does not let wildcard permissions bypass ownership for a non-platform user', async () => {
    await expect(controller.listMyReferrals({ ...actor, permissions: [Permission.ALL] }, foreign.id))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it('does not let platform status alone bypass ownership', async () => {
    await expect(controller.listMyReferrals({ ...actor, isPlatformUser: true }, foreign.id))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows an explicitly authorized platform manager to select another partner', async () => {
    await expect(controller.listMyReferrals({
      ...actor,
      isPlatformUser: true,
      permissions: [Permission.PLATFORM_MANAGE],
    }, foreign.id)).resolves.toEqual({ partnerId: foreign.id, referrals: [], attributions: [] });
  });

  it('uses the authenticated userId rather than a supplied portal-query userId', async () => {
    await expect(controller.getMyPartnerProfile(actor, {
      partnerId: owned.id,
      userId: foreign.ownerUserId,
    })).resolves.toEqual({ profile: owned, summary: null });
    expect(mocks.portalService.getPortalData).toHaveBeenCalledWith(expect.objectContaining({
      partnerId: owned.id,
      userId: actor.userId,
    }));
  });

  it('overwrites a forged referral actor while preserving the request idempotency key', async () => {
    await expect(controller.createMyReferral(actor, {
      partnerId: owned.id,
      createdBy: foreign.ownerUserId,
      correlationId: 'correlation-referral',
      idempotencyKey: 'idempotent-referral',
    })).rejects.toBe(operationFailure);
    expect(mocks.referralService.createReferral).toHaveBeenCalledWith(expect.objectContaining({
      partnerId: owned.id,
      createdBy: actor.userId,
      idempotencyKey: 'idempotent-referral',
    }));
  });

  it('overwrites a forged payout actor while preserving the request idempotency key', async () => {
    await expect(controller.requestMyPayout(actor, {
      partnerId: owned.id,
      settlementId: 'owned-settlement',
      amount: '10.00',
      currency: 'USD',
      method: 'BANK_TRANSFER',
      requestedBy: foreign.ownerUserId,
      correlationId: 'correlation-payout',
      idempotencyKey: 'idempotent-payout',
    })).rejects.toBe(operationFailure);
    expect(mocks.payoutService.requestPayout).toHaveBeenCalledWith(expect.objectContaining({
      partnerId: owned.id,
      requestedBy: actor.userId,
      idempotencyKey: 'idempotent-payout',
    }));
  });

  it('declares only existing permissions for portal reads', () => {
    const required = new Reflector().get<Permission[]>(PERMISSIONS_KEY, PartnerPortalController);
    expect(required).toEqual([Permission.REPORT_READ, Permission.PAYOUT_MANAGE, Permission.PLATFORM_MANAGE]);
    expect(required.every((permission) => typeof permission === 'string')).toBe(true);
  });

  it('requires payout authority on the write route, not merely report access', () => {
    const targets = [PartnerPortalController.prototype.requestMyPayout, PartnerPortalController];
    const reflector = new Reflector();
    const required = reflector.getAllAndOverride<Permission[]>(PERMISSIONS_KEY, targets);
    expect(required).toEqual([Permission.PAYOUT_MANAGE, Permission.PLATFORM_MANAGE]);
    expect(reflector.getAllAndOverride<string>(PERMISSIONS_MODE_KEY, targets)).toBe('any');
    expect(hasAnyPermission([Permission.REPORT_READ], required)).toBe(false);
    expect(hasAnyPermission([Permission.PAYOUT_MANAGE], required)).toBe(true);
  });
});
