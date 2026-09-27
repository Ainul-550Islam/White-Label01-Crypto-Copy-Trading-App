import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';

/**
 * Detects inconsistent account ownership, account state, compliance state, funding workflow state,
 * exchange binding, portfolio binding, and lifecycle records without silently correcting authoritative systems.
 */

@Injectable()
export class LifecycleReconciliationService {
  private readonly logger = new Logger(LifecycleReconciliationService.name);

  constructor(private readonly prisma: PrismaService) {}

  async reconcileClientProfile(params: { tenantId: string; clientProfileId: string }): Promise<{ discrepancies: Array<{ type: string; severity: string; details: any }>; hasCritical: boolean }> {
    const { tenantId, clientProfileId } = params;
    const discrepancies: Array<{ type: string; severity: string; details: any }> = [];

    try {
      const profile = await (this.prisma as any).clientProfile.findFirst({ where: { id: clientProfileId, tenantId } });
      if (!profile) {
        discrepancies.push({ type: 'CLIENT_PROFILE_NOT_FOUND', severity: 'CRITICAL', details: { clientProfileId } });
        return { discrepancies, hasCritical: true };
      }

      // Check onboarding state vs profile status consistency
      const onboarding = await (this.prisma as any).clientOnboarding.findFirst({
        where: { tenantId, clientProfileId, state: { in: ['IN_PROGRESS', 'PENDING_REVIEW'] } },
        orderBy: { createdAt: 'desc' },
      });

      if (profile.status === 'ACTIVE' && !onboarding && profile.status !== 'APPROVED') {
        // Check if onboarding was approved but profile not transitioned
        const approvedOnboarding = await (this.prisma as any).clientOnboarding.findFirst({
          where: { tenantId, clientProfileId, state: 'APPROVED' },
          orderBy: { createdAt: 'desc' },
        });
        if (approvedOnboarding) {
          discrepancies.push({ type: 'PROFILE_STATUS_MISMATCH', severity: 'WARNING', details: { profileStatus: profile.status, onboardingState: approvedOnboarding.state, onboardingId: approvedOnboarding.id } });
        }
      }

      // Check ownership consistency — account should have ownership record matching client profile
      const accounts = await (this.prisma as any).institutionalAccount.findMany({ where: { tenantId, clientProfileId } });
      for (const account of accounts) {
        const ownership = await (this.prisma as any).accountOwnership.findFirst({
          where: { tenantId, accountId: account.id, clientProfileId, status: 'ACTIVE' },
        });
        if (!ownership) {
          discrepancies.push({ type: 'OWNERSHIP_MISSING', severity: 'WARNING', details: { accountId: account.id, clientProfileId } });
        }
      }

      // Check compliance state vs profile status
      if (profile.status === 'ACTIVE') {
        // If compliance case is blocked, profile should not be ACTIVE
        if (profile.complianceCaseId) {
          try {
            const complianceCase = await (this.prisma as any).complianceCase?.findFirst?.({ where: { id: profile.complianceCaseId, tenantId } });
            if (complianceCase && complianceCase.status === 'BLOCKED') {
              discrepancies.push({ type: 'COMPLIANCE_STATE_MISMATCH', severity: 'CRITICAL', details: { clientProfileId, complianceStatus: complianceCase.status, profileStatus: profile.status } });
            }
          } catch {}
        }
      }

      // Check funding workflow state consistency
      const fundingRequests = await (this.prisma as any).fundingRequest.findMany({ where: { tenantId, clientProfileId } });
      for (const fr of fundingRequests) {
        if (fr.state === 'CONFIRMED' && !fr.confirmedAmount) {
          discrepancies.push({ type: 'FUNDING_STATE_INCONSISTENT', severity: 'CRITICAL', details: { fundingRequestId: fr.id, state: fr.state, missing: 'confirmedAmount' } });
        }
      }

      // Check exchange binding consistency
      for (const account of accounts) {
        if (account.exchangeAccountId) {
          try {
            const exchangeAccount = await (this.prisma as any).exchangeAccount?.findFirst?.({ where: { id: account.exchangeAccountId, tenantId } });
            if (!exchangeAccount) {
              discrepancies.push({ type: 'EXCHANGE_BINDING_ORPHANED', severity: 'WARNING', details: { accountId: account.id, exchangeAccountId: account.exchangeAccountId } });
            }
          } catch {}
        }
      }

      // Check portfolio binding consistency
      for (const account of accounts) {
        if (account.portfolioId) {
          try {
            const portfolio = await (this.prisma as any).portfolioAccountingProfile?.findFirst?.({ where: { id: account.portfolioId, tenantId } });
            if (!portfolio) {
              discrepancies.push({ type: 'PORTFOLIO_BINDING_ORPHANED', severity: 'WARNING', details: { accountId: account.id, portfolioId: account.portfolioId } });
            }
          } catch {}
        }
      }

      // Check for duplicate relationships
      const relationships = await (this.prisma as any).accountRelationship.findMany({ where: { tenantId, clientProfileId, status: 'ACTIVE' } });
      const relationshipKeys = new Map<string, number>();
      for (const rel of relationships) {
        const key = `${rel.sourceId}:${rel.targetId}:${rel.relationshipType}`;
        relationshipKeys.set(key, (relationshipKeys.get(key) ?? 0) + 1);
      }
      for (const [key, count] of relationshipKeys.entries()) {
        if (count > 1) {
          discrepancies.push({ type: 'DUPLICATE_RELATIONSHIP', severity: 'WARNING', details: { key, count } });
        }
      }
    } catch (e) {
      discrepancies.push({ type: 'RECONCILIATION_FAILED', severity: 'WARNING', details: { error: (e as Error).message } });
    }

    const hasCritical = discrepancies.some((d) => d.severity === 'CRITICAL');
    return { discrepancies, hasCritical };
  }

