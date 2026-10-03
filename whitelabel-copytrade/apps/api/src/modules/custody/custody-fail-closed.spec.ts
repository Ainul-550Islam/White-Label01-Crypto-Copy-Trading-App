/**
 * Phase 3: custody fails closed. No locally invented deposit addresses, no
 * provider that claims capabilities it does not implement, no fabricated
 * providers for unknown ids.
 */

import { BadRequestException } from '@nestjs/common';
import { BlockchainProviderFactory, INTERNAL_LEDGER_PROVIDER_ID } from './blockchain-provider.factory';
import { DepositAddressService } from './deposit-address.service';

function registries() {
  return {
    assetRegistry: { isAssetSupported: jest.fn(async () => true) },
    networkRegistry: { isNetworkSupported: jest.fn(async () => true) },
  };
}

function factory() {
  const { assetRegistry, networkRegistry } = registries();
  return new BlockchainProviderFactory({} as any, assetRegistry as any, networkRegistry as any, {} as any);
}

describe('BlockchainProviderFactory', () => {
  const saved = process.env.CUSTODY_BLOCKCHAIN_PROVIDER;
  afterEach(() => {
    if (saved === undefined) delete process.env.CUSTODY_BLOCKCHAIN_PROVIDER;
    else process.env.CUSTODY_BLOCKCHAIN_PROVIDER = saved;
  });

  it('resolves the internal-ledger provider with honest capabilities and unhealthy status', async () => {
    delete process.env.CUSTODY_BLOCKCHAIN_PROVIDER;
    const provider = await factory().getProviderForNetwork({ networkId: 'ethereum', assetId: 'ETH-ethereum' });
    expect(provider.providerId).toBe(INTERNAL_LEDGER_PROVIDER_ID);
    const caps = await provider.getCapabilities();
    expect(caps).toMatchObject({
      canGetBalance: false,
      canObserveAddress: false,
      canSubmitTransaction: false,
      canEstimateFee: false,
      canGenerateAddress: false,
      canGetTransaction: true,
    });
    expect(provider.generateDepositAddress).toBeUndefined();
    await expect(provider.isHealthy?.()).resolves.toMatchObject({ healthy: false });
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
  function build(provider: any) {
    const prisma = {
      custodyWalletAddress: { findFirst: jest.fn(async () => null) },
      custodyWallet: { findFirst: jest.fn(async () => ({ id: 'w1', tenantId: 't1', state: 'ACTIVE' })) },
    };
    const walletAddressService = { createAddress: jest.fn(async (input: any) => ({ id: 'addr-1', ...input })) };
    const providerFactory = { getProviderForNetwork: jest.fn(async () => provider) };
    const audit = { log: jest.fn(async () => undefined) };
    return { svc: new DepositAddressService(prisma as any, walletAddressService as any, providerFactory as any, audit as any), walletAddressService };
  }
  const params = { tenantId: 't1', walletId: 'w1', assetId: 'ETH-ethereum', networkId: 'ethereum' };

  it('never invents an address when the provider cannot generate one', async () => {
    const { svc, walletAddressService } = build({ providerId: 'internal-ledger', getCapabilities: async () => ({ canGenerateAddress: false }) });
    await expect(svc.getOrCreateDepositAddress(params)).rejects.toThrow(/cannot generate deposit addresses/);
    expect(walletAddressService.createAddress).not.toHaveBeenCalled();
  });

  it('stores exactly the provider-issued address', async () => {
    const generateDepositAddress = jest.fn(async () => ({ address: '0xProviderIssued', providerReference: 'prov:abc' }));
    const { svc, walletAddressService } = build({ providerId: 'real', getCapabilities: async () => ({ canGenerateAddress: true }), generateDepositAddress });
    const record = await svc.getOrCreateDepositAddress(params);
    expect(record.address).toBe('0xProviderIssued');
    expect(walletAddressService.createAddress).toHaveBeenCalledWith(expect.objectContaining({ address: '0xProviderIssued', providerReference: 'prov:abc' }));
    expect(generateDepositAddress).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 't1', walletId: 'w1', idempotencyKey: expect.any(String) }));
  });

  it('refuses an empty provider answer', async () => {
    const { svc } = build({ providerId: 'real', getCapabilities: async () => ({ canGenerateAddress: true }), generateDepositAddress: async () => ({ address: ' ', providerReference: 'x' }) });
    await expect(svc.getOrCreateDepositAddress(params)).rejects.toThrow('Provider did not return a deposit address');
  });
});

describe('CustodyController tenant/scope resolution', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { CustodyController } = require('./custody.controller');
  const ctrl = new (CustodyController as any)();

  it('uses only the authenticated tenant and refuses cross-tenant ids', () => {
    expect(ctrl.getTenantId({ user: { tenantId: 't1' } }, 't1')).toBe('t1');
    expect(() => ctrl.getTenantId({ user: { tenantId: 't1' } }, 't2')).toThrow('Cross-tenant custody access refused');
    expect(() => ctrl.getTenantId({ user: { tenantId: 't1' } }, undefined, 't2')).toThrow('Cross-tenant custody access refused');
    expect(() => ctrl.getTenantId({ headers: { 'x-tenant-id': 't9' } })).toThrow('Tenant context required');
  });

  it('ignores a client-supplied scope header and defaults to CLIENT', () => {
    expect(ctrl.getScope({ headers: { 'x-custody-scope': 'PLATFORM_ADMIN' } })).toBe('CLIENT');
    expect(ctrl.getScope({ user: { custodyScope: 'ROOT' } })).toBe('CLIENT');
  });

  it('derives the scope from the principal permissions (no issuer sets a custodyScope claim)', () => {
    expect(ctrl.getScope({ user: { isPlatformUser: true, permissions: [] } })).toBe('PLATFORM_ADMIN');
    expect(ctrl.getScope({ user: { permissions: ['*'] } })).toBe('PLATFORM_ADMIN');
    expect(ctrl.getScope({ user: { permissions: ['payout:manage'] } })).toBe('TREASURY_OPERATOR');
    expect(ctrl.getScope({ user: { permissions: ['tenant:update'] } })).toBe('TENANT_OWNER');
    expect(ctrl.getScope({ user: { permissions: ['compliance:read'] } })).toBe('COMPLIANCE_REVIEWER');
    expect(ctrl.getScope({ user: { permissions: ['report:read'] } })).toBe('CLIENT');
    expect(ctrl.getScope({ user: {} })).toBe('CLIENT');
  });

  it('a custodyScope claim can narrow the derived scope but never raise it', () => {
    expect(ctrl.getScope({ user: { custodyScope: 'TREASURY_OPERATOR' } })).toBe('CLIENT');
    expect(ctrl.getScope({ user: { custodyScope: 'PLATFORM_ADMIN', permissions: ['tenant:update'] } })).toBe('TENANT_OWNER');
    expect(ctrl.getScope({ user: { custodyScope: 'CLIENT', permissions: ['payout:manage'] } })).toBe('CLIENT');
    expect(ctrl.getScope({ user: { custodyScope: 'TREASURY_OPERATOR', permissions: ['payout:manage'] } })).toBe('TREASURY_OPERATOR');
  });
});
