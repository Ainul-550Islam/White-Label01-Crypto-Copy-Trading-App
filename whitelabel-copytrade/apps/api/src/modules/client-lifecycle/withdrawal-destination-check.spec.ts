import { Reflector } from '@nestjs/core';
import { Permission, type AuthenticatedActor } from '@wlct/shared-types';
import { PERMISSIONS_KEY, PERMISSIONS_MODE_KEY } from '../../common/constants/metadata.constants';
import { WithdrawalDestinationPolicyService, type WithdrawalDestinationRepository, type WithdrawalDestinationRecord } from '../custody/withdrawal-destination-policy.service';
import { WithdrawalDestinationCheckController } from './withdrawal-destination-check.controller';

const tenantId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';
const actor = { tenantId, userId } as AuthenticatedActor;
const address = '0x' + '1'.repeat(40);
const base: WithdrawalDestinationRecord = {
  id: '33333333-3333-4333-8333-333333333333', tenantId, userId, network: 'ETHEREUM', address,
  label: 'Approved', status: 'ACTIVE', activatesAt: new Date('2026-01-01T00:00:00Z'), revokedAt: null, createdAt: new Date('2026-01-01T00:00:00Z'),
};

function setup(rows: WithdrawalDestinationRecord[]) {
  const findExact = jest.fn(async (q: { tenantId: string; userId: string; network: string; address: string }) =>
    rows.find((row) => row.tenantId === q.tenantId && row.userId === q.userId && row.network === q.network && row.address === q.address) ?? null);
  const repository = { findExact } as unknown as WithdrawalDestinationRepository;
  const policy = new WithdrawalDestinationPolicyService(repository);
  return { controller: new WithdrawalDestinationCheckController(policy), findExact };
}

test('uses the authenticated tenant and user, rejecting an unlisted destination without any write', async () => {
  const { controller, findExact } = setup([{ ...base, userId: 'other-user' }]);
  await expect(controller.check(tenantId, actor, { network: 'ETHEREUM', address })).resolves.toEqual({
    network: 'ETHEREUM', decision: 'DENY', code: 'DESTINATION_NOT_ALLOWLISTED', destinationId: null, activatesAt: null,
  });
  expect(findExact).toHaveBeenCalledWith({ tenantId, userId, network: 'ETHEREUM', address });
});

test('reports active and pending entries without claiming that a withdrawal is authorized', async () => {
  const active = setup([base]);
  await expect(active.controller.check(tenantId, actor, { network: 'ETHEREUM', address })).resolves.toMatchObject({ decision: 'ALLOW', code: 'ALLOW', destinationId: base.id });
  const pending = setup([{ ...base, status: 'PENDING' }]);
  await expect(pending.controller.check(tenantId, actor, { network: 'ETHEREUM', address })).resolves.toMatchObject({ decision: 'DENY', code: 'DESTINATION_PENDING_ACTIVATION', activatesAt: '2026-01-01T00:00:00.000Z' });
  const revoked = setup([{ ...base, status: 'REVOKED', revokedAt: new Date() }]);
  await expect(revoked.controller.check(tenantId, actor, { network: 'ETHEREUM', address })).resolves.toMatchObject({ decision: 'DENY', code: 'DESTINATION_REVOKED' });
});

test('inconsistent active entries never bypass revocation or a future activation time', async () => {
  const future = setup([{ ...base, activatesAt: new Date('2999-01-01T00:00:00Z') }]);
  await expect(future.controller.check(tenantId, actor, { network: 'ETHEREUM', address })).resolves.toMatchObject({ decision: 'DENY', code: 'DESTINATION_PENDING_ACTIVATION' });
  const revoked = setup([{ ...base, revokedAt: new Date() }]);
  await expect(revoked.controller.check(tenantId, actor, { network: 'ETHEREUM', address })).resolves.toMatchObject({ decision: 'DENY', code: 'DESTINATION_REVOKED' });
  const invalid = setup([{ ...base, activatesAt: new Date('invalid') }]);
  await expect(invalid.controller.check(tenantId, actor, { network: 'ETHEREUM', address })).resolves.toMatchObject({ decision: 'DENY' });
});

test('the check requires a customer money-read or payout permission', () => {
  const reflector = new Reflector();
  const handler = WithdrawalDestinationCheckController.prototype.check;
  expect(reflector.get(PERMISSIONS_KEY, handler)).toEqual([Permission.PORTFOLIO_READ, Permission.PAYOUT_MANAGE]);
  expect(reflector.get(PERMISSIONS_MODE_KEY, handler)).toBe('any');
});
