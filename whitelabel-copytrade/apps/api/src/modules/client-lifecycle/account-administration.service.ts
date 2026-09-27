import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { ClientProfileRepository } from './client-profile.repository';
import { ClientPolicyService } from './client-policy.service';
import { LifecycleAuditService } from './lifecycle-audit.service';
import { deterministicIdempotencyKey, InstitutionalAccountState, redactPiiAndSecrets } from './client-lifecycle.types';

/**
 * Creates and manages institutional trading/managed-account records, account type, ownership,
 * lifecycle status, operational metadata, and relationship boundaries.
 */

@Injectable()
export class AccountAdministrationService {
  private readonly logger = new Logger(AccountAdministrationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly profileRepo: ClientProfileRepository,
    private readonly policyService: ClientPolicyService,
    private readonly auditService: LifecycleAuditService,
  ) {}

  async createAccount(params: {
    tenantId: string;
    clientProfileId: string;
    accountType?: string;
    displayName?: string | null;
    ownerId?: string | null;
    ownerType?: string | null;
    operatorId?: string | null;
    correlationId?: string | null;
  }): Promise<any> {
    const { tenantId, clientProfileId, accountType = 'TRADING', displayName = null, ownerId = null, ownerType = null, operatorId = null, correlationId = null } = params;

    const profile = await this.profileRepo.getProfile({ tenantId, profileId: clientProfileId });
    if (!profile) throw new BadRequestException('Client profile not found or tenant mismatch');

    const policy = await this.policyService.resolvePolicy({ tenantId, clientProfileId });

    if (!policy.allowedAccountTypes.includes(accountType)) {
      throw new BadRequestException(`Account type ${accountType} not allowed`);
    }

    const idempotencyKey = deterministicIdempotencyKey({
      type: `institutional-account:${accountType}`,
      tenantId,
      clientProfileId,
      externalRef: `${clientProfileId}:${accountType}:${displayName ?? ''}`,
    });

    try {
      const existing = await (this.prisma as any).institutionalAccount.findFirst({ where: { idempotencyKey } });
      if (existing) return existing;
    } catch {}

    const account = await (this.prisma as any).institutionalAccount.create({
      data: {
        tenantId,
        clientProfileId,
        accountType,
        displayName,
        ownerId: ownerId ?? clientProfileId,
        ownerType: ownerType ?? 'CLIENT',
        state: 'PENDING',
        idempotencyKey,
        metadata: { createdBy: operatorId },
      },
    });

    await this.auditService.log({
      tenantId,
      clientProfileId,
      accountId: account.id,
      action: 'ACCOUNT_CREATED',
      entityType: 'INSTITUTIONAL_ACCOUNT',
      entityId: account.id,
      actorId: operatorId,
      toState: 'PENDING',
      correlationId,
      evidence: { accountType, displayName },
    });

    this.logger.log({ event: 'client.account.created', tenantId, accountId: account.id, accountType });

    return account;
  }

  async getAccount(params: { tenantId: string; accountId: string }): Promise<any | null> {
    try {
      return await (this.prisma as any).institutionalAccount.findFirst({
        where: { id: params.accountId, tenantId: params.tenantId },
      });
    } catch {
      return null;
    }
  }

  async listAccounts(params: {
    tenantId: string;
    clientProfileId?: string;
    state?: string;
    accountType?: string;
    ownerId?: string;
    page?: number;
    limit?: number;
  }): Promise<{ data: any[]; total: number; page: number; limit: number }> {
    const { tenantId, clientProfileId, state, accountType, ownerId, page = 1, limit = 50 } = params;
    const where: any = { tenantId };
    if (clientProfileId) where.clientProfileId = clientProfileId;
    if (state) where.state = state;
    if (accountType) where.accountType = accountType;
    if (ownerId) where.ownerId = ownerId;

    try {
      const [data, total] = await Promise.all([
        (this.prisma as any).institutionalAccount.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        (this.prisma as any).institutionalAccount.count({ where }),
      ]);
      return { data, total, page, limit };
    } catch {
      return { data: [], total: 0, page, limit };
    }
  }

  async updateAccountMetadata(params: {
    tenantId: string;
    accountId: string;
    displayName?: string | null;
    metadata?: any;
    operatorId?: string | null;
  }): Promise<any> {
    const { tenantId, accountId, displayName, metadata, operatorId = null } = params;

    const account = await this.getAccount({ tenantId, accountId });
    if (!account) throw new BadRequestException('Account not found');

    const updated = await (this.prisma as any).institutionalAccount.update({
      where: { id: accountId },
      data: {
        ...(displayName !== undefined ? { displayName } : {}),
        ...(metadata ? { metadata: { ...(account.metadata as any), ...metadata } } : {}),
      },
    });

    await this.auditService.log({
      tenantId,
      clientProfileId: account.clientProfileId,
      accountId,
      action: 'ACCOUNT_UPDATED',
      entityType: 'INSTITUTIONAL_ACCOUNT',
      entityId: accountId,
      actorId: operatorId,
      evidence: { displayName, metadata: redactPiiAndSecrets(metadata) },
    });

    return updated;
  }
}
