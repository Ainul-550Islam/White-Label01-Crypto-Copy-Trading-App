// # Responsibility: prove custody provider honesty, authenticated tenant/scope boundaries and fail-closed reserve/internal-transfer behavior using typed unit fixtures.
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { Prisma, type CustodyWallet, type CustodyReserve, type CustodyInternalTransfer, type CustodyAsset, type CustodyNetwork, type CustodyWalletAddress, type CustodySweep, type CustodyDeposit, type CustodyWithdrawal, type CustodyTransaction, type CustodyAudit, type FundingRequest, type WithdrawalRequest, type InstitutionalAccount } from '@prisma/client';
import { AppConfigService } from '../../config/app-config.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { rowMatches } from '../../common/__fixtures__/in-memory-prisma.fixture-spec';
import { BlockchainProviderFactory, INTERNAL_LEDGER_PROVIDER_ID } from './blockchain-provider.factory';
import { type BlockchainProvider, type BlockchainProviderCapabilities } from './blockchain-provider.interface';
import { DepositAddressService } from './deposit-address.service';
import { CustodyController } from './custody.controller';
import { WalletService } from './wallet.service';
import { WalletRepository, assertSafeWalletMetadata } from './wallet.repository';
import { WalletAddressService } from './wallet-address.service';
import { DepositMonitoringService } from './deposit-monitoring.service';
import { WithdrawalPolicyService } from './withdrawal-policy.service';
import { WithdrawalOrchestrationService } from './withdrawal-orchestration.service';
import { TransactionService } from './transaction.service';
import { TransactionMonitoringService } from './transaction-monitoring.service';
import { ConfirmationService } from './confirmation.service';
import { BlockchainFeeService } from './blockchain-fee.service';
import { InternalTransferService } from './internal-transfer.service';
import { SettlementService } from './settlement.service';
import { TreasuryBalanceService } from './treasury-balance.service';
import { ReserveManagementService } from './reserve-management.service';
import { SweepService } from './sweep.service';
import { CustodyReconciliationService } from './custody-reconciliation.service';
import { CustodyAuditService } from './custody-audit.service';
import { CustodyVisibilityService } from './custody-visibility.service';
import { CustodyPolicyService, type CustodyPolicy } from './custody-policy.service';
import { AssetRegistryService } from './asset-registry.service';
import { NetworkRegistryService } from './network-registry.service';
import { type BalanceObservation, CustodyWalletState, redactSecrets, custodyJsonInput, add, cmp, parseScaled } from './custody.types';

const NOW = new Date('2026-10-10T12:00:00.000Z');
const TENANT = '11111111-1111-4111-8111-111111111111';
const OTHER_TENANT = '22222222-2222-4222-8222-222222222222';

function walletRecord(overrides: Partial<CustodyWallet> = {}): CustodyWallet {
  return { id: 'wallet-source', tenantId: TENANT, clientProfileId: null, accountId: null, walletType: 'HOT', state: 'ACTIVE',
    scope: 'TENANT', assetId: 'ETH-ethereum', networkId: 'ethereum', provider: 'unit-provider', providerReference: 'unit-wallet-ref',
    providerMetadata: null, encryptedSecretReference: null, credentialFingerprint: null, ownerId: 'owner-a', ownerType: 'USER',
    isActive: true, metadata: {}, idempotencyKey: 'wallet-key', activatedAt: NOW, suspendedAt: null, closedAt: null,
    createdAt: NOW, updatedAt: NOW, ...overrides };
}

function transferRecord(overrides: Partial<CustodyInternalTransfer> = {}): CustodyInternalTransfer {
  return { id: 'transfer-1', tenantId: TENANT, sourceWalletId: 'wallet-source', destinationWalletId: 'wallet-destination',
    assetId: 'ETH-ethereum', networkId: 'ethereum', amount: '2', state: 'REQUESTED', authorizationReference: null,
    operatorId: null, reason: null, settlementReference: null, metadata: {}, evidence: {}, idempotencyKey: 'transfer-key',
    requestedAt: NOW, approvedAt: null, settledAt: null, failedAt: null, createdAt: NOW, updatedAt: NOW, ...overrides };
}

function reserveRecord(overrides: Partial<CustodyReserve> = {}): CustodyReserve {
  return { id: 'reserve-1', tenantId: TENANT, walletId: null, assetId: 'ETH-ethereum', networkId: null, reserveType: 'operational',
    requiredAmount: '2', availableAmount: null, reservedAmount: null, lockedAmount: null, state: 'ACTIVE', policyVersion: null,
    calculationVersion: 'custody-v1.0.0', metadata: {}, idempotencyKey: 'reserve-key', createdAt: NOW, updatedAt: NOW, ...overrides };
}

function assetRecord(overrides: Partial<CustodyAsset> = {}): CustodyAsset {
  return { id: 'asset-1', assetId: 'ETH-ethereum', symbol: 'ETH', name: 'Ether', decimals: 18, displayPrecision: 8,
    isNative: true, isActive: true, contractAddress: null, tokenStandard: null, chainId: '1', networkId: 'ethereum',
    metadata: {}, createdAt: NOW, updatedAt: NOW, ...overrides };
}

function networkRecord(overrides: Partial<CustodyNetwork> = {}): CustodyNetwork {
  return { id: 'network-1', networkId: 'ethereum', chainId: '1', name: 'Ethereum', nativeAssetId: 'ETH-ethereum', nativeAssetSymbol: 'ETH',
    explorerUrl: null, rpcUrl: null, finalityModel: null, confirmationPolicy: { requiredConfirmations: 12 }, status: 'ACTIVE',
    providerCapabilities: [], metadata: {}, createdAt: NOW, updatedAt: NOW, ...overrides };
}

function balanceRecord(overrides: Partial<BalanceObservation> = {}): BalanceObservation {
  return { assetId: 'ETH-ethereum', assetSymbol: 'ETH', networkId: 'ethereum', walletId: 'wallet-source', available: '10',
    observationTimestamp: NOW.toISOString(), provider: 'unit-provider', sourceReference: 'unit-balance-observation',
    dataCompleteness: 'PROVIDER_DERIVED', ...overrides };
}

function policyRecord(): CustodyPolicy {
  return { supportedAssets: ['ETH'], supportedNetworks: ['ethereum'], confirmationRequirements: { ethereum: 12 },
    withdrawalLimits: { maxSingleWithdrawal: null, maxDailyWithdrawal: null, maxPendingWithdrawals: 10 },
    reserveRequirements: { operationalReserveBps: null, withdrawalReserveBps: null, gasReserveAmount: null },
    addressAllowlisting: { requireAllowlist: false, allowNewAddresses: true, verificationRequired: true },
    cooldownRequirements: { withdrawalCooldownMs: null, newAddressCooldownMs: null },
    maintenanceRestrictions: { blockWithdrawalsDuringMaintenance: true, blockSweepsDuringMaintenance: true, blockDepositsDuringMaintenance: false },
    providerSelection: { preferredProvider: null, fallbackAllowed: false },
    approvalPrerequisites: { withdrawalRequiresCompliance: true, withdrawalRequiresRisk: true, withdrawalRequiresSecurity: true,
      withdrawalRequiresOwnership: true, sweepRequiresApproval: true, internalTransferRequiresApproval: true },
    policyVersion: 'custody-policy-v1.0.0', calculationVersion: 'custody-v1.0.0' };
}

function capabilities(overrides: Partial<BlockchainProviderCapabilities> = {}): BlockchainProviderCapabilities {
  return { canGetBalance: false, canObserveAddress: false, canSubmitTransaction: false, canGetTransaction: true, canGetReceipt: false,
    canGetBlock: false, canEstimateFee: false, canObserveConfirmations: false, canGenerateAddress: false,
    supportedNetworks: ['ethereum'], supportedAssets: ['ETH-ethereum'], ...overrides };
}

function unitProvider(overrides: Partial<BlockchainProvider> = {}): BlockchainProvider {
  return { providerId: 'unit-provider', providerName: 'Unit provider fixture', getCapabilities: async () => capabilities(),
    getBalance: async () => balanceRecord({ dataCompleteness: 'UNKNOWN' }), getTransaction: async () => null, ...overrides };
}

describe('BlockchainProviderFactory', () => {
  let module: TestingModule;
  const saved = process.env.CUSTODY_BLOCKCHAIN_PROVIDER;
  beforeEach(async () => {
    module = await Test.createTestingModule({ providers: [BlockchainProviderFactory,
      { provide: PrismaService, useValue: {} }, { provide: AppConfigService, useValue: {} },
      { provide: AssetRegistryService, useValue: { isAssetSupported: jest.fn<AssetRegistryService['isAssetSupported']>().mockResolvedValue(true) } },
      { provide: NetworkRegistryService, useValue: { isNetworkSupported: jest.fn<NetworkRegistryService['isNetworkSupported']>().mockResolvedValue(true) } },
    ] }).compile();
  });
  afterEach(async () => {
    if (saved === undefined) delete process.env.CUSTODY_BLOCKCHAIN_PROVIDER;
    else process.env.CUSTODY_BLOCKCHAIN_PROVIDER = saved;
    await module.close();
  });
  function factory() { return module.get<BlockchainProviderFactory>(BlockchainProviderFactory); }

  it('resolves the internal-ledger provider with honest capabilities and unhealthy status', async () => {
    delete process.env.CUSTODY_BLOCKCHAIN_PROVIDER;
    const provider = await factory().getProviderForNetwork({ networkId: 'ethereum', assetId: 'ETH-ethereum' });
    expect(provider.providerId).toBe(INTERNAL_LEDGER_PROVIDER_ID);
    expect(await provider.getCapabilities()).toMatchObject({ canGetBalance: false, canObserveAddress: false,
      canSubmitTransaction: false, canEstimateFee: false, canGenerateAddress: false, canGetTransaction: true });
    expect(provider.generateDepositAddress).toBeUndefined();
    await expect(provider.isHealthy?.()).resolves.toMatchObject({ healthy: false });
  });
  it('never reports an unknown or ledger-only balance as a measured zero', async () => {
    delete process.env.CUSTODY_BLOCKCHAIN_PROVIDER;
    const findMany = jest.fn<() => Promise<Array<{ amount: string }>>>().mockResolvedValue([]);
    const instance = new BlockchainProviderFactory({ custodyDeposit: { findMany } } as never,
      { isAssetSupported: async () => true } as never, { isNetworkSupported: async () => true } as never, {} as never);
    const provider = await instance.getProviderForNetwork({ networkId: 'ethereum', assetId: 'ETH-ethereum' });
    const params = { assetId: 'ETH-ethereum', networkId: 'ethereum', address: 'address' };
    await expect(provider.getBalance(params)).resolves.toMatchObject({ available: null, dataCompleteness: 'UNKNOWN_NO_PROVIDER_OBSERVATION' });
    findMany.mockResolvedValue([{ amount: '1' }]);
    await expect(provider.getBalance(params)).resolves.toMatchObject({ available: null, dataCompleteness: 'UNKNOWN_LEDGER_ONLY_NOT_CHAIN_TRUTH' });
  });
  it('refuses a named external provider that has no adapter', async () => {
    process.env.CUSTODY_BLOCKCHAIN_PROVIDER = 'fireblocks';
    await expect(factory().getProviderForNetwork({ networkId: 'ethereum', assetId: 'ETH-ethereum' })).rejects.toThrow(/fail closed/);
  });
  it('refuses unknown provider ids instead of fabricating one', async () => {
    await expect(factory().getProviderById('bitgo')).rejects.toThrow(BadRequestException);
    await expect(factory().getProviderById(INTERNAL_LEDGER_PROVIDER_ID)).resolves.toMatchObject({ providerId: INTERNAL_LEDGER_PROVIDER_ID });
  });
});

