// # Responsibility: retain tenant ownership checks and application reactivation policy while removing only an unused binding, not its required lookup.
/**
 * Developer application lifecycle with tenant/partner ownership, idempotent
 * creation, deterministic client identifiers, validated lifecycle
 * transitions, redirect-URI management and audit emission.
 *
 * Every write carries (tenantId, actorType, actorId, correlationId) and is
 * emitted to the immutable audit chain. A revoked application is terminal:
 * no tokens, no credentials, no reactivation.
 */

import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { isUUID } from 'class-validator';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import {
  APPLICATION_TRANSITIONS,
  deterministicClientId,
  DEVELOPER_ERROR_CODES,
  DeveloperError,
  idempotencyKey,
  transitionOrThrow,
  validateScopes,
  type ApplicationState,
} from './developer.types';
import {
  DEVELOPER_POLICY_DATA_PORT,
  DeveloperPolicyDataPort,
  DeveloperPolicyService,
  type DeveloperPolicy,
} from './developer-policy.service';
import { DeveloperAuditService } from './developer-audit.service';
import { claimMutationIntent } from './developer-mutation-intent';

export interface DeveloperActor {
  tenantId: string;
  actorType: 'USER' | 'SERVICE' | 'PLATFORM';
  actorId: string;
  correlationId: string;
}

export interface CreateApplicationInput extends DeveloperActor {
  name: string;
  description: string;
  redirectUris: string[];
  requestedScopes?: string[];
  environment?: 'SANDBOX' | 'PRODUCTION';
  naturalKey?: string;
  /** Set by the partner boundary for partner-owned applications. */
  partnerId?: string;
}

const REDIRECT_URI_PATTERN = /^https:\/\/[A-Za-z0-9.\-_:]+[A-Za-z0-9/\-._~%]*$|^http:\/\/localhost(:\d+)?[A-Za-z0-9/\-._~%]*$/;

