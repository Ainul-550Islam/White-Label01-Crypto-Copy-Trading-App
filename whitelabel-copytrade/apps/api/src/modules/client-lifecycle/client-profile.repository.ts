// # Responsibility: persist canonical tenant profiles without treating failed uniqueness reads as permission to create or update another tenant.
import { Injectable, Logger } from '@nestjs/common';
import { Prisma, ClientProfileStatus as StoredProfileStatus, type ClientProfile } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { deterministicIdempotencyKey, deterministicPiiHash, lifecycleEnum } from './client-lifecycle.types';

/**
 * Persists tenant-scoped client profiles and relationship references with deterministic uniqueness,
 * idempotency, and safe query isolation.
 */

@Injectable()
export class ClientProfileRepository {
  private readonly logger = new Logger(ClientProfileRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  async createProfile(params: {
    tenantId: string;
    clientType?: string;
    legalName?: string | null;
    displayName?: string | null;
    email?: string | null;
    phone?: string | null;
    countryCode?: string | null;
    externalIdentityRef?: string | null;
    idempotencyKey?: string;
  }): Promise<ClientProfile> {
    const { tenantId, clientType = 'CLIENT', legalName = null, displayName = null, email = null, phone = null, countryCode = null, externalIdentityRef = null } = params;

    const idempotencyKey = params.idempotencyKey ?? deterministicIdempotencyKey({
      type: 'client-profile',
      tenantId,
      externalRef: externalIdentityRef ?? email ?? `${legalName ?? ''}:${Date.now()}`,
    });

    const existing = await this.prisma.clientProfile.findFirst({ where: { tenantId, idempotencyKey } });
    if (existing) {
      this.logger.log({ event: 'client.profile.idempotent_hit', idempotencyKey });
      return existing;
    }

    // Check for duplicate externalIdentityRef within tenant
    if (externalIdentityRef) {
      const dup = await this.prisma.clientProfile.findFirst({ where: { tenantId, externalIdentityRef } });
      if (dup) return dup;
    }

    const piiHash = email ? deterministicPiiHash(email) : null;

    const created = await this.prisma.clientProfile.create({
      data: {
        tenantId,
        clientType,
        legalName,
        displayName,
        email,
        phone,
        countryCode,
        externalIdentityRef,
        piiHash,
        idempotencyKey,
        status: 'PENDING',
      },
    });

    return created;
  }

  async getProfile(params: { tenantId: string; profileId: string }): Promise<ClientProfile | null> {
    return this.prisma.withTenantRls(params.tenantId, (tx) => tx.clientProfile.findFirst({
      where: { id: params.profileId, tenantId: params.tenantId },
    }));
  }

  async getProfileByExternalRef(params: { tenantId: string; externalIdentityRef: string }): Promise<ClientProfile | null> {
    return await this.prisma.clientProfile.findFirst({
      where: { tenantId: params.tenantId, externalIdentityRef: params.externalIdentityRef },
    });
  }

  async listProfiles(params: {
    tenantId: string;
    status?: string;
    clientType?: string;
    search?: string;
    page?: number;
    limit?: number;
  }): Promise<{ data: ClientProfile[]; total: number; page: number; limit: number }> {
    const { tenantId, status, clientType, search, page = 1, limit = 50 } = params;
    const where: Prisma.ClientProfileWhereInput = { tenantId };
    if (status) where.status = lifecycleEnum(Object.values(StoredProfileStatus), status, 'profile status');
    if (clientType) where.clientType = clientType;
    if (search) {
      where.OR = [
        { displayName: { contains: search, mode: 'insensitive' } },
        { legalName: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.clientProfile.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.clientProfile.count({ where }),
    ]);
    return { data, total, page, limit };
  }

  async updateProfileStatus(params: { tenantId: string; profileId: string; status: string; onboardingId?: string | null }): Promise<ClientProfile> {
    try {
      return await this.prisma.clientProfile.update({
        where: { id: params.profileId, tenantId: params.tenantId },
        data: {
          status: lifecycleEnum(Object.values(StoredProfileStatus), params.status, 'profile status'),
          ...(params.onboardingId ? { onboardingId: params.onboardingId } : {}),
        },
      });
    } catch (e) {
      this.logger.warn(`Failed to update profile status: ${(e as Error).message}`);
      throw e;
    }
  }
}