describe('DepositAddressService', () => {
  const modules: TestingModule[] = [];
  afterEach(async () => { for (const module of modules.splice(0)) await module.close(); });
  async function build(provider: BlockchainProvider) {
    const prisma = { custodyWalletAddress: { findFirst: jest.fn<(args: Prisma.CustodyWalletAddressFindFirstArgs) => Promise<null>>().mockResolvedValue(null) },
      custodyWallet: { findFirst: jest.fn<(args: Prisma.CustodyWalletFindFirstArgs) => Promise<CustodyWallet>>().mockResolvedValue(walletRecord()) } };
    const walletAddressService = { createAddress: jest.fn<(input: Parameters<WalletAddressService['createAddress']>[0]) => Promise<CustodyWalletAddress>>()
      .mockImplementation(async (input) => addressRecord({ id: 'addr-1', tenantId: input.tenantId, walletId: input.walletId,
        assetId: input.assetId, networkId: input.networkId, address: input.address,
        providerReference: input.providerReference ?? null, creationSource: input.creationSource ?? null,
        isDepositAddress: input.isDepositAddress ?? false, accountId: input.accountId ?? null,
        clientProfileId: input.clientProfileId ?? null, metadata: input.metadata })) };
    const module = await Test.createTestingModule({ providers: [DepositAddressService,
      { provide: PrismaService, useValue: prisma }, { provide: WalletAddressService, useValue: walletAddressService },
      { provide: BlockchainProviderFactory, useValue: { getProviderForNetwork: jest.fn<BlockchainProviderFactory['getProviderForNetwork']>().mockResolvedValue(provider) } },
      { provide: CustodyAuditService, useValue: { log: jest.fn<(input: Parameters<CustodyAuditService['log']>[0]) => Promise<null>>().mockResolvedValue(null) } },
    ] }).compile();
    modules.push(module);
    return { svc: module.get<DepositAddressService>(DepositAddressService), walletAddressService };
  }
  const params = { tenantId: TENANT, walletId: 'wallet-source', assetId: 'ETH-ethereum', networkId: 'ethereum' };
  it('never invents an address when the provider cannot generate one', async () => {
    const { svc, walletAddressService } = await build(unitProvider());
    await expect(svc.getOrCreateDepositAddress(params)).rejects.toThrow(/cannot generate deposit addresses/);
    expect(walletAddressService.createAddress).not.toHaveBeenCalled();
  });
  it('stores exactly the provider-issued address', async () => {
    const generateDepositAddress = jest.fn<NonNullable<BlockchainProvider['generateDepositAddress']>>()
      .mockResolvedValue({ address: '0xProviderIssued', providerReference: 'prov:abc' });
    const { svc, walletAddressService } = await build(unitProvider({ getCapabilities: async () => capabilities({ canGenerateAddress: true }), generateDepositAddress }));
    const record: unknown = await svc.getOrCreateDepositAddress(params);
    expect(record).toMatchObject({ address: '0xProviderIssued' });
    expect(walletAddressService.createAddress).toHaveBeenCalledWith(expect.objectContaining({ address: '0xProviderIssued', providerReference: 'prov:abc' }));
    expect(generateDepositAddress).toHaveBeenCalledWith(expect.objectContaining({ tenantId: TENANT, walletId: 'wallet-source', idempotencyKey: expect.any(String) }));
  });
  it('refuses an empty provider answer', async () => {
    const { svc } = await build(unitProvider({ getCapabilities: async () => capabilities({ canGenerateAddress: true }),
      generateDepositAddress: async () => ({ address: ' ', providerReference: 'x' }) }));
    await expect(svc.getOrCreateDepositAddress(params)).rejects.toThrow('Provider did not return a deposit address');
  });
});

describe('WalletAddressService ambiguity checks', () => {
  it.each([0, 1])('does not create an address when ownership check %i fails', async (failedCheck) => {
    const findFirst = jest.fn<() => Promise<null>>().mockResolvedValue(null);
    if (failedCheck === 0) findFirst.mockRejectedValueOnce(new Error('database unavailable'));
    else findFirst.mockResolvedValueOnce(null).mockRejectedValueOnce(new Error('database unavailable'));
    const create = jest.fn();
    const db = { custodyWallet: { findFirst: async () => walletRecord() }, custodyWalletAddress: { findFirst, create } };
    const service = new WalletAddressService(db as never, { log: async () => undefined } as never);
    await expect(service.createAddress({ tenantId: TENANT, walletId: 'wallet-source', assetId: 'ETH-ethereum',
      networkId: 'ethereum', address: '0xAddress' })).rejects.toMatchObject({ code: 'CUSTODY_ADDRESS_AMBIGUITY_CHECK_FAILED' });
    expect(create).not.toHaveBeenCalled();
  });
});

describe('CustodyController tenant/scope resolution', () => {
  let module: TestingModule;
  let controller: CustodyController;
  const visibility = { assertCanAccessWallet: jest.fn<(input: Parameters<CustodyVisibilityService['assertCanAccessWallet']>[0]) => Promise<void>>().mockResolvedValue(undefined) };
  const wallet = { getWallet: jest.fn<(input: Parameters<WalletService['getWallet']>[0]) => Promise<CustodyWallet>>().mockResolvedValue(walletRecord()),
    listWallets: jest.fn<(input: Parameters<WalletService['listWallets']>[0]) => Promise<{ data: CustodyWallet[]; total: number; page: number; limit: number }>>()
      .mockResolvedValue({ data: [], total: 0, page: 1, limit: 50 }) };
  beforeEach(async () => {
    visibility.assertCanAccessWallet.mockClear(); wallet.getWallet.mockClear(); wallet.listWallets.mockClear();
    const otherTokens = [WalletRepository, WalletAddressService, DepositAddressService, DepositMonitoringService, WithdrawalPolicyService,
      WithdrawalOrchestrationService, TransactionService, TransactionMonitoringService, ConfirmationService, BlockchainFeeService,
      InternalTransferService, SettlementService, TreasuryBalanceService, ReserveManagementService, SweepService, CustodyReconciliationService,
      CustodyAuditService, CustodyPolicyService, AssetRegistryService, NetworkRegistryService, BlockchainProviderFactory];
    module = await Test.createTestingModule({ controllers: [CustodyController], providers: [
      { provide: WalletService, useValue: wallet }, { provide: CustodyVisibilityService, useValue: visibility },
      ...otherTokens.map((provide) => ({ provide, useValue: {} })),
    ] }).compile();
    controller = module.get<CustodyController>(CustodyController);
  });
  afterEach(async () => { await module.close(); });
  async function scope(request: { user?: { isPlatformUser?: boolean; permissions?: string[]; custodyScope?: string }; headers?: Record<string, string> }): Promise<unknown> {
    await controller.getWallet({ ...request, user: { tenantId: TENANT, ...request.user } }, 'wallet-source', {});
    return visibility.assertCanAccessWallet.mock.calls.at(-1)?.[0].scope;
  }
  it('uses only the authenticated tenant and refuses cross-tenant ids', async () => {
    await controller.listWallets({ user: { tenantId: TENANT } }, { tenantId: TENANT });
    expect(wallet.listWallets).toHaveBeenCalledWith(expect.objectContaining({ tenantId: TENANT }));
    await expect(controller.listWallets({ user: { tenantId: TENANT } }, { tenantId: OTHER_TENANT })).rejects.toThrow('Cross-tenant custody access refused');
    await expect(controller.getWallet({ user: { tenantId: TENANT } }, 'wallet-source', { tenantId: OTHER_TENANT })).rejects.toThrow('Cross-tenant custody access refused');
    await expect(controller.listWallets({ headers: { 'x-tenant-id': OTHER_TENANT } }, {})).rejects.toThrow('Tenant context required');
  });
  it('refuses to label a manually entered address as provider-issued', async () => {
    await expect(controller.createAddress({ user: { tenantId: TENANT } }, {
      creationSource: 'DEPOSIT_ADDRESS_SERVICE', metadata: { noMemoRequired: true },
    })).rejects.toThrow('Provider issuance source is reserved');
  });
  it('ignores a client-supplied scope header and defaults to CLIENT', async () => {
    expect(await scope({ headers: { 'x-custody-scope': 'PLATFORM_ADMIN' } })).toBe('CLIENT');
    expect(await scope({ user: { custodyScope: 'ROOT' } })).toBe('CLIENT');
  });
  it('derives the scope from the principal permissions (no issuer sets a custodyScope claim)', async () => {
    expect(await scope({ user: { isPlatformUser: true, permissions: [] } })).toBe('PLATFORM_ADMIN');
    expect(await scope({ user: { permissions: ['*'] } })).toBe('PLATFORM_ADMIN');
    expect(await scope({ user: { permissions: ['payout:manage'] } })).toBe('TREASURY_OPERATOR');
    expect(await scope({ user: { permissions: ['tenant:update'] } })).toBe('TENANT_OWNER');
    expect(await scope({ user: { permissions: ['compliance:read'] } })).toBe('COMPLIANCE_REVIEWER');
    expect(await scope({ user: { permissions: ['report:read'] } })).toBe('CLIENT');
    expect(await scope({ user: {} })).toBe('CLIENT');
  });
  it('a custodyScope claim can narrow the derived scope but never raise it', async () => {
    expect(await scope({ user: { custodyScope: 'TREASURY_OPERATOR' } })).toBe('CLIENT');
    expect(await scope({ user: { custodyScope: 'PLATFORM_ADMIN', permissions: ['tenant:update'] } })).toBe('TENANT_OWNER');
    expect(await scope({ user: { custodyScope: 'CLIENT', permissions: ['payout:manage'] } })).toBe('CLIENT');
    expect(await scope({ user: { custodyScope: 'TREASURY_OPERATOR', permissions: ['payout:manage'] } })).toBe('TREASURY_OPERATOR');
  });
});

