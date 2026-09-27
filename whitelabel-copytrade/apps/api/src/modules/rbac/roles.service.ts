import { Injectable } from '@nestjs/common';
import { AuditAction, AuditActorType, AuditOutcome, RoleScope } from '@wlct/shared-types';
import type { PaginatedResult } from '@wlct/shared-types';
import { buildPaginationMeta, normalisePagination } from '@wlct/utils';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { PermissionsService } from './permissions.service';
import { AuditService } from '../audit/audit.service';
import { ConflictException, NotFoundException, AppException } from '../../common/errors/app.exception';
import { ErrorCode } from '@wlct/shared-types';
import type { CreateRoleDto } from './dto/create-role.dto';
import type { UpdateRoleDto } from './dto/update-role.dto';
import type { ListRolesDto } from './dto/list-roles.dto';

export interface RoleView {
  id: string;
  tenantId: string | null;
  key: string;
  name: string;
  description: string | null;
  scope: RoleScope;
  isSystem: boolean;
  isDefault: boolean;
  priority: number;
  permissions: string[];
  memberCount: number;
  createdAt: Date;
  updatedAt: Date;
}

const SORTABLE_FIELDS = ['createdAt', 'name', 'key', 'priority'] as const;

/**
 * Role administration.
 *
 * System roles are immutable templates owned by the platform; tenants extend
 * the model by creating custom roles that reference the same permission
 * catalogue. This is what allows new roles to be introduced later without any
 * change to guards or controllers.
 */
