// # Responsibility: prove a key's permissions are classified from evidence and that withdrawal or a false read-only claim is refused.
import { describe, expect, it } from '@jest/globals';

import {
  PermissionVerificationService,
  normalisePermissions,
  type KeyClass,
  type PermissionProbe,
  type ReportedPermissions,
} from './permission-verification.service';

function reported(overrides: ReportedPermissions = {}): ReportedPermissions {
  return { canReadData: true, canTrade: true, canWithdraw: false, permissions: ['SPOT', 'TRADE'], ...overrides };
}

function probe(overrides: Partial<PermissionProbe> = {}): PermissionProbe {
  return { orderPlacementAccepted: true, ...overrides };
}

const service = new PermissionVerificationService();

describe('Permission classification', () => {
  it('classifies a trading key that cannot withdraw as TRADE', () => {
    expect(service.classify(reported())).toBe('TRADE');
  });

  it('classifies a read-only key as READ_ONLY', () => {
    expect(service.classify(reported({ canTrade: false, permissions: ['SPOT', 'READ'] }))).toBe('READ_ONLY');
  });

  it('classifies a withdrawal-capable key as WITHDRAW_ENABLED even when it also trades', () => {
    expect(service.classify(reported({ canWithdraw: true }))).toBe('WITHDRAW_ENABLED');
  });

  it('detects withdrawal from a permission label when the boolean is absent', () => {
    expect(service.classify(reported({ canWithdraw: null, permissions: ['TRADE', 'withdraw'] }))).toBe(
      'WITHDRAW_ENABLED',
    );
  });

  it('treats a key that can do nothing usable as UNKNOWN, not read-only', () => {
    expect(service.classify({ canReadData: false, canTrade: false, canWithdraw: false, permissions: [] })).toBe(
      'UNKNOWN',
    );
    expect(service.classify({})).toBe('UNKNOWN');
  });

  it('normalises permission labels deterministically', () => {
    expect(normalisePermissions([' trade ', 'SPOT', 'trade', '', null as unknown as string])).toEqual(['SPOT', 'TRADE']);
    // Sorting matters: an unsorted comparison would raise a false "permissions
    // changed" alert whenever the venue reordered its own list.
    expect(normalisePermissions(['B', 'A'])).toEqual(normalisePermissions(['A', 'B']));
    expect(normalisePermissions(null)).toEqual([]);
  });
});