describe('Canonical custody policy evidence', () => {
  let module: TestingModule;
  const db = {
    custodyAsset: { findMany: jest.fn<(args: Prisma.CustodyAssetFindManyArgs) => Promise<CustodyAsset[]>>(),
      findFirst: jest.fn<(args: Prisma.CustodyAssetFindFirstArgs) => Promise<CustodyAsset | null>>() },
    custodyNetwork: { findMany: jest.fn<(args: Prisma.CustodyNetworkFindManyArgs) => Promise<CustodyNetwork[]>>(),
      findFirst: jest.fn<(args: Prisma.CustodyNetworkFindFirstArgs) => Promise<CustodyNetwork | null>>() },
  };
  beforeEach(async () => {
    db.custodyAsset.findMany.mockReset().mockResolvedValue([assetRecord()]); db.custodyAsset.findFirst.mockReset().mockResolvedValue(assetRecord());
    db.custodyNetwork.findMany.mockReset().mockResolvedValue([networkRecord()]); db.custodyNetwork.findFirst.mockReset().mockResolvedValue(networkRecord());
    module = await Test.createTestingModule({ providers: [CustodyPolicyService,
      { provide: PrismaService, useValue: db }, { provide: AppConfigService, useValue: {} },
    ] }).compile();
  });
  afterEach(async () => { await module.close(); });
  function policy() { return module.get<CustodyPolicyService>(CustodyPolicyService); }
  it('propagates a failed required active-asset read instead of claiming default support', async () => {
    const failure = new Error('asset registry unavailable'); db.custodyAsset.findMany.mockRejectedValueOnce(failure);
    await expect(policy().resolvePolicy({ tenantId: TENANT })).rejects.toBe(failure);
  });
  it('propagates a failed required network read instead of inventing confirmation evidence', async () => {
    const failure = new Error('network registry unavailable'); db.custodyNetwork.findMany.mockRejectedValueOnce(failure);
    await expect(policy().getRequiredConfirmations({ tenantId: TENANT, networkId: 'ethereum' })).rejects.toBe(failure);
  });
  it('retains an explicit zero-confirmation policy instead of treating zero as absent', async () => {
    db.custodyNetwork.findMany.mockResolvedValueOnce([networkRecord({ confirmationPolicy: { requiredConfirmations: 0 } })]);
    await expect(policy().getRequiredConfirmations({ tenantId: TENANT, networkId: 'ethereum' })).resolves.toBe(0);
  });
  it.each(['twelve', -1, 1.5])('rejects malformed confirmation evidence %s', async (requiredConfirmations) => {
    db.custodyNetwork.findMany.mockResolvedValueOnce([networkRecord({ confirmationPolicy: { requiredConfirmations } })]);
    await expect(policy().resolvePolicy({ tenantId: TENANT })).rejects.toThrow('Invalid required confirmations');
  });
  it('does not substitute twelve confirmations for an unknown network', async () => {
    await expect(policy().getRequiredConfirmations({ tenantId: TENANT, networkId: 'unconfigured-network' })).rejects.toThrow('No explicit confirmation policy');
  });
  it('uses exact canonical asset/network identities rather than a matching symbol substring', async () => {
    db.custodyAsset.findFirst.mockResolvedValueOnce(null);
    await expect(policy().isAssetSupported({ tenantId: TENANT, assetId: 'FAKEETH-token', networkId: 'ethereum' })).resolves.toBe(false);
    expect(db.custodyAsset.findFirst).toHaveBeenCalledWith({ where: { assetId: 'FAKEETH-token', isActive: true,
      OR: [{ networkId: 'ethereum' }, { networkId: null }] } });
  });
});

describe('Internal custody transfer boundaries', () => {
  let module: TestingModule;
  let wallets: CustodyWallet[];
  const db = {
    custodyWallet: { findFirst: jest.fn<(args: Prisma.CustodyWalletFindFirstArgs) => Promise<CustodyWallet | null>>() },
    custodyInternalTransfer: {
      findFirst: jest.fn<(args: Prisma.CustodyInternalTransferFindFirstArgs) => Promise<CustodyInternalTransfer | null>>(),
      create: jest.fn<(args: Prisma.CustodyInternalTransferCreateArgs) => Promise<CustodyInternalTransfer>>(),
      update: jest.fn<(args: Prisma.CustodyInternalTransferUpdateArgs) => Promise<CustodyInternalTransfer>>(),
    },
  };
  const audit = { log: jest.fn<(args: Parameters<CustodyAuditService['log']>[0]) => Promise<null>>() };
  const params = { tenantId: TENANT, sourceWalletId: 'wallet-source', destinationWalletId: 'wallet-destination', assetId: 'ETH-ethereum', amount: '2' };
  beforeEach(async () => {
    wallets = [walletRecord(), walletRecord({ id: 'wallet-destination', idempotencyKey: 'destination-key' })];
    db.custodyWallet.findFirst.mockReset().mockImplementation(async (args) => wallets.find((row) => rowMatches(row, args.where)) ?? null);
    db.custodyInternalTransfer.findFirst.mockReset().mockResolvedValue(null);
    db.custodyInternalTransfer.create.mockReset().mockResolvedValue(transferRecord());
    db.custodyInternalTransfer.update.mockReset().mockResolvedValue(transferRecord({ state: 'APPROVED', approvedAt: NOW }));
    audit.log.mockReset().mockResolvedValue(null);
    module = await Test.createTestingModule({ providers: [InternalTransferService,
      { provide: PrismaService, useValue: db }, { provide: CustodyAuditService, useValue: audit },
    ] }).compile();
  });
  afterEach(async () => { await module.close(); });
  function service() { return module.get<InternalTransferService>(InternalTransferService); }
  it.each(['0', '-1', '0.0000000000001', '2suffix'])('refuses nonpositive, lossy or malformed amount %s before writing', async (amount) => {
    await expect(service().createInternalTransfer({ ...params, amount })).rejects.toThrow();
    expect(db.custodyInternalTransfer.create).not.toHaveBeenCalled();
  });
  it('refuses a destination wallet from another tenant', async () => {
    wallets[1] = walletRecord({ id: 'wallet-destination', tenantId: OTHER_TENANT });
    await expect(service().createInternalTransfer(params)).rejects.toThrow('not found for this tenant');
    expect(db.custodyInternalTransfer.create).not.toHaveBeenCalled();
  });
  it('does not silently substitute the source network for a different destination network', async () => {
    wallets[1] = walletRecord({ id: 'wallet-destination', networkId: 'polygon' });
    await expect(service().createInternalTransfer(params)).rejects.toThrow('matching network');
  });
  it('requires real ownership evidence on both wallets', async () => {
    wallets[1] = walletRecord({ id: 'wallet-destination', ownerId: null });
    await expect(service().createInternalTransfer(params)).rejects.toThrow('ownership evidence');
  });
  it('rejects cross-owner requests without an operator and authorization reference', async () => {
    wallets[1] = walletRecord({ id: 'wallet-destination', ownerId: 'owner-b' });
    await expect(service().createInternalTransfer(params)).rejects.toThrow('explicit authorization reference');
    expect(db.custodyInternalTransfer.create).not.toHaveBeenCalled();
  });
  it('records an explicitly authorized request as REQUESTED, not proof that any funds moved', async () => {
    wallets[1] = walletRecord({ id: 'wallet-destination', ownerId: 'owner-b' });
    await service().createInternalTransfer({ ...params, operatorId: 'operator-a', authorizationReference: 'review-reference', metadata: { apiKey: 'not-a-real-secret', note: 'request only' } });
    expect(db.custodyInternalTransfer.create).toHaveBeenCalledWith({ data: expect.objectContaining({ tenantId: TENANT,
      networkId: 'ethereum', state: 'REQUESTED', authorizationReference: 'review-reference', metadata: { apiKey: '[REDACTED]', note: 'request only' } }) });
  });
  it('does not treat a failed idempotency lookup as permission to create another request', async () => {
    const failure = new Error('transfer lookup unavailable'); db.custodyInternalTransfer.findFirst.mockRejectedValueOnce(failure);
    await expect(service().createInternalTransfer(params)).rejects.toBe(failure);
    expect(db.custodyInternalTransfer.create).not.toHaveBeenCalled();
  });
  it('requires successful durable request persistence before returning or auditing creation', async () => {
    const failure = new Error('transfer persistence unavailable'); db.custodyInternalTransfer.create.mockRejectedValueOnce(failure);
    await expect(service().createInternalTransfer(params)).rejects.toBe(failure); expect(audit.log).not.toHaveBeenCalled();
  });
  it('binds approval to the tenant and expected state at the mutation', async () => {
    db.custodyInternalTransfer.findFirst.mockResolvedValueOnce(transferRecord());
    await service().approveInternalTransfer({ tenantId: TENANT, transferId: 'transfer-1', approverId: 'operator-a' });
    expect(db.custodyInternalTransfer.update).toHaveBeenCalledWith({ where: { id: 'transfer-1', tenantId: TENANT, state: 'REQUESTED' },
      data: { state: 'APPROVED', approvedAt: expect.any(Date) } });
  });
  it.each(['REQUESTED', 'SETTLED', 'CANCELLED'] as const)('does not settle a transfer from invalid state %s', async (state) => {
    db.custodyInternalTransfer.findFirst.mockResolvedValueOnce(transferRecord({ state }));
    await expect(service().settleInternalTransfer({ tenantId: TENANT, transferId: 'transfer-1' })).rejects.toThrow('must be APPROVED/SETTLING');
    expect(db.custodyInternalTransfer.update).not.toHaveBeenCalled();
  });
  it.each(['APPROVED', 'SETTLING'] as const)('never fabricates settlement from %s, even when a reference is supplied', async (state) => {
    db.custodyInternalTransfer.findFirst.mockResolvedValueOnce(transferRecord({ state }));
    await expect(service().settleInternalTransfer({ tenantId: TENANT, transferId: 'transfer-1', settlementReference: 'caller-claim' })).rejects.toThrow(ServiceUnavailableException);
    expect(db.custodyInternalTransfer.update).not.toHaveBeenCalled(); expect(audit.log).not.toHaveBeenCalled();
  });
});

