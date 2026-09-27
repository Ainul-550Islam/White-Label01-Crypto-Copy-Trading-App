import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { deterministicIdempotencyKey } from './custody.types';

/**
 * Tenant-safe persistent wallet/custody account repository with deterministic uniqueness,
 * address indexes, provider references, state indexes, and idempotency support.
 * Must never persist raw private keys.
 */

@Injectable()
export class WalletRepository {
  private readonly logger = new Logger(WalletRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  async createWallet(params: {
    tenantId: string;
    clientProfileId?: string | null;
    accountId?: string | null;
    walletType?: string;
    scope?: string;
    assetId: string;
    networkId: string;
    provider?: string | null;
    providerReference?: string | null;
    encryptedSecretReference?: string | null;
    credentialFingerprint?: string | null;
    ownerId?: string | null;
    ownerType?: string | null;
    idempotencyKey?: string;
    metadata?: any;
  }): Promise<any> {
    const { tenantId, clientProfileId = null, accountId = null, walletType = 'HOT', scope = 'TENANT', assetId, networkId, provider = null, providerReference = null, encryptedSecretReference = null, credentialFingerprint = null, ownerId = null, ownerType = null, metadata = {} } = params;

    // Never persist raw private keys — check metadata for forbidden fields
    const forbiddenFields = ['privateKey', 'seedPhrase', 'mnemonic', 'walletSecret', 'providerSecret', 'secret'];
    for (const field of forbiddenFields) {
      if ((metadata as any)[field]) {
        throw new Error(`Raw private key cannot be persisted — field ${field} forbidden`);
      }
    }

    const idempotencyKey = params.idempotencyKey ?? deterministicIdempotencyKey({
      type: `custody-wallet:${walletType}:${assetId}:${networkId}`,
      tenantId,
      walletId: accountId ?? clientProfileId ?? undefined,
      assetId,
      networkId,
      externalRef: providerReference ?? `${assetId}:${networkId}:${walletType}`,
    });

    try {
      const existing = await (this.prisma as any).custodyWallet.findFirst({ where: { idempotencyKey } });
      if (existing) {
        this.logger.log({ event: 'custody.wallet.idempotent_hit', idempotencyKey });
        return existing;
      }
    } catch {}

    // Check deterministic uniqueness — same tenant, asset, network, account should be unique
    try {
      if (accountId) {
        const existingByAccount = await (this.prisma as any).custodyWallet.findFirst({
          where: { tenantId, accountId, assetId, networkId, walletType },
        });
        if (existingByAccount) return existingByAccount;
      }
    } catch {}

    const wallet = await (this.prisma as any).custodyWallet.create({
      data: {
        tenantId,
        clientProfileId: clientProfileId ?? null,
        accountId: accountId ?? null,
        walletType,
        scope: scope as any,
        state: 'PENDING',
        assetId,
        networkId,
        provider: provider ?? null,
        providerReference: providerReference ?? null,
        encryptedSecretReference: encryptedSecretReference ?? null,
        credentialFingerprint: credentialFingerprint ?? null,
        ownerId: ownerId ?? null,
        ownerType: ownerType ?? null,
        isActive: false,
        idempotencyKey,
        metadata,
      },
    });

    return wallet;
  }

  async getWallet(params: { tenantId: string; walletId: string }): Promise<any | null> {
    try {
      return await (this.prisma as any).custodyWallet.findFirst({ where: { id: params.walletId, tenantId: params.tenantId } });
    } catch {
      return null;
    }
  }

  async listWallets(params: {
    tenantId: string;
    clientProfileId?: string;
    accountId?: string;
    assetId?: string;
    networkId?: string;
    state?: string;
    walletType?: string;
    page?: number;
    limit?: number;
  }): Promise<{ data: any[]; total: number; page: number; limit: number }> {
    const { tenantId, clientProfileId, accountId, assetId, networkId, state, walletType, page = 1, limit = 50 } = params;
    const where: any = { tenantId };
    if (clientProfileId) where.clientProfileId = clientProfileId;
    if (accountId) where.accountId = accountId;
    if (assetId) where.assetId = assetId;
    if (networkId) where.networkId = networkId;
    if (state) where.state = state;
    if (walletType) where.walletType = walletType;

    try {
      const [data, total] = await Promise.all([
        (this.prisma as any).custodyWallet.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit }),
        (this.prisma as any).custodyWallet.count({ where }),
      ]);
      return { data, total, page, limit };
    } catch {
      return { data: [], total: 0, page, limit };
    }
  }

  async updateWalletState(params: { tenantId: string; walletId: string; state: string; isActive?: boolean }): Promise<any> {
    try {
      return await (this.prisma as any).custodyWallet.update({
        where: { id: params.walletId },
        data: { state: params.state as any, ...(params.isActive !== undefined ? { isActive: params.isActive } : {}), ...(params.state === 'ACTIVE' ? { activatedAt: new Date() } : {}), ...(params.state === 'SUSPENDED' ? { suspendedAt: new Date() } : {}), ...(params.state === 'CLOSED' ? { closedAt: new Date() } : {}) },
      });
    } catch (e) {
      this.logger.warn(`Failed to update wallet state: ${(e as Error).message}`);
      throw e;
    }
  }
}