describe('Permission verification', () => {
  it('accepts a trade key that cannot withdraw', () => {
    const verdict = service.verify({ reported: reported(), probe: probe(), requireTrade: true });

    expect(verdict.accepted).toBe(true);
    expect(verdict.keyClass).toBe('TRADE');
    expect(verdict.code).toBe('ACCEPTED_TRADE');
    expect(verdict.claimMismatch).toBe(false);
  });

  it('accepts a read-only key for an account that does not trade', () => {
    const verdict = service.verify({
      reported: reported({ canTrade: false }),
      probe: probe({ orderPlacementAccepted: false }),
      requireTrade: false,
    });

    expect(verdict.accepted).toBe(true);
    expect(verdict.code).toBe('ACCEPTED_READ_ONLY');
  });

  it('refuses a withdrawal-capable key before looking at anything else', () => {
    const verdict = service.verify({
      reported: reported({ canWithdraw: true }),
      probe: probe(),
      requireTrade: true,
    });

    expect(verdict.accepted).toBe(false);
    expect(verdict.code).toBe('REFUSED_WITHDRAWAL');
    expect(verdict.keyClass).toBe('WITHDRAW_ENABLED');
    expect(verdict.message).toMatch(/withdrawals disabled/i);
  });

  it('refuses a withdrawal-capable key even for an account that only reads', () => {
    const verdict = service.verify({
      reported: reported({ canWithdraw: true, canTrade: false }),
      probe: probe({ orderPlacementAccepted: false }),
      requireTrade: false,
    });

    expect(verdict.accepted).toBe(false);
    expect(verdict.code).toBe('REFUSED_WITHDRAWAL');
  });

  it('refuses a key whose report is missing when the probe did not run', () => {
    const verdict = service.verify({
      reported: reported(),
      probe: probe({ orderPlacementAccepted: null }),
      requireTrade: true,
    });

    expect(verdict.accepted).toBe(false);
    expect(verdict.code).toBe('REFUSED_UNVERIFIED');
    expect(verdict.keyClass).toBe('UNKNOWN');
  });

  it('refuses a key the venue reported nothing about', () => {
    const verdict = service.verify({ reported: {}, probe: probe(), requireTrade: true });

    expect(verdict.accepted).toBe(false);
    expect(verdict.code).toBe('REFUSED_UNVERIFIED');
  });

  it('flags a key that claims read-only but has an order accepted', () => {
    // The dangerous direction: the report is not merely wrong, it is wrong in a
    // way that would have let an apparently-safe key trade.
    const verdict = service.verify({
      reported: reported({ canTrade: false }),
      probe: probe({ orderPlacementAccepted: true }),
      requireTrade: false,
    });

    expect(verdict.accepted).toBe(false);
    expect(verdict.code).toBe('REFUSED_CLAIM_MISMATCH');
    expect(verdict.claimMismatch).toBe(true);
    expect(verdict.keyClass).toBe('TRADE');
  });

  it('believes the probe when the venue refuses an order from a "trading" key', () => {
    const verdict = service.verify({
      reported: reported({ canTrade: true }),
      probe: probe({ orderPlacementAccepted: false }),
      requireTrade: true,
    });

    expect(verdict.accepted).toBe(false);
    expect(verdict.code).toBe('REFUSED_NO_TRADE');
    expect(verdict.keyClass).toBe('READ_ONLY');
    expect(verdict.claimMismatch).toBe(true);
  });

  it('refuses a read-only key on an account that is set up to trade', () => {
    const verdict = service.verify({
      reported: reported({ canTrade: false }),
      probe: probe({ orderPlacementAccepted: false }),
      requireTrade: true,
    });

    expect(verdict.accepted).toBe(false);
    expect(verdict.code).toBe('REFUSED_NO_TRADE');
    expect(verdict.claimMismatch).toBe(false);
  });

  it('refuses when the stored class and the venue disagree, whichever way', () => {
    const drift = service.verify({
      reported: reported(),
      probe: probe(),
      requireTrade: true,
      claimed: 'READ_ONLY' as KeyClass,
    });
    const recovery = service.verify({
      reported: reported({ canTrade: false }),
      probe: probe({ orderPlacementAccepted: false }),
      requireTrade: false,
      claimed: 'TRADE' as KeyClass,
    });

    expect(drift).toMatchObject({ accepted: false, code: 'REFUSED_CLAIM_MISMATCH' });
    expect(recovery).toMatchObject({ accepted: false, code: 'REFUSED_CLAIM_MISMATCH' });
  });

  it('returns the normalised permission list for storage on every path', () => {
    const verdicts = [
      service.verify({ reported: reported(), probe: probe(), requireTrade: true }),
      service.verify({ reported: reported({ canWithdraw: true }), probe: probe(), requireTrade: true }),
      service.verify({ reported: {}, probe: probe(), requireTrade: true }),
    ];

    for (const verdict of verdicts) {
      expect(Array.isArray(verdict.normalisedPermissions)).toBe(true);
      expect(verdict.normalisedPermissions).toEqual([...verdict.normalisedPermissions].sort());
    }
  });

  it('says no to a copy account unless the key reports trade without withdrawal', () => {
    expect(PermissionVerificationService.shouldRefuseCopyAccount(reported())).toBe(false);
    expect(PermissionVerificationService.shouldRefuseCopyAccount(reported({ canWithdraw: true }))).toBe(true);
    expect(
      PermissionVerificationService.shouldRefuseCopyAccount(reported({ canWithdraw: null, permissions: ['WITHDRAW'] })),
    ).toBe(true);
    expect(PermissionVerificationService.shouldRefuseCopyAccount(reported({ canTrade: null }))).toBe(true);
    expect(PermissionVerificationService.shouldRefuseCopyAccount({})).toBe(true);
  });
});