describe('Authoritative reserve sufficiency', () => {
  let module: TestingModule;
  let wallets: CustodyWallet[];
  let reserves: CustodyReserve[];
  let policy: CustodyPolicy;
  const db = {
    withTenantRls: async (_tenant: string, work: (tx: any) => Promise<any>) => work(db),
    custodyWallet: { findMany: jest.fn<(args: Prisma.CustodyWalletFindManyArgs) => Promise<CustodyWallet[]>>() },
    custodyReserve: { findMany: jest.fn<(args: Prisma.CustodyReserveFindManyArgs) => Promise<CustodyReserve[]>>() },
  };
  const balance = { getWalletBalance: jest.fn<TreasuryBalanceService['getWalletBalance']>() };
  const policyService = { resolvePolicy: jest.fn<CustodyPolicyService['resolvePolicy']>() };
  const params = { tenantId: TENANT, walletId: 'wallet-source', assetId: 'ETH-ethereum', networkId: 'ethereum', requestedAmount: '1' };
  beforeEach(async () => {
    wallets = [walletRecord()]; reserves = [reserveRecord()]; policy = policyRecord();
    db.custodyWallet.findMany.mockReset().mockImplementation(async (args) => wallets.filter((row) => rowMatches(row, args.where)));
    db.custodyReserve.findMany.mockReset().mockImplementation(async (args) => reserves.filter((row) => rowMatches(row, args.where)));
    balance.getWalletBalance.mockReset().mockResolvedValue(balanceRecord({ observationTimestamp: new Date().toISOString() }));
    policyService.resolvePolicy.mockReset().mockImplementation(async () => policy);
    module = await Test.createTestingModule({ providers: [ReserveManagementService,
      { provide: PrismaService, useValue: db }, { provide: CustodyPolicyService, useValue: policyService },
      { provide: TreasuryBalanceService, useValue: balance }, { provide: CustodyAuditService, useValue: {} },
    ] }).compile();
  });
  afterEach(async () => { await module.close(); });
  function service() { return module.get<ReserveManagementService>(ReserveManagementService); }
  it('fails a required reserve read rather than replacing unread reserves with an empty list', async () => {
    const failure = new Error('reserves unavailable'); db.custodyReserve.findMany.mockRejectedValueOnce(failure);
    await expect(service().evaluateReserveSufficiency(params)).rejects.toBe(failure); expect(balance.getWalletBalance).not.toHaveBeenCalled();
  });
  it('retains tenant-wide reserves when checking a specific wallet and network', async () => {
    reserves.push(reserveRecord({ id: 'wallet-reserve', walletId: 'wallet-source', networkId: 'ethereum', requiredAmount: '3' }));
    const result = await service().evaluateReserveSufficiency(params);
    expect(result).toMatchObject({ sufficient: true, requiredReserve: '5', availableAfterReserve: '5', dataCompleteness: 'PROVIDER_DERIVED' });
    expect(db.custodyReserve.findMany).toHaveBeenCalledWith({ where: expect.objectContaining({ tenantId: TENANT,
      AND: [{ OR: [{ walletId: 'wallet-source' }, { walletId: null }] }, { OR: [{ networkId: 'ethereum' }, { networkId: null }] }] }) });
  });
  it('does not let reserves from another tenant contaminate this tenant calculation', async () => {
    reserves.push(reserveRecord({ id: 'other-reserve', tenantId: OTHER_TENANT, requiredAmount: '1000' }));
    expect((await service().evaluateReserveSufficiency(params)).requiredReserve).toBe('2');
  });
  it('rejects malformed required reserve amounts instead of skipping their contribution', async () => {
    reserves[0] = reserveRecord({ requiredAmount: 'unavailable' });
    await expect(service().evaluateReserveSufficiency(params)).rejects.toThrow('Invalid persisted reserve amount');
  });
  it.each(['UNKNOWN_NO_ADDRESS', 'PARTIAL_UNKNOWN'])('returns unknown, not a fabricated zero, for %s balances', async (dataCompleteness) => {
    balance.getWalletBalance.mockResolvedValueOnce(balanceRecord({ dataCompleteness }));
    expect(await service().evaluateReserveSufficiency(params)).toMatchObject({ sufficient: false, availableAfterReserve: null, dataCompleteness: 'UNKNOWN' });
  });
  it('fails closed when a balance lookup fails without manufacturing a zero observation', async () => {
    balance.getWalletBalance.mockRejectedValueOnce(new Error('provider unavailable'));
    expect(await service().evaluateReserveSufficiency(params)).toMatchObject({ sufficient: false, availableAfterReserve: null,
      reasonCodes: ['AUTHORITATIVE_BALANCE_UNAVAILABLE'] });
  });
  it('does not accept an observation for another asset/network/wallet', async () => {
    balance.getWalletBalance.mockResolvedValueOnce(balanceRecord({ walletId: 'wallet-other' }));
    expect(await service().evaluateReserveSufficiency(params)).toMatchObject({ sufficient: false, dataCompleteness: 'UNKNOWN' });
  });
  it('does not default a missing wallet network to ethereum', async () => {
    wallets[0] = walletRecord({ networkId: null });
    expect(await service().evaluateReserveSufficiency({ ...params, networkId: null })).toMatchObject({ sufficient: false, availableAfterReserve: null,
      reasonCodes: ['WALLET_NETWORK_UNKNOWN'] });
    expect(balance.getWalletBalance).not.toHaveBeenCalled();
  });
  it('requires complete observations for every treasury wallet instead of returning a partially successful aggregate', async () => {
    wallets.push(walletRecord({ id: 'wallet-destination' }));
    balance.getWalletBalance.mockResolvedValueOnce(balanceRecord()).mockRejectedValueOnce(new Error('second wallet unavailable'));
    expect(await service().evaluateReserveSufficiency({ ...params, walletId: null })).toMatchObject({ sufficient: false, availableAfterReserve: null, dataCompleteness: 'UNKNOWN' });
  });
  it('keeps an empty treasury observation unknown rather than claiming measured zero funds', async () => {
    wallets = [];
    expect(await service().evaluateReserveSufficiency({ ...params, walletId: null })).toMatchObject({ sufficient: false, availableAfterReserve: null,
      reasonCodes: ['NO_AUTHORITATIVE_WALLET_OBSERVATION'] });
  });
  it.each(['0', '-1', '1suffix'])('rejects invalid requested amount %s', async (requestedAmount) => {
    await expect(service().evaluateReserveSufficiency({ ...params, requestedAmount })).rejects.toThrow(BadRequestException);
    expect(db.custodyReserve.findMany).not.toHaveBeenCalled();
  });
  it('uses only explicit configured policy basis points, with decimal-safe reserve arithmetic', async () => {
    policy.reserveRequirements.operationalReserveBps = 500; policy.reserveRequirements.withdrawalReserveBps = 500;
    expect(await service().evaluateReserveSufficiency(params)).toMatchObject({ sufficient: true, requiredReserve: '3', availableAfterReserve: '7' });
  });
  it('does not silently treat a gas reserve as the requested asset denomination', async () => {
    policy.reserveRequirements.gasReserveAmount = '0.01';
    await expect(service().evaluateReserveSufficiency(params)).rejects.toThrow('explicit native-asset evidence');
  });
});

describe('Custody decimal and redaction evidence boundaries', () => {
  it('preserves nested arrays and objects while removing secret values without asserting the original type', () => {
    expect(redactSecrets({ nested: [{ apiKey: 'not-a-real-secret', count: 2 }], note: 'safe' }))
      .toEqual({ nested: [{ apiKey: '[REDACTED]', count: 2 }], note: 'safe' });
  });
  it('rejects non-finite or circular JSON instead of converting evidence to null', () => {
    expect(() => custodyJsonInput({ count: Number.NaN })).toThrow('Non-finite');
    const cycle: Record<string, unknown> = {}; cycle.self = cycle;
    expect(() => custodyJsonInput(cycle)).toThrow('Circular');
  });
  it('rejects unrepresentable decimal precision rather than silently truncating transferred funds', () => {
    expect(() => parseScaled('0.0000000000001')).toThrow('precision exceeds');
    expect(add('1.0000000000000', '0.000000000001')).toBe('1.000000000001');
    expect(cmp('9007199254740993.01', '9007199254740993.00')).toBe(1);
  });
});


// # Responsibility: exercise complete Part6 custody observation and wallet boundaries with generated-model fixtures; these are units, not live chain/DB/RLS certification.
function addressRecord(overrides: Partial<CustodyWalletAddress> = {}): CustodyWalletAddress {
  return { id: 'address-1', tenantId: TENANT, walletId: 'wallet-source', assetId: 'ETH-ethereum', networkId: 'ethereum',
    address: 'unit-address-1', providerReference: 'unit-address-ref', creationSource: 'PROVIDER', status: 'ACTIVE', label: null,
    isDepositAddress: true, clientProfileId: null, accountId: null, verified: true, verifiedAt: NOW,
    metadata: {}, idempotencyKey: 'address-key', activatedAt: NOW, deprecatedAt: null, createdAt: NOW, updatedAt: NOW, ...overrides };
}
function auditRecord(): CustodyAudit {
  return { id: 'audit-1', tenantId: TENANT, walletId: 'wallet-source', action: 'WALLET_CREATED', entityType: 'CUSTODY_WALLET',
    entityId: 'wallet-source', actorId: null, actorType: null, fromState: null, toState: 'PENDING', reason: null, sourceType: null,
    sourceId: null, evidence: {}, metadata: {}, correlationId: null, idempotencyKey: null, createdAt: NOW };
}
function sweepRecord(overrides: Partial<CustodySweep> = {}): CustodySweep {
  return { id: 'sweep-1', tenantId: TENANT, sourceWalletId: 'wallet-source', destinationWalletId: 'wallet-destination',
    assetId: 'ETH-ethereum', networkId: 'ethereum', amount: '2', state: 'REQUESTED', providerReference: null, transactionId: null,
    operatorId: 'operator-1', approvedBy: null, reason: null, estimatedFee: null, actualFee: null, metadata: {}, evidence: {},
    idempotencyKey: 'sweep-key', requestedAt: NOW, approvedAt: null, submittedAt: null, settledAt: null, failedAt: null,
    createdAt: NOW, updatedAt: NOW, ...overrides };
}
function custodyDepositRecord(overrides: Partial<CustodyDeposit> = {}): CustodyDeposit {
  return { id: 'deposit-1', tenantId: TENANT, walletId: 'wallet-source', addressId: 'address-1', assetId: 'ETH-ethereum', networkId: 'ethereum',
    amount: '2', transactionHash: 'unit-chain-hash', blockHash: 'unit-block-hash', blockNumber: '100', fromAddress: 'unit-from',
    toAddress: 'unit-address-1', providerReference: 'unit-provider-receipt', state: 'CONFIRMED', confirmationCount: 12,
    requiredConfirmationCount: 12, isFinal: true, observedAt: NOW, confirmedAt: NOW, failedAt: null, failureReason: null,
    fundingRequestId: 'funding-1', metadata: {}, evidence: {}, idempotencyKey: 'deposit-key', createdAt: NOW, updatedAt: NOW, ...overrides };
}
function custodyWithdrawalRecord(overrides: Partial<CustodyWithdrawal> = {}): CustodyWithdrawal {
  return { id: 'withdrawal-1', tenantId: TENANT, walletId: 'wallet-source', accountId: 'account-1', assetId: 'ETH-ethereum', networkId: 'ethereum',
    amount: '2', destinationAddress: 'unit-destination', destinationType: 'EXTERNAL', transactionHash: 'unit-chain-hash',
    providerReference: 'unit-provider-receipt', state: 'CONFIRMED', fundingRequestId: null, withdrawalRequestId: 'withdrawal-request-1',
    approvedBy: 'approver-1', submittedBy: 'operator-1', estimatedFee: null, actualFee: null, feeAsset: null, confirmationCount: 12,
    requiredConfirmationCount: 12, failureReason: null, metadata: {}, evidence: {}, idempotencyKey: 'withdrawal-key',
    requestedAt: NOW, approvedAt: NOW, submittedAt: NOW, confirmedAt: NOW, failedAt: null, createdAt: NOW, updatedAt: NOW, ...overrides };
}
function custodyTransactionRecord(overrides: Partial<CustodyTransaction> = {}): CustodyTransaction {
  return { id: 'transaction-1', tenantId: TENANT, walletId: 'wallet-source', assetId: 'ETH-ethereum', networkId: 'ethereum', direction: 'IN',
    amount: '2', transactionHash: 'unit-chain-hash', blockHash: 'unit-block-hash', blockNumber: '100', providerReference: 'unit-provider-receipt',
    providerMetadata: null, status: 'CONFIRMED', confirmationCount: 12, requiredConfirmationCount: 12, estimatedFee: null, actualFee: null,
    feeAsset: null, feeReference: null, sourceWorkflowType: null, sourceWorkflowId: null, depositId: 'deposit-1', withdrawalId: null,
    observedAt: NOW, submittedAt: NOW, confirmedAt: NOW, failedAt: null, failureReason: null, isReorged: false, reorgedAt: null,
    metadata: {}, evidence: {}, idempotencyKey: 'transaction-key', createdAt: NOW, updatedAt: NOW, ...overrides };
}
function fundingRequestRecord(overrides: Partial<FundingRequest> = {}): FundingRequest {
  return { id: 'funding-1', tenantId: TENANT, clientProfileId: null, accountId: 'account-1', state: 'SUBMITTED', requestedAmount: '2',
    approvedAmount: '2', submittedAmount: '2', confirmedAmount: null, settledAmount: null, currency: 'ETH', externalReference: null,
    sourceType: null, sourceId: null, requestedBy: 'operator-1', approvedBy: 'approver-1', approvalPolicyVersion: 'unit-policy',
    calculationVersion: 'client-lifecycle-v1.0.0', failureReason: null, reversalReason: null, metadata: {}, evidence: {}, idempotencyKey: 'funding-key', requestedAt: NOW, approvedAt: NOW,
    submittedAt: NOW, confirmedAt: null, failedAt: null, createdAt: NOW, updatedAt: NOW, ...overrides };
}
function withdrawalRequestRecord(overrides: Partial<WithdrawalRequest> = {}): WithdrawalRequest {
  const funding = fundingRequestRecord();
  return { ...funding, id: 'withdrawal-request-1', destinationAddress: 'unit-destination', destinationType: 'EXTERNAL',
    complianceCheckId: null, riskCheckId: null, securityCheckId: null, ...overrides };
}
function institutionalRecord(overrides: Partial<InstitutionalAccount> = {}): InstitutionalAccount {
  return { id: 'account-1', tenantId: TENANT, clientProfileId: null, accountType: 'TRADING', state: 'ACTIVE', displayName: 'Unit account',
    ownerId: 'owner-a', ownerType: 'USER', exchangeAccountId: null, portfolioId: null, isTradingEnabled: false, isFundingEnabled: true,
    isWithdrawalEnabled: true, tradingEligibility: null, eligibilityEvidence: null, blockingReasons: [], complianceStatus: 'CLEAR',
    riskStatus: 'CLEAR', securityStatus: 'CLEAR', metadata: {}, idempotencyKey: 'account-key', activatedAt: NOW, suspendedAt: null,
    closedAt: null, createdAt: NOW, updatedAt: NOW, deletedAt: null, ...overrides };
}

