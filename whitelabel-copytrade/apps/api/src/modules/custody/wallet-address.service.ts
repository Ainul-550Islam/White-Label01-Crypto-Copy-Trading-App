import { Injectable, Logger, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { CustodyAuditService } from './custody-audit.service';
import { deterministicIdempotencyKey, CustodyWalletAddressState, ADDRESS_VALID_TRANSITIONS, redactSecrets } from './custody.types';

/**
 * Manages wallet addresses, address status, ownership, network/asset binding, labels, creation source,
 * verification, and lifecycle. Prevents the same address from being ambiguously assigned across
 * incompatible tenant/account contexts.
 */

@Injectable()
export class WalletAddressService {
  private readonly logger = new Logger(WalletAddressService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: CustodyAuditService,
  ) {}

  async createAddress(params: {
    tenantId: string;
    walletId: string;
    assetId: string;
    networkId: string;
    address: string;
    providerReference?: string | null;
    creationSource?: string | null;
    label?: string | null;
    isDepositAddress?: boolean;
    clientProfileId?: string | null;
    accountId?: string | null;
    operatorId?: string | null;
    correlationId?: string | null;
    metadata?: any;
  }): Promise<any> {
    const { tenantId, walletId, assetId, networkId, address, providerReference = null, creationSource = null, label = null, isDepositAddress = false, clientProfileId = null, accountId = null, operatorId = null, correlationId = null, metadata = {} } = params;

    if (!assetId || !networkId || !address) throw new BadRequestException('assetId, networkId, address must be explicit');

    // Verify wallet belongs to tenant
    const wallet = await (this.prisma as any).custodyWallet.findFirst({ where: { id: walletId, tenantId } });
    if (!wallet) throw new BadRequestException('Wallet not found or tenant mismatch');

    // Prevent same address from being ambiguously assigned across incompatible tenant/account contexts
    try {
      const existing = await (this.prisma as any).custodyWalletAddress.findFirst({
        where: { address, networkId, tenantId: { not: tenantId } },
      });
      if (existing) {
        throw new ForbiddenException('Address already assigned to different tenant — ambiguous assignment prevented');
      }

      // Same tenant but different wallet? Check if address already active for same network
      const sameTenantSameAddress = await (this.prisma as any).custodyWalletAddress.findFirst({
        where: { tenantId, networkId, address, status: { in: ['ACTIVE', 'RESERVED'] } },
      });
      if (sameTenantSameAddress && sameTenantSameAddress.walletId !== walletId) {
        // Allow if same account, but prevent ambiguous across incompatible account contexts
        if (sameTenantSameAddress.accountId && accountId && sameTenantSameAddress.accountId !== accountId) {
          throw new BadRequestException(`Address ${address} already assigned to different account context — ambiguous assignment prevented`);
        }
      }
    } catch (e) {
      if (e instanceof BadRequestException || e instanceof ForbiddenException) throw e;
    }

    const idempotencyKey = deterministicIdempotencyKey({
      type: `wallet-address:${assetId}:${networkId}`,
      tenantId,
      walletId,
      assetId,
      networkId,
      externalRef: address,
    });

    try {
      const existingByKey = await (this.prisma as any).custodyWalletAddress.findFirst({ where: { idempotencyKey } });
      if (existingByKey) return existingByKey;
    } catch {}

    const walletAddress = await (this.prisma as any).custodyWalletAddress.create({
      data: {
        tenantId,
        walletId,
        assetId,
        networkId,
        address,
        providerReference: providerReference ?? null,
        creationSource: creationSource ?? null,
        status: 'GENERATING',
        label: label ?? null,
        isDepositAddress,
        clientProfileId: clientProfileId ?? null,
        accountId: accountId ?? null,
        verified: false,
        idempotencyKey,
        metadata: redactSecrets(metadata) as any,
      },
    });

    // Transition to ACTIVE after creation — address ownership must be explicit
    const active = await this.transitionAddress({
      tenantId,
      addressId: walletAddress.id,
      toState: CustodyWalletAddressState.ACTIVE as any,
      operatorId,
      correlationId,
    });

    await this.auditService.log({
      tenantId,
      walletId,
      action: 'ADDRESS_GENERATED' as any,
      entityType: 'CUSTODY_WALLET_ADDRESS',
      entityId: walletAddress.id,
      actorId: operatorId,
      toState: 'ACTIVE',
      correlationId,
      evidence: { address, assetId, networkId, providerReference, creationSource, walletId },
    });

    this.logger.log({ event: 'custody.address.created', tenantId, walletId, address, assetId, networkId });

    return active;
  }

  async transitionAddress(params: {
    tenantId: string;
    addressId: string;
    toState: CustodyWalletAddressState;
    operatorId?: string | null;
    reason?: string;
    correlationId?: string | null;
  }): Promise<any> {
    const { tenantId, addressId, toState, operatorId = null, reason, correlationId = null } = params;

    const address = await (this.prisma as any).custodyWalletAddress.findFirst({ where: { id: addressId, tenantId } });
    if (!address) throw new BadRequestException('Address not found');

    const currentState = address.status as CustodyWalletAddressState;
    const allowed = ADDRESS_VALID_TRANSITIONS[currentState] ?? [];
    if (!allowed.includes(toState)) {
      throw new BadRequestException(`Invalid address transition ${currentState} → ${toState}`);
    }

    const updated = await (this.prisma as any).custodyWalletAddress.update({
      where: { id: addressId },
      data: {
        status: toState as any,
        ...(toState === CustodyWalletAddressState.ACTIVE ? { activatedAt: new Date() } : {}),
        ...(toState === CustodyWalletAddressState.DEPRECATED ? { deprecatedAt: new Date() } : {}),
        ...(toState === CustodyWalletAddressState.ACTIVE ? { verified: true, verifiedAt: new Date() } : {}),
      },
    });

    await this.auditService.log({
      tenantId,
      walletId: address.walletId,
      action: 'ADDRESS_STATUS_CHANGED' as any,
      entityType: 'CUSTODY_WALLET_ADDRESS',
      entityId: addressId,
      actorId: operatorId,
      fromState: currentState,
      toState: toState as any,
      reason: reason ?? null,
      correlationId,
      evidence: { fromState: currentState, toState, address: address.address },
    });

    return updated;
  }

  async getAddress(params: { tenantId: string; addressId: string }): Promise<any | null> {
    try {
      return await (this.prisma as any).custodyWalletAddress.findFirst({ where: { id: params.addressId, tenantId: params.tenantId } });
    } catch {
      return null;
    }
  }

  async getAddressByAddress(params: { tenantId: string; address: string; networkId: string }): Promise<any | null> {
    try {
      return await (this.prisma as any).custodyWalletAddress.findFirst({ where: { tenantId: params.tenantId, address: params.address, networkId: params.networkId } });
    } catch {
      return null;
    }
  }

  async listAddresses(params: {
    tenantId: string;
    walletId?: string;
    assetId?: string;
    networkId?: string;
    status?: string;
    accountId?: string;
    clientProfileId?: string;
    page?: number;
    limit?: number;
  }): Promise<{ data: any[]; total: number; page: number; limit: number }> {
    const { tenantId, walletId, assetId, networkId, status, accountId, clientProfileId, page = 1, limit = 50 } = params;
    const where: any = { tenantId };
    if (walletId) where.walletId = walletId;
    if (assetId) where.assetId = assetId;
    if (networkId) where.networkId = networkId;
    if (status) where.status = status;
    if (accountId) where.accountId = accountId;
    if (clientProfileId) where.clientProfileId = clientProfileId;

    try {
      const [data, total] = await Promise.all([
        (this.prisma as any).custodyWalletAddress.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit }),
        (this.prisma as any).custodyWalletAddress.count({ where }),
      ]);
      return { data, total, page, limit };
    } catch {
      return { data: [], total: 0, page, limit };
    }
  }
}
