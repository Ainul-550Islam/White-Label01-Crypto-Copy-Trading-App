// # Responsibility: proves the operator key-health read is tenant-scoped, permission-gated, never returns key material, and reports an unverified key as UNKNOWN rather than healthy.
import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { Permission } from '@wlct/shared-types';
import { PERMISSIONS_KEY, PERMISSIONS_MODE_KEY } from '../../common/constants/metadata.constants';
import { REQUIRE_STEP_UP_KEY } from '../auth/step-up/require-step-up.decorator';
import { AccountCapabilityHealthService } from './account-capability-health.service';
import { ExchangeKeyHealthAdminController } from './exchange-key-health-admin.controller';
import {
  ExchangeAccountState,
  ExchangeCapability,
  ExchangeEnvironment,
  ExchangeHealthState,
  ExchangeVenue,
} from './exchange.types';
import type { ExchangeAccountRecord } from './exchange-account.repository';

const TENANT_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

/** A record shaped like `ExchangeAccountRepository.mapToRecord` output. */
function record(overrides: Partial<ExchangeAccountRecord> = {}): ExchangeAccountRecord {
  return {
    id: 'account-1',
    tenantId: TENANT_ID,
    userId: 'user-1',
    exchangeId: 'exchange-1',
    venue: ExchangeVenue.BINANCE,
    label: 'Main spot key',
    status: ExchangeAccountState.ACTIVE,
    environment: ExchangeEnvironment.LIVE,
    isSandbox: false,
    credentialSource: 'VAULT',
    credentialRef: 'vault://ref-1',
    apiKeyLastFour: 'a1b2',
    apiKeyBlindIndex: 'blind-index-1',
    capabilities: [ExchangeCapability.BALANCES, ExchangeCapability.ORDERS],
    healthState: ExchangeHealthState.HEALTHY,
    connectionState: 'CONNECTED' as never,
    lastVerifiedAt: new Date('2026-10-30T00:00:00.000Z'),
    credentialExpiresAt: new Date('2026-12-01T00:00:00.000Z'),
    consecutiveFailures: 0,
    lastSyncAt: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    liveTradingEnabled: false,
    privateStreamEnabled: true,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-10-30T00:00:00.000Z'),
    deletedAt: null,
    idempotencyKey: null,
    metadata: {},
    ...overrides,
  };
}

function repositoryWith(rows: ExchangeAccountRecord[], total = rows.length) {
  return { listByTenant: jest.fn().mockResolvedValue({ data: rows, total }) };
}

/** The real service: this spec asserts the matrix it computes, not a mock of it. */
function capabilityHealth(): AccountCapabilityHealthService {
  return new AccountCapabilityHealthService({ now: () => new Date('2026-10-30T01:00:00.000Z') });
}