describe('Complete Part6 treasury observations', () => {
  let module: TestingModule; let wallets: CustodyWallet[]; let addresses: CustodyWalletAddress[];
  const db = { withTenantRls: async (_tenant: string, work: (tx: any) => Promise<any>) => work(db), custodyWallet: {
    findFirst: jest.fn<(args: Prisma.CustodyWalletFindFirstArgs) => Promise<CustodyWallet | null>>(),
    findMany: jest.fn<(args: Prisma.CustodyWalletFindManyArgs) => Promise<CustodyWallet[]>>(),
    count: jest.fn<(args: Prisma.CustodyWalletCountArgs) => Promise<number>>(),
  }, custodyAsset: { findFirst: jest.fn<(args: Prisma.CustodyAssetFindFirstArgs) => Promise<CustodyAsset | null>>() },
  custodyWalletAddress: { findMany: jest.fn<(args: Prisma.CustodyWalletAddressFindManyArgs) => Promise<CustodyWalletAddress[]>>() } };
  const getBalance = jest.fn<BlockchainProvider['getBalance']>();
  const factory = { getProviderForNetwork: jest.fn<BlockchainProviderFactory['getProviderForNetwork']>() };
  const params = { tenantId: TENANT, walletId: 'wallet-source', assetId: 'ETH-ethereum', networkId: 'ethereum' };
  beforeEach(async () => {
    wallets = [walletRecord()]; addresses = [addressRecord()];
    db.custodyWallet.findFirst.mockReset().mockImplementation(async (args) => wallets.find((row) => rowMatches(row, args.where)) ?? null);
    db.custodyWallet.findMany.mockReset().mockImplementation(async (args) => wallets.filter((row) => rowMatches(row, args.where)));
    db.custodyWallet.count.mockReset().mockImplementation(async (args) => wallets.filter((row) => rowMatches(row, args.where)).length);
    db.custodyAsset.findFirst.mockReset().mockResolvedValue(assetRecord());
    db.custodyWalletAddress.findMany.mockReset().mockImplementation(async (args) => addresses.filter((row) => rowMatches(row, args.where)));
    getBalance.mockReset().mockImplementation(async (input) => balanceRecord({ walletId: input.walletId ?? '', available: '1', sourceReference: `observation:${input.address}` }));
    factory.getProviderForNetwork.mockReset().mockResolvedValue(unitProvider({ getCapabilities: async () => capabilities({ canGetBalance: true }), getBalance }));
    module = await Test.createTestingModule({ providers: [TreasuryBalanceService, { provide: PrismaService, useValue: db },
      { provide: BlockchainProviderFactory, useValue: factory } ] }).compile();
  });
  afterEach(async () => { await module.close(); });
  function service() { return module.get<TreasuryBalanceService>(TreasuryBalanceService); }
  it('does not turn a missing address into measured zero', async () => {
    addresses = [];
    expect(await service().getWalletBalance(params)).toMatchObject({ available: null, dataCompleteness: 'UNKNOWN_NO_ADDRESS' });
    expect(getBalance).not.toHaveBeenCalled();
  });
  it('propagates a required address-index read failure instead of claiming no addresses', async () => {
    const failure = new Error('address index unavailable'); db.custodyWalletAddress.findMany.mockRejectedValueOnce(failure);
    await expect(service().getWalletBalance(params)).rejects.toBe(failure);
  });
  it('requires registered asset symbol evidence rather than splitting the asset id', async () => {
    db.custodyAsset.findFirst.mockResolvedValueOnce(null);
    await expect(service().getWalletBalance(params)).rejects.toThrow('Authoritative asset identity unavailable');
    expect(getBalance).not.toHaveBeenCalled();
  });
  it('does not query a balance provider that disclaims the required capability', async () => {
    factory.getProviderForNetwork.mockResolvedValueOnce(unitProvider({ getBalance }));
    expect(await service().getWalletBalance(params)).toMatchObject({ available: null, dataCompleteness: 'UNKNOWN_PROVIDER_CAPABILITY' });
    expect(getBalance).not.toHaveBeenCalled();
  });
  it('inspects every active address, including addresses beyond the former ten-address cap', async () => {
    addresses = Array.from({ length: 11 }, (_, index) => addressRecord({ id: `address-${index}`, address: `unit-address-${index}` }));
    expect(await service().getWalletBalance(params)).toMatchObject({ available: '11', dataCompleteness: 'PROVIDER_DERIVED' });
    expect(getBalance).toHaveBeenCalledTimes(11);
    expect(db.custodyWalletAddress.findMany).toHaveBeenCalledWith({ where: expect.objectContaining({ tenantId: TENANT, walletId: 'wallet-source' }), orderBy: { id: 'asc' } });
  });
  it('invalidates the complete aggregate when a later address is unavailable', async () => {
    addresses.push(addressRecord({ id: 'address-2', address: 'unit-address-2' }));
    getBalance.mockResolvedValueOnce(balanceRecord({ available: '10' })).mockRejectedValueOnce(new Error('provider unavailable'));
    expect(await service().getWalletBalance(params)).toMatchObject({ available: null, dataCompleteness: 'UNKNOWN_INCOMPLETE_ADDRESS_OBSERVATIONS' });
  });
  const invalid: Array<[string, Partial<BalanceObservation>]> = [
    ['wrong wallet', { walletId: 'wallet-other' }], ['wrong asset', { assetId: 'BTC-bitcoin' }], ['wrong symbol', { assetSymbol: 'BTC' }],
    ['wrong network', { networkId: 'bitcoin' }], ['wrong provider', { provider: 'other-provider' }], ['unknown balance', { available: null }],
    ['partial balance', { dataCompleteness: 'PARTIAL_UNKNOWN' }], ['missing provenance', { sourceReference: '' }],
    ['invalid timestamp', { observationTimestamp: 'not-a-date' }], ['negative funds', { available: '-1' }],
  ];
  it.each(invalid)('does not accept a %s observation as complete funds', async (_label, overrides) => {
    getBalance.mockResolvedValueOnce(balanceRecord(overrides));
    expect(await service().getWalletBalance(params)).toMatchObject({ available: null, dataCompleteness: 'UNKNOWN_INVALID_PROVIDER_OBSERVATION' });
  });
  it('preserves a genuine provider-observed zero, unlike an unavailable observation', async () => {
    getBalance.mockResolvedValueOnce(balanceRecord({ available: '0' }));
    expect(await service().getWalletBalance(params)).toMatchObject({ available: '0', dataCompleteness: 'PROVIDER_DERIVED' });
  });
  it('rejects duplicate active address evidence rather than double counting it', async () => {
    addresses.push(addressRecord({ id: 'duplicate' }));
    await expect(service().getWalletBalance(params)).rejects.toThrow('Duplicate or invalid');
  });
  it('keeps a no-wallet treasury balance unknown', async () => {
    wallets = [];
    expect(await service().getTreasuryBalance({ tenantId: TENANT, assetId: 'ETH-ethereum' })).toEqual({ totalAvailable: null, balances: [], dataCompleteness: 'UNKNOWN_NO_WALLET' });
  });
  it('includes every treasury wallet beyond the former one-hundred-wallet cap', async () => {
    wallets = Array.from({ length: 101 }, (_, index) => walletRecord({ id: `wallet-${index}` }));
    addresses = wallets.map((wallet, index) => addressRecord({ id: `address-${index}`, walletId: wallet.id, address: `unit-address-${index}` }));
    const result = await service().getTreasuryBalance({ tenantId: TENANT, assetId: 'ETH-ethereum' });
    expect(result).toMatchObject({ totalAvailable: '101', dataCompleteness: 'PROVIDER_DERIVED' }); expect(result.balances).toHaveLength(101);
    expect(db.custodyWallet.findMany).toHaveBeenCalledWith({ where: { tenantId: TENANT, assetId: 'ETH-ethereum', state: 'ACTIVE' }, orderBy: { id: 'asc' } });
  });
  it('does not present a partially readable treasury as a complete total', async () => {
    wallets.push(walletRecord({ id: 'wallet-second' }));
    expect(await service().getTreasuryBalance({ tenantId: TENANT, assetId: 'ETH-ethereum' })).toMatchObject({ totalAvailable: null, dataCompleteness: 'PARTIAL_UNKNOWN' });
  });
  it('retains unknown wallet identities in the paginated list rather than silently dropping rows', async () => {
    wallets.push(walletRecord({ id: 'wallet-unknown', assetId: null, networkId: null }));
    const result = await service().listBalances({ tenantId: TENANT });
    expect(result.total).toBe(2); expect(result.data).toHaveLength(2);
    expect(result.data[1]).toMatchObject({ walletId: 'wallet-unknown', available: null, dataCompleteness: 'UNKNOWN_WALLET_IDENTITY' });
  });
  it('does not observe a wallet from another tenant', async () => {
    wallets = [walletRecord({ tenantId: OTHER_TENANT })];
    await expect(service().getWalletBalance(params)).rejects.toThrow(BadRequestException);
    expect(getBalance).not.toHaveBeenCalled();
  });
});

