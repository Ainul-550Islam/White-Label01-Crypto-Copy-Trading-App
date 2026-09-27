import { Injectable } from '@nestjs/common';
import {
  AuditAction,
  AuditActorType,
  AuditOutcome,
  ErrorCode,
  KycStatus,
  SystemRole,
  UserStatus,
  type PaginatedResult,
  type SupportedCurrency,
  type SupportedLocale,
  type UserDto,
} from '@wlct/shared-types';
import { normaliseEmail } from '@wlct/utils';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { CryptoService } from '../../infrastructure/crypto/crypto.service';
import { PasswordService } from '../../infrastructure/crypto/password.service';
import { UsersRepository, type UserRecord } from './users.repository';
import { PermissionsService } from '../rbac/permissions.service';
import { RolesService } from '../rbac/roles.service';
import { AuditService } from '../audit/audit.service';
import { AppException, ConflictException, NotFoundException } from '../../common/errors/app.exception';
import type { CreateUserDto } from './dto/create-user.dto';
import type { AdminUpdateUserDto, UpdateUserDto } from './dto/update-user.dto';
import type { ListUsersDto } from './dto/list-users.dto';
import { PlanLimitUsersGuard } from '../billing/enforcement/plan-limit-users.guard';
import type { EnforcementActor } from '../billing/enforcement/enforcement.types';

export interface ActorContext {
  actorId: string;
  tenantId?: string;
  ipHash: string;
  requestId: string;
  roles?: string[];
  correlationId?: string;
}

/**
 * User lifecycle.
 *
 * All reads and writes are tenant-scoped at the query level; the caller's
 * tenant id comes from the verified JWT, never from the request body.
 *
 * Enforcement integration (Part 2):
 *  - Before user creation, reserve a slot via PlanLimitUsersGuard (atomic Lua)
 *  - If creation fails after reservation, release the slot to prevent leak
 *  - Guard resolves maxUsers from plan catalog, no hardcoded limits
 */
