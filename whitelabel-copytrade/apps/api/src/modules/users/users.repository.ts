import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { buildPaginationMeta, normalisePagination } from '@wlct/utils';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type { ListUsersDto } from './dto/list-users.dto';

/** Shape returned to controllers; excludes password hashes by construction. */
export const USER_SELECT = {
  id: true,
  tenantId: true,
  email: true,
  emailVerifiedAt: true,
  phone: true,
  phoneVerifiedAt: true,
  status: true,
  kycStatus: true,
  isPlatformUser: true,
  twoFactorEnabled: true,
  lastLoginAt: true,
  lastLoginIpHash: true,
  referralCode: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
  profile: {
    select: {
      firstName: true,
      lastName: true,
      displayName: true,
      avatarUrl: true,
      bio: true,
      countryCode: true,
      timezone: true,
      locale: true,
      preferredCurrency: true,
      marketingOptIn: true,
    },
  },
  roles: {
    select: {
      roleId: true,
      assignedAt: true,
      expiresAt: true,
      role: { select: { key: true, name: true, scope: true, tenantId: true } },
    },
  },
} satisfies Prisma.UserSelect;

export type UserRecord = Prisma.UserGetPayload<{ select: typeof USER_SELECT }>;

const SORTABLE_FIELDS = ['createdAt', 'updatedAt', 'email', 'status', 'lastLoginAt'] as const;

/**
 * Data access for users.
 *
 * Every query is explicitly tenant-scoped. The `passwordHash` column is never
 * part of a select used by controller-facing code.
 */
@Injectable()
export class UsersRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(tenantId: string, userId: string): Promise<UserRecord | null> {
    return this.prisma.user.findFirst({
      where: { id: userId, tenantId, deletedAt: null },
      select: USER_SELECT,
    });
  }

  async findByIdIncludingDeleted(tenantId: string, userId: string): Promise<UserRecord | null> {
    return this.prisma.user.findFirst({
      where: { id: userId, tenantId },
      select: USER_SELECT,
    });
  }

  async findByEmailIndex(tenantId: string, emailIndex: string): Promise<UserRecord | null> {
    return this.prisma.user.findFirst({
      where: { tenantId, emailIndex, deletedAt: null },
      select: USER_SELECT,
    });
  }

  async list(
    tenantId: string,
    query: ListUsersDto,
  ): Promise<{ items: UserRecord[]; totalItems: number; page: number; limit: number }> {
    const pagination = normalisePagination(query, SORTABLE_FIELDS);

    const where: Prisma.UserWhereInput = {
      tenantId,
      ...(query.includeDeleted ? {} : { deletedAt: null }),
      ...(query.status ? { status: query.status } : {}),
      ...(query.kycStatus ? { kycStatus: query.kycStatus } : {}),
      ...(query.roleKey ? { roles: { some: { role: { key: query.roleKey } } } } : {}),
      ...(query.createdFrom || query.createdTo
        ? {
            createdAt: {
              ...(query.createdFrom ? { gte: query.createdFrom } : {}),
              ...(query.createdTo ? { lte: query.createdTo } : {}),
            },
          }
        : {}),
      ...(pagination.search
        ? {
            OR: [
              { email: { contains: pagination.search, mode: 'insensitive' } },
              {
                profile: {
                  is: {
                    OR: [
                      { firstName: { contains: pagination.search, mode: 'insensitive' } },
                      { lastName: { contains: pagination.search, mode: 'insensitive' } },
                      { displayName: { contains: pagination.search, mode: 'insensitive' } },
                    ],
                  },
                },
              },
            ],
          }
        : {}),
    };

    const [items, totalItems] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        select: USER_SELECT,
        orderBy: { [pagination.sortBy ?? 'createdAt']: pagination.sortOrder },
        skip: pagination.skip,
        take: pagination.take,
      }),
      this.prisma.user.count({ where }),
    ]);

    return { items, totalItems, page: pagination.page, limit: pagination.limit };
  }

  async countActive(tenantId: string): Promise<number> {
    return this.prisma.user.count({ where: { tenantId, deletedAt: null, status: 'ACTIVE' } });
  }

  buildPaginationMeta(page: number, limit: number, totalItems: number) {
    return buildPaginationMeta(page, limit, totalItems);
  }
}