describe('Part6 native wallet persistence and metadata rejection', () => {
  let module: TestingModule;
  const db = { custodyWallet: {
    findFirst: jest.fn<(args: Prisma.CustodyWalletFindFirstArgs) => Promise<CustodyWallet | null>>(),
    create: jest.fn<(args: Prisma.CustodyWalletCreateArgs) => Promise<CustodyWallet>>(),
    update: jest.fn<(args: Prisma.CustodyWalletUpdateArgs) => Promise<CustodyWallet>>(),
    findMany: jest.fn<(args: Prisma.CustodyWalletFindManyArgs) => Promise<CustodyWallet[]>>(),
    count: jest.fn<(args: Prisma.CustodyWalletCountArgs) => Promise<number>>(),
  } };
  const params = { tenantId: TENANT, assetId: 'ETH-ethereum', networkId: 'ethereum' };
  beforeEach(async () => {
    db.custodyWallet.findFirst.mockReset().mockResolvedValue(null); db.custodyWallet.create.mockReset().mockResolvedValue(walletRecord({ state: 'PENDING', isActive: false }));
    db.custodyWallet.update.mockReset().mockResolvedValue(walletRecord({ state: 'SUSPENDED', isActive: false }));
    db.custodyWallet.findMany.mockReset().mockResolvedValue([]); db.custodyWallet.count.mockReset().mockResolvedValue(0);
    module = await Test.createTestingModule({ providers: [WalletRepository, { provide: PrismaService, useValue: db }] }).compile();
  });
  afterEach(async () => { await module.close(); });
  function repository() { return module.get<WalletRepository>(WalletRepository); }
  it.each(['private_key', 'seedPhrase', 'mnemonic', 'apiKey', 'secret'])('rejects nested raw %s even when its value is empty', async (key) => {
    await expect(repository().createWallet({ ...params, metadata: { nested: [{ [key]: '' }] } })).rejects.toThrow('cannot be persisted');
    expect(db.custodyWallet.findFirst).not.toHaveBeenCalled(); expect(db.custodyWallet.create).not.toHaveBeenCalled();
  });
  it('rejects circular metadata without an unchecked JSON/cast path', () => {
    const metadata: Record<string, unknown> = {}; metadata.self = metadata;
    expect(() => assertSafeWalletMetadata(metadata)).toThrow('Circular');
  });
  it('propagates idempotency-read failure rather than creating a duplicate', async () => {
    const failure = new Error('idempotency unavailable'); db.custodyWallet.findFirst.mockRejectedValueOnce(failure);
    await expect(repository().createWallet(params)).rejects.toBe(failure); expect(db.custodyWallet.create).not.toHaveBeenCalled();
  });
  it('rejects conflicting existing wallet ownership/identity', async () => {
    db.custodyWallet.findFirst.mockResolvedValueOnce(walletRecord({ assetId: 'BTC-bitcoin' }));
    await expect(repository().createWallet(params)).rejects.toThrow('Conflicting idempotent wallet identity');
    expect(db.custodyWallet.create).not.toHaveBeenCalled();
  });
  it('rejects an unrecognized scope instead of casting it into the native enum', async () => {
    await expect(repository().createWallet({ ...params, scope: 'ROOT' })).rejects.toThrow('Invalid wallet identity/scope');
    expect(db.custodyWallet.create).not.toHaveBeenCalled();
  });
  it('includes tenant and the expected current state in a wallet mutation', async () => {
    await repository().updateWalletState({ tenantId: TENANT, walletId: 'wallet-source', expectedState: 'ACTIVE', state: 'SUSPENDED', isActive: false });
    expect(db.custodyWallet.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'wallet-source', tenantId: TENANT, state: 'ACTIVE' }, data: expect.objectContaining({ state: 'SUSPENDED', isActive: false }) }));
  });
  it('rejects an invalid persisted-state filter before querying the wallet list', async () => {
    await expect(repository().listWallets({ tenantId: TENANT, state: 'ROOT' })).rejects.toThrow('Invalid wallet state');
    expect(db.custodyWallet.findMany).not.toHaveBeenCalled();
  });
});


describe('Part6 exact wallet capability and safe public views', () => {
  let module: TestingModule;
  const repository = { createWallet: jest.fn<WalletRepository['createWallet']>(), getWallet: jest.fn<WalletRepository['getWallet']>(),
    updateWalletState: jest.fn<WalletRepository['updateWalletState']>(), listWallets: jest.fn<WalletRepository['listWallets']>() };
  const supported = { isAssetSupported: jest.fn<CustodyPolicyService['isAssetSupported']>() };
  const asset = { isAssetSupported: jest.fn<AssetRegistryService['isAssetSupported']>() };
  const network = { isNetworkSupported: jest.fn<NetworkRegistryService['isNetworkSupported']>() };
  const audit = { log: jest.fn<(input: Parameters<CustodyAuditService['log']>[0]) => Promise<CustodyAudit | null>>() };
  const factory = { getProviderById: jest.fn<BlockchainProviderFactory['getProviderById']>() };
  const params = { tenantId: TENANT, assetId: 'ETH-ethereum', networkId: 'ethereum' };
  beforeEach(async () => {
    repository.createWallet.mockReset().mockResolvedValue(walletRecord({ state: 'PENDING', isActive: false }));
    repository.getWallet.mockReset().mockResolvedValue(walletRecord()); repository.updateWalletState.mockReset().mockResolvedValue(walletRecord({ state: 'SUSPENDED', isActive: false }));
    repository.listWallets.mockReset().mockResolvedValue({ data: [walletRecord()], total: 1, page: 1, limit: 50 });
    supported.isAssetSupported.mockReset().mockResolvedValue(true); asset.isAssetSupported.mockReset().mockResolvedValue(true);
    network.isNetworkSupported.mockReset().mockResolvedValue(true); audit.log.mockReset().mockResolvedValue(auditRecord());
    factory.getProviderById.mockReset().mockResolvedValue(unitProvider());
    module = await Test.createTestingModule({ providers: [WalletService, { provide: PrismaService, useValue: {} },
      { provide: WalletRepository, useValue: repository }, { provide: CustodyPolicyService, useValue: supported },
      { provide: AssetRegistryService, useValue: asset }, { provide: NetworkRegistryService, useValue: network },
      { provide: CustodyAuditService, useValue: audit }, { provide: BlockchainProviderFactory, useValue: factory },
    ] }).compile();
  });
  afterEach(async () => { await module.close(); });
  function service() { return module.get<WalletService>(WalletService); }
  it('rejects substring-lookalike assets rather than authorizing policy fallback', async () => {
    asset.isAssetSupported.mockResolvedValueOnce(false);
    await expect(service().createWallet({ ...params, assetId: 'FAKE-ETH-lookalike' })).rejects.toThrow('Unsupported registered asset/network');
    expect(repository.createWallet).not.toHaveBeenCalled();
  });
  it('propagates failed capability evidence instead of using policy defaults', async () => {
    const failure = new Error('asset registry unavailable'); asset.isAssetSupported.mockRejectedValueOnce(failure);
    await expect(service().createWallet(params)).rejects.toBe(failure); expect(repository.createWallet).not.toHaveBeenCalled();
  });
  it('rejects nested private-key material before writing a wallet', async () => {
    await expect(service().createWallet({ ...params, metadata: { nested: { privateKey: '' } } })).rejects.toThrow('cannot be persisted');
    expect(repository.createWallet).not.toHaveBeenCalled();
  });
  it('does not return encrypted secret references, fingerprints or provider-private metadata', async () => {
    repository.getWallet.mockResolvedValueOnce(walletRecord({ encryptedSecretReference: 'unit-secret-pointer', credentialFingerprint: 'unit-private-fingerprint',
      providerMetadata: { internal: 'private' }, metadata: { apiKey: 'unit-credential', note: 'safe' } }));
    const view = await service().getWallet({ tenantId: TENANT, walletId: 'wallet-source' });
    expect(view).not.toHaveProperty('encryptedSecretReference'); expect(view).not.toHaveProperty('credentialFingerprint'); expect(view).not.toHaveProperty('providerMetadata');
    expect(view?.metadata).toEqual({ apiKey: '[REDACTED]', note: 'safe' });
  });
  it('does not call a transition successful when its required audit was not recorded', async () => {
    audit.log.mockResolvedValueOnce(null);
    await expect(service().transitionWallet({ tenantId: TENANT, walletId: 'wallet-source', toState: CustodyWalletState.SUSPENDED })).rejects.toThrow(ServiceUnavailableException);
  });
  it('preserves conditional tenant/current-state writes on a valid non-activation transition', async () => {
    await service().transitionWallet({ tenantId: TENANT, walletId: 'wallet-source', toState: CustodyWalletState.SUSPENDED });
    expect(repository.updateWalletState).toHaveBeenCalledWith({ tenantId: TENANT, walletId: 'wallet-source', expectedState: 'ACTIVE', state: 'SUSPENDED', isActive: false });
  });
  it('does not turn a provider name alone into wallet activation capability', async () => {
    repository.getWallet.mockResolvedValueOnce(walletRecord({ state: 'PENDING', isActive: false }));
    await expect(service().transitionWallet({ tenantId: TENANT, walletId: 'wallet-source', toState: CustodyWalletState.ACTIVE })).rejects.toThrow('healthy, exact provider wallet capability');
    expect(repository.updateWalletState).not.toHaveBeenCalled();
  });
});

