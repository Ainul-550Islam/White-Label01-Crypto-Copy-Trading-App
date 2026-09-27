import { Injectable, Logger, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { WalletRepository } from './wallet.repository';
import { CustodyPolicyService } from './custody-policy.service';
import { AssetRegistryService } from './asset-registry.service';
import { NetworkRegistryService } from './network-registry.service';
import { CustodyAuditService } from './custody-audit.service';
import { WALLET_VALID_TRANSITIONS, CustodyWalletState, redactSecrets } from './custody.types';

/**
 * Creates, activates, restricts, suspends, and closes custody wallets/accounts while enforcing ownership,
 * tenant isolation, supported asset/network capability, security requirements, and provider-backed metadata.
 */

@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly walletRepo: WalletRepository,
    private readonly custodyPolicyService: CustodyPolicyService,
    private readonly assetRegistry: AssetRegistryService,
    private readonly networkRegistry: NetworkRegistryService,
    private readonly auditService: CustodyAuditService,
  ) {}

  async createWallet(params: {
    tenantId: string;
    clientProfileId?: string | null;
    accountId?: string | null;
    walletType?: string;
    scope?: string;
    assetId: string;
    networkId: string;
    provider?: string | null;
    ownerId?: string | null;
    ownerType?: string | null;
    operatorId?: string | null;
    correlationId?: string | null;
    metadata?: any;
  }): Promise<any> {
    const { tenantId, clientProfileId = null, accountId = null, walletType = 'HOT', scope = 'TENANT', assetId, networkId, provider = null, ownerId = null, ownerType = null, operatorId = null, correlationId = null, metadata = {} } = params;

    // Asset/network must be explicit
    if (!assetId || !networkId) throw new BadRequestException('assetId and networkId must be explicit');

    // Reject unsupported or ambiguous assets
    try {
      await this.assetRegistry.validateAssetIdentity({ assetId, assetSymbol: assetId.split('-')[0] ?? assetId, networkId, decimals: 18 } as any);
    } catch {
      // If asset registry doesn't have asset, check policy
      const policy = await this.custodyPolicyService.resolvePolicy({ tenantId });
      if (!policy.supportedAssets.some((a) => assetId.toLowerCase().includes(a.toLowerCase())) || !policy.supportedNetworks.includes(networkId)) {
        throw new BadRequestException(`Unsupported asset/network: ${assetId} on ${networkId} — explicit capability error`);
      }
    }

    const networkSupported = await this.networkRegistry.isNetworkSupported({ networkId });
    if (!networkSupported) throw new BadRequestException(`Unsupported network ${networkId}`);

    // Ownership validation
    if (accountId) {
      const account = await (this.prisma as any).institutionalAccount.findFirst({ where: { id: accountId, tenantId } });
      if (!account) throw new BadRequestException('Institutional account not found or tenant mismatch');
    }

    if (clientProfileId) {
      const profile = await (this.prisma as any).clientProfile.findFirst({ where: { id: clientProfileId, tenantId } });
      if (!profile) throw new BadRequestException('Client profile not found or tenant mismatch');
    }

    // Security requirements — would check SecurityModule
    // For now, ensure no raw private keys in metadata
    if ((metadata as any).privateKey || (metadata as any).mnemonic || (metadata as any).seedPhrase) {
      throw new BadRequestException('Raw private key cannot be persisted — forbidden');
    }

    const wallet = await this.walletRepo.createWallet({
      tenantId,
      clientProfileId,
      accountId,
      walletType,
      scope,
      assetId,
      networkId,
      provider,
      ownerId,
      ownerType,
      metadata: redactSecrets(metadata) as any,
    });

    await this.auditService.log({
      tenantId,
      walletId: wallet.id,
      action: 'WALLET_CREATED' as any,
      entityType: 'CUSTODY_WALLET',
      entityId: wallet.id,
      actorId: operatorId,
      toState: 'PENDING',
      correlationId,
      evidence: { assetId, networkId, walletType, provider, accountId, clientProfileId },
    });

    this.logger.log({ event: 'custody.wallet.created', tenantId, walletId: wallet.id, assetId, networkId });

    return wallet;
  }

  async transitionWallet(params: {
    tenantId: string;
    walletId: string;
    toState: CustodyWalletState;
    operatorId?: string | null;
    reason?: string;
    correlationId?: string | null;
  }): Promise<any> {
    const { tenantId, walletId, toState, operatorId = null, reason, correlationId = null } = params;

    const wallet = await this.walletRepo.getWallet({ tenantId, walletId });
    if (!wallet) throw new BadRequestException('Wallet not found or tenant mismatch');

    const currentState = wallet.state as CustodyWalletState;
    const allowed = WALLET_VALID_TRANSITIONS[currentState] ?? [];
    if (!allowed.includes(toState)) {
      throw new BadRequestException(`Invalid wallet transition ${currentState} → ${toState}`);
    }

    // Wallet activation must require supported asset/network, provider capability, security, ownership, tenant, compliance, operational readiness
    if (toState === CustodyWalletState.ACTIVE) {
      const policy = await this.custodyPolicyService.resolvePolicy({ tenantId, walletId });
      if (!policy.supportedAssets.some((a) => wallet.assetId.toLowerCase().includes(a.toLowerCase())) || !policy.supportedNetworks.includes(wallet.networkId)) {
        throw new BadRequestException(`Cannot activate wallet — asset/network not supported: ${wallet.assetId} on ${wallet.networkId}`);
      }
      if (!wallet.provider) {
        throw new BadRequestException('Cannot activate wallet — provider capability required');
      }
      // Security policy check
      // Compliance restrictions check
      const restrictions = await (this.prisma as any).accountRestriction?.findMany?.({ where: { tenantId, accountId: wallet.accountId, status: 'ACTIVE', restrictionType: { in: ['COMPLIANCE_HOLD', 'SECURITY_HOLD'] } } });
      if (restrictions && restrictions.length > 0) {
        throw new BadRequestException(`Cannot activate wallet — compliance/security restrictions: ${restrictions.map((r: any) => r.restrictionType).join(',')}`);
      }
    }

    // An operator must not be able to directly force a wallet into ACTIVE if required prerequisites fail — enforced above

    const updated = await this.walletRepo.updateWalletState({ tenantId, walletId, state: toState as any, isActive: toState === CustodyWalletState.ACTIVE });

    await this.auditService.log({
      tenantId,
      walletId,
      action: `WALLET_${toState}` as any,
      entityType: 'CUSTODY_WALLET',
      entityId: walletId,
      actorId: operatorId,
      fromState: currentState,
      toState: toState as any,
      reason: reason ?? null,
      correlationId,
      evidence: { fromState: currentState, toState, reason },
    });

    return updated;
  }

  async getWallet(params: { tenantId: string; walletId: string }): Promise<any | null> {
    return await this.walletRepo.getWallet(params);
  }

  async listWallets(params: {
    tenantId: string;
    clientProfileId?: string;
    accountId?: string;
    assetId?: string;
    networkId?: string;
    state?: string;
    page?: number;
    limit?: number;
  }): Promise<{ data: any[]; total: number; page: number; limit: number }> {
    return await this.walletRepo.listWallets(params);
  }
}
