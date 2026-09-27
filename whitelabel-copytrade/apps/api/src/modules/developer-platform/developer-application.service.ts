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
      if (!REDIRECT_URI_PATTERN.test(uri)) {
        throw new DeveloperError(
          DEVELOPER_ERROR_CODES.REDIRECT_URI_MISMATCH,
          `redirect URI '${uri}' is not a valid https (or localhost-development) URI`,
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
  async create(input: CreateApplicationInput) {
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

    const existing = await this.prisma.developerApplication.findFirst({
      where: { tenantId: input.tenantId, idempotencyKey: idem },
    });
    if (existing) {
      return existing;
    }

    const count = await this.prisma.developerApplication.count({
      where: { tenantId: input.tenantId, state: { not: 'REVOKED' } },
    });
    if (count >= policy.maxApplications) {
      throw new DeveloperError(
        DEVELOPER_ERROR_CODES.POLICY_LIMIT,
        `plan allows at most ${policy.maxApplications} active applications`,
      );
    }

    const application = await this.prisma.developerApplication.create({
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
    });
    return application;
  }

  /** Portal listing scoped to the caller's tenant ONLY. */
  async listForTenant(
    tenantId: string,
    query: { state?: string; environment?: string; limit?: number; cursor?: string },
  ) {
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
    const rows = await this.prisma.developerApplication.findMany({
      where: {
        tenantId,
        ...(query.state ? { state: query.state } : {}),
        ...(query.environment ? { environment: query.environment } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return {
      rows: rows.map(({ idempotencyKey: _idem, createdByActorId: _actor, ...safe }: { idempotencyKey: string; createdByActorId: string } & Record<string, unknown>) => {
        void _idem;
        void _actor;
        return safe;
      }),
    };
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
    const application = await this.prisma.developerApplication.findUnique({
      where: { id: applicationId },
    });
    if (!application || application.tenantId !== tenantId) {
      throw new NotFoundException('developer application not found');
    }
    return application;
  }

  async update(
    actor: DeveloperActor,
    applicationId: string,
    patch: { name?: string; description?: string; redirectUris?: string[]; homePageUrl?: string },
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
      : application.redirectUris;
    const updated = await this.prisma.developerApplication.update({
      where: { id: application.id },
      data: {
        name: patch.name ?? application.name,
        description: patch.description ?? application.description,
        homePageUrl: patch.homePageUrl ?? application.homePageUrl,
        redirectUris,
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
    });
    return updated;
  }

  private async transition(
    actor: DeveloperActor,
    applicationId: string,
    target: ApplicationState,
    action: string,
    reason?: string,
  ): Promise<void> {
    const application = await this.loadOwned(actor.tenantId, applicationId);
    transitionOrThrow(APPLICATION_TRANSITIONS, application.state, target, `application ${application.id}`);
    await this.prisma.developerApplication.update({
      where: { id: application.id },
      data: { state: target },
    });
    await this.audit.record({
      tenantId: actor.tenantId,
      applicationId: application.id,
      actorType: actor.actorType,
      actorId: actor.actorId,
      correlationId: actor.correlationId,
      action,
      detail: { from: application.state, to: target, reason: reason ?? null },
    });
  }

  async activate(actor: DeveloperActor, applicationId: string): Promise<void> {
    await this.transition(actor, applicationId, 'ACTIVE', 'application.activated');
  }

  async suspend(actor: DeveloperActor, applicationId: string, reason?: string): Promise<void> {
    await this.transition(actor, applicationId, 'SUSPENDED', 'application.suspended', reason);
  }

  /**
   * Suspension exit goes through review when the plan requires it; the
   * REVIEW state is itself audited so partner/tenant self-reactivation is
   * always visible to platform staff.
   */
  async requestReactivation(actor: DeveloperActor, applicationId: string, reason?: string): Promise<ApplicationState> {
    const application = await this.loadOwned(actor.tenantId, applicationId);
    const plan = await this.policyData.planLimitViewForTenant(actor.tenantId);
    const entitlements = await this.policyData.tenantEntitlementKeys(actor.tenantId);
    const policy = this.policyService.resolve(actor.tenantId, plan, entitlements);
    const target: ApplicationState = policy.reactivationReviewRequired
      ? 'REACTIVATION_REVIEW'
      : 'ACTIVE';
    await this.transition(actor, applicationId, target, 'application.reactivation_requested', reason);
    return target;
  }

  async approveReactivation(actor: DeveloperActor, applicationId: string): Promise<void> {
    await this.transition(actor, applicationId, 'ACTIVE', 'application.reactivation_approved');
  }

  async revoke(actor: DeveloperActor, applicationId: string, reason?: string): Promise<void> {
    await this.transition(actor, applicationId, 'REVOKED', 'application.revoked', reason);
  }

  async addRedirectUri(actor: DeveloperActor, applicationId: string, uri: string) {
    const application = await this.loadOwned(actor.tenantId, applicationId);
    const plan = await this.policyData.planLimitViewForTenant(actor.tenantId);
    const entitlements = await this.policyData.tenantEntitlementKeys(actor.tenantId);
    const policy = this.policyService.resolve(actor.tenantId, plan, entitlements);
    if (application.redirectUris.includes(uri)) {
      return application;
    }
    const redirectUris = this.validateRedirectUris(
      [...application.redirectUris, uri],
      policy,
      application.environment,
    );
    const updated = await this.prisma.developerApplication.update({
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
    });
    return updated;
  }
}
