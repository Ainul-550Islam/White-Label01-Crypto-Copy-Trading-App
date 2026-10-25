// # Responsibility: persist native tenant-bound wallet records with deterministic identity, runtime-narrowed states/scopes and recursive raw-secret rejection; required reads/writes fail closed.
import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { Prisma, CustodyScope as NativeCustodyScope, CustodyWalletState as NativeWalletState, type CustodyWallet } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { custodyJsonInput, deterministicIdempotencyKey, isCustodyObject } from './custody.types';

export function assertSafeWalletMetadata(metadata: unknown): void {
  if (!isCustodyObject(metadata)) throw new BadRequestException('Wallet metadata must be an object');
  const seen = new WeakSet<object>();
  function visit(value: unknown): void {
    if (value === null || typeof value !== 'object') return;
    if (seen.has(value)) throw new BadRequestException('Circular wallet metadata is forbidden');
    seen.add(value);
    if (Array.isArray(value)) {
      const entries: unknown[] = value;
      entries.forEach(visit);
    } else if (isCustodyObject(value)) {
      for (const [key, entry] of Object.entries(value)) {
        if (/privatekey|seedphrase|mnemonic|walletsecret|providersecret|apikey|password|^(secret|token|authorization)$/.test(key.replace(/[_-]/g, '').toLowerCase())) {
          throw new BadRequestException('Raw private key or credential cannot be persisted in wallet metadata');
        }
        visit(entry);
      }
    }
    seen.delete(value);
  }
  visit(metadata);
}

@Injectable()
export class WalletRepository {
  private readonly logger = new Logger(WalletRepository.name);
  constructor(private readonly prisma: PrismaService) {}

  async createWallet(params: {
    tenantId: string; clientProfileId?: string | null; accountId?: string | null; walletType?: string; scope?: string;
    assetId: string; networkId: string; provider?: string | null; providerReference?: string | null;
    encryptedSecretReference?: string | null; credentialFingerprint?: string | null; ownerId?: string | null;
    ownerType?: string | null; idempotencyKey?: string; metadata?: unknown;
  }): Promise<CustodyWallet> {
    const { tenantId, clientProfileId = null, accountId = null, walletType = 'HOT', scope = 'TENANT', assetId, networkId,
      provider = null, providerReference = null, encryptedSecretReference = null, credentialFingerprint = null,
      ownerId = null, ownerType = null, metadata = {} } = params;
    assertSafeWalletMetadata(metadata);
    const nativeScope = Object.values(NativeCustodyScope).find((value) => value === scope);
    if (!nativeScope || !tenantId || !assetId || !networkId || !walletType.trim()) throw new BadRequestException('Invalid wallet identity/scope');
    const idempotencyKey = params.idempotencyKey ?? deterministicIdempotencyKey({ type: `custody-wallet:${walletType}:${assetId}:${networkId}`,
      tenantId, walletId: accountId ?? clientProfileId ?? undefined, assetId, networkId,
      externalRef: providerReference ?? `${assetId}:${networkId}:${walletType}` });
    const existing = await this.prisma.custodyWallet.findFirst({ where: { tenantId, idempotencyKey } });
    if (existing) {
      this.assertIdentity(existing, { tenantId, clientProfileId, accountId, assetId, networkId, walletType, scope: nativeScope, ownerId, ownerType, provider });
      this.logger.log({ event: 'custody.wallet.idempotent_hit', walletId: existing.id });
      return existing;
    }
    if (accountId) {
      const byAccount = await this.prisma.custodyWallet.findFirst({ where: { tenantId, accountId, assetId, networkId, walletType } });
      if (byAccount) {
        this.assertIdentity(byAccount, { tenantId, clientProfileId, accountId, assetId, networkId, walletType, scope: nativeScope, ownerId, ownerType, provider });
        return byAccount;
      }
    }
    return this.prisma.custodyWallet.create({ data: { tenantId, clientProfileId, accountId, walletType, scope: nativeScope, state: 'PENDING',
      assetId, networkId, provider, providerReference, encryptedSecretReference, credentialFingerprint, ownerId, ownerType,
      isActive: false, idempotencyKey, metadata: custodyJsonInput(metadata) } });
  }

  async getWallet(params: { tenantId: string; walletId: string }): Promise<CustodyWallet | null> {
    return this.prisma.custodyWallet.findFirst({ where: { id: params.walletId, tenantId: params.tenantId } });
  }

  async listWallets(params: {
    tenantId: string; clientProfileId?: string; accountId?: string; assetId?: string; networkId?: string;
    state?: string; walletType?: string; page?: number; limit?: number;
  }): Promise<{ data: CustodyWallet[]; total: number; page: number; limit: number }> {
    const { tenantId, clientProfileId, accountId, assetId, networkId, state, walletType, page = 1, limit = 50 } = params;
    const where: Prisma.CustodyWalletWhereInput = { tenantId };
    if (clientProfileId) where.clientProfileId = clientProfileId;
    if (accountId) where.accountId = accountId;
    if (assetId) where.assetId = assetId;
    if (networkId) where.networkId = networkId;
    if (walletType) where.walletType = walletType;
    if (state) {
      const nativeState = Object.values(NativeWalletState).find((value) => value === state);
      if (!nativeState) throw new BadRequestException('Invalid wallet state');
      where.state = nativeState;
    }
    const [data, total] = await Promise.all([
      this.prisma.custodyWallet.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit }),
      this.prisma.custodyWallet.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  async updateWalletState(params: { tenantId: string; walletId: string; expectedState: string; state: string; isActive?: boolean }): Promise<CustodyWallet> {
    const state = Object.values(NativeWalletState).find((value) => value === params.state);
    const expectedState = Object.values(NativeWalletState).find((value) => value === params.expectedState);
    if (!state || !expectedState) throw new BadRequestException('Invalid wallet state');
    return this.prisma.custodyWallet.update({ where: { id: params.walletId, tenantId: params.tenantId, state: expectedState },
      data: { state, ...(params.isActive !== undefined ? { isActive: params.isActive } : {}),
        ...(state === 'ACTIVE' ? { activatedAt: new Date() } : {}), ...(state === 'SUSPENDED' ? { suspendedAt: new Date() } : {}),
        ...(state === 'CLOSED' ? { closedAt: new Date() } : {}) } });
  }

  private assertIdentity(wallet: CustodyWallet, identity: Pick<CustodyWallet,
    'tenantId' | 'clientProfileId' | 'accountId' | 'assetId' | 'networkId' | 'walletType' | 'scope' | 'ownerId' | 'ownerType' | 'provider'>): void {
    if (wallet.tenantId !== identity.tenantId || wallet.clientProfileId !== identity.clientProfileId || wallet.accountId !== identity.accountId
      || wallet.assetId !== identity.assetId || wallet.networkId !== identity.networkId || wallet.walletType !== identity.walletType
      || wallet.scope !== identity.scope || wallet.ownerId !== identity.ownerId || wallet.ownerType !== identity.ownerType || wallet.provider !== identity.provider) {
      throw new BadRequestException('Conflicting idempotent wallet identity');
    }
  }
}
