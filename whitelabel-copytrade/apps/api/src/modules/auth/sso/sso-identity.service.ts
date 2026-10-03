import { Injectable } from '@nestjs/common';
import { Prisma, type SsoProviderType } from '@prisma/client';
import { SystemRole } from '@wlct/shared-types';

import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { CryptoService } from '../../../infrastructure/crypto/crypto.service';
import { PasswordService } from '../../../infrastructure/crypto/password.service';
import { RolesService } from '../../rbac/roles.service';
import { SecurityPolicyService } from '../../security/security-policy.service';
import type { VerifiedSsoIdentity } from '../../security/sso-provider.interface';
import { SsoAuthError, SsoReasonCode } from '../../security/sso-flow.types';

/** The subset of an SsoConfiguration the mapper reads. */
export interface SsoMappingConfig {
  id: string;
  tenantId: string;
  providerType: SsoProviderType;
  allowedDomains: string[];
  jitEnabled: boolean;
  defaultRole: string | null;
}

export interface ResolvedSsoUser {
  userId: string;
  /** How the user was resolved: an existing subject link, a new link to an existing account, or JIT. */
  resolution: 'LINKED' | 'LINKED_BY_VERIFIED_EMAIL' | 'JIT_CREATED';
}

/** Roles an IdP-provisioned account may receive. Anything else falls back to FOLLOWER. */
const JIT_ALLOWED_ROLES: readonly string[] = Object.freeze([
  SystemRole.FOLLOWER,
  SystemRole.TRADER,
]);

/**
 * Maps a cryptographically verified IdP identity to exactly one user in the
 * request's tenant.
 *
 * The key is (tenant, provider, issuer, subject) - never the email alone:
 *  1. An existing SsoIdentity link resolves directly; the linked user must
 *     belong to the tenant, not be deleted, and be usable.
 *  2. Without a link, an existing account is linked only when the IdP
 *     vouches for the email (email_verified / tenant SAML IdP), the email's
 *     domain is in the configuration's non-empty allowedDomains list, the
 *     account is not platform staff, and the account is not already linked
 *     to a different subject of this configuration.
 *  3. Otherwise a new account is provisioned only when JIT is enabled
 *     (configuration or tenant policy), with a FOLLOWER/TRADER role.
 * Every other case is refused with a specific reason code; the HTTP layer
 * reports all of them with the same generic error.
 */