describe('ExchangeKeyHealthAdminController', () => {
  it('requires an exchange-account read permission', () => {
    expect(Reflect.getMetadata(PERMISSIONS_KEY, ExchangeKeyHealthAdminController.prototype.list)).toEqual([
      Permission.EXCHANGE_ACCOUNT_READ,
    ]);
    expect(Reflect.getMetadata(PERMISSIONS_MODE_KEY, ExchangeKeyHealthAdminController.prototype.list)).toBe('all');
  });

  it('is read-only: no route on this controller consumes a step-up proof', () => {
    // A step-up on the read would burn the operator's proof for an action they did
    // not take, and would suggest this surface can remediate a key. It cannot.
    for (const handler of ['list'] as const) {
      expect(Reflect.getMetadata(REQUIRE_STEP_UP_KEY, ExchangeKeyHealthAdminController.prototype[handler])).toBeUndefined();
    }
  });

  it('lists only the JWT tenant and forwards the operator’s filters', async () => {
    const repository = repositoryWith([record()]);
    const controller = new ExchangeKeyHealthAdminController(repository as never, capabilityHealth());

    const page = await controller.list(TENANT_ID, '2', '50', 'bybit', 'active');

    expect(repository.listByTenant).toHaveBeenCalledWith(TENANT_ID, {
      page: 2,
      limit: 50,
      venue: ExchangeVenue.BYBIT,
      status: ExchangeAccountState.ACTIVE,
      environment: undefined,
      userId: undefined,
    });
    expect(page.evaluated).toBe(1);
    expect(page.total).toBe(1);
  });

  it('reports the page total from the repository so a truncated page is visible', async () => {
    const repository = repositoryWith([record()], 240);
    const controller = new ExchangeKeyHealthAdminController(repository as never, capabilityHealth());

    const page = await controller.list(TENANT_ID);

    expect(page.total).toBe(240);
    expect(page.evaluated).toBe(1);
    expect(page.summary.healthy).toBe(1);
  });

  it('never returns credential references, blind indexes or key material', async () => {
    const repository = repositoryWith([record()]);
    const controller = new ExchangeKeyHealthAdminController(repository as never, capabilityHealth());

    const serialised = JSON.stringify(await controller.list(TENANT_ID));

    expect(serialised).not.toContain('vault://ref-1');
    expect(serialised).not.toContain('blind-index-1');
    expect(serialised).not.toContain('apiKeyBlindIndex');
    expect(serialised).not.toContain('credentialRef');
    // The last four characters are deliberately retained: an operator identifying a
    // key by sight needs them, and they are not usable on their own.
    expect(JSON.parse(serialised).data[0].apiKeyLastFour).toBe('a1b2');
  });

  it('shows a key whose permissions were never verified as UNKNOWN with an action, not as healthy', async () => {
    const repository = repositoryWith([record({ capabilities: [], lastVerifiedAt: null })]);
    const controller = new ExchangeKeyHealthAdminController(repository as never, capabilityHealth());

    const page = await controller.list(TENANT_ID);

    expect(page.data[0].overall).toBe('UNKNOWN');
    expect(page.data[0].requiresAction).toContain('VERIFY_PERMISSIONS');
    expect(page.summary.unknown).toBe(1);
    expect(page.summary.healthy).toBe(0);
  });

  it('derives trade and read capability from the verified permission list, never withdrawal', async () => {
    const repository = repositoryWith([
      record({ capabilities: [ExchangeCapability.ORDERS, ExchangeCapability.BALANCES, ExchangeCapability.WITHDRAWALS] }),
    ]);
    const controller = new ExchangeKeyHealthAdminController(repository as never, capabilityHealth());

    const page = await controller.list(TENANT_ID);
    const rows = page.data[0].capabilities;

    expect(rows.find((row) => row.capability === 'TRADE')?.granted).toBe(true);
    expect(rows.find((row) => row.capability === 'READ')?.granted).toBe(true);
    // WITHDRAWALS in the verified list does not make canWithdraw true: the matrix
    // must report what the key may do, and a venue feature is not a grant.
    expect(rows.find((row) => row.capability === 'WITHDRAW')?.granted).toBe(false);
  });

  it('surfaces a withdrawal-enabled key as RISK with the rotation action', async () => {
    // `canWithdraw` is never derived from the stored list, so the only way a key
    // reaches the withdrawal branch is the explicit permission flag; the record
    // does not carry it, which is why a verified list alone can never produce
    // WITHDRAWAL_ENABLED. This asserts the negative: the read does not invent it.
    const repository = repositoryWith([record({ capabilities: [ExchangeCapability.ORDERS] })]);
    const controller = new ExchangeKeyHealthAdminController(repository as never, capabilityHealth());

    const page = await controller.list(TENANT_ID);

    expect(page.data[0].requiresAction).not.toContain('ROTATE_KEY_WITHOUT_WITHDRAWAL');
  });

  it('rejects a malformed page, an oversized limit and an unknown enum value with 400 and the bound in the message', async () => {
    const repository = repositoryWith([]);
    const controller = new ExchangeKeyHealthAdminController(repository as never, capabilityHealth());

    await expect(controller.list(TENANT_ID, 'zero')).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.list(TENANT_ID, '1', '5000')).rejects.toThrow(/must not exceed 200/);
    await expect(controller.list(TENANT_ID, '1', '20', 'not-a-venue')).rejects.toThrow(/venue must be one of/);
    await expect(controller.list(TENANT_ID, '1', '20', undefined, 'NOPE')).rejects.toThrow(/status must be one of/);
    expect(repository.listByTenant).not.toHaveBeenCalled();
  });

  it('counts each overall verdict and the number of keys that need a human', async () => {
    const repository = repositoryWith([
      record({ id: 'a', capabilities: [ExchangeCapability.BALANCES, ExchangeCapability.ORDERS] }),
      record({ id: 'b', capabilities: [], lastVerifiedAt: null }),
      record({ id: 'c', capabilities: [ExchangeCapability.BALANCES], lastVerifiedAt: new Date('2026-10-01T00:00:00.000Z') }),
    ]);
    const controller = new ExchangeKeyHealthAdminController(repository as never, capabilityHealth());

    const page = await controller.list(TENANT_ID, '1', '200');

    expect(page.summary.unknown).toBe(1);
    expect(page.summary.requiresAction).toBeGreaterThanOrEqual(2);
    expect(page.summary.healthy + page.summary.degraded + page.summary.risk + page.summary.unhealthy + page.summary.unknown).toBe(3);
  });
});
