import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ExchangeVenue, ExchangeEnvironment, sanitizeExchangeMetadata } from './exchange.types';
import { randomUUID } from 'crypto';

export enum ExchangeAuditEvent {
  EXCHANGE_ACCOUNT_CONNECTED = 'EXCHANGE_ACCOUNT_CONNECTED',
  EXCHANGE_ACCOUNT_ACTIVATED = 'EXCHANGE_ACCOUNT_ACTIVATED',
  EXCHANGE_ACCOUNT_DISABLED = 'EXCHANGE_ACCOUNT_DISABLED',
  EXCHANGE_ACCOUNT_REVOKED = 'EXCHANGE_ACCOUNT_REVOKED',
  CREDENTIAL_CREATED = 'CREDENTIAL_CREATED',
  CREDENTIAL_ROTATED = 'CREDENTIAL_ROTATED',
  CREDENTIAL_REVOKED = 'CREDENTIAL_REVOKED',
  CONNECTIVITY_CHECKED = 'CONNECTIVITY_CHECKED',
  CAPABILITIES_DISCOVERED = 'CAPABILITIES_DISCOVERED',
  BALANCE_SYNCED = 'BALANCE_SYNCED',
  POSITION_SYNCED = 'POSITION_SYNCED',
  ORDER_SYNCED = 'ORDER_SYNCED',
  EXCHANGE_HEALTH_CHANGED = 'EXCHANGE_HEALTH_CHANGED',
  RATE_LIMIT_TRIGGERED = 'RATE_LIMIT_TRIGGERED',
  ROUTING_DECISION = 'ROUTING_DECISION',
}

export interface ExchangeAuditInput {
  tenantId: string;
  accountId: string;
  venue: ExchangeVenue;
  environment: ExchangeEnvironment;
  event: ExchangeAuditEvent | string;
  result: 'SUCCESS' | 'FAILURE';
  actorId?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  safeMetadata?: Record<string, any> | null;
  ipHash?: string | null;
  requestId?: string | null;
}

/**
 * Structured audit events for account connection, credential lifecycle, sync, health failures, routing decisions, and privileged exchange operations without secrets.
 * Never log API key, secret, passphrase, private key, withdrawal credential, authentication token.
 */
@Injectable()
export class ExchangeAuditService {
  private readonly logger = new Logger(ExchangeAuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(input: ExchangeAuditInput): Promise<void> {
    const safeMeta = input.safeMetadata ? sanitizeExchangeMetadata(input.safeMetadata) : {};

    try {
      // Try to persist to AuditLog with safe metadata
      await this.prisma.auditLog.create({
        data: {
          id: randomUUID(),
          tenantId: input.tenantId,
          actorType: input.actorId ? 'USER' : 'SYSTEM',
          actorId: input.actorId || null,
          action: input.event,
          outcome: input.result === 'SUCCESS' ? 'SUCCESS' : 'FAILURE',
          resourceType: input.targetType || 'ExchangeAccount',
          resourceId: input.targetId || input.accountId,
          description: `${input.event} venue=${input.venue} env=${input.environment} account=${input.accountId} result=${input.result}`.substring(0, 500),
          metadata: {
            venue: input.venue,
            environment: input.environment,
            accountId: input.accountId,
            ...safeMeta,
          },
          ipHash: input.ipHash || null,
          requestId: input.requestId || null,
          createdAt: new Date(),
        },
      });

      // Log structured without secrets
      const logPayload = {
        event: 'exchange.audit',
        auditEvent: input.event,
        tenantId: input.tenantId,
        accountId: input.accountId,
        venue: input.venue,
        environment: input.environment,
        result: input.result,
        actorId: input.actorId,
        requestId: input.requestId,
      };

      if (input.result === 'FAILURE') {
        this.logger.warn(logPayload, `${input.event} failed tenant=${input.tenantId} account=${input.accountId}`);
      } else {
        this.logger.log(`${input.event} tenant=${input.tenantId} account=${input.accountId} venue=${input.venue} env=${input.environment}`);
      }
    } catch (e: any) {
      this.logger.error(`Failed to record exchange audit event ${input.event}: ${e.message}`);
    }
  }

  async listAuditLogs(tenantId: string, filters?: { accountId?: string; venue?: ExchangeVenue; event?: string; fromDate?: Date; toDate?: Date; page?: number; limit?: number }): Promise<{ data: any[]; total: number; page: number; limit: number }> {
    const page = filters?.page || 1;
    const limit = filters?.limit || 20;
    const skip = (page - 1) * limit;

    try {
      const where: any = { tenantId };
      if (filters?.accountId) where.resourceId = filters.accountId;
      if (filters?.event) where.action = filters.event;
      if (filters?.venue) where.metadata = { path: ['venue'], equals: filters.venue };
      if (filters?.fromDate || filters?.toDate) {
        where.createdAt = {};
        if (filters.fromDate) where.createdAt.gte = filters.fromDate;
        if (filters.toDate) where.createdAt.lte = filters.toDate;
      }

      const [data, total] = await this.prisma.$transaction([
        this.prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: limit }),
        this.prisma.auditLog.count({ where }),
      ]);

      return { data, total, page, limit };
    } catch {
      return { data: [], total: 0, page, limit };
    }
  }
}
