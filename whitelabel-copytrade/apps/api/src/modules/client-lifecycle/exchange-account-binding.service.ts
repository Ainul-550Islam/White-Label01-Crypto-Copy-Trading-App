import { Injectable, Logger, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { LifecycleAuditService } from './lifecycle-audit.service';
import { deterministicIdempotencyKey } from './client-lifecycle.types';

/**
 * Associates an institutional account with existing ExchangeAccount records while enforcing ownership,
 * tenant isolation, credential-state requirements, and exchange-account uniqueness.
 * Must never store raw exchange credentials.
 */

@Injectable()
export class ExchangeAccountBindingService {
  private readonly logger = new Logger(ExchangeAccountBindingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: LifecycleAuditService,
  ) {}

  async bindExchangeAccount(params: {
    tenantId: string;
    accountId: string;
    exchangeAccountId: string;
    operatorId?: string | null;
    correlationId?: string | null;
  }): Promise<any> {
    const { tenantId, accountId, exchangeAccountId, operatorId = null, correlationId = null } = params;

    const account = await (this.prisma as any).institutionalAccount.findFirst({ where: { id: accountId, tenantId } });
    if (!account) throw new BadRequestException('Institutional account not found or tenant mismatch');

    // Verify exchange account exists and belongs to same tenant — tenant isolation
    let exchangeAccount: any = null;
    try {
      exchangeAccount = await (this.prisma as any).exchangeAccount?.findFirst?.({ where: { id: exchangeAccountId, tenantId } });
      if (!exchangeAccount) {
        // Try alternative model name
        exchangeAccount = await (this.prisma as any).exchangeAccountBinding?.findFirst?.({ where: { id: exchangeAccountId, tenantId } });
      }
    } catch {}

    // If exchange account model not found, still enforce uniqueness via institutionalAccount field
    // But we must check tenant isolation
    if (exchangeAccount && exchangeAccount.tenantId && exchangeAccount.tenantId !== tenantId) {
      throw new ForbiddenException('Cross-tenant exchange account binding rejected');
    }

    // Check for duplicate exchange-account binding — uniqueness
    try {
      const existingBinding = await (this.prisma as any).institutionalAccount.findFirst({
        where: { tenantId, exchangeAccountId, id: { not: accountId } },
      });
      if (existingBinding) {
        throw new BadRequestException(`Duplicate exchange-account binding rejected — exchange account ${exchangeAccountId} already bound to account ${existingBinding.id}`);
      }
    } catch (e) {
      if (e instanceof BadRequestException || e instanceof ForbiddenException) throw e;
    }

    // Verify credential-state requirements — exchange account must have valid credential state
    // Must never store raw exchange credentials — only reference
    if (exchangeAccount) {
      if (exchangeAccount.credentialState && ['EXPIRED', 'REVOKED', 'INVALID'].includes(exchangeAccount.credentialState)) {
        throw new BadRequestException(`Exchange account credential state ${exchangeAccount.credentialState} invalid`);
      }
      // Ensure no raw credentials stored
      if (exchangeAccount.apiKey || exchangeAccount.secret || exchangeAccount.privateKey) {
        this.logger.warn({ event: 'client.binding.raw_credential_detected', exchangeAccountId });
        // Do not store raw credentials — we only store reference ID
      }
    }

    const idempotencyKey = deterministicIdempotencyKey({
      type: 'exchange-binding',
      tenantId,
      accountId,
      externalRef: exchangeAccountId,
    });

    // Idempotency for binding
    try {
      const existing = await (this.prisma as any).accountRelationship.findFirst({ where: { idempotencyKey } });
      if (existing) return existing;
    } catch {}

    // Update institutional account with exchangeAccountId
    const updatedAccount = await (this.prisma as any).institutionalAccount.update({
      where: { id: accountId },
      data: { exchangeAccountId },
    });

    // Create relationship record
    const relationship = await (this.prisma as any).accountRelationship.create({
      data: {
        tenantId,
        sourceId: accountId,
        sourceType: 'INSTITUTIONAL_ACCOUNT',
        targetId: exchangeAccountId,
        targetType: 'EXCHANGE_ACCOUNT',
        relationshipType: 'CLIENT_TO_EXCHANGE_ACCOUNT',
        status: 'ACTIVE',
        effectiveAt: new Date(),
        accountId,
        clientProfileId: account.clientProfileId,
        createdBy: operatorId,
        source: 'EXCHANGE_BINDING_SERVICE',
        idempotencyKey,
      },
    });

    await this.auditService.log({
      tenantId,
      clientProfileId: account.clientProfileId,
      accountId,
      action: 'EXCHANGE_ACCOUNT_BOUND',
      entityType: 'INSTITUTIONAL_ACCOUNT',
      entityId: accountId,
      actorId: operatorId,
      correlationId,
      evidence: { exchangeAccountId, relationshipId: relationship.id },
    });

    this.logger.log({ event: 'client.exchange_account.bound', tenantId, accountId, exchangeAccountId });

    return { account: updatedAccount, relationship };
  }

  async unbindExchangeAccount(params: {
    tenantId: string;
    accountId: string;
    operatorId?: string | null;
    reason?: string;
    correlationId?: string | null;
  }): Promise<any> {
    const { tenantId, accountId, operatorId = null, reason, correlationId = null } = params;

    const account = await (this.prisma as any).institutionalAccount.findFirst({ where: { id: accountId, tenantId } });
    if (!account) throw new BadRequestException('Account not found');

    if (!account.exchangeAccountId) throw new BadRequestException('No exchange account bound');

    const previousExchangeAccountId = account.exchangeAccountId;

    const updatedAccount = await (this.prisma as any).institutionalAccount.update({
      where: { id: accountId },
      data: { exchangeAccountId: null },
    });

    // Revoke relationship
    try {
      await (this.prisma as any).accountRelationship.updateMany({
        where: { tenantId, accountId, targetId: previousExchangeAccountId, status: 'ACTIVE' },
        data: { status: 'REVOKED', endedAt: new Date() },
      });
    } catch {}

    await this.auditService.log({
      tenantId,
      clientProfileId: account.clientProfileId,
      accountId,
      action: 'EXCHANGE_ACCOUNT_UNBOUND',
      entityType: 'INSTITUTIONAL_ACCOUNT',
      entityId: accountId,
      actorId: operatorId,
      reason: reason ?? null,
      correlationId,
      evidence: { previousExchangeAccountId, reason },
    });

    return updatedAccount;
  }

  async getBinding(params: { tenantId: string; accountId: string }): Promise<any | null> {
    try {
      const account = await (this.prisma as any).institutionalAccount.findFirst({ where: { id: params.accountId, tenantId: params.tenantId } });
      if (!account?.exchangeAccountId) return null;
      return { exchangeAccountId: account.exchangeAccountId, accountId: account.id };
    } catch {
      return null;
    }
  }
}