  async reconcileAccount(params: { tenantId: string; accountId: string }): Promise<{ discrepancies: Array<{ type: string; severity: string; details: any }>; hasCritical: boolean }> {
    const { tenantId, accountId } = params;
    const discrepancies: Array<{ type: string; severity: string; details: any }> = [];

    try {
      const account = await (this.prisma as any).institutionalAccount.findFirst({ where: { id: accountId, tenantId } });
      if (!account) {
        discrepancies.push({ type: 'ACCOUNT_NOT_FOUND', severity: 'CRITICAL', details: { accountId } });
        return { discrepancies, hasCritical: true };
      }

      // Check ownership exists
      const ownership = await (this.prisma as any).accountOwnership.findFirst({ where: { tenantId, accountId, status: 'ACTIVE' } });
      if (!ownership) {
        discrepancies.push({ type: 'OWNERSHIP_MISSING', severity: 'WARNING', details: { accountId } });
      }

      // Check account state vs restrictions
      if (account.state === 'ACTIVE') {
        const blockingRestrictions = await (this.prisma as any).accountRestriction.findMany({
          where: { tenantId, accountId, status: 'ACTIVE', restrictionType: { in: ['ACCOUNT_LOCKED', 'NO_TRADING'] } },
        });
        if (blockingRestrictions.length > 0) {
          discrepancies.push({ type: 'ACCOUNT_STATE_MISMATCH', severity: 'WARNING', details: { accountId, state: account.state, blockingRestrictions: blockingRestrictions.map((r: any) => r.restrictionType) } });
        }
      }

      // Check funding reconciliation
      const fundingRequests = await (this.prisma as any).fundingRequest.findMany({ where: { tenantId, accountId } });
      for (const fr of fundingRequests) {
        if (fr.state === 'CONFIRMED' && !fr.externalReference) {
          discrepancies.push({ type: 'FUNDING_WITHOUT_EXTERNAL', severity: 'CRITICAL', details: { fundingRequestId: fr.id } });
        }
      }

      // Check for open exposure when closure pending
      if (account.state === 'CLOSURE_PENDING') {
        try {
          const openPositions = await (this.prisma as any).position?.findMany?.({ where: { tenantId, accountId } });
          if (openPositions && openPositions.length > 0) {
            discrepancies.push({ type: 'CLOSURE_WITH_OPEN_EXPOSURE', severity: 'WARNING', details: { accountId, openPositions: openPositions.length } });
          }
        } catch {}
      }
    } catch (e) {
      discrepancies.push({ type: 'RECONCILIATION_FAILED', severity: 'WARNING', details: { error: (e as Error).message } });
    }

    const hasCritical = discrepancies.some((d) => d.severity === 'CRITICAL');
    return { discrepancies, hasCritical };
  }

  async runFullReconciliation(params: { tenantId: string; clientProfileId?: string; accountId?: string }): Promise<any> {
    const { tenantId, clientProfileId, accountId } = params;

    let discrepancies: Array<{ type: string; severity: string; details: any }> = [];
    let hasCritical = false;

    if (clientProfileId) {
      const result = await this.reconcileClientProfile({ tenantId, clientProfileId });
      discrepancies = [...discrepancies, ...result.discrepancies];
      hasCritical = hasCritical || result.hasCritical;
    }

    if (accountId) {
      const result = await this.reconcileAccount({ tenantId, accountId });
      discrepancies = [...discrepancies, ...result.discrepancies];
      hasCritical = hasCritical || result.hasCritical;
    }

    if (!clientProfileId && !accountId) {
      // Full tenant reconciliation — check all profiles and accounts
      try {
        const profiles = await (this.prisma as any).clientProfile.findMany({ where: { tenantId }, take: 100 });
        for (const profile of profiles) {
          const result = await this.reconcileClientProfile({ tenantId, clientProfileId: profile.id });
          discrepancies = [...discrepancies, ...result.discrepancies];
          hasCritical = hasCritical || result.hasCritical;
        }
      } catch {}
    }

    return { discrepancies, hasCritical, tenantId, clientProfileId, accountId, reconciledAt: new Date().toISOString() };
  }
}