describe('Part6 withdrawal eligibility never fabricates passed security/approval checks', () => {
  let module: TestingModule; let policy: CustodyPolicy;
  const db = {
    custodyWallet: { findFirst: jest.fn<(args: Prisma.CustodyWalletFindFirstArgs) => Promise<CustodyWallet | null>>() },
    institutionalAccount: { findFirst: jest.fn<(args: Prisma.InstitutionalAccountFindFirstArgs) => Promise<InstitutionalAccount | null>>() },
    accountRestriction: { findMany: jest.fn<(args: Prisma.AccountRestrictionFindManyArgs) => Promise<never[]>>() },
    custodyWalletAddress: { findFirst: jest.fn<(args: Prisma.CustodyWalletAddressFindFirstArgs) => Promise<CustodyWalletAddress | null>>() },
    custodyWithdrawal: { count: jest.fn<(args: Prisma.CustodyWithdrawalCountArgs) => Promise<number>>() },
    operationalMaintenanceWindow: { findFirst: jest.fn<(args: Prisma.OperationalMaintenanceWindowFindFirstArgs) => Promise<null>>() },
  };
  const balance = { getWalletBalance: jest.fn<TreasuryBalanceService['getWalletBalance']>() };
  const reserve = { evaluateReserveSufficiency: jest.fn<ReserveManagementService['evaluateReserveSufficiency']>() };
  const params = { tenantId: TENANT, accountId: 'account-1', walletId: 'wallet-source', assetId: 'ETH-ethereum', networkId: 'ethereum', amount: '2', destinationAddress: 'unit-destination', operatorId: 'operator-1' };
  beforeEach(async () => {
    policy = policyRecord(); db.custodyWallet.findFirst.mockReset().mockResolvedValue(walletRecord({ accountId: 'account-1' }));
    db.institutionalAccount.findFirst.mockReset().mockResolvedValue(institutionalRecord()); db.accountRestriction.findMany.mockReset().mockResolvedValue([]);
    db.custodyWalletAddress.findFirst.mockReset().mockResolvedValue(addressRecord({ address: 'unit-destination' }));
    db.custodyWithdrawal.count.mockReset().mockResolvedValue(0); db.operationalMaintenanceWindow.findFirst.mockReset().mockResolvedValue(null);
    balance.getWalletBalance.mockReset().mockResolvedValue(balanceRecord());
    reserve.evaluateReserveSufficiency.mockReset().mockResolvedValue({ sufficient: true, requiredReserve: '0', availableAfterReserve: '10',
      blockingReserves: [], dataCompleteness: 'PROVIDER_DERIVED', reasonCodes: [] });
    module = await Test.createTestingModule({ providers: [WithdrawalPolicyService, { provide: PrismaService, useValue: db },
      { provide: CustodyPolicyService, useValue: { resolvePolicy: jest.fn<CustodyPolicyService['resolvePolicy']>().mockImplementation(async () => policy) } },
      { provide: AssetRegistryService, useValue: { isAssetSupported: jest.fn<AssetRegistryService['isAssetSupported']>().mockResolvedValue(true) } },
      { provide: NetworkRegistryService, useValue: { isNetworkSupported: jest.fn<NetworkRegistryService['isNetworkSupported']>().mockResolvedValue(true) } },
      { provide: TreasuryBalanceService, useValue: balance }, { provide: ReserveManagementService, useValue: reserve },
    ] }).compile();
  });
  afterEach(async () => { await module.close(); });
  function service() { return module.get<WithdrawalPolicyService>(WithdrawalPolicyService); }
  async function failed(check: string): Promise<boolean | undefined> { return (await service().evaluateWithdrawalEligibility(params)).checks.find((item) => item.check === check)?.passed; }
  it('keeps unwired session MFA and linked approvals blocked despite supplied operator/account ids', async () => {
    const result = await service().evaluateWithdrawalEligibility(params);
    expect(result.eligible).toBe(false); expect(result.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ check: 'securityMfa', passed: false }), expect.objectContaining({ check: 'approvalExists', passed: false }),
      expect.objectContaining({ check: 'sufficientBalance', passed: true }), expect.objectContaining({ check: 'reservePolicy', passed: true }),
    ]));
  });
  it('blocks a failed restriction read rather than omitting its failure', async () => {
    db.accountRestriction.findMany.mockRejectedValueOnce(new Error('restrictions unavailable'));
    expect(await failed('clientAccountEvidence')).toBe(false);
  });
  it('does not pass compliance/risk for an absent account', async () => {
    db.institutionalAccount.findFirst.mockResolvedValueOnce(null);
    const result = await service().evaluateWithdrawalEligibility(params);
    expect(result.checks).toEqual(expect.arrayContaining([expect.objectContaining({ check: 'complianceAllows', passed: false }), expect.objectContaining({ check: 'riskAllows', passed: false })]));
  });
  it('requires the native account withdrawal-enable flag, not only ACTIVE state', async () => {
    db.institutionalAccount.findFirst.mockResolvedValueOnce(institutionalRecord({ isWithdrawalEnabled: false }));
    expect(await failed('clientAccountActive')).toBe(false);
  });
  it('does not count unavailable balances as a passed sufficient-balance check', async () => {
    balance.getWalletBalance.mockResolvedValueOnce(balanceRecord({ available: null, dataCompleteness: 'UNKNOWN' }));
    expect(await failed('sufficientBalance')).toBe(false);
  });
  it('does not accept an unknown reserve calculation even if an adapter wrongly says sufficient', async () => {
    reserve.evaluateReserveSufficiency.mockResolvedValueOnce({ sufficient: true, requiredReserve: '0', availableAfterReserve: null,
      blockingReserves: [], dataCompleteness: 'UNKNOWN', reasonCodes: ['UNKNOWN'] });
    expect(await failed('reservePolicy')).toBe(false);
  });
  it('blocks an unread maintenance table instead of declaring no maintenance', async () => {
    db.operationalMaintenanceWindow.findFirst.mockRejectedValueOnce(new Error('maintenance unavailable'));
    expect(await failed('noMaintenanceRestriction')).toBe(false);
  });
  it('binds a required verified allowlist lookup to the exact tenant, asset and network', async () => {
    policy.addressAllowlisting.requireAllowlist = true;
    await service().evaluateWithdrawalEligibility(params);
    expect(db.custodyWalletAddress.findFirst).toHaveBeenCalledWith({ where: { tenantId: TENANT, address: 'unit-destination', assetId: 'ETH-ethereum', networkId: 'ethereum', status: 'ACTIVE', verified: true } });
  });
  it('does not make a configured but unwired daily limit a passed check', async () => {
    policy.withdrawalLimits.maxDailyWithdrawal = '100';
    expect(await failed('dailyWithdrawalLimit')).toBe(false);
  });
  it.each(['0', '-2', '2suffix'])('does not authorize invalid amount %s', async (amount) => {
    const result = await service().evaluateWithdrawalEligibility({ ...params, amount });
    expect(result.eligible).toBe(false); expect(result.checks).toContainEqual(expect.objectContaining({ check: 'positiveAmount', passed: false }));
    expect(balance.getWalletBalance).not.toHaveBeenCalled(); expect(reserve.evaluateReserveSufficiency).not.toHaveBeenCalled();
  });
});


describe('Part6 sweeps preserve intent without simulated settlement', () => {
  let module: TestingModule; let sweep: CustodySweep | null;
  const db = { custodyWallet: { findFirst: jest.fn<(args: Prisma.CustodyWalletFindFirstArgs) => Promise<CustodyWallet | null>>() },
    custodySweep: { findFirst: jest.fn<(args: Prisma.CustodySweepFindFirstArgs) => Promise<CustodySweep | null>>(),
      create: jest.fn<(args: Prisma.CustodySweepCreateArgs) => Promise<CustodySweep>>(), update: jest.fn<(args: Prisma.CustodySweepUpdateArgs) => Promise<CustodySweep>>() },
    operationalMaintenanceWindow: { findFirst: jest.fn<(args: Prisma.OperationalMaintenanceWindowFindFirstArgs) => Promise<null>>() } };
  const reserve = { evaluateReserveSufficiency: jest.fn<ReserveManagementService['evaluateReserveSufficiency']>() };
  const policy = { evaluateWithdrawalEligibility: jest.fn<WithdrawalPolicyService['evaluateWithdrawalEligibility']>() };
  const submitTransaction = jest.fn<NonNullable<BlockchainProvider['submitTransaction']>>();
  const factory = { getProviderForNetwork: jest.fn<BlockchainProviderFactory['getProviderForNetwork']>() };
  const audit = { log: jest.fn<(input: Parameters<CustodyAuditService['log']>[0]) => Promise<CustodyAudit | null>>() };
  const params = { tenantId: TENANT, sourceWalletId: 'wallet-source', destinationWalletId: 'wallet-destination', assetId: 'ETH-ethereum', networkId: 'ethereum', amount: '2', operatorId: 'operator-1' };
  beforeEach(async () => {
    sweep = null;
    db.custodyWallet.findFirst.mockReset().mockImplementation(async (args) => [walletRecord(), walletRecord({ id: 'wallet-destination' })].find((row) => rowMatches(row, args.where)) ?? null);
    db.custodySweep.findFirst.mockReset().mockImplementation(async (args) => sweep && rowMatches(sweep, args.where) ? sweep : null);
    db.custodySweep.create.mockReset().mockResolvedValue(sweepRecord()); db.custodySweep.update.mockReset().mockResolvedValue(sweepRecord({ state: 'APPROVED', approvedBy: 'approver-1' }));
    db.operationalMaintenanceWindow.findFirst.mockReset().mockResolvedValue(null);
    reserve.evaluateReserveSufficiency.mockReset().mockResolvedValue({ sufficient: true, requiredReserve: '0', availableAfterReserve: '10', blockingReserves: [], dataCompleteness: 'PROVIDER_DERIVED', reasonCodes: [] });
    policy.evaluateWithdrawalEligibility.mockReset().mockResolvedValue({ eligible: true, checks: [], blockingReasons: [] });
    submitTransaction.mockReset().mockResolvedValue({ transactionHash: 'unit-provider-hash', providerReference: 'unit-provider-reference' });
    factory.getProviderForNetwork.mockReset().mockResolvedValue(unitProvider({ getCapabilities: async () => capabilities({ canSubmitTransaction: true }), submitTransaction }));
    audit.log.mockReset().mockResolvedValue(auditRecord());
    module = await Test.createTestingModule({ providers: [SweepService, { provide: PrismaService, useValue: db }, { provide: CustodyAuditService, useValue: audit },
      { provide: ReserveManagementService, useValue: reserve }, { provide: WithdrawalPolicyService, useValue: policy }, { provide: BlockchainProviderFactory, useValue: factory },
    ] }).compile();
  });
  afterEach(async () => { await module.close(); });
  function service() { return module.get<SweepService>(SweepService); }
  it('does not invent a settlement reference or timestamps when the sweep bridge is absent', async () => {
    sweep = sweepRecord({ state: 'APPROVED', approvedBy: 'approver-1' });
    await expect(service().executeSweep({ tenantId: TENANT, sweepId: 'sweep-1' })).rejects.toThrow(ServiceUnavailableException);
    expect(db.custodySweep.update).not.toHaveBeenCalled(); expect(submitTransaction).not.toHaveBeenCalled(); expect(audit.log).not.toHaveBeenCalled();
    expect(sweep).toMatchObject({ state: 'APPROVED', providerReference: null, submittedAt: null, settledAt: null });
  });
  it('does not execute a sweep belonging to another tenant', async () => {
    sweep = sweepRecord({ tenantId: OTHER_TENANT, state: 'APPROVED' });
    await expect(service().executeSweep({ tenantId: TENANT, sweepId: 'sweep-1' })).rejects.toThrow('Sweep not found');
    expect(factory.getProviderForNetwork).not.toHaveBeenCalled();
  });
  it('propagates a required maintenance-read failure rather than creating a sweep', async () => {
    const failure = new Error('maintenance unavailable'); db.operationalMaintenanceWindow.findFirst.mockRejectedValueOnce(failure);
    await expect(service().createSweep(params)).rejects.toBe(failure); expect(db.custodySweep.create).not.toHaveBeenCalled();
  });
  it('propagates an idempotency-read failure rather than creating a duplicate', async () => {
    const failure = new Error('sweep lookup unavailable'); db.custodySweep.findFirst.mockRejectedValueOnce(failure);
    await expect(service().createSweep(params)).rejects.toBe(failure); expect(db.custodySweep.create).not.toHaveBeenCalled();
  });
  it('retains every required policy denial even when the destination is an internal wallet', async () => {
    policy.evaluateWithdrawalEligibility.mockResolvedValueOnce({ eligible: false, blockingReasons: ['MFA unavailable'], checks: [{ check: 'securityMfa', passed: false, reason: 'MFA unavailable' }] });
    await expect(service().createSweep(params)).rejects.toThrow('MFA unavailable'); expect(db.custodySweep.create).not.toHaveBeenCalled();
  });
  it('persists the independent approver with tenant/current-state predicates', async () => {
    sweep = sweepRecord();
    await service().approveSweep({ tenantId: TENANT, sweepId: 'sweep-1', approverId: 'approver-1' });
    expect(db.custodySweep.update).toHaveBeenCalledWith({ where: { id: 'sweep-1', tenantId: TENANT, state: 'REQUESTED' },
      data: { state: 'APPROVED', approvedAt: expect.any(Date), approvedBy: 'approver-1' } });
  });
  it('does not approve a request with its own requesting operator id', async () => {
    sweep = sweepRecord();
    await expect(service().approveSweep({ tenantId: TENANT, sweepId: 'sweep-1', approverId: 'operator-1' })).rejects.toThrow('independent approver');
    expect(db.custodySweep.update).not.toHaveBeenCalled();
  });
  it.each(['0', '-1', '2suffix'])('rejects invalid sweep amount %s before any persistence', async (amount) => {
    await expect(service().createSweep({ ...params, amount })).rejects.toThrow(BadRequestException); expect(db.custodyWallet.findFirst).not.toHaveBeenCalled();
  });
});

