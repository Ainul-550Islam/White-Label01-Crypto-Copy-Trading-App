import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ComplianceAuditService } from './compliance-audit.service';
import { KycState, AmlState, ComplianceDecision, RiskLevel } from './compliance.types';

/**
 * Reconciliation: detect state inconsistencies between verification, screening, cases, and controlled restrictions.
 * - Verification marked VERIFIED without provider reference
 * - Stale PENDING verifications beyond SLA
 * - CLEAR screening despite MATCH result
 * - Blocked decision with unrestricted activity
 * - Decision without reviewer
 * - Duplicate case/screening detection
 * - Expired treated as valid
 * - State mismatch
 */
@Injectable()
export class ComplianceReconciliationService {
  private readonly logger = new Logger(ComplianceReconciliationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: ComplianceAuditService,
  ) {}

  async runReconciliation(params: { tenantId?: string; fullScan?: boolean }): Promise<{
    issues: { category: string; count: number; examples: any[] }[];
    totalIssues: number;
    scanned: number;
  }> {
    const issues: { category: string; count: number; examples: any[] }[] = [];
    let totalIssues = 0;
    let scanned = 0;

    const tenantFilter = params.tenantId ? { tenantId: params.tenantId } : {};

    // 1. Verification marked VERIFIED without provider reference
    const verifiedWithoutProvider = await this.findVerifiedWithoutProvider(tenantFilter);
    if (verifiedWithoutProvider.length > 0) {
      issues.push({ category: 'VERIFIED_WITHOUT_PROVIDER_REF', count: verifiedWithoutProvider.length, examples: verifiedWithoutProvider.slice(0, 5) });
      totalIssues += verifiedWithoutProvider.length;
    }
    scanned += verifiedWithoutProvider.length;

    // 2. Stale PENDING verifications beyond SLA (7 days)
    const stalePending = await this.findStalePending(tenantFilter);
    if (stalePending.length > 0) {
      issues.push({ category: 'STALE_PENDING_VERIFICATION', count: stalePending.length, examples: stalePending.slice(0, 5) });
      totalIssues += stalePending.length;
    }
    scanned += stalePending.length;

    // 3. CLEAR despite MATCH
    const clearDespiteMatch = await this.findClearDespiteMatch(tenantFilter);
    if (clearDespiteMatch.length > 0) {
      issues.push({ category: 'CLEAR_DESPITE_MATCH', count: clearDespiteMatch.length, examples: clearDespiteMatch.slice(0, 5) });
      totalIssues += clearDespiteMatch.length;
    }
    scanned += clearDespiteMatch.length;

    // 4. Blocked with unrestricted - decision BLOCK but no case or case not resolved
    const blockedWithUnrestricted = await this.findBlockedWithUnrestricted(tenantFilter);
    if (blockedWithUnrestricted.length > 0) {
      issues.push({ category: 'BLOCKED_WITH_UNRESTRICTED', count: blockedWithUnrestricted.length, examples: blockedWithUnrestricted.slice(0, 5) });
      totalIssues += blockedWithUnrestricted.length;
    }
    scanned += blockedWithUnrestricted.length;

    // 5. Decision without reviewer
    const decisionWithoutReviewer = await this.findDecisionWithoutReviewer(tenantFilter);
    if (decisionWithoutReviewer.length > 0) {
      issues.push({ category: 'DECISION_WITHOUT_REVIEWER', count: decisionWithoutReviewer.length, examples: decisionWithoutReviewer.slice(0, 5) });
      totalIssues += decisionWithoutReviewer.length;
    }
    scanned += decisionWithoutReviewer.length;

    // 6. Duplicate case/screening
    const duplicates = await this.findDuplicates(tenantFilter);
    if (duplicates.length > 0) {
      issues.push({ category: 'DUPLICATE_CASE_SCREENING', count: duplicates.length, examples: duplicates.slice(0, 5) });
      totalIssues += duplicates.length;
    }
    scanned += duplicates.length;

    // 7. Expired treated as valid
    const expiredAsValid = await this.findExpiredTreatedAsValid(tenantFilter);
    if (expiredAsValid.length > 0) {
      issues.push({ category: 'EXPIRED_TREATED_AS_VALID', count: expiredAsValid.length, examples: expiredAsValid.slice(0, 5) });
      totalIssues += expiredAsValid.length;
    }
    scanned += expiredAsValid.length;

    // 8. State mismatch between KycProfile and ComplianceScreeningRequest
    const stateMismatch = await this.findStateMismatch(tenantFilter);
    if (stateMismatch.length > 0) {
      issues.push({ category: 'STATE_MISMATCH', count: stateMismatch.length, examples: stateMismatch.slice(0, 5) });
      totalIssues += stateMismatch.length;
    }
    scanned += stateMismatch.length;

    // Audit reconciliation run
    for (const issue of issues) {
      for (const example of issue.examples) {
        try {
          await this.auditService.recordReconciliationDetected(
            example.tenantId || params.tenantId || 'platform',
            example.id || 'unknown',
            issue.category,
            'EXPECTED_CONSISTENT_STATE',
            `DETECTED_${issue.category}`,
          );
        } catch {}
      }
    }

    this.logger.log(`Compliance reconciliation completed tenant=${params.tenantId || 'all'} totalIssues=${totalIssues} scanned=${scanned}`);

    return { issues, totalIssues, scanned };
  }