@Injectable()
export class SsoIdentityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly passwords: PasswordService,
    private readonly roles: RolesService,
    private readonly policies: SecurityPolicyService,
  ) {}

  async resolveUser(
    tenantId: string,
    config: SsoMappingConfig,
    identity: VerifiedSsoIdentity,
  ): Promise<ResolvedSsoUser> {
    if (config.tenantId !== tenantId) {
      throw new SsoAuthError(
        SsoReasonCode.TENANT_MISMATCH,
        'Configuration belongs to another tenant',
      );
    }
    if (!identity.subject || !identity.issuer) {
      throw new SsoAuthError(
        SsoReasonCode.CLAIMS_MISSING,
        'Verified identity lacks issuer or subject',
      );
    }

    const link = await this.prisma.ssoIdentity.findUnique({
      where: {
        tenantId_providerType_issuer_subject: {
          tenantId,
          providerType: config.providerType,
          issuer: identity.issuer,
          subject: identity.subject,
        },
      },
      select: { id: true, userId: true },
    });

    if (link) {
      await this.assertUserUsable(tenantId, link.userId);
      await this.prisma.ssoIdentity.update({
        where: { id: link.id },
        data: { lastLoginAt: new Date() },
      });
      return { userId: link.userId, resolution: 'LINKED' };
    }

    // No subject link: any further step depends on a vouched-for email.
    if (!identity.email) {
      throw new SsoAuthError(
        SsoReasonCode.EMAIL_MISSING,
        'IdP asserted no email for an unlinked subject',
      );
    }
    if (!identity.emailVerified) {
      throw new SsoAuthError(
        SsoReasonCode.EMAIL_NOT_VERIFIED,
        'IdP did not verify the email of an unlinked subject',
      );
    }
    const email = identity.email.trim().toLowerCase();
    const domain = email.split('@')[1] ?? '';
    const allowedDomains = (config.allowedDomains ?? [])
      .map((d) => d.trim().toLowerCase())
      .filter((d) => d.length > 0);
    if (allowedDomains.length > 0 && !allowedDomains.includes(domain)) {
      throw new SsoAuthError(
        SsoReasonCode.EMAIL_DOMAIN_NOT_ALLOWED,
        'Email domain is not allowed for this provider',
      );
    }

    const emailIndex = this.crypto.blindIndex(email);
    const existing = await this.prisma.user.findFirst({
      where: { tenantId, emailIndex, deletedAt: null },
      select: { id: true, status: true, isPlatformUser: true },
    });

    if (existing) {
      // Auto-linking an existing password account is only safe when the
      // operator has pinned the domains this IdP is authoritative for.
      if (allowedDomains.length === 0 || existing.isPlatformUser) {
        throw new SsoAuthError(
          SsoReasonCode.IDENTITY_LINK_REQUIRED,
          'Existing account must be linked by an administrator',
        );
      }
      this.assertStatusUsable(existing.status);
      const otherLink = await this.prisma.ssoIdentity.findFirst({
        where: { tenantId, configurationId: config.id, userId: existing.id },
        select: { id: true },
      });
      if (otherLink) {
        throw new SsoAuthError(
          SsoReasonCode.IDENTITY_CONFLICT,
          'Account is already linked to a different subject',
        );
      }
      await this.createLink(tenantId, config, identity, existing.id, emailIndex, 'VERIFIED_EMAIL');
      return { userId: existing.id, resolution: 'LINKED_BY_VERIFIED_EMAIL' };
    }

    const policy = await this.policies.getEffectivePolicy({ tenantId });
    if (!config.jitEnabled && !policy.jitProvisioning) {
      throw new SsoAuthError(SsoReasonCode.JIT_DISABLED, 'Just-in-time provisioning is disabled');
    }

    const userId = await this.provision(tenantId, config, identity, email, emailIndex);
    return { userId, resolution: 'JIT_CREATED' };
  }

  /** The user behind a verified SAML hand-off must still be usable at completion time. */
  async assertUserUsable(tenantId: string, userId: string): Promise<void> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId },
      select: { tenantId: true, status: true, deletedAt: true },
    });
    if (!user || user.deletedAt) {
      throw new SsoAuthError(SsoReasonCode.ACCOUNT_UNAVAILABLE, 'Linked account no longer exists');
    }
    if (user.tenantId !== tenantId) {
      throw new SsoAuthError(
        SsoReasonCode.USER_TENANT_MISMATCH,
        'Linked account belongs to another tenant',
      );
    }
    this.assertStatusUsable(user.status);
  }

  private assertStatusUsable(status: string): void {
    if (status === 'SUSPENDED' || status === 'DEACTIVATED' || status === 'LOCKED') {
      throw new SsoAuthError(SsoReasonCode.ACCOUNT_UNAVAILABLE, 'Account is not usable');
    }
  }

  private async createLink(
    tenantId: string,
    config: SsoMappingConfig,
    identity: VerifiedSsoIdentity,
    userId: string,
    emailIndex: string,
    linkedVia: 'VERIFIED_EMAIL' | 'JIT',
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const client = tx ?? this.prisma;
    try {
      await client.ssoIdentity.create({
        data: {
          tenantId,
          userId,
          configurationId: config.id,
          providerType: config.providerType,
          issuer: identity.issuer,
          subject: identity.subject,
          emailIndexAtLink: emailIndex,
          linkedVia,
          lastLoginAt: new Date(),
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new SsoAuthError(
          SsoReasonCode.IDENTITY_CONFLICT,
          'Identity or account already linked',
        );
      }
      throw error;
    }
  }

  private async provision(
    tenantId: string,
    config: SsoMappingConfig,
    identity: VerifiedSsoIdentity,
    email: string,
    emailIndex: string,
  ): Promise<string> {
    const roleKey =
      config.defaultRole && JIT_ALLOWED_ROLES.includes(config.defaultRole)
        ? config.defaultRole
        : SystemRole.FOLLOWER;
    const roles = await this.roles.findByKeys(tenantId, [roleKey]);
    // The account has no usable password: a random secret nobody knows,
    // hashed with the normal password hasher. Password login stays possible
    // only after a password reset through the verified mailbox.
    const passwordHash = await this.passwords.hash(this.crypto.generateToken(48));

    try {
      return await this.prisma.$transaction(async (tx) => {
        const created = await tx.user.create({
          data: {
            tenantId,
            email,
            emailIndex,
            passwordHash,
            status: 'ACTIVE',
            emailVerifiedAt: new Date(),
            metadata: { provisionedBy: 'sso', providerType: config.providerType },
            profile: {
              create: {
                firstName: identity.firstName ? identity.firstName.slice(0, 64) : null,
                lastName: identity.lastName ? identity.lastName.slice(0, 64) : null,
                displayName: identity.displayName ? identity.displayName.slice(0, 64) : null,
              },
            },
          },
          select: { id: true },
        });
        if (roles.length > 0) {
          await tx.userRole.createMany({
            data: roles.map((role) => ({ userId: created.id, roleId: role.id, tenantId })),
          });
        }
        await this.createLink(tenantId, config, identity, created.id, emailIndex, 'JIT', tx);
        return created.id;
      });
    } catch (error) {
      if (error instanceof SsoAuthError) throw error;
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new SsoAuthError(
          SsoReasonCode.IDENTITY_CONFLICT,
          'Concurrent provisioning for the same identity',
        );
      }
      throw error;
    }
  }
}
