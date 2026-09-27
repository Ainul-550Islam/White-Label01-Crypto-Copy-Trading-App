import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { buildPaginationMeta, normalisePagination } from '@wlct/utils';
import type { PaginatedResult } from '@wlct/shared-types';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type { AuditLogEntity, ListAuditLogsFilter } from './audit.types';

const SORTABLE_FIELDS = ['createdAt', 'action', 'outcome', 'actorEmail'] as const;

/** Data access for the audit trail. Writes are insert-only; nothing updates. */
@Injectable()
export class AuditRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createMany(records: Prisma.AuditLogCreateManyInput[]): Promise<number> {
    if (records.length === 0) {
      return 0;
    }
    const result = await this.prisma.auditLog.createMany({ data: records });
    return result.count;
  }

  async list(filter: ListAuditLogsFilter): Promise<PaginatedResult<AuditLogEntity>> {
    const pagination = normalisePagination(filter, SORTABLE_FIELDS);

    const where: Prisma.AuditLogWhereInput = {
      ...(filter.tenantId ? { tenantId: filter.tenantId } : {}),
      ...(filter.actorId ? { actorId: filter.actorId } : {}),
      ...(filter.action ? { action: filter.action } : {}),
      ...(filter.outcome ? { outcome: filter.outcome } : {}),
      ...(filter.resourceType ? { resourceType: filter.resourceType } : {}),
      ...(filter.resourceId ? { resourceId: filter.resourceId } : {}),
      ...(filter.from || filter.to
        ? {
            createdAt: {
              ...(filter.from ? { gte: filter.from } : {}),
              ...(filter.to ? { lte: filter.to } : {}),
            },
          }
        : {}),
      ...(pagination.search
        ? {
            OR: [
              { action: { contains: pagination.search, mode: 'insensitive' } },
              { actorEmail: { contains: pagination.search, mode: 'insensitive' } },
              { description: { contains: pagination.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [items, totalItems] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { [pagination.sortBy ?? 'createdAt']: pagination.sortOrder },
        skip: pagination.skip,
        take: pagination.take,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return {
      items: items as unknown as AuditLogEntity[],
      pagination: buildPaginationMeta(pagination.page, pagination.limit, totalItems),
    };
  }

  /** Retention job support: audit rows older than the cutoff are purged. */
  async pruneOlderThan(cutoff: Date): Promise<number> {
    const result = await this.prisma.auditLog.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });
    return result.count;
  }
}
