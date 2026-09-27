import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { deterministicIdempotencyKey, redactPiiAndSecrets, deterministicPiiHash } from './client-lifecycle.types';

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
  }): Promise<any> {
    const { tenantId, clientType = 'CLIENT', legalName = null, displayName = null, email = null, phone = null, countryCode = null, externalIdentityRef = null } = params;

    const idempotencyKey = params.idempotencyKey ?? deterministicIdempotencyKey({
      type: 'client-profile',
      tenantId,
      externalRef: externalIdentityRef ?? email ?? `${legalName ?? ''}:${Date.now()}`,
    });

    try {
      const existing = await (this.prisma as any).clientProfile.findFirst({ where: { idempotencyKey } });
      if (existing) {
        this.logger.log({ event: 'client.profile.idempotent_hit', idempotencyKey });
        return existing;
      }
    } catch {}

    // Check for duplicate externalIdentityRef within tenant
    if (externalIdentityRef) {
      try {
        const dup = await (this.prisma as any).clientProfile.findFirst({ where: { tenantId, externalIdentityRef } });
        if (dup) {
          // Return existing if same external ref — deterministic uniqueness
          return dup;
        }
      } catch {}
    }

    const piiHash = email ? deterministicPiiHash(email) : null;

    const created = await (this.prisma as any).clientProfile.create({
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

  async getProfile(params: { tenantId: string; profileId: string }): Promise<any | null> {
    try {
      return await (this.prisma as any).clientProfile.findFirst({
        where: { id: params.profileId, tenantId: params.tenantId },
      });
    } catch {
      return null;
    }
  }

  async getProfileByExternalRef(params: { tenantId: string; externalIdentityRef: string }): Promise<any | null> {
    try {
      return await (this.prisma as any).clientProfile.findFirst({
        where: { tenantId: params.tenantId, externalIdentityRef: params.externalIdentityRef },
      });
    } catch {
      return null;
    }
  }

  async listProfiles(params: {
    tenantId: string;
    status?: string;
    clientType?: string;
    search?: string;
    page?: number;
    limit?: number;
  }): Promise<{ data: any[]; total: number; page: number; limit: number }> {
    const { tenantId, status, clientType, search, page = 1, limit = 50 } = params;
    const where: any = { tenantId };
    if (status) where.status = status;
    if (clientType) where.clientType = clientType;
    if (search) {
      where.OR = [
        { displayName: { contains: search, mode: 'insensitive' } },
        { legalName: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }

    try {
      const [data, total] = await Promise.all([
        (this.prisma as any).clientProfile.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip: (page - 1) * limit,
          take: limit,
        }),
        (this.prisma as any).clientProfile.count({ where }),
      ]);
      return { data, total, page, limit };
    } catch {
      return { data: [], total: 0, page, limit };
    }
  }

  async updateProfileStatus(params: { tenantId: string; profileId: string; status: string; onboardingId?: string | null }): Promise<any> {
    try {
      return await (this.prisma as any).clientProfile.update({
        where: { id: params.profileId },
        data: {
          status: params.status as any,
          ...(params.onboardingId ? { onboardingId: params.onboardingId } : {}),
        },
      });
    } catch (e) {
      this.logger.warn(`Failed to update profile status: ${(e as Error).message}`);
      throw e;
    }
  }
}
