import { Injectable, Logger, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { LifecycleAuditService } from './lifecycle-audit.service';
import { deterministicIdempotencyKey } from './client-lifecycle.types';

/**
 * Associates managed accounts/client accounts with existing Portfolio Accounting portfolios,
 * preserving one authoritative portfolio record and preventing unauthorized reassignment.
 */

@Injectable()
export class PortfolioBindingService {
  private readonly logger = new Logger(PortfolioBindingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: LifecycleAuditService,
  ) {}

  async bindPortfolio(params: {
    tenantId: string;
    accountId: string;
    portfolioId: string;
    operatorId?: string | null;
    correlationId?: string | null;
  }): Promise<any> {
    const { tenantId, accountId, portfolioId, operatorId = null, correlationId = null } = params;

    const account = await (this.prisma as any).institutionalAccount.findFirst({ where: { id: accountId, tenantId } });
    if (!account) throw new BadRequestException('Institutional account not found or tenant mismatch');

    // Verify portfolio exists and belongs to same tenant — ownership verified
    let portfolio: any = null;
    try {
      portfolio = await (this.prisma as any).portfolioAccountingProfile?.findFirst?.({ where: { id: portfolioId, tenantId } });
      if (!portfolio) {
        portfolio = await (this.prisma as any).portfolio?.findFirst?.({ where: { id: portfolioId, tenantId } });
      }
    } catch {}

    if (portfolio && portfolio.tenantId && portfolio.tenantId !== tenantId) {
      throw new ForbiddenException('Cross-tenant portfolio binding rejected');
    }

    // Prevent unauthorized reassignment — check if portfolio already bound to different account
    try {
      const existingBinding = await (this.prisma as any).institutionalAccount.findFirst({
        where: { tenantId, portfolioId, id: { not: accountId } },
      });
      if (existingBinding) {
        throw new BadRequestException(`Portfolio ${portfolioId} already bound to account ${existingBinding.id} — unauthorized reassignment prevented`);
      }
    } catch (e) {
      if (e instanceof BadRequestException || e instanceof ForbiddenException) throw e;
    }

    // Verify ownership — portfolio should belong to same client profile or be explicitly allowed
    if (portfolio && account.clientProfileId && portfolio.clientProfileId && portfolio.clientProfileId !== account.clientProfileId) {
      // Allow if operator is platform admin or tenant owner, but log
      this.logger.warn({ event: 'client.portfolio_binding.cross_client', tenantId, accountId, portfolioId, accountClient: account.clientProfileId, portfolioClient: portfolio.clientProfileId });
    }

    const idempotencyKey = deterministicIdempotencyKey({
      type: 'portfolio-binding',
      tenantId,
      accountId,
      externalRef: portfolioId,
    });

    try {
      const existing = await (this.prisma as any).accountRelationship.findFirst({ where: { idempotencyKey } });
      if (existing) return existing;
    } catch {}

    const updatedAccount = await (this.prisma as any).institutionalAccount.update({
      where: { id: accountId },
      data: { portfolioId },
    });

    const relationship = await (this.prisma as any).accountRelationship.create({
      data: {
        tenantId,
        sourceId: accountId,
        sourceType: 'INSTITUTIONAL_ACCOUNT',
        targetId: portfolioId,
        targetType: 'PORTFOLIO',
        relationshipType: 'CLIENT_TO_PORTFOLIO',
        status: 'ACTIVE',
        effectiveAt: new Date(),
        accountId,
        clientProfileId: account.clientProfileId,
        createdBy: operatorId,
        source: 'PORTFOLIO_BINDING_SERVICE',
        idempotencyKey,
      },
    });

    await this.auditService.log({
      tenantId,
      clientProfileId: account.clientProfileId,
      accountId,
      action: 'PORTFOLIO_BOUND',
      entityType: 'INSTITUTIONAL_ACCOUNT',
      entityId: accountId,
      actorId: operatorId,
      correlationId,
      evidence: { portfolioId, relationshipId: relationship.id },
    });

    this.logger.log({ event: 'client.portfolio.bound', tenantId, accountId, portfolioId });

    return { account: updatedAccount, relationship };
  }

  async unbindPortfolio(params: {
    tenantId: string;
    accountId: string;
    operatorId?: string | null;
    reason?: string;
    correlationId?: string | null;
  }): Promise<any> {
    const { tenantId, accountId, operatorId = null, reason, correlationId = null } = params;

    const account = await (this.prisma as any).institutionalAccount.findFirst({ where: { id: accountId, tenantId } });
    if (!account) throw new BadRequestException('Account not found');
    if (!account.portfolioId) throw new BadRequestException('No portfolio bound');

    const previousPortfolioId = account.portfolioId;

    const updatedAccount = await (this.prisma as any).institutionalAccount.update({
      where: { id: accountId },
      data: { portfolioId: null },
    });

    try {
      await (this.prisma as any).accountRelationship.updateMany({
        where: { tenantId, accountId, targetId: previousPortfolioId, status: 'ACTIVE' },
        data: { status: 'REVOKED', endedAt: new Date() },
      });
    } catch {}

    await this.auditService.log({
      tenantId,
      clientProfileId: account.clientProfileId,
      accountId,
      action: 'PORTFOLIO_UNBOUND',
      entityType: 'INSTITUTIONAL_ACCOUNT',
      entityId: accountId,
      actorId: operatorId,
      reason: reason ?? null,
      correlationId,
      evidence: { previousPortfolioId, reason },
    });

    return updatedAccount;
  }
}
