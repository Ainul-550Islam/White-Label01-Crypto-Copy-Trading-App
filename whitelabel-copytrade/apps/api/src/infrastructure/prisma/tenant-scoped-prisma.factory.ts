import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from './prisma.service';

/**
 * Models that carry a `tenantId` column and must always be filtered by it.
 * Adding a new tenant-scoped model in a later part means adding it here; the
 * extension then enforces isolation for every query automatically.
 */
const TENANT_SCOPED_MODELS = new Set<string>([
  'User',
  'UserSession',
  'RefreshToken',
  'VerificationToken',
  'LoginAttempt',
  'TenantSetting',
  'TenantDomain',
  'TenantFeatureFlag',
  'TenantSubscription',
  'TenantApiKey',
  'AuditLog',
  'SecurityEvent',
  'KycProfile',
  'Notification',
  'UserRole',
]);

const READ_OPERATIONS = new Set([
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'findUnique',
  'findUniqueOrThrow',
  'count',
  'aggregate',
  'groupBy',
]);

const WRITE_FILTER_OPERATIONS = new Set([
  'update',
  'updateMany',
  'delete',
  'deleteMany',
  'upsert',
]);

export type TenantScopedClient = ReturnType<TenantScopedPrismaFactory['forTenant']>;

/**
 * Produces a Prisma client that is physically incapable of reading or writing
 * another tenant's rows.
 *
 * Defence in depth: services still pass `tenantId` explicitly in their queries,
 * but this extension injects the predicate as well. If a future contributor
 * forgets the filter, the query is still constrained instead of leaking data
 * across brands - the single most damaging bug class in a multi-tenant SaaS.
 */
@Injectable()
export class TenantScopedPrismaFactory {
  constructor(private readonly prisma: PrismaService) {}

  forTenant(tenantId: string) {
    return this.prisma.$extends({
      name: 'tenant-isolation',
      query: {
        $allModels: {
          async $allOperations({ model, operation, args, query }) {
            if (!model || !TENANT_SCOPED_MODELS.has(model)) {
              return query(args);
            }

            const typedArgs = args as Record<string, unknown>;

            if (READ_OPERATIONS.has(operation) || WRITE_FILTER_OPERATIONS.has(operation)) {
              const existingWhere = (typedArgs.where as Record<string, unknown> | undefined) ?? {};
              typedArgs.where = { ...existingWhere, tenantId };
            }

            if (operation === 'create') {
              const data = (typedArgs.data as Record<string, unknown> | undefined) ?? {};
              typedArgs.data = { ...data, tenantId };
            }

            if (operation === 'createMany') {
              const data = typedArgs.data;
              if (Array.isArray(data)) {
                typedArgs.data = data.map((row) => ({
                  ...(row as Record<string, unknown>),
                  tenantId,
                }));
              } else if (data && typeof data === 'object') {
                typedArgs.data = { ...(data as Record<string, unknown>), tenantId };
              }
            }

            if (operation === 'upsert') {
              const create = (typedArgs.create as Record<string, unknown> | undefined) ?? {};
              typedArgs.create = { ...create, tenantId };
            }

            return query(typedArgs as typeof args);
          },
        },
      },
    });
  }

  /**
   * Escape hatch for platform-level operations (super admin, cron jobs). Using
   * it is an explicit, greppable decision rather than an accidental omission.
   */
  get unscoped(): PrismaService {
    return this.prisma;
  }

  /** Re-exports the Prisma namespace so callers avoid importing @prisma/client. */
  static get types(): typeof Prisma {
    return Prisma;
  }
}