@Injectable()
export class DeveloperApplicationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policyService: DeveloperPolicyService,
    @Inject(DEVELOPER_POLICY_DATA_PORT) private readonly policyData: DeveloperPolicyDataPort,
    private readonly audit: DeveloperAuditService,
  ) {}

  private validateRedirectUris(uris: string[], policy: DeveloperPolicy, environment: string): string[] {
    const unique = [...new Set(uris.map((uri) => uri.trim()).filter(Boolean))];
    if (unique.length === 0) {
      throw new DeveloperError(
        DEVELOPER_ERROR_CODES.VALIDATION,
        'at least one redirect URI is required',
      );
    }
    if (unique.length > policy.maxRedirectUris) {
      throw new DeveloperError(
        DEVELOPER_ERROR_CODES.POLICY_LIMIT,
        `plan allows at most ${policy.maxRedirectUris} redirect URIs`,
      );
    }
    for (const uri of unique) {
      let validUrl = false;
      try {
        const parsed = new URL(uri);
        validUrl = Boolean(parsed.hostname) && !parsed.username && !parsed.password && !parsed.search && !parsed.hash
          && (parsed.protocol === 'https:' || (parsed.protocol === 'http:' && parsed.hostname === 'localhost'));
      } catch { /* rejected below */ }
      if (!REDIRECT_URI_PATTERN.test(uri) || !validUrl) {
        throw new DeveloperError(
          DEVELOPER_ERROR_CODES.REDIRECT_URI_MISMATCH,
          'redirect URI must be a valid https (or localhost-development) URI',
        );
      }
      if (environment === 'PRODUCTION' && uri.startsWith('http://')) {
        throw new DeveloperError(
          DEVELOPER_ERROR_CODES.REDIRECT_URI_MISMATCH,
          'production applications require https redirect URIs',
        );
      }
    }
    return unique.sort();
  }

  /**
   * Idempotent create: the (tenantId, naturalKey) pair deterministically
   * derives both the idempotency key and the client id, so a retried
   * registration returns the SAME application instead of a duplicate.
   */
  async create(input: CreateApplicationInput, requestKey: string) {
    const plan = await this.policyData.planLimitViewForTenant(input.tenantId);
    const entitlements = await this.policyData.tenantEntitlementKeys(input.tenantId);
    const policy = this.policyService.resolve(input.tenantId, plan, entitlements);
    if (policy.maxApplications < 1) {
      throw new DeveloperError(
        DEVELOPER_ERROR_CODES.POLICY_LIMIT,
        'the tenant plan does not include developer applications',
      );
    }
    if (input.partnerId && !policy.partnerApplicationsAllowed) {
      throw new DeveloperError(
        DEVELOPER_ERROR_CODES.POLICY_LIMIT,
        'the tenant plan does not allow partner-owned applications',
      );
    }
    const environment = input.environment ?? 'SANDBOX';
    if (!policy.environments.includes(environment)) {
      throw new DeveloperError(
        DEVELOPER_ERROR_CODES.ENVIRONMENT_MISMATCH,
        `environment ${environment} is not allowed by platform policy`,
      );
    }
    const scopes = validateScopes(input.requestedScopes ?? ['profile:read']);
    const outside = scopes.filter((scope) => !policy.allowedScopes.includes(scope));
    if (outside.length > 0) {
      throw new DeveloperError(
        DEVELOPER_ERROR_CODES.SCOPE_NOT_ALLOWED,
        `tenant policy does not grant scope(s): ${outside.join(', ')}`,
      );
    }
    const redirectUris = this.validateRedirectUris(input.redirectUris, policy, environment);
    const naturalKey = input.naturalKey ?? input.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 48);
    const idem = idempotencyKey(input.tenantId, 'developer_application.create', naturalKey);

    return this.prisma.withTenantRls(input.tenantId, async (tx) => {
      // The tenant row serializes the quota check and duplicate natural key.
      await tx.$queryRaw`SELECT "id" FROM "tenants" WHERE "id" = ${input.tenantId}::uuid FOR UPDATE`;
      await claimMutationIntent(tx, input.tenantId, requestKey, 'application.create', idem);
      const existing = await tx.developerApplication.findFirst({
        where: { tenantId: input.tenantId, idempotencyKey: idem },
      });
      if (existing) {
        const sameRedirects = existing.redirectUris.length === redirectUris.length && redirectUris.every((uri) => existing.redirectUris.includes(uri));
        const sameScopes = existing.scopes.length === scopes.length && scopes.every((scope) => existing.scopes.includes(scope));
        if (existing.name !== input.name || existing.description !== input.description || existing.environment !== environment
          || existing.partnerId !== (input.partnerId ?? null) || !sameRedirects || !sameScopes) {
          throw new DeveloperError(DEVELOPER_ERROR_CODES.INVALID_TRANSITION, 'application natural key is already in use');
        }
        return existing;
      }

      const count = await tx.developerApplication.count({
        where: { tenantId: input.tenantId, state: { not: 'REVOKED' } },
      });
      if (count >= policy.maxApplications) {
        throw new DeveloperError(
          DEVELOPER_ERROR_CODES.POLICY_LIMIT,
          `plan allows at most ${policy.maxApplications} active applications`,
        );
      }

      const application = await tx.developerApplication.create({
        data: {
          tenantId: input.tenantId,
          partnerId: input.partnerId ?? null,
          name: input.name,
          description: input.description,
          clientId: deterministicClientId(input.tenantId, naturalKey),
          state: 'PENDING',
          environment,
          redirectUris,
          scopes,
          homePageUrl: null,
          idempotencyKey: idem,
          naturalKey,
          createdByActorId: input.actorId,
        },
      });
      await this.audit.record({
        tenantId: input.tenantId,
        applicationId: application.id,
        actorType: input.actorType,
        actorId: input.actorId,
        correlationId: input.correlationId,
        action: 'application.created',
        detail: { name: application.name, clientId: application.clientId, environment },
      }, tx);
      return application;
    });
  }

  /** Portal listing scoped to the caller's tenant ONLY. */
  async listForTenant(
    tenantId: string,
    query: { state?: string; environment?: string; limit?: number; cursor?: string },
  ) {
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
    return this.prisma.withTenantRls(tenantId, async (tx) => {
      const where = {
        tenantId,
        ...(query.state ? { state: query.state } : {}),
        ...(query.environment ? { environment: query.environment } : {}),
      };
      if (query.cursor && (!isUUID(query.cursor) || !await tx.developerApplication.findFirst({
        where: { ...where, id: query.cursor }, select: { id: true },
      }))) throw new BadRequestException('invalid application cursor');
      const rows = await tx.developerApplication.findMany({
        where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: limit + 1,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      });
      const page = rows.slice(0, limit);
      return {
        rows: page.map(({ idempotencyKey: _idem, createdByActorId: _actor, ...safe }) => {
          void _idem; void _actor; return safe;
        }),
        nextCursor: rows.length > limit ? page[page.length - 1].id : null,
      };
    });
  }

  /** Owned read; cross-tenant ids are indistinguishable from unknown. */
  async getOwned(tenantId: string, applicationId: string) {
    const application = await this.loadOwned(tenantId, applicationId);
    const {
      idempotencyKey: _idem,
      createdByActorId: _actor,
      ...safe
    } = application;
    void _idem;
    void _actor;
    return safe;
  }

  private async loadOwned(tenantId: string, applicationId: string) {
    const application = await this.prisma.withTenantRls(tenantId, (tx) => tx.developerApplication.findUnique({
      where: { id: applicationId },
    }));
    if (!application || application.tenantId !== tenantId) {
      throw new NotFoundException('developer application not found');
    }
    return application;
  }

  async update(
    actor: DeveloperActor,
    applicationId: string,
    patch: { name?: string; description?: string; redirectUris?: string[]; homePageUrl?: string },
    requestKey: string,
  ) {
    const application = await this.loadOwned(actor.tenantId, applicationId);
    if (application.state === 'REVOKED') {
      throw new DeveloperError(
        DEVELOPER_ERROR_CODES.APPLICATION_REVOKED,
        'revoked applications cannot be modified',
      );
    }
    const plan = await this.policyData.planLimitViewForTenant(actor.tenantId);
    const entitlements = await this.policyData.tenantEntitlementKeys(actor.tenantId);
    const policy = this.policyService.resolve(actor.tenantId, plan, entitlements);
    const redirectUris = patch.redirectUris
      ? this.validateRedirectUris(patch.redirectUris, policy, application.environment)
      : undefined;
    return this.prisma.withTenantRls(actor.tenantId, async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "developer_applications" WHERE "id" = ${application.id}::uuid AND "tenant_id" = ${actor.tenantId}::uuid FOR UPDATE`;
      const current = await tx.developerApplication.findUnique({ where: { id: application.id } });
      if (!current || current.tenantId !== actor.tenantId) throw new NotFoundException('developer application not found');
      if (current.state === 'REVOKED') throw new DeveloperError(DEVELOPER_ERROR_CODES.APPLICATION_REVOKED, 'revoked applications cannot be modified');
      await claimMutationIntent(tx, actor.tenantId, requestKey, 'application.update', application.id);
      const updated = await tx.developerApplication.update({
        where: { id: application.id },
        data: {
          ...(patch.name !== undefined ? { name: patch.name } : {}),
          ...(patch.description !== undefined ? { description: patch.description } : {}),
          ...(patch.homePageUrl !== undefined ? { homePageUrl: patch.homePageUrl } : {}),
          ...(redirectUris !== undefined ? { redirectUris } : {}),
        },
      });
      await this.audit.record({
        tenantId: actor.tenantId,
        applicationId: application.id,
        actorType: actor.actorType,
        actorId: actor.actorId,
        correlationId: actor.correlationId,
        action: 'application.updated',
        detail: { fields: Object.keys(patch) },
      }, tx);
      const { idempotencyKey: _idem, createdByActorId: _actor, ...safe } = updated;
      void _idem; void _actor; return safe;
    });
  }

  private async transition(
    actor: DeveloperActor,
    applicationId: string,
    target: ApplicationState,
    action: string,
    requestKey: string,
    reason?: string,
    requiredState?: ApplicationState,
  ): Promise<void> {
    const application = await this.loadOwned(actor.tenantId, applicationId);
    if (requiredState && application.state !== requiredState) {
      throw new DeveloperError(DEVELOPER_ERROR_CODES.INVALID_TRANSITION, 'application is not in the required state');
    }
    // Policy may explicitly allow reactivation without a review stage. All
    // other transitions still follow the fixed lifecycle map.
    if (!(action === 'application.reactivation_requested' && application.state === 'SUSPENDED' && target === 'ACTIVE')) {
      transitionOrThrow(APPLICATION_TRANSITIONS, application.state, target, `application ${application.id}`);
    }
    await this.prisma.withTenantRls(actor.tenantId, async (tx) => {
      await claimMutationIntent(tx, actor.tenantId, requestKey, 'application.transition', `${application.id}:${target}`);
      const changed = await tx.developerApplication.updateMany({
        where: { id: application.id, tenantId: actor.tenantId, state: application.state },
        data: { state: target },
      });
      if (changed.count !== 1) throw new DeveloperError(DEVELOPER_ERROR_CODES.INVALID_TRANSITION, 'application state changed');
      await this.audit.record({
        tenantId: actor.tenantId,
        applicationId: application.id,
        actorType: actor.actorType,
        actorId: actor.actorId,
        correlationId: actor.correlationId,
        action,
        detail: { from: application.state, to: target, reason: reason ?? null },
      }, tx);
    });
  }

  async activate(actor: DeveloperActor, applicationId: string, requestKey: string): Promise<void> {
    // Review approvals require a separate platform-only operation.
    await this.transition(actor, applicationId, 'ACTIVE', 'application.activated', requestKey, undefined, 'PENDING');
  }

  async suspend(actor: DeveloperActor, applicationId: string, reason: string | undefined, requestKey: string): Promise<void> {
    await this.transition(actor, applicationId, 'SUSPENDED', 'application.suspended', requestKey, reason);
  }

  /**
   * Suspension exit goes through review when the plan requires it; the
   * REVIEW state is itself audited so partner/tenant self-reactivation is
   * always visible to platform staff.
   */
  async requestReactivation(actor: DeveloperActor, applicationId: string, reason: string | undefined, requestKey: string): Promise<ApplicationState> {
    await this.loadOwned(actor.tenantId, applicationId);
    const plan = await this.policyData.planLimitViewForTenant(actor.tenantId);
    const entitlements = await this.policyData.tenantEntitlementKeys(actor.tenantId);
    const policy = this.policyService.resolve(actor.tenantId, plan, entitlements);
    const target: ApplicationState = policy.reactivationReviewRequired
      ? 'REACTIVATION_REVIEW'
      : 'ACTIVE';
    await this.transition(actor, applicationId, target, 'application.reactivation_requested', requestKey, reason, 'SUSPENDED');
    return target;
  }

  async approveReactivation(actor: DeveloperActor, applicationId: string, requestKey: string): Promise<void> {
    await this.transition(actor, applicationId, 'ACTIVE', 'application.reactivation_approved', requestKey, undefined, 'REACTIVATION_REVIEW');
  }

  async revoke(actor: DeveloperActor, applicationId: string, reason: string | undefined, requestKey: string): Promise<void> {
    await this.transition(actor, applicationId, 'REVOKED', 'application.revoked', requestKey, reason);
  }

  async addRedirectUri(actor: DeveloperActor, applicationId: string, uri: string, requestKey: string) {
    const application = await this.loadOwned(actor.tenantId, applicationId);
    const plan = await this.policyData.planLimitViewForTenant(actor.tenantId);
    const entitlements = await this.policyData.tenantEntitlementKeys(actor.tenantId);
    const policy = this.policyService.resolve(actor.tenantId, plan, entitlements);
    return this.prisma.withTenantRls(actor.tenantId, async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "developer_applications" WHERE "id" = ${application.id}::uuid AND "tenant_id" = ${actor.tenantId}::uuid FOR UPDATE`;
      const current = await tx.developerApplication.findUnique({ where: { id: application.id } });
      if (!current || current.tenantId !== actor.tenantId) throw new NotFoundException('developer application not found');
      if (current.state === 'REVOKED') throw new DeveloperError(DEVELOPER_ERROR_CODES.APPLICATION_REVOKED, 'revoked applications cannot be modified');
      await claimMutationIntent(tx, actor.tenantId, requestKey, 'application.redirect_add', application.id);
      if (current.redirectUris.includes(uri)) {
        const { idempotencyKey: _idem, createdByActorId: _actor, ...safe } = current;
        void _idem; void _actor; return safe;
      }
      const redirectUris = this.validateRedirectUris([...current.redirectUris, uri], policy, current.environment);
      const updated = await tx.developerApplication.update({
        where: { id: application.id },
        data: { redirectUris },
      });
      await this.audit.record({
        tenantId: actor.tenantId,
        applicationId: application.id,
        actorType: actor.actorType,
        actorId: actor.actorId,
        correlationId: actor.correlationId,
        action: 'application.redirect_added',
        detail: { uri },
      }, tx);
      const { idempotencyKey: _idem, createdByActorId: _actor, ...safe } = updated;
      void _idem; void _actor; return safe;
    });
  }
}
