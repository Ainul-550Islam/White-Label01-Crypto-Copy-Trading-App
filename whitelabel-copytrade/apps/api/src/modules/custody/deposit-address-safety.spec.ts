import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import type { CustodyWalletAddress, Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { BlockchainProviderFactory } from './blockchain-provider.factory';
import { type BlockchainProvider, type BlockchainProviderCapabilities } from './blockchain-provider.interface';
import { CustodyAuditService } from './custody-audit.service';
import { DepositAddressService } from './deposit-address.service';
import { WalletAddressService } from './wallet-address.service';

const tenantId = '11111111-1111-4111-8111-111111111111';
const request = { tenantId, walletId: 'wallet', assetId: 'ETH', networkId: 'ethereum', accountId: 'account-b', clientProfileId: 'client-b' };
const now = new Date('2026-10-27T00:00:00Z');

function address(overrides: Partial<CustodyWalletAddress> = {}): CustodyWalletAddress {
  return {
    id: 'address', ...request, address: '0xIssued', providerReference: 'provider-ref',
    creationSource: 'DEPOSIT_ADDRESS_SERVICE', status: 'ACTIVE', label: null,
    isDepositAddress: true, verified: true, verifiedAt: now,
    metadata: { noMemoRequired: true }, idempotencyKey: 'key', activatedAt: now,
    deprecatedAt: null, createdAt: now, updatedAt: now, ...overrides,
  };
}

function setup() {
  const wallet = { id: request.walletId, tenantId, accountId: null as string | null,
    clientProfileId: null as string | null, assetId: 'ETH', networkId: 'ethereum', state: 'ACTIVE', isActive: true };
  const rows: CustodyWalletAddress[] = [];
  const findFirst = jest.fn<(args: Prisma.CustodyWalletAddressFindFirstArgs) => Promise<CustodyWalletAddress | null>>()
    .mockImplementation(async ({ where }) => rows.find((row) => {
      if (!where) return false;
      return row.tenantId === where.tenantId && row.walletId === where.walletId &&
        row.assetId === where.assetId && row.networkId === where.networkId &&
        row.accountId === where.accountId && row.clientProfileId === where.clientProfileId &&
        row.isDepositAddress === where.isDepositAddress && ['ACTIVE', 'RESERVED'].includes(row.status);
    }) ?? null);
  const prisma = { custodyWallet: { findFirst: jest.fn<() => Promise<typeof wallet | null>>().mockResolvedValue(wallet) },
    custodyWalletAddress: { findFirst } };
  const capabilities: BlockchainProviderCapabilities = { canGetBalance: false, canObserveAddress: false,
    canSubmitTransaction: false, canGetTransaction: false, canGetReceipt: false, canGetBlock: false,
    canEstimateFee: false, canObserveConfirmations: false, canGenerateAddress: true,
    supportedNetworks: ['ethereum'], supportedAssets: ['ETH'] };
  const generate = jest.fn<NonNullable<BlockchainProvider['generateDepositAddress']>>()
    .mockResolvedValue({ address: '0xIssued', providerReference: 'provider-ref' });
  const provider = { providerId: 'provider', getCapabilities: async () => capabilities, generateDepositAddress: generate };
  const createAddress = jest.fn<WalletAddressService['createAddress']>().mockImplementation(async (input) => address({
    tenantId: input.tenantId, walletId: input.walletId, assetId: input.assetId, networkId: input.networkId,
    accountId: input.accountId ?? null, clientProfileId: input.clientProfileId ?? null,
    address: input.address, providerReference: input.providerReference ?? null,
    creationSource: input.creationSource ?? null, isDepositAddress: input.isDepositAddress ?? false,
    metadata: input.metadata,
  }));
  const audit = { log: jest.fn<CustodyAuditService['log']>().mockResolvedValue(undefined as never) };
  const service = new DepositAddressService(
    prisma as unknown as PrismaService,
    { createAddress } as unknown as WalletAddressService,
    { getProviderForNetwork: async () => provider } as unknown as BlockchainProviderFactory,
    audit as unknown as CustodyAuditService,
  );
  return { service, prisma, wallet, rows, createAddress, audit, generate };
}

afterEach(() => jest.useRealTimers());

describe('deposit address ownership and provider evidence', () => {
  it('only reuses an active provider-issued row for the exact account and client', async () => {
    const f = setup();
    f.rows.push(address({ id: 'other', accountId: 'account-a', clientProfileId: 'client-a' }), address({ id: 'own' }));
    await expect(f.service.getOrCreateDepositAddress(request)).resolves.toMatchObject({ id: 'own' });
    expect(f.prisma.custodyWalletAddress.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ accountId: 'account-b', clientProfileId: 'client-b' }),
    }));
    expect(f.generate).not.toHaveBeenCalled();
  });

  it('does not return an address from a suspended wallet or a wallet bound to another owner', async () => {
    const f = setup();
    f.rows.push(address());
    f.wallet.state = 'SUSPENDED';
    await expect(f.service.getOrCreateDepositAddress(request)).rejects.toBeInstanceOf(BadRequestException);
    f.wallet.state = 'ACTIVE';
    f.wallet.accountId = 'account-a';
    await expect(f.service.getOrCreateDepositAddress(request)).rejects.toBeInstanceOf(BadRequestException);
    expect(f.prisma.custodyWalletAddress.findFirst).not.toHaveBeenCalled();
  });

  it.each([
    { status: 'RESERVED' as const }, { verified: false }, { creationSource: 'MANUAL' },
    { providerReference: null }, { metadata: {} }, { accountId: 'account-a' },
  ])('does not return a row with incomplete or conflicting evidence: %p', async (unsafe) => {
    const f = setup();
    // A malformed database result must be rejected even if a query or adapter misbehaves.
    f.prisma.custodyWalletAddress.findFirst.mockResolvedValueOnce(address(unsafe));
    await expect(f.service.getOrCreateDepositAddress(request)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(f.generate).not.toHaveBeenCalled();
  });

  it('refuses provider responses with a required memo or missing provider reference', async () => {
    const f = setup();
    f.generate.mockResolvedValueOnce({ address: '0xIssued', providerReference: 'provider-ref', memo: 'tag-123' });
    await expect(f.service.getOrCreateDepositAddress(request)).rejects.toBeInstanceOf(ServiceUnavailableException);
    f.generate.mockResolvedValueOnce({ address: '0xIssued', providerReference: ' ' });
    await expect(f.service.getOrCreateDepositAddress(request)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(f.createAddress).not.toHaveBeenCalled();
  });

  it('does not report a replay for another account as a successful issuance', async () => {
    const f = setup();
    f.createAddress.mockResolvedValueOnce(address({ accountId: 'account-a' }));
    await expect(f.service.getOrCreateDepositAddress(request)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(f.audit.log).not.toHaveBeenCalled();
  });

  it('keeps the provider intent stable across dates after an uncertain write', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-10-27T23:59:59Z'));
    const f = setup();
    f.createAddress.mockRejectedValue(new Error('unavailable'));
    await expect(f.service.getOrCreateDepositAddress(request)).rejects.toThrow();
    jest.setSystemTime(new Date('2026-10-28T00:00:01Z'));
    await expect(f.service.getOrCreateDepositAddress(request)).rejects.toThrow();
    expect(f.generate.mock.calls[0]?.[0].idempotencyKey).toBe(f.generate.mock.calls[1]?.[0].idempotencyKey);
  });

  it('does not expose provider exception text', async () => {
    const f = setup();
    f.generate.mockRejectedValueOnce(new Error('private provider credential and response'));
    await expect(f.service.getOrCreateDepositAddress(request)).rejects.toThrow('Deposit address provider is unavailable');
  });
});
