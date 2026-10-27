/**
 * API/OAuth credential lifecycle over the existing Security/API-Key model:
 * secrets are generated once, shown ONCE under the authorized one-time rule,
 * and persisted ONLY as HMAC digests. There is no code path that returns a
 * stored secret; rotation issues a NEW secret and revokes the old material.
 */

import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { isUUID } from 'class-validator';

import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import {
  constantTimeEqual,
  credentialDigest,
  deterministicKeyPrefix,
  DEVELOPER_ERROR_CODES,
  DeveloperError,
  generateClientSecret,
  scopesIntersect,
  validateScopes,
} from './developer.types';
import { DeveloperAuditService, type DeveloperAuditActor } from './developer-audit.service';
import {
  DEVELOPER_POLICY_DATA_PORT,
  DeveloperPolicyDataPort,
  DeveloperPolicyService,
} from './developer-policy.service';
import { DeveloperScopeService } from './developer-scope.service';
import { claimMutationIntent } from './developer-mutation-intent';

/** Platform secret infrastructure key used to HMAC credentials at rest. */
export const DEVELOPER_SECRET_HMAC_KEY = Symbol('DEVELOPER_SECRET_HMAC_KEY');

export interface IssuedSecret {
  keyId: string;
  /** Shown exactly once by the controller; never persisted in this form. */
  secret: string;
  scopes: string[];
  expiresAt: Date | null;
}

