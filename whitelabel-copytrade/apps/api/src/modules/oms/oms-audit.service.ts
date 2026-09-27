import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { OmsAuditEventType } from './oms.types';
import { randomUUID } from 'crypto';

/**
 * OMS Audit Service — immutable audit events for order intent, submit, ack, fill, cancel, replace,
 * rejection, reconciliation, recovery, operator actions.
 * Never logs API keys, exchange secrets, private keys, tokens, wallet credentials.
 */

@Injectable()
export class OmsAuditService {
  private readonly logger = new Logger(OmsAuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  private sanitizeMetadata(metadata: Record<string, unknown> | null): Record<string, unknown> | null {
    if (!metadata) return null;
    const forbiddenKeys = ['apiKey', 'secret', 'privateKey', 'token', 'credential', 'password', 'apiSecret', 'passphrase', 'wallet', 'mnemonic', 'seed'];
    const sanitized: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(metadata)) {
      const lower = k.toLowerCase();
      if (forbiddenKeys.some((fk) => lower.includes(fk))) {
        sanitized[k] = '[REDACTED]';
      } else if (typeof v === 'object' && v !== null) {
        sanitized[k] = this.sanitizeMetadata(v as any);
      } else {
        sanitized[k] = v;
      }
    }
    return sanitized;
  }

  async recordEvent(params: {
    tenantId: string;
    eventType: OmsAuditEventType | string;
    orderIntentId?: string | null;
    internalOrderId?: string | null;
    fillId?: string | null;
    tradeId?: string | null;
    accountId?: string | null;
    symbol?: string | null;
    venue?: string | null;
    strategyId?: string | null;
    traderId?: string | null;
    followerId?: string | null;
    actorId?: string | null;
    actorType?: string;
    reason?: string | null;
    correlationId?: string | null;
    requestId?: string | null;
    policyVersion?: string | null;
    riskRuleId?: string | null;
    metadata?: Record<string, unknown> | null;
  }) {
    const { tenantId, eventType, orderIntentId, internalOrderId, fillId, tradeId, accountId, symbol, venue, strategyId, traderId, followerId, actorId, actorType, reason, correlationId, requestId, policyVersion, riskRuleId, metadata } = params;

    const safeMetadata = this.sanitizeMetadata(metadata ?? null);

    const auditData = {
      id: randomUUID(),
      tenantId,
      eventType,
      orderIntentId: orderIntentId ?? null,
      internalOrderId: internalOrderId ?? null,
      fillId: fillId ?? null,
      tradeId: tradeId ?? null,
      accountId: accountId ?? null,
      symbol: symbol ?? null,
      venue: venue ?? null,
      strategyId: strategyId ?? null,
      traderId: traderId ?? null,
      followerId: followerId ?? null,
      actorId: actorId ?? null,
      actorType: actorType ?? 'SYSTEM',
      reason: reason ? reason.slice(0, 1000) : null,
      correlationId: correlationId ?? null,
      requestId: requestId ?? null,
      policyVersion: policyVersion ?? null,
      riskRuleId: riskRuleId ?? null,
      metadata: safeMetadata,
      timestamp: new Date().toISOString(),
    };

    try {
      const created = await (this.prisma as any).omsAudit.create({ data: auditData });
      // Also write to canonical auditLog for platform-wide audit
      await this.prisma.auditLog.create({
        data: {
          tenantId,
          actorId: actorId ?? undefined,
          actorType: (actorType as any) ?? 'SYSTEM',
          action: eventType,
          resourceType: 'OMS_ORDER',
          resourceId: orderIntentId ?? internalOrderId ?? tradeId ?? fillId ?? undefined,
          description: `${eventType} ${orderIntentId ?? ''} ${symbol ?? ''} ${reason ?? ''}`.slice(0, 500),
          metadata: { ...safeMetadata, correlationId, requestId, policyVersion, riskRuleId } as any,
          requestId: requestId ?? undefined,
          correlationId: correlationId ?? undefined,
        },
      });
      this.logger.log(`OMS audit ${eventType} intent ${orderIntentId ?? 'n/a'} tenant ${tenantId} actor ${actorId ?? 'system'}`);
      return created;
    } catch (e) {
      // Fallback to auditLog only if omsAudit model missing
      this.logger.warn(`OmsAudit model missing, using auditLog only: ${(e as Error).message}`);
      try {
        const fallback = await this.prisma.auditLog.create({
          data: {
            tenantId,
            actorId: actorId ?? undefined,
            actorType: (actorType as any) ?? 'SYSTEM',
            action: eventType,
            resourceType: 'OMS_ORDER',
            resourceId: orderIntentId ?? internalOrderId ?? undefined,
            description: `${eventType} ${orderIntentId ?? ''} ${symbol ?? ''} ${reason ?? ''}`.slice(0, 500),
            metadata: { ...safeMetadata, correlationId, requestId, policyVersion, riskRuleId, orderIntentId, fillId, tradeId } as any,
            requestId: requestId ?? undefined,
            correlationId: correlationId ?? undefined,
          },
        });
        return fallback;
      } catch {
        return auditData;
      }
    }
  }

  async getAuditForIntent(tenantId: string, orderIntentId: string) {
    try {
      return await (this.prisma as any).omsAudit.findMany({ where: { tenantId, orderIntentId }, orderBy: { timestamp: 'asc' } });
    } catch {
      return this.prisma.auditLog.findMany({ where: { tenantId, resourceId: orderIntentId }, orderBy: { createdAt: 'asc' } });
    }
  }

  async getAuditHistory(params: { tenantId: string; accountId?: string; symbol?: string; eventType?: string; from?: Date; to?: Date; page?: number; limit?: number }) {
    const { tenantId, accountId, symbol, eventType, from, to, page = 1, limit = 20 } = params;
    try {
      const where: any = {
        tenantId,
        ...(accountId ? { accountId } : {}),
        ...(symbol ? { symbol } : {}),
        ...(eventType ? { eventType } : {}),
        ...(from || to ? { timestamp: { gte: from?.toISOString(), lte: to?.toISOString() } } : {}),
      };
      const [items, total] = await Promise.all([
        (this.prisma as any).omsAudit.findMany({ where, orderBy: { timestamp: 'desc' }, skip: (page - 1) * limit, take: limit }),
        (this.prisma as any).omsAudit.count({ where }),
      ]);
      return { items, total, page, limit };
    } catch {
      const where: any = {
        tenantId,
        ...(eventType ? { action: eventType } : {}),
        ...(from || to ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
      };
      const [items, total] = await Promise.all([
        this.prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit }),
        this.prisma.auditLog.count({ where }),
      ]);
      return { items, total, page, limit };
    }
  }
}