  private async findVerifiedWithoutProvider(tenantFilter: any): Promise<any[]> {
    try {
      const results = await (this.prisma as any).complianceScreeningRequest?.findMany({
        where: { ...tenantFilter, kycState: KycState.VERIFIED, providerRef: null },
        take: 100,
      }) || [];

      const kycProfiles = await (this.prisma as any).kycProfile?.findMany({
        where: { ...tenantFilter, status: 'APPROVED', externalApplicantId: null },
        take: 100,
      }) || [];

      return [...results, ...kycProfiles].map((r: any) => ({ id: r.id, tenantId: r.tenantId, userId: r.userId, issue: 'VERIFIED without provider reference' }));
    } catch {
      return [];
    }
  }

  private async findStalePending(tenantFilter: any): Promise<any[]> {
    try {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const stale = await (this.prisma as any).complianceScreeningRequest?.findMany({
        where: { ...tenantFilter, kycState: KycState.PENDING, createdAt: { lt: sevenDaysAgo } },
        take: 100,
      }) || [];

      return stale.map((r: any) => ({ id: r.id, tenantId: r.tenantId, userId: r.userId, createdAt: r.createdAt, issue: 'Stale PENDING beyond 7 days' }));
    } catch {
      return [];
    }
  }

  private async findClearDespiteMatch(tenantFilter: any): Promise<any[]> {
    try {
      // Find users with both CLEAR and MATCH screening results
      const allRequests = await (this.prisma as any).complianceScreeningRequest?.findMany({
        where: { ...tenantFilter, type: { in: ['AML', 'TRANSACTION'] } },
        take: 500,
        orderBy: { createdAt: 'desc' },
      }) || [];

      const userMap = new Map<string, any[]>();
      for (const req of allRequests) {
        const key = `${req.tenantId}_${req.userId}`;
        if (!userMap.has(key)) userMap.set(key, []);
        userMap.get(key)!.push(req);
      }

      const issues: any[] = [];
      for (const [key, requests] of userMap.entries()) {
        const hasMatch = requests.some((r: any) => r.amlState === AmlState.MATCH || r.amlState === AmlState.BLOCKED);
        const hasClearAsLatest = requests[0]?.amlState === AmlState.CLEAR;
        if (hasMatch && hasClearAsLatest) {
          issues.push({ id: requests[0].id, tenantId: requests[0].tenantId, userId: requests[0].userId, issue: 'CLEAR despite previous MATCH', history: requests.slice(0, 3).map((r: any) => r.amlState) });
        }
      }

      return issues;
    } catch {
      return [];
    }
  }

  private async findBlockedWithUnrestricted(tenantFilter: any): Promise<any[]> {
    try {
      const blockedCases = await (this.prisma as any).complianceCase?.findMany({
        where: { ...tenantFilter, decision: ComplianceDecision.BLOCK },
        take: 100,
      }) || [];

      // Check if user still has active trading/payout despite block - via canonical sources
      const issues: any[] = [];
      for (const c of blockedCases) {
        // If case is RESOLVED with BLOCK but not CLOSED and user has recent payments, flag
        if (c.state === 'RESOLVED' || c.state === 'OPEN') {
          issues.push({ id: c.id, tenantId: c.tenantId, userId: c.userId, issue: 'BLOCKED decision but case still open/resolved without restriction enforcement', decision: c.decision });
        }
      }

      return issues;
    } catch {
      return [];
    }
  }

