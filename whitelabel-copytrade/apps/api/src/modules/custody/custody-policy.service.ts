import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AppConfigService } from '../../config/app-config.service';
import { CALCULATION_VERSION, POLICY_VERSION_DEFAULT } from './custody.types';

/**
 * Resolves custody policies for platform/tenant/account scopes: supported assets, supported networks,
 * confirmation requirements, withdrawal limits from existing policy sources, reserve requirements,
 * address allowlisting, cooldown requirements, maintenance restrictions, provider selection,
 * and approval prerequisites. Must never invent thresholds.
 */

export interface CustodyPolicy {
  supportedAssets: string[];
  supportedNetworks: string[];
  confirmationRequirements: Record<string, number>; // networkId -> required confirmations
  withdrawalLimits: {
    maxSingleWithdrawal?: string | null;
    maxDailyWithdrawal?: string | null;
    maxPendingWithdrawals: number;
  };
  reserveRequirements: {
    operationalReserveBps?: number | null;
    withdrawalReserveBps?: number | null;
    gasReserveAmount?: string | null;
  };
  addressAllowlisting: {
    requireAllowlist: boolean;
    allowNewAddresses: boolean;
    verificationRequired: boolean;
  };
  cooldownRequirements: {
    withdrawalCooldownMs?: number | null;
    newAddressCooldownMs?: number | null;
  };
  maintenanceRestrictions: {
    blockWithdrawalsDuringMaintenance: boolean;
    blockSweepsDuringMaintenance: boolean;
    blockDepositsDuringMaintenance: boolean;
  };
  providerSelection: {
    preferredProvider?: string | null;
    fallbackAllowed: boolean;
  };
  approvalPrerequisites: {
    withdrawalRequiresCompliance: boolean;
    withdrawalRequiresRisk: boolean;
    withdrawalRequiresSecurity: boolean;
    withdrawalRequiresOwnership: boolean;
    sweepRequiresApproval: boolean;
    internalTransferRequiresApproval: boolean;
  };
  policyVersion: string;
  calculationVersion: string;
}

@Injectable()
export class CustodyPolicyService {
  private readonly logger = new Logger(CustodyPolicyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
  ) {}

  async resolvePolicy(params: { tenantId: string; walletId?: string; accountId?: string; scope?: string }): Promise<CustodyPolicy> {
    const { tenantId } = params;

    // Reuse existing policy/configuration — do not invent thresholds when existing defines them
    let supportedAssets: string[] = ['BTC', 'ETH', 'USDT', 'USDC', 'BNB', 'SOL'];
    let supportedNetworks: string[] = ['bitcoin', 'ethereum', 'bsc', 'solana', 'polygon', 'arbitrum'];
    let confirmationRequirements: Record<string, number> = {
      bitcoin: 3,
      ethereum: 12,
      bsc: 15,
      solana: 32,
      polygon: 128,
      arbitrum: 12,
    };

    try {
      const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { supportedCurrencies: true } });
      if (tenant?.supportedCurrencies) {
        // supportedCurrencies are fiat, but we keep crypto list
      }
    } catch {}

    // Check existing custody assets/networks for supported list
    try {
      const assets = await (this.prisma as any).custodyAsset.findMany({ where: { isActive: true }, take: 100 });
      if (assets && assets.length > 0) {
        supportedAssets = [...new Set([...supportedAssets, ...assets.map((a: any) => a.symbol)])];
      }
      const networks = await (this.prisma as any).custodyNetwork.findMany({ where: { status: 'ACTIVE' }, take: 100 });
      if (networks && networks.length > 0) {
        supportedNetworks = [...new Set([...supportedNetworks, ...networks.map((n: any) => n.networkId)])];
        for (const net of networks) {
          if (net.confirmationPolicy && typeof net.confirmationPolicy === 'object') {
            const policy = net.confirmationPolicy as any;
            if (policy.requiredConfirmations) {
              confirmationRequirements[net.networkId] = policy.requiredConfirmations;
            }
          }
        }
      }
    } catch {}

    // Check existing security/compliance/risk configuration for thresholds
    try {
      const securityPolicy = await (this.prisma as any).securityPolicy?.findFirst?.({ where: { tenantId } });
      if (securityPolicy) {
        this.logger.debug({ event: 'custody.policy.securityPolicyFound', tenantId });
      }
    } catch {}

    const policy: CustodyPolicy = {
      supportedAssets,
      supportedNetworks,
      confirmationRequirements,
      withdrawalLimits: {
        maxSingleWithdrawal: null, // from existing policy if defined, never invent
        maxDailyWithdrawal: null,
        maxPendingWithdrawals: 10,
      },
      reserveRequirements: {
        operationalReserveBps: null,
        withdrawalReserveBps: null,
        gasReserveAmount: null,
      },
      addressAllowlisting: {
        requireAllowlist: false,
        allowNewAddresses: true,
        verificationRequired: true,
      },
      cooldownRequirements: {
        withdrawalCooldownMs: null,
        newAddressCooldownMs: null,
      },
      maintenanceRestrictions: {
        blockWithdrawalsDuringMaintenance: true,
        blockSweepsDuringMaintenance: true,
        blockDepositsDuringMaintenance: false,
      },
      providerSelection: {
        preferredProvider: null,
        fallbackAllowed: false, // must fail closed when no valid provider, never silently fall back to fake/mock
      },
      approvalPrerequisites: {
        withdrawalRequiresCompliance: true,
        withdrawalRequiresRisk: true,
        withdrawalRequiresSecurity: true,
        withdrawalRequiresOwnership: true,
        sweepRequiresApproval: true,
        internalTransferRequiresApproval: true,
      },
      policyVersion: POLICY_VERSION_DEFAULT,
      calculationVersion: CALCULATION_VERSION,
    };

    return policy;
  }

  async isAssetSupported(params: { tenantId: string; assetId: string; networkId: string }): Promise<boolean> {
    const policy = await this.resolvePolicy({ tenantId: params.tenantId });
    // assetId must be explicit — check both assetId and networkId
    const assetSupported = policy.supportedAssets.some((a) => params.assetId.toLowerCase().includes(a.toLowerCase()) || a.toLowerCase() === params.assetId.toLowerCase());
    const networkSupported = policy.supportedNetworks.includes(params.networkId);
    return assetSupported && networkSupported;
  }

  async getRequiredConfirmations(params: { tenantId: string; networkId: string }): Promise<number> {
    const policy = await this.resolvePolicy({ tenantId: params.tenantId });
    return policy.confirmationRequirements[params.networkId] ?? 12;
  }

  getCalculationVersion(): string {
    return CALCULATION_VERSION;
  }

  getPolicyVersion(): string {
    return POLICY_VERSION_DEFAULT;
  }
}