@Injectable()
export class RolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
    private readonly audit: AuditService,
  ) {}

  async list(tenantId: string, query: ListRolesDto): Promise<PaginatedResult<RoleView>> {
    const pagination = normalisePagination(query, SORTABLE_FIELDS);

    const where: Prisma.RoleWhereInput = {
      deletedAt: null,
      // Tenant roles plus the platform templates they inherit.
      OR: [{ tenantId }, { tenantId: null }],
      ...(query.scope ? { scope: query.scope } : {}),
      ...(query.includeSystem === false ? { isSystem: false } : {}),
      ...(pagination.search
        ? {
            AND: [
              {
                OR: [
                  { name: { contains: pagination.search, mode: 'insensitive' } },
                  { key: { contains: pagination.search.toUpperCase() } },
                ],
              },
            ],
          }
        : {}),
    };

    const [roles, totalItems] = await this.prisma.$transaction([
      this.prisma.role.findMany({
        where,
        orderBy: { [pagination.sortBy ?? 'priority']: pagination.sortOrder },
        skip: pagination.skip,
        take: pagination.take,
        include: {
          permissions: { select: { permission: { select: { key: true } } } },
          _count: { select: { users: true } },
        },
      }),
      this.prisma.role.count({ where }),
    ]);

    return {
      items: roles.map((role) => this.toView(role)),
      pagination: buildPaginationMeta(pagination.page, pagination.limit, totalItems),
    };
  }

  async findById(tenantId: string, roleId: string): Promise<RoleView> {
    const role = await this.prisma.role.findFirst({
      where: { id: roleId, deletedAt: null, OR: [{ tenantId }, { tenantId: null }] },
      include: {
        permissions: { select: { permission: { select: { key: true } } } },
        _count: { select: { users: true } },
      },
    });

    if (!role) {
      throw new NotFoundException('Role', roleId);
    }

    return this.toView(role);
  }

  async create(
    tenantId: string,
    actorId: string,
    dto: CreateRoleDto,
    context: { ipHash: string; requestId: string },
  ): Promise<RoleView> {
    const existing = await this.prisma.role.findFirst({
      where: { tenantId, key: dto.key, deletedAt: null },
      select: { id: true },
    });

    if (existing) {
      throw new ConflictException('A role with this key already exists in your organisation.', {
        key: dto.key,
      });
    }

    const permissionRecords = await this.resolvePermissionIds(dto.permissionKeys);

    const role = await this.prisma.role.create({
      data: {
        tenantId,
        key: dto.key,
        name: dto.name,
        description: dto.description ?? null,
        scope: RoleScope.TENANT,
        isSystem: false,
        isDefault: false,
        priority: 500,
        permissions: {
          create: permissionRecords.map((permission) => ({ permissionId: permission.id })),
        },
      },
      include: {
        permissions: { select: { permission: { select: { key: true } } } },
        _count: { select: { users: true } },
      },
    });

    await this.audit.record({
      tenantId,
      actorType: AuditActorType.USER,
      actorId,
      action: AuditAction.ROLE_CREATED,
      outcome: AuditOutcome.SUCCESS,
      resourceType: 'Role',
      resourceId: role.id,
      description: `Created role ${role.key}`,
      metadata: { permissionCount: permissionRecords.length },
      ipHash: context.ipHash,
      requestId: context.requestId,
    });

    return this.toView(role);
  }

  async update(
    tenantId: string,
    actorId: string,
    roleId: string,
    dto: UpdateRoleDto,
    context: { ipHash: string; requestId: string },
  ): Promise<RoleView> {
    const role = await this.prisma.role.findFirst({
      where: { id: roleId, tenantId, deletedAt: null },
      include: { permissions: { select: { permission: { select: { key: true } } } } },
    });

    if (!role) {
      throw new NotFoundException('Role', roleId);
    }

    if (role.isSystem) {
      throw new AppException({
        code: ErrorCode.FORBIDDEN,
        message: 'System roles cannot be modified. Create a custom role instead.',
        context: { roleId, key: role.key },
      });
    }

    const before = {
      name: role.name,
      description: role.description,
      permissions: role.permissions.map((entry) => entry.permission.key).sort(),
    };

    const updated = await this.prisma.$transaction(async (tx) => {
      if (dto.permissionKeys) {
        const permissionRecords = await this.resolvePermissionIds(dto.permissionKeys, tx);
        await tx.rolePermission.deleteMany({ where: { roleId } });
        await tx.rolePermission.createMany({
          data: permissionRecords.map((permission) => ({
            roleId,
            permissionId: permission.id,
          })),
        });
      }

      return tx.role.update({
        where: { id: roleId },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.description !== undefined ? { description: dto.description } : {}),
        },
        include: {
          permissions: { select: { permission: { select: { key: true } } } },
          _count: { select: { users: true } },
        },
      });
    });

    await this.permissions.invalidateRoleMembers(roleId);

    await this.audit.record({
      tenantId,
      actorType: AuditActorType.USER,
      actorId,
      action: AuditAction.ROLE_UPDATED,
      outcome: AuditOutcome.SUCCESS,
      resourceType: 'Role',
      resourceId: roleId,
      description: `Updated role ${role.key}`,
      changes: {
        name: { before: before.name, after: updated.name },
        description: { before: before.description, after: updated.description },
        permissions: {
          before: before.permissions,
          after: updated.permissions.map((entry) => entry.permission.key).sort(),
        },
      },
      ipHash: context.ipHash,
      requestId: context.requestId,
    });

    return this.toView(updated);
  }

  async remove(
    tenantId: string,
    actorId: string,
    roleId: string,
    context: { ipHash: string; requestId: string },
  ): Promise<{ id: string; deleted: true }> {
    const role = await this.prisma.role.findFirst({
      where: { id: roleId, tenantId, deletedAt: null },
      include: { _count: { select: { users: true } } },
    });

    if (!role) {
      throw new NotFoundException('Role', roleId);
    }

    if (role.isSystem) {
      throw new AppException({
        code: ErrorCode.FORBIDDEN,
        message: 'System roles cannot be deleted.',
        context: { roleId, key: role.key },
      });
    }

    if (role._count.users > 0) {
      throw new ConflictException(
        'This role is still assigned to users. Reassign them before deleting it.',
        { memberCount: role._count.users },
      );
    }

    await this.prisma.role.update({
      where: { id: roleId },
      data: { deletedAt: new Date() },
    });

    await this.audit.record({
      tenantId,
      actorType: AuditActorType.USER,
      actorId,
      action: AuditAction.ROLE_DELETED,
      outcome: AuditOutcome.SUCCESS,
      resourceType: 'Role',
      resourceId: roleId,
      description: `Deleted role ${role.key}`,
      ipHash: context.ipHash,
      requestId: context.requestId,
    });

    return { id: roleId, deleted: true };
  }

  /** Resolves the tenant-visible role records for a set of role keys. */
  async findByKeys(tenantId: string, keys: string[]): Promise<{ id: string; key: string }[]> {
    if (keys.length === 0) {
      return [];
    }
    return this.prisma.role.findMany({
      where: {
        key: { in: keys },
        deletedAt: null,
        OR: [{ tenantId }, { tenantId: null }],
      },
      select: { id: true, key: true },
    });
  }

  private async resolvePermissionIds(
    keys: string[],
    tx?: Prisma.TransactionClient,
  ): Promise<{ id: string; key: string }[]> {
    const client = tx ?? this.prisma;
    const unique = [...new Set(keys)];
    const records = await client.permission.findMany({
      where: { key: { in: unique } },
      select: { id: true, key: true },
    });

    if (records.length !== unique.length) {
      const found = new Set(records.map((record) => record.key));
      const missing = unique.filter((key) => !found.has(key));
      throw new AppException({
        code: ErrorCode.VALIDATION_ERROR,
        message: 'One or more permissions are not recognised.',
        details: missing.map((key) => ({
          field: 'permissionKeys',
          constraint: 'unknownPermission',
          message: `Unknown permission: ${key}`,
        })),
      });
    }

    return records;
  }

  private toView(role: {
    id: string;
    tenantId: string | null;
    key: string;
    name: string;
    description: string | null;
    scope: string;
    isSystem: boolean;
    isDefault: boolean;
    priority: number;
    createdAt: Date;
    updatedAt: Date;
    permissions: { permission: { key: string } }[];
    _count: { users: number };
  }): RoleView {
    return {
      id: role.id,
      tenantId: role.tenantId,
      key: role.key,
      name: role.name,
      description: role.description,
      scope: role.scope as RoleScope,
      isSystem: role.isSystem,
      isDefault: role.isDefault,
      priority: role.priority,
      permissions: role.permissions.map((entry) => entry.permission.key).sort(),
      memberCount: role._count.users,
      createdAt: role.createdAt,
      updatedAt: role.updatedAt,
    };
  }
}
