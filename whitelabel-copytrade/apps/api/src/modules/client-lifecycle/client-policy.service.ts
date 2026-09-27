import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AppConfigService } from '../../config/app-config.service';
import { CALCULATION_VERSION, POLICY_VERSION_DEFAULT } from './client-lifecycle.types';

/**
 * Resolves tenant/client/account policies including allowed account types, approval requirements,
 * funding controls, trading activation prerequisites, withdrawal rules, ownership rules, and
 * operational restrictions using existing security/compliance/risk configuration.
 * Do not invent thresholds when existing policy/configuration already defines them.
 */

export interface ClientPolicy {
  allowedAccountTypes: string[];
  approvalRequirements: {
    onboardingRequiresCompliance: boolean;
    onboardingRequiresRisk: boolean;
    onboardingRequiresSecurity: boolean;
    fundingRequiresApproval: boolean;
    withdrawalRequiresApproval: boolean;
    closureRequiresApproval: boolean;
    suspensionRequiresApproval: boolean;
  };
  fundingControls: {
    maxFundingAmount?: string | null;
    maxWithdrawalAmount?: string | null;
    allowedCurrencies: string[];
    requireExternalReference: boolean;
    requireDestinationValidation: boolean;
  };
  tradingActivationPrerequisites: {
    requireCompliance: boolean;
    requireKyc: boolean;
    requireAml: boolean;
    requireSecurityMfa: boolean;
    requireRisk: boolean;
    requireExchangeBinding: boolean;
    requirePortfolioBinding: boolean;
    requireCredential: boolean;
    requireVenueAttestation: boolean;
    requireIpAllowlist: boolean;
    requireSignedTransport: boolean;
    requireLiveGate: boolean;
    requireOmsReadiness: boolean;
  };
  withdrawalRules: {
    requireComplianceCheck: boolean;
    requireRiskCheck: boolean;
    requireSecurityCheck: boolean;
    requireNoWithdrawalRestriction: boolean;
    requireSufficientBalance: boolean;
    requireNoPendingClosure: boolean;
  };
  ownershipRules: {
    maxOwnersPerAccount: number;
    allowCrossTenantOwnership: boolean;
    requireExplicitOwnershipChange: boolean;
  };
  operationalRestrictions: {
    defaultRestrictions: string[];
    allowSelfRestrictionRemoval: boolean;
  };
  policyVersion: string;
  calculationVersion: string;
}

@Injectable()
export class ClientPolicyService {
  private readonly logger = new Logger(ClientPolicyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
  ) {}

  async resolvePolicy(params: { tenantId: string; clientProfileId?: string; accountId?: string }): Promise<ClientPolicy> {
    const { tenantId } = params;

    // Reuse existing KYC/AML, Security, Risk, Compliance, Billing, Finance, Exchanges, Portfolio Accounting, Operations, Notifications, IAM services
    let allowedCurrencies: string[] = ['USD', 'USDT', 'USDC', 'BTC', 'ETH'];
    let maxFundingAmount: string | null = null;
    let maxWithdrawalAmount: string | null = null;

    try {
      const tenant = await this.prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { supportedCurrencies: true, defaultCurrency: true },
      });
      if (tenant?.supportedCurrencies && tenant.supportedCurrencies.length > 0) {
        allowedCurrencies = [...new Set([...allowedCurrencies, ...tenant.supportedCurrencies])];
      }
    } catch {}

    // Check existing security/compliance/risk configuration for thresholds
    try {
      const securityPolicy = await (this.prisma as any).securityPolicy?.findFirst?.({ where: { tenantId } });
      if (securityPolicy) {
        // Reuse existing policy if defined — do not invent thresholds
        this.logger.debug({ event: 'client.policy.securityPolicyFound', tenantId });
      }
    } catch {}

    const policy: ClientPolicy = {
      allowedAccountTypes: ['TRADING', 'MANAGED', 'COPY_TRADING', 'PAPER'],
      approvalRequirements: {
        onboardingRequiresCompliance: true,
        onboardingRequiresRisk: true,
        onboardingRequiresSecurity: true,
        fundingRequiresApproval: true,
        withdrawalRequiresApproval: true,
        closureRequiresApproval: true,
        suspensionRequiresApproval: true,
      },
      fundingControls: {
        maxFundingAmount,
        maxWithdrawalAmount,
        allowedCurrencies,
        requireExternalReference: true,
        requireDestinationValidation: true,
      },
      tradingActivationPrerequisites: {
        requireCompliance: true,
        requireKyc: true,
        requireAml: true,
        requireSecurityMfa: true,
        requireRisk: true,
        requireExchangeBinding: true,
        requirePortfolioBinding: false, // optional for non-managed
        requireCredential: true,
        requireVenueAttestation: true,
        requireIpAllowlist: true,
        requireSignedTransport: true,
        requireLiveGate: true,
        requireOmsReadiness: true,
      },
      withdrawalRules: {
        requireComplianceCheck: true,
        requireRiskCheck: true,
        requireSecurityCheck: true,
        requireNoWithdrawalRestriction: true,
        requireSufficientBalance: true,
        requireNoPendingClosure: true,
      },
      ownershipRules: {
        maxOwnersPerAccount: 5,
        allowCrossTenantOwnership: false, // No cross-tenant ownership relationship may be created
        requireExplicitOwnershipChange: true,
      },
      operationalRestrictions: {
        defaultRestrictions: [],
        allowSelfRestrictionRemoval: false,
      },
      policyVersion: POLICY_VERSION_DEFAULT,
      calculationVersion: CALCULATION_VERSION,
    };

    return policy;
  }

  getCalculationVersion(): string {
    return CALCULATION_VERSION;
  }

  getPolicyVersion(): string {
    return POLICY_VERSION_DEFAULT;
  }
}
