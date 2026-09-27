import { Injectable } from '@nestjs/common';
import { CACHE_KEY, CACHE_TTL } from '@wlct/config';
import {
  NON_WILDCARD_PERMISSIONS,
  describePermissions,
  hasAllPermissions,
  hasAnyPermission,
} from '@wlct/shared-types';
import type { PermissionDefinition } from '@wlct/shared-types';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { CacheService } from '../../infrastructure/redis/cache.service';

export interface EffectiveAccess {
  roleKeys: string[];
  permissionKeys: string[];
}

/**
 * Resolves and caches the effective permission set of a user.
 *
 * Permissions are derived from role membership at read time rather than being
 * denormalised onto the user, so revoking a permission from a role takes effect
 * everywhere as soon as the cache entry is dropped. Access tokens also embed a
 * snapshot for stateless checks; the cache is the authority for anything that
 * must reflect a change immediately.
 */
@Injectable()
export class PermissionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  /** Loads role keys and permission keys granted to a user. */
  async getEffectiveAccess(userId: string): Promise<EffectiveAccess> {
    return this.cache.remember(
      CACHE_KEY.userPermissions(userId),
      CACHE_TTL.USER_PERMISSIONS_SECONDS,
      async () => {
        const assignments = await this.prisma.userRole.findMany({
          where: {
            userId,
            OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
            role: { deletedAt: null },
          },
          select: {
            role: {
              select: {
                key: true,
                permissions: { select: { permission: { select: { key: true } } } },
              },
            },
          },
        });

        const roleKeys = new Set<string>();
        const permissionKeys = new Set<string>();

        for (const assignment of assignments) {
          roleKeys.add(assignment.role.key);
          for (const rolePermission of assignment.role.permissions) {
            permissionKeys.add(rolePermission.permission.key);
          }
        }

        return {
          roleKeys: [...roleKeys],
          permissionKeys: [...permissionKeys],
        };
      },
    );
  }

  /** Invalidates the cached permission set after a role change. */
  async invalidateUser(userId: string): Promise<void> {
    await this.cache.delete(CACHE_KEY.userPermissions(userId));
  }

  /** Invalidates every cached permission set for a role's members. */
  async invalidateRoleMembers(roleId: string): Promise<void> {
    const members = await this.prisma.userRole.findMany({
      where: { roleId },
      select: { userId: true },
    });
    await Promise.all(members.map((member) => this.invalidateUser(member.userId)));
  }

  hasAll(granted: readonly string[], required: readonly string[]): boolean {
    return hasAllPermissions(granted, required);
  }

  hasAny(granted: readonly string[], required: readonly string[]): boolean {
    return hasAnyPermission(granted, required);
  }

  /** Catalogue of permissions available for building custom roles. */
  async listCatalogue(): Promise<PermissionDefinition[]> {
    const persisted = await this.prisma.permission.findMany({
      orderBy: [{ resource: 'asc' }, { action: 'asc' }],
      select: { key: true, resource: true, action: true, description: true },
    });

    if (persisted.length > 0) {
      return persisted.map((permission) => ({
        key: permission.key as PermissionDefinition['key'],
        resource: permission.resource,
        action: permission.action,
        description: permission.description ?? '',
        // Derived from the compiled set rather than stored. Whether a
        // permission may be granted by a wildcard is a property of the code
        // that enforces it, and a database row that disagreed with
        // `permissionMatches` would be worse than no row at all.
        requiresExplicitGrant: NON_WILDCARD_PERMISSIONS.has(permission.key),
      }));
    }

    // Falls back to the compiled catalogue when the seed has not run yet.
    return describePermissions();
  }
}