describe('Part6 required native settlement evidence and transactional bridge', () => {
  let module: TestingModule; let deposit: CustodyDeposit | null; let withdrawal: CustodyWithdrawal | null;
  let transaction: CustodyTransaction | null; let funding: FundingRequest | null; let withdrawalRequest: WithdrawalRequest | null;
  const tx = {
    $executeRaw: jest.fn<(...args: unknown[]) => Promise<number>>(),
    custodyDeposit: { findFirst: jest.fn<(args: Prisma.CustodyDepositFindFirstArgs) => Promise<CustodyDeposit | null>>(), updateMany: jest.fn<(args: Prisma.CustodyDepositUpdateManyArgs) => Promise<Prisma.BatchPayload>>() },
    custodyWithdrawal: { findFirst: jest.fn<(args: Prisma.CustodyWithdrawalFindFirstArgs) => Promise<CustodyWithdrawal | null>>(), updateMany: jest.fn<(args: Prisma.CustodyWithdrawalUpdateManyArgs) => Promise<Prisma.BatchPayload>>() },
    custodyTransaction: { findFirst: jest.fn<(args: Prisma.CustodyTransactionFindFirstArgs) => Promise<CustodyTransaction | null>>(), updateMany: jest.fn<(args: Prisma.CustodyTransactionUpdateManyArgs) => Promise<Prisma.BatchPayload>>() },
    fundingRequest: { findFirst: jest.fn<(args: Prisma.FundingRequestFindFirstArgs) => Promise<FundingRequest | null>>(), updateMany: jest.fn<(args: Prisma.FundingRequestUpdateManyArgs) => Promise<Prisma.BatchPayload>>() },
    withdrawalRequest: { findFirst: jest.fn<(args: Prisma.WithdrawalRequestFindFirstArgs) => Promise<WithdrawalRequest | null>>(), updateMany: jest.fn<(args: Prisma.WithdrawalRequestUpdateManyArgs) => Promise<Prisma.BatchPayload>>() },
    custodyWallet: { findFirst: jest.fn<(args: Prisma.CustodyWalletFindFirstArgs) => Promise<CustodyWallet | null>>() },
    custodyAsset: { findFirst: jest.fn<(args: Prisma.CustodyAssetFindFirstArgs) => Promise<CustodyAsset | null>>() },
    custodyAudit: { create: jest.fn<(args: Prisma.CustodyAuditCreateArgs) => Promise<CustodyAudit>>() },
  };
  const transact = jest.fn<(work: (client: typeof tx) => Promise<unknown>, options: { isolationLevel: Prisma.TransactionIsolationLevel }) => Promise<unknown>>();
  const depositParams = { tenantId: TENANT, depositId: 'deposit-1' };
  const withdrawalParams = { tenantId: TENANT, custodyWithdrawalId: 'withdrawal-1' };
  beforeEach(async () => {
    deposit = custodyDepositRecord(); withdrawal = custodyWithdrawalRecord(); transaction = custodyTransactionRecord(); funding = fundingRequestRecord(); withdrawalRequest = withdrawalRequestRecord();
    tx.custodyDeposit.findFirst.mockReset().mockImplementation(async (args) => deposit && rowMatches(deposit, args.where) ? deposit : null);
    tx.custodyWithdrawal.findFirst.mockReset().mockImplementation(async (args) => withdrawal && rowMatches(withdrawal, args.where) ? withdrawal : null);
    tx.custodyTransaction.findFirst.mockReset().mockImplementation(async (args) => transaction && rowMatches(transaction, args.where) ? transaction : null);
    tx.fundingRequest.findFirst.mockReset().mockImplementation(async (args) => funding && rowMatches(funding, args.where) ? funding : null);
    tx.withdrawalRequest.findFirst.mockReset().mockImplementation(async (args) => withdrawalRequest && rowMatches(withdrawalRequest, args.where) ? withdrawalRequest : null);
    tx.custodyWallet.findFirst.mockReset().mockResolvedValue(walletRecord({ accountId: 'account-1' })); tx.custodyAsset.findFirst.mockReset().mockResolvedValue(assetRecord());
    for (const delegate of [tx.custodyDeposit, tx.custodyWithdrawal, tx.custodyTransaction, tx.fundingRequest, tx.withdrawalRequest]) delegate.updateMany.mockReset().mockResolvedValue({ count: 1 });
    tx.custodyAudit.create.mockReset().mockResolvedValue(auditRecord());
    tx.$executeRaw.mockReset().mockResolvedValue(1);
    transact.mockReset().mockImplementation(async (work) => work(tx));
    module = await Test.createTestingModule({ providers: [SettlementService, { provide: PrismaService, useValue: { $transaction: transact } }] }).compile();
  });
  afterEach(async () => { await module.close(); });
  function service() { return module.get<SettlementService>(SettlementService); }
  it('does not claim settlement or mutate funding when a spendable customer credit is unverified', async () => {
    await expect(service().finalizeDepositSettlement(depositParams)).rejects.toThrow(ServiceUnavailableException);
    expect(transact).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(tx.fundingRequest.updateMany).not.toHaveBeenCalled();
    expect(tx.custodyAudit.create).not.toHaveBeenCalled();
  });
  it('propagates a linked funding read failure instead of returning settled true', async () => {
    const failure = new Error('funding unavailable'); tx.fundingRequest.findFirst.mockRejectedValueOnce(failure);
    await expect(service().finalizeDepositSettlement(depositParams)).rejects.toBe(failure); expect(tx.fundingRequest.updateMany).not.toHaveBeenCalled(); expect(tx.custodyAudit.create).not.toHaveBeenCalled();
  });
  it('requires the linked workflow to exist in this tenant', async () => {
    funding = fundingRequestRecord({ tenantId: OTHER_TENANT });
    await expect(service().finalizeDepositSettlement(depositParams)).rejects.toThrow('Linked funding request not found');
    expect(tx.fundingRequest.updateMany).not.toHaveBeenCalled();
  });
  it('does not confirm an internally approved workflow that has not been submitted', async () => {
    funding = fundingRequestRecord({ state: 'APPROVED' });
    await expect(service().finalizeDepositSettlement(depositParams)).rejects.toThrow('matching submitted amount/state');
    expect(tx.fundingRequest.updateMany).not.toHaveBeenCalled();
  });
  it('rejects a currency mismatch between custody asset and funding workflow', async () => {
    funding = fundingRequestRecord({ currency: 'USD' });
    await expect(service().finalizeDepositSettlement(depositParams)).rejects.toThrow('account/currency does not match');
  });
  it('requires the matching non-reorged custody transaction rather than accepting a state/hash alone', async () => {
    transaction = null;
    await expect(service().finalizeDepositSettlement(depositParams)).rejects.toThrow('Matching non-reorged'); expect(tx.fundingRequest.updateMany).not.toHaveBeenCalled();
  });
  it.each([{ confirmationCount: 1 }, { transactionHash: null }, { providerReference: null }, { confirmedAt: null }])('rejects incomplete deposit confirmation evidence %j', async (overrides) => {
    deposit = custodyDepositRecord(overrides);
    await expect(service().finalizeDepositSettlement(depositParams)).rejects.toThrow('complete provider confirmation evidence');
    expect(tx.fundingRequest.updateMany).not.toHaveBeenCalled();
  });
  it('does not treat a matching prior funding state as proof of a spendable credit', async () => {
    funding = fundingRequestRecord({ state: 'CONFIRMED', confirmedAmount: '2', settledAmount: '2', externalReference: 'unit-chain-hash' });
    await expect(service().finalizeDepositSettlement(depositParams)).rejects.toThrow(ServiceUnavailableException);
    expect(tx.fundingRequest.updateMany).not.toHaveBeenCalled();
    expect(tx.custodyAudit.create).not.toHaveBeenCalled();
  });
  it('also refuses to claim settlement for a deposit without a linked funding request', async () => {
    deposit = custodyDepositRecord({ fundingRequestId: null });
    await expect(service().finalizeDepositSettlement(depositParams)).rejects.toThrow(ServiceUnavailableException);
    expect(tx.fundingRequest.updateMany).not.toHaveBeenCalled();
    expect(tx.custodyAudit.create).not.toHaveBeenCalled();
  });
  it('does not reuse contradictory prior confirmation evidence as an idempotent success', async () => {
    funding = fundingRequestRecord({ state: 'CONFIRMED', confirmedAmount: '2', settledAmount: '2', externalReference: 'different-hash' });
    await expect(service().finalizeDepositSettlement(depositParams)).rejects.toThrow('Conflicting previously confirmed');
  });
  it('requires the withdrawal destination/account/currency to match its submitted workflow', async () => {
    transaction = custodyTransactionRecord({ depositId: null, withdrawalId: 'withdrawal-1', direction: 'OUT' });
    withdrawalRequest = withdrawalRequestRecord({ destinationAddress: 'different-destination' });
    await expect(service().finalizeWithdrawalSettlement(withdrawalParams)).rejects.toThrow('account/currency/destination does not match'); expect(tx.withdrawalRequest.updateMany).not.toHaveBeenCalled();
  });
  it('propagates a required withdrawal workflow write failure instead of finalizing anyway', async () => {
    transaction = custodyTransactionRecord({ depositId: null, withdrawalId: 'withdrawal-1', direction: 'OUT' });
    const failure = new Error('withdrawal write unavailable'); tx.withdrawalRequest.updateMany.mockRejectedValueOnce(failure);
    await expect(service().finalizeWithdrawalSettlement(withdrawalParams)).rejects.toBe(failure); expect(tx.custodyAudit.create).not.toHaveBeenCalled();
  });
  it('actually marks native custody reorg state and explicitly leaves portfolio/funding reconciliation required', async () => {
    const result = await service().handleReorgSettlement({ tenantId: TENANT, transactionId: 'transaction-1', reason: 'Unit provider reorg notice' });
    expect(result).toMatchObject({ settlementState: 'REORGED', reconciliationRequired: true });
    expect(tx.custodyTransaction.updateMany).toHaveBeenCalledWith({ where: { id: 'transaction-1', tenantId: TENANT, status: 'CONFIRMED' },
      data: { status: 'REORGED', isReorged: true, reorgedAt: expect.any(Date), failureReason: 'Unit provider reorg notice' } });
    expect(tx.custodyDeposit.updateMany).toHaveBeenCalledWith({ where: { id: 'deposit-1', tenantId: TENANT }, data: { state: 'REORGED', isFinal: false, failureReason: 'Unit provider reorg notice' } });
    expect(tx.custodyAudit.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'TRANSACTION_REORGED' }) }));
    expect(tx.fundingRequest.updateMany).not.toHaveBeenCalled();
  });
  it('does not claim a reorg mutation succeeded when a required linked update failed', async () => {
    tx.custodyDeposit.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(service().handleReorgSettlement({ tenantId: TENANT, transactionId: 'transaction-1', reason: 'Unit notice' })).rejects.toThrow('deposit update unavailable');
    expect(tx.custodyAudit.create).not.toHaveBeenCalled();
  });
});