@Injectable()
export class DeveloperCredentialService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DeveloperAuditService,
    private readonly policyService: DeveloperPolicyService,
    private readonly scopes: DeveloperScopeService,
    @Inject(DEVELOPER_POLICY_DATA_PORT) private readonly policyData: DeveloperPolicyDataPort,
    @Inject(DEVELOPER_SECRET_HMAC_KEY) private readonly hmacKey: string,
  ) {}

  private async loadOwnedApplication(tenantId: string, applicationId: string) {
    const application = await this.prisma.withTenantRls(tenantId, (tx) => tx.developerApplication.findUnique({
      where: { id: applicationId },
    }));
    if (!application || application.tenantId !== tenantId) {
      throw new NotFoundException('developer application not found');
    }
    if (application.state === 'REVOKED') {
      throw new DeveloperError(
        DEVELOPER_ERROR_CODES.APPLICATION_REVOKED,
        'revoked applications cannot hold credentials',
      );
    }
    return application;
  }

  async createApiKey(
    actor: DeveloperAuditActor,
    applicationId: string,
    input: { label: string; expiresInDays?: number; scopes?: string[] },
    requestKey?: string,
  ): Promise<IssuedSecret> {
    const application = await this.loadOwnedApplication(actor.tenantId, applicationId);
    const plan = await this.policyData.planLimitViewForTenant(actor.tenantId);
    const entitlements = await this.policyData.tenantEntitlementKeys(actor.tenantId);
    const policy = this.policyService.resolve(actor.tenantId, plan, entitlements);

    const activeCount = await this.prisma.withTenantRls(actor.tenantId, (tx) => tx.developerCredential.count({
      where: { tenantId: actor.tenantId, applicationId: application.id, revokedAt: null },
    }));
    if (activeCount >= policy.maxCredentialsPerApplication) {
      throw new DeveloperError(
        DEVELOPER_ERROR_CODES.POLICY_LIMIT,
        `plan allows at most ${policy.maxCredentialsPerApplication} active credentials per application`,
      );
    }
    const requested = validateScopes(input.scopes ?? application.scopes);
    const effective = this.scopes.resolve({
      applicationScopes: application.scopes,
      policyAllowedScopes: policy.allowedScopes,
      subjectScopes: policy.allowedScopes,
    });
    const bounded = scopesIntersect(requested, effective.effective);
    if (bounded.length === 0) {
      throw new DeveloperError(
        DEVELOPER_ERROR_CODES.SCOPE_NOT_ALLOWED,
        'no requested scope is granted by tenant policy',
      );
    }

    const keyId = deterministicKeyPrefix();
    const secret = generateClientSecret().replace('devsec_', 'devsec_');
    const expiresAt = input.expiresInDays
      ? new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000)
      : null;

    const create = async (tx: Prisma.TransactionClient) => {
      if (requestKey) {
        await claimMutationIntent(tx, actor.tenantId, requestKey, 'credential.create', application.id);
        // Serialize quota checks with other public creations for this app.
        const locked = await tx.$queryRaw<Array<{ state: string }>>`
          SELECT "state" FROM "developer_applications"
          WHERE "tenant_id" = ${actor.tenantId}::uuid AND "id" = ${application.id}::uuid
          FOR UPDATE
        `;
        if (!locked[0] || locked[0].state === 'REVOKED') {
          throw new DeveloperError(DEVELOPER_ERROR_CODES.APPLICATION_REVOKED, 'application is revoked');
        }
        const count = await tx.developerCredential.count({ where: { applicationId: application.id, revokedAt: null } });
        if (count >= policy.maxCredentialsPerApplication) {
          throw new DeveloperError(DEVELOPER_ERROR_CODES.POLICY_LIMIT, 'credential limit reached');
        }
      }
      await tx.developerCredential.create({
        data: {
          tenantId: actor.tenantId,
          applicationId: application.id,
          label: input.label,
          kind: 'API_KEY',
          keyId,
          secretHash: credentialDigest(secret, this.hmacKey),
          scopes: bounded,
          expiresAt,
          createdByActorId: actor.actorId,
        },
      });
      await this.audit.record({
        ...actor,
        applicationId: application.id,
        action: 'credential.created',
        detail: { keyId, kind: 'API_KEY', scopes: bounded, expiresInDays: input.expiresInDays ?? null },
      }, tx);
    };
    await this.prisma.withTenantRls(actor.tenantId, create);
    // One-time presentation: the plaintext secret exists only in this return.
    return { keyId, secret, scopes: bounded, expiresAt };
  }

  async rotate(actor: DeveloperAuditActor, applicationId: string, keyId: string, reason?: string, requestKey?: string): Promise<IssuedSecret> {
    const application = await this.loadOwnedApplication(actor.tenantId, applicationId);
    const existing = await this.prisma.withTenantRls(actor.tenantId, (tx) => tx.developerCredential.findUnique({ where: { keyId } }));
    if (!existing || existing.tenantId !== actor.tenantId || existing.applicationId !== application.id) {
      throw new NotFoundException('credential not found');
    }
    if (existing.revokedAt) {
      throw new DeveloperError(DEVELOPER_ERROR_CODES.VALIDATION, 'revoked credentials cannot be rotated');
    }
    const rotate = async (tx: Prisma.TransactionClient) => {
      if (requestKey) await claimMutationIntent(tx, actor.tenantId, requestKey, 'credential.rotate', keyId);
      // Claim the old key atomically. Two concurrent rotations of the same
      // credential must never mint two replacements.
      const claimed = await tx.developerCredential.updateMany({
        where: { id: existing.id, tenantId: actor.tenantId, applicationId: application.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      if (claimed.count !== 1) {
        throw new DeveloperError(DEVELOPER_ERROR_CODES.VALIDATION, 'credential was already revoked or rotated');
      }
      const keyIdNew = deterministicKeyPrefix();
      const secret = generateClientSecret();
      await tx.developerCredential.create({
        data: {
          tenantId: actor.tenantId,
          applicationId: application.id,
          label: existing.label,
          kind: existing.kind,
          keyId: keyIdNew,
          secretHash: credentialDigest(secret, this.hmacKey),
          scopes: existing.scopes,
          expiresAt: existing.expiresAt,
          rotatedFromKeyId: existing.keyId,
          createdByActorId: actor.actorId,
        },
      });
      await this.audit.record({
        ...actor,
        applicationId: application.id,
        action: 'credential.rotated',
        detail: { fromKeyId: keyId, toKeyId: keyIdNew, reason: reason ?? null },
      }, tx);
      return { keyId: keyIdNew, secret };
    };
    const rotated = await this.prisma.withTenantRls(actor.tenantId, rotate);
    return {
      keyId: rotated.keyId,
      secret: rotated.secret,
      scopes: existing.scopes,
      expiresAt: existing.expiresAt,
    };
  }

  async revoke(actor: DeveloperAuditActor, applicationId: string, keyId: string, reason?: string, requestKey?: string): Promise<void> {
    const application = await this.loadOwnedApplication(actor.tenantId, applicationId);
    const existing = await this.prisma.withTenantRls(actor.tenantId, (tx) => tx.developerCredential.findUnique({ where: { keyId } }));
    if (!existing || existing.tenantId !== actor.tenantId || existing.applicationId !== application.id) {
      throw new NotFoundException('credential not found');
    }
    const revoke = async (tx: Prisma.TransactionClient) => {
      if (requestKey) await claimMutationIntent(tx, actor.tenantId, requestKey, 'credential.revoke', keyId);
      await tx.developerCredential.updateMany({
        where: { id: existing.id, tenantId: actor.tenantId, applicationId: application.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.audit.record({
        ...actor,
        applicationId: application.id,
        action: 'credential.revoked',
        detail: { keyId, reason: reason ?? null },
      }, tx);
    };
    await this.prisma.withTenantRls(actor.tenantId, revoke);
  }

  /** Portal listing; secret hashes never leave the service. */
  async listForTenant(
    tenantId: string,
    query: { applicationId?: string; status?: string; kind?: string; limit?: number; cursor?: string },
  ) {
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
    return this.prisma.withTenantRls(tenantId, async (tx) => {
      const now = new Date();
      const where = {
        tenantId,
        ...(query.applicationId ? { applicationId: query.applicationId } : {}),
        ...(query.kind ? { kind: query.kind } : {}),
        ...(query.status === 'REVOKED' ? { revokedAt: { not: null } } : {}),
        ...(query.status === 'ACTIVE' ? { revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] } : {}),
        ...(query.status === 'EXPIRED' ? { revokedAt: null, expiresAt: { lte: now } } : {}),
      };
      if (query.cursor && (!isUUID(query.cursor) || !await tx.developerCredential.findFirst({
        where: { ...where, id: query.cursor }, select: { id: true },
      }))) throw new BadRequestException('invalid credential cursor');
      const rows = await tx.developerCredential.findMany({
        where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: limit + 1,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      });
      const page = rows.slice(0, limit);
      return {
        rows: page.map(({ secretHash: _hash, rotatedFromKeyId: _rot, createdByActorId: _actor, ...safe }) => {
          void _hash; void _rot; void _actor; return safe;
        }),
        nextCursor: rows.length > limit ? page[page.length - 1].id : null,
      };
    });
  }

  /** Scope change on an application, bounded by tenant policy, audited. */
  async updateApplicationScopes(
    actor: DeveloperAuditActor,
    applicationId: string,
    dto: { scopes: string[]; reason?: string },
    requestKey: string,
  ) {
    const application = await this.loadOwnedApplication(actor.tenantId, applicationId);
    if (application.state === 'REVOKED') {
      throw new DeveloperError(DEVELOPER_ERROR_CODES.APPLICATION_REVOKED, 'application is revoked');
    }
    const plan = await this.policyData.planLimitViewForTenant(actor.tenantId);
    const entitlements = await this.policyData.tenantEntitlementKeys(actor.tenantId);
    const policy = this.policyService.resolve(actor.tenantId, plan, entitlements);
    const normalized = this.scopes.assertApplicationScopeChange(dto.scopes, policy.allowedScopes);
    return this.prisma.withTenantRls(actor.tenantId, async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "developer_applications" WHERE "id" = ${application.id}::uuid AND "tenant_id" = ${actor.tenantId}::uuid FOR UPDATE`;
      const current = await tx.developerApplication.findUnique({ where: { id: application.id } });
      if (!current || current.tenantId !== actor.tenantId) throw new NotFoundException('developer application not found');
      if (current.state === 'REVOKED') throw new DeveloperError(DEVELOPER_ERROR_CODES.APPLICATION_REVOKED, 'application is revoked');
      await claimMutationIntent(tx, actor.tenantId, requestKey, 'application.scopes', application.id);
      const updated = await tx.developerApplication.update({
        where: { id: application.id },
        data: { scopes: normalized },
      });
      const added = normalized.filter((scope: string) => !current.scopes.includes(scope));
      const removed = current.scopes.filter((scope) => !normalized.includes(scope));
      await this.audit.record({
        ...actor,
        applicationId: application.id,
        action: 'application.scopes_changed',
        detail: { added, removed, reason: dto.reason ?? null },
      }, tx);
      const { idempotencyKey: _idem, createdByActorId: _actor, ...safe } = updated;
      void _idem; void _actor; return safe;
    });
  }

  /** Constant-time digest comparison used by api-access (never returns the hash). */
  verifySecretMatches(secret: string, storedHash: string): boolean {
    return constantTimeEqual(credentialDigest(secret, this.hmacKey), storedHash);
  }
}