@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly repository: UsersRepository,
    private readonly crypto: CryptoService,
    private readonly passwords: PasswordService,
    private readonly permissions: PermissionsService,
    private readonly roles: RolesService,
    private readonly audit: AuditService,
    private readonly usersLimitGuard: PlanLimitUsersGuard,
  ) {}

  /** Projection used by the auth flow: includes the live permission set. */
  async findByIdForSession(userId: string, tenantId: string): Promise<UserDto> {
    const user = await this.repository.findById(tenantId, userId);
    if (!user) {
      throw new NotFoundException('User', userId);
    }

    const access = await this.permissions.getEffectiveAccess(userId);
    return this.toDto(user, access.permissionKeys);
  }

  async findById(tenantId: string, userId: string): Promise<UserDto> {
    const user = await this.repository.findById(tenantId, userId);
    if (!user) {
      throw new NotFoundException('User', userId);
    }
    return this.toDto(user, []);
  }

  async list(tenantId: string, query: ListUsersDto): Promise<PaginatedResult<UserDto>> {
    const result = await this.repository.list(tenantId, query);
    return {
      items: result.items.map((user) => this.toDto(user, [])),
      pagination: this.repository.buildPaginationMeta(
        result.page,
        result.limit,
        result.totalItems,
      ),
    };
  }

  async create(tenantId: string, dto: CreateUserDto, context: ActorContext): Promise<UserDto> {
    const email = normaliseEmail(dto.email);
    const emailIndex = this.crypto.blindIndex(email);

    const existing = await this.repository.findByEmailIndex(tenantId, emailIndex);
    if (existing) {
      throw new ConflictException('A user with this email address already exists.', { email });
    }

    // Enforcement: reserve maxUsers quota before creation (atomic Lua check-and-increment)
    const enforcementActor: EnforcementActor = {
      userId: context.actorId,
      tenantId,
      roles: context.roles ?? [],
      ipHash: context.ipHash,
      requestId: context.requestId,
      correlationId: context.correlationId ?? context.requestId,
    };

    let quotaReserved = false;
    try {
      await this.usersLimitGuard.reserve(enforcementActor);
      quotaReserved = true;
    } catch (error) {
      // PlanLimitExceededError or SubscriptionInactiveError propagates as-is
      // No quota was reserved, so no release needed
      throw error;
    }

    // Without a password the account is created in an invitable state; the
    // random placeholder is never usable because it is discarded immediately.
    const password = dto.password ?? this.crypto.generateToken(24);
    if (dto.password) {
      this.passwords.assertPolicy(dto.password, { email });
    }
    const passwordHash = await this.passwords.hash(password);

    const roleKeys = dto.roleKeys?.length ? dto.roleKeys : [SystemRole.FOLLOWER];
    const roleRecords = await this.roles.findByKeys(tenantId, roleKeys);

    if (roleRecords.length !== roleKeys.length) {
      const found = new Set(roleRecords.map((role) => role.key));
      // Release quota on validation failure
      if (quotaReserved) {
        await this.usersLimitGuard.release(enforcementActor).catch(() => {
          // Best-effort release; log but don't fail the validation error
        });
      }
      throw new AppException({
        code: ErrorCode.VALIDATION_ERROR,
        message: 'One or more roles are not available in this organisation.',
        details: roleKeys
          .filter((key) => !found.has(key))
          .map((key) => ({
            field: 'roleKeys',
            constraint: 'unknownRole',
            message: `Unknown role: ${key}`,
          })),
      });
    }

    let created: { id: string };
    try {
      created = await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            tenantId,
            email,
            emailIndex,
            passwordHash,
            phone: dto.phone ?? null,
            status: dto.password ? UserStatus.ACTIVE : UserStatus.PENDING_VERIFICATION,
            profile: {
              create: {
                firstName: dto.firstName ?? null,
                lastName: dto.lastName ?? null,
                locale: dto.locale ?? 'en',
              },
            },
          },
          select: { id: true },
        });

        await tx.userRole.createMany({
          data: roleRecords.map((role) => ({ userId: user.id, roleId: role.id, tenantId })),
        });

        return user;
      });
    } catch (error) {
      // Release quota on creation failure to prevent leak
      if (quotaReserved) {
        await this.usersLimitGuard.release(enforcementActor).catch(() => {
          // Best-effort release
        });
      }
      throw error;
    }

    await this.audit.record({
      tenantId,
      actorType: AuditActorType.USER,
      actorId: context.actorId,
      action: AuditAction.USER_CREATED,
      outcome: AuditOutcome.SUCCESS,
      resourceType: 'User',
      resourceId: created.id,
      description: `Created user ${email}`,
      metadata: { roleKeys, invited: dto.sendInvite && !dto.password },
      ipHash: context.ipHash,
      requestId: context.requestId,
    });

    return this.findById(tenantId, created.id);
  }

  async updateProfile(
    tenantId: string,
    userId: string,
    dto: UpdateUserDto,
    context: ActorContext,
  ): Promise<UserDto> {
    const user = await this.repository.findById(tenantId, userId);
    if (!user) {
      throw new NotFoundException('User', userId);
    }

    await this.prisma.$transaction(async (tx) => {
      if (dto.phone !== undefined) {
        await tx.user.update({
          where: { id: userId },
          data: { phone: dto.phone, phoneVerifiedAt: null },
        });
      }

      await tx.userProfile.upsert({
        where: { userId },
        create: {
          userId,
          firstName: dto.firstName ?? null,
          lastName: dto.lastName ?? null,
          displayName: dto.displayName ?? null,
          avatarUrl: dto.avatarUrl ?? null,
          bio: dto.bio ?? null,
          countryCode: dto.countryCode ?? null,
          timezone: dto.timezone ?? 'UTC',
          locale: dto.locale ?? 'en',
          preferredCurrency: dto.preferredCurrency ?? 'USD',
          marketingOptIn: dto.marketingOptIn ?? false,
        },
        update: {
          ...(dto.firstName !== undefined ? { firstName: dto.firstName } : {}),
          ...(dto.lastName !== undefined ? { lastName: dto.lastName } : {}),
          ...(dto.displayName !== undefined ? { displayName: dto.displayName } : {}),
          ...(dto.avatarUrl !== undefined ? { avatarUrl: dto.avatarUrl } : {}),
          ...(dto.bio !== undefined ? { bio: dto.bio } : {}),
          ...(dto.countryCode !== undefined ? { countryCode: dto.countryCode } : {}),
          ...(dto.timezone !== undefined ? { timezone: dto.timezone } : {}),
          ...(dto.locale !== undefined ? { locale: dto.locale } : {}),
          ...(dto.preferredCurrency !== undefined
            ? { preferredCurrency: dto.preferredCurrency }
            : {}),
          ...(dto.marketingOptIn !== undefined ? { marketingOptIn: dto.marketingOptIn } : {}),
        },
      });
    });

    await this.audit.record({
      tenantId,
      actorType: AuditActorType.USER,
      actorId: context.actorId,
      action: AuditAction.USER_UPDATED,
      outcome: AuditOutcome.SUCCESS,
      resourceType: 'User',
      resourceId: userId,
      changes: {
        profile: { before: user.profile, after: dto },
      },
      ipHash: context.ipHash,
      requestId: context.requestId,
    });

    return this.findById(tenantId, userId);
  }

  async adminUpdate(
    tenantId: string,
    userId: string,
    dto: AdminUpdateUserDto,
    context: ActorContext,
  ): Promise<UserDto> {
    const { status, ...profileFields } = dto;

    if (Object.keys(profileFields).length > 0) {
      await this.updateProfile(tenantId, userId, profileFields, context);
    }

    if (status) {
      await this.prisma.user.updateMany({ where: { id: userId, tenantId }, data: { status } });

      await this.audit.record({
        tenantId,
        actorType: AuditActorType.USER,
        actorId: context.actorId,
        action: AuditAction.USER_UPDATED,
        outcome: AuditOutcome.SUCCESS,
        resourceType: 'User',
        resourceId: userId,
        description: `Status set to ${status}`,
        ipHash: context.ipHash,
        requestId: context.requestId,
      });
    }

    return this.findById(tenantId, userId);
  }

  async suspend(
    tenantId: string,
    userId: string,
    reason: string | undefined,
    context: ActorContext,
  ): Promise<UserDto> {
    if (userId === context.actorId) {
      throw new ConflictException('You cannot suspend your own account.');
    }

    const updated = await this.prisma.user.updateMany({
      where: { id: userId, tenantId, deletedAt: null },
      data: { status: UserStatus.SUSPENDED },
    });

    if (updated.count === 0) {
      throw new NotFoundException('User', userId);
    }

    // Suspension must take effect immediately, not at token expiry.
    await this.prisma.$transaction([
      this.prisma.userSession.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date(), revokeReason: 'account_suspended' },
      }),
      this.prisma.refreshToken.updateMany({
        where: { userId, status: 'ACTIVE' },
        data: { status: 'REVOKED', revokedAt: new Date(), revokeReason: 'account_suspended' },
      }),
    ]);

    await this.permissions.invalidateUser(userId);

    await this.audit.recordImmediate({
      tenantId,
      actorType: AuditActorType.USER,
      actorId: context.actorId,
      action: AuditAction.USER_SUSPENDED,
      outcome: AuditOutcome.SUCCESS,
      resourceType: 'User',
      resourceId: userId,
      description: reason ?? 'Account suspended by an administrator.',
      ipHash: context.ipHash,
      requestId: context.requestId,
    });

    return this.findById(tenantId, userId);
  }

  async reinstate(tenantId: string, userId: string, context: ActorContext): Promise<UserDto> {
    const updated = await this.prisma.user.updateMany({
      where: { id: userId, tenantId, status: UserStatus.SUSPENDED },
      data: { status: UserStatus.ACTIVE },
    });

    if (updated.count === 0) {
      throw new NotFoundException('Suspended user', userId);
    }

    await this.audit.record({
      tenantId,
      actorType: AuditActorType.USER,
      actorId: context.actorId,
      action: AuditAction.USER_REINSTATED,
      outcome: AuditOutcome.SUCCESS,
      resourceType: 'User',
      resourceId: userId,
      ipHash: context.ipHash,
      requestId: context.requestId,
    });

    return this.findById(tenantId, userId);
  }

  /** Soft delete: the row is retained for audit and financial reconciliation. */
  async softDelete(
    tenantId: string,
    userId: string,
    context: ActorContext,
  ): Promise<{ id: string; deleted: true }> {
    if (userId === context.actorId) {
      throw new ConflictException('You cannot delete your own account.');
    }

    const updated = await this.prisma.user.updateMany({
      where: { id: userId, tenantId, deletedAt: null },
      data: { deletedAt: new Date(), status: UserStatus.DEACTIVATED },
    });

    if (updated.count === 0) {
      throw new NotFoundException('User', userId);
    }

    await this.prisma.$transaction([
      this.prisma.userSession.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date(), revokeReason: 'account_deleted' },
      }),
      this.prisma.refreshToken.updateMany({
        where: { userId, status: 'ACTIVE' },
        data: { status: 'REVOKED', revokedAt: new Date(), revokeReason: 'account_deleted' },
      }),
    ]);

    await this.permissions.invalidateUser(userId);

    await this.audit.recordImmediate({
      tenantId,
      actorType: AuditActorType.USER,
      actorId: context.actorId,
      action: AuditAction.USER_DELETED,
      outcome: AuditOutcome.SUCCESS,
      resourceType: 'User',
      resourceId: userId,
      ipHash: context.ipHash,
      requestId: context.requestId,
    });

    return { id: userId, deleted: true };
  }

  async assignRoles(
    tenantId: string,
    userId: string,
    roleIds: string[],
    context: ActorContext,
  ): Promise<UserDto> {
    const user = await this.repository.findById(tenantId, userId);
    if (!user) {
      throw new NotFoundException('User', userId);
    }

    const roles = await this.prisma.role.findMany({
      where: {
        id: { in: roleIds },
        deletedAt: null,
        OR: [{ tenantId }, { tenantId: null }],
      },
      select: { id: true, key: true, scope: true },
    });

    if (roles.length !== roleIds.length) {
      throw new AppException({
        code: ErrorCode.VALIDATION_ERROR,
        message: 'One or more roles are not available in this organisation.',
      });
    }

    // Platform-scoped roles cannot be granted through the tenant API.
    const platformRole = roles.find((role) => role.scope === 'PLATFORM');
    if (platformRole) {
      throw new AppException({
        code: ErrorCode.INSUFFICIENT_PERMISSIONS,
        message: 'Platform roles cannot be assigned from the tenant administration API.',
        context: { roleKey: platformRole.key },
      });
    }

    await this.prisma.$transaction([
      this.prisma.userRole.deleteMany({ where: { userId } }),
      this.prisma.userRole.createMany({
        data: roles.map((role) => ({
          userId,
          roleId: role.id,
          tenantId,
          assignedById: context.actorId,
        })),
      }),
    ]);

    await this.permissions.invalidateUser(userId);

    await this.audit.recordImmediate({
      tenantId,
      actorType: AuditActorType.USER,
      actorId: context.actorId,
      action: AuditAction.ROLE_ASSIGNED,
      outcome: AuditOutcome.SUCCESS,
      resourceType: 'User',
      resourceId: userId,
      changes: {
        roles: {
          before: user.roles.map((entry) => entry.role.key),
          after: roles.map((role) => role.key),
        },
      },
      ipHash: context.ipHash,
      requestId: context.requestId,
    });

    return this.findById(tenantId, userId);
  }

  private toDto(user: UserRecord, permissions: string[]): UserDto {
    return {
      id: user.id,
      tenantId: user.tenantId,
      email: user.email,
      emailVerifiedAt: user.emailVerifiedAt ? user.emailVerifiedAt.toISOString() : null,
      phone: user.phone,
      phoneVerifiedAt: user.phoneVerifiedAt ? user.phoneVerifiedAt.toISOString() : null,
      status: user.status as UserStatus,
      kycStatus: user.kycStatus as KycStatus,
      isPlatformUser: user.isPlatformUser,
      twoFactorEnabled: user.twoFactorEnabled,
      lastLoginAt: user.lastLoginAt ? user.lastLoginAt.toISOString() : null,
      lastLoginIpHash: user.lastLoginIpHash,
      profile: {
        firstName: user.profile?.firstName ?? null,
        lastName: user.profile?.lastName ?? null,
        displayName: user.profile?.displayName ?? null,
        avatarUrl: user.profile?.avatarUrl ?? null,
        bio: user.profile?.bio ?? null,
        countryCode: user.profile?.countryCode ?? null,
        timezone: user.profile?.timezone ?? 'UTC',
        locale: (user.profile?.locale ?? 'en') as SupportedLocale,
        preferredCurrency: (user.profile?.preferredCurrency ?? 'USD') as SupportedCurrency,
        marketingOptIn: user.profile?.marketingOptIn ?? false,
      },
      roles: user.roles.map((entry) => ({
        roleId: entry.roleId,
        key: entry.role.key,
        name: entry.role.name,
        scope: entry.role.scope,
        tenantId: entry.role.tenantId,
        assignedAt: entry.assignedAt.toISOString(),
        expiresAt: entry.expiresAt ? entry.expiresAt.toISOString() : null,
      })),
      permissions,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
      deletedAt: user.deletedAt ? user.deletedAt.toISOString() : null,
    };
  }
}