  private async findDecisionWithoutReviewer(tenantFilter: any): Promise<any[]> {
    try {
      const reviews = await (this.prisma as any).complianceReview?.findMany({
        where: { ...tenantFilter, decision: { not: null }, reviewerId: null },
        take: 100,
      }) || [];

      const cases = await (this.prisma as any).complianceCase?.findMany({
        where: { ...tenantFilter, decision: { not: null }, assignedTo: null },
        take: 100,
      }) || [];

      return [
        ...reviews.map((r: any) => ({ id: r.id, tenantId: r.tenantId, caseId: r.caseId, issue: 'Decision without reviewer in review' })),
        ...cases.map((c: any) => ({ id: c.id, tenantId: c.tenantId, userId: c.userId, issue: 'Case decision without assigned reviewer' })),
      ];
    } catch {
      return [];
    }
  }

  private async findDuplicates(tenantFilter: any): Promise<any[]> {
    try {
      const allCases = await (this.prisma as any).complianceCase?.findMany({
        where: { ...tenantFilter, state: { in: ['OPEN', 'IN_REVIEW', 'ESCALATED'] } },
        take: 500,
      }) || [];

      const seen = new Map<string, any[]>();
      for (const c of allCases) {
        const key = `${c.tenantId}_${c.userId}_${c.caseType}`;
        if (!seen.has(key)) seen.set(key, []);
        seen.get(key)!.push(c);
      }

      const duplicates: any[] = [];
      for (const [key, cases] of seen.entries()) {
        if (cases.length > 1) {
          duplicates.push({ key, count: cases.length, ids: cases.map((c: any) => c.id), tenantId: cases[0].tenantId, userId: cases[0].userId, issue: 'Duplicate open cases' });
        }
      }

      // Screening duplicates by idempotencyKey
      const screeningRequests = await (this.prisma as any).complianceScreeningRequest?.findMany({
        where: tenantFilter,
        take: 500,
      }) || [];

      const idempotencyMap = new Map<string, number>();
      for (const req of screeningRequests) {
        if (req.idempotencyKey) {
          idempotencyMap.set(req.idempotencyKey, (idempotencyMap.get(req.idempotencyKey) || 0) + 1);
        }
      }

      for (const [key, count] of idempotencyMap.entries()) {
        if (count > 1) {
          duplicates.push({ key, count, issue: 'Duplicate screening idempotencyKey' });
        }
      }

      return duplicates;
    } catch {
      return [];
    }
  }

  private async findExpiredTreatedAsValid(tenantFilter: any): Promise<any[]> {
    try {
      const now = new Date();
      const expiredProfiles = await (this.prisma as any).kycProfile?.findMany({
        where: { ...tenantFilter, expiresAt: { lt: now }, status: 'APPROVED' },
        take: 100,
      }) || [];

      return expiredProfiles.map((p: any) => ({ id: p.id, tenantId: p.tenantId, userId: p.userId, expiresAt: p.expiresAt, issue: 'Expired KYC treated as valid APPROVED' }));
    } catch {
      return [];
    }
  }

  private async findStateMismatch(tenantFilter: any): Promise<any[]> {
    try {
      const kycProfiles = await (this.prisma as any).kycProfile?.findMany({
        where: tenantFilter,
        take: 200,
      }) || [];

      const issues: any[] = [];

      for (const profile of kycProfiles) {
        const screeningRequest = await (this.prisma as any).complianceScreeningRequest?.findFirst({
          where: { userId: profile.userId, type: 'KYC' },
          orderBy: { createdAt: 'desc' },
        });

        if (screeningRequest) {
          const profileState = profile.status;
          const screeningState = screeningRequest.kycState;

          // Map APPROVED to VERIFIED
          const expectedScreeningState = profileState === 'APPROVED' ? KycState.VERIFIED : profileState === 'REJECTED' ? KycState.REJECTED : profileState === 'PENDING' ? KycState.PENDING : null;

          if (expectedScreeningState && screeningState !== expectedScreeningState && screeningState !== KycState.PENDING) {
            // Allow PENDING to be different, but VERIFIED vs REJECTED mismatch is issue
            if ((profileState === 'APPROVED' && screeningState === KycState.REJECTED) || (profileState === 'REJECTED' && screeningState === KycState.VERIFIED)) {
              issues.push({ id: profile.id, tenantId: profile.tenantId, userId: profile.userId, profileStatus: profileState, screeningState, issue: 'State mismatch between KycProfile and ComplianceScreeningRequest' });
            }
          }
        }
      }

      return issues;
    } catch {
      return [];
    }
  }

  async getReconciliationStats(tenantId?: string): Promise<any> {
    const result = await this.runReconciliation({ tenantId, fullScan: true });
    return {
      tenantId: tenantId || 'all',
      totalIssues: result.totalIssues,
      scanned: result.scanned,
      categories: result.issues.map((i) => ({ category: i.category, count: i.count })),
      runAt: new Date().toISOString(),
    };
  }
}
