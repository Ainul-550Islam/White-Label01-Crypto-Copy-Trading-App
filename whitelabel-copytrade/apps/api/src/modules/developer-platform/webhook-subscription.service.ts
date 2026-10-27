/**
 * Developer webhook subscription lifecycle with ownership enforcement,
 * deterministic event filtering, secret lifecycle and delivery policy.
 *
 * A subscription belongs to exactly one (tenant, application). Endpoints
 * must be https in PRODUCTION. The signing secret is shown ONCE at creation
 * and stored encrypted for signing plus an HMAC digest. Every mutation is audited.
 */

import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { isUUID } from 'class-validator';
import type { DeveloperWebhookSubscription, Prisma } from '@prisma/client';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { constantTimeEqual, credentialDigest, DEVELOPER_ERROR_CODES, DeveloperError, idempotencyKey, isKnownEventType, validateScopes } from './developer.types';
import { DeveloperAuditService, type DeveloperAuditActor } from './developer-audit.service';
import {
  DEVELOPER_POLICY_DATA_PORT,
  DeveloperPolicyDataPort,
  DeveloperPolicyService,
} from './developer-policy.service';
import { DEVELOPER_SECRET_CIPHER, WebhookSigningService, type DeveloperSecretCipher } from './webhook-signing.service';
import { DEVELOPER_SECRET_HMAC_KEY } from './developer-credential.service';
import { claimMutationIntent } from './developer-mutation-intent';
import { parseWebhookTarget } from './webhook-http-client';

// Only the one-time plaintext secret is returned to the caller. Internal
// ciphertext and digests must never cross the service's portal boundary.
function publicSubscription(subscription: DeveloperWebhookSubscription) {
  const { secretHash, secretEncrypted, idempotencyKey: _key, createdByActorId: _actor, ...safe } = subscription;
  void secretHash; void secretEncrypted; void _key; void _actor;
  return safe;
}

export interface CreateSubscriptionInput {
  applicationId: string;
  endpointUrl: string;
  eventTypes: string[];
  eventVersion?: string;
  environment?: 'SANDBOX' | 'PRODUCTION';
  description?: string;
}

@Injectable()
export class WebhookSubscriptionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: DeveloperAuditService,
    private readonly policyService: DeveloperPolicyService,
    @Inject(DEVELOPER_POLICY_DATA_PORT) private readonly policyData: DeveloperPolicyDataPort,
    private readonly signing: WebhookSigningService,
    @Inject(DEVELOPER_SECRET_HMAC_KEY) private readonly hmacKey: string,
    @Inject(DEVELOPER_SECRET_CIPHER) private readonly cipher: DeveloperSecretCipher,
  ) {}

  private validateEndpoint(url: string, _environment: string): string {
    if (!parseWebhookTarget(url)) {
      throw new DeveloperError(
        DEVELOPER_ERROR_CODES.WEBHOOK_ENDPOINT_INVALID,
        'webhook endpoint must be a public HTTPS URL on port 443',
      );
    }
    return url;
  }

  private validateEventTypes(eventTypes: string[]): string[] {
    const unique = [...new Set(eventTypes.map((type) => type.trim()).filter(Boolean))];
    if (unique.length === 0) {
      throw new DeveloperError(DEVELOPER_ERROR_CODES.VALIDATION, 'at least one event type is required');
    }
    for (const eventType of unique) {
      if (!isKnownEventType(eventType)) {
        throw new DeveloperError(
          DEVELOPER_ERROR_CODES.EVENT_NOT_SUBSCRIBED,
          `event type '${eventType}' does not exist on this platform`,
        );
      }
    }
    return unique.sort();
  }

  private async loadOwnedApplication(tenantId: string, applicationId: string) {
    const application = await this.prisma.withTenantRls(tenantId, (tx) => tx.developerApplication.findUnique({
      where: { id: applicationId },
    }));
    if (!application || application.tenantId !== tenantId) {
      throw new NotFoundException('developer application not found');
    }
    return application;
  }

  async create(actor: DeveloperAuditActor, input: CreateSubscriptionInput, requestKey?: string) {
    const application = await this.loadOwnedApplication(actor.tenantId, input.applicationId);
    if (application.state !== 'ACTIVE') {
      throw new DeveloperError(DEVELOPER_ERROR_CODES.APPLICATION_REVOKED, 'application is not active');
    }
    const plan = await this.policyData.planLimitViewForTenant(actor.tenantId);
    const entitlements = await this.policyData.tenantEntitlementKeys(actor.tenantId);
    const policy = this.policyService.resolve(actor.tenantId, plan, entitlements);
    if (!Number.isSafeInteger(policy.maxWebhookSubscriptions) || policy.maxWebhookSubscriptions < 0 ||
        !Number.isSafeInteger(policy.maxWebhookEndpointsPerApplication) || policy.maxWebhookEndpointsPerApplication < 0) {
      throw new DeveloperError(DEVELOPER_ERROR_CODES.POLICY_LIMIT, 'webhook quota evidence is unavailable');
    }
    if (!policy.allowedScopes.includes('webhooks:manage')) {
      throw new DeveloperError(DEVELOPER_ERROR_CODES.SCOPE_NOT_ALLOWED, 'the current plan does not grant webhooks');
    }

    const [activeCount, applicationCount] = await this.prisma.withTenantRls(actor.tenantId, (tx) => Promise.all([
      tx.developerWebhookSubscription.count({ where: { tenantId: actor.tenantId, revokedAt: null } }),
      tx.developerWebhookSubscription.count({ where: { tenantId: actor.tenantId, applicationId: application.id, revokedAt: null } }),
    ]));
    if (activeCount >= policy.maxWebhookSubscriptions || applicationCount >= policy.maxWebhookEndpointsPerApplication) {
      throw new DeveloperError(DEVELOPER_ERROR_CODES.POLICY_LIMIT, 'plan webhook subscription or application endpoint limit reached');
    }
    // webhooks:manage must be inside the application's declared scopes.
    validateScopes(['webhooks:manage']);
    if (!application.scopes.includes('webhooks:manage')) {
      throw new DeveloperError(
        DEVELOPER_ERROR_CODES.SCOPE_NOT_ALLOWED,
        "application does not hold the 'webhooks:manage' scope",
      );
    }

    const environment = input.environment ?? application.environment;
    if (environment !== application.environment) {
      throw new DeveloperError(DEVELOPER_ERROR_CODES.ENVIRONMENT_MISMATCH, 'webhook environment must match its application');
    }
    const endpointUrl = this.validateEndpoint(input.endpointUrl, environment);
    const eventTypes = this.validateEventTypes(input.eventTypes);
    const eventVersion = input.eventVersion ?? 'v1';

    const secret = this.signing.newSecret();
    const create = async (tx: Prisma.TransactionClient) => {
      if (requestKey) {
        await claimMutationIntent(tx, actor.tenantId, requestKey, 'webhook.create', application.id);
        // The tenant row serializes quota checks for concurrent creations.
        await tx.$queryRaw`SELECT "id" FROM "tenants" WHERE "id" = ${actor.tenantId}::uuid FOR UPDATE`;
        const locked = await tx.$queryRaw<Array<{ state: string; scopes: string[]; environment: string }>>`
          SELECT "state", "scopes", "environment" FROM "developer_applications"
          WHERE "tenant_id" = ${actor.tenantId}::uuid AND "id" = ${application.id}::uuid FOR UPDATE
        `;
        if (!locked[0] || locked[0].state !== 'ACTIVE' ||
            !locked[0].scopes.includes('webhooks:manage') || locked[0].environment !== environment) {
          throw new DeveloperError(DEVELOPER_ERROR_CODES.SCOPE_NOT_ALLOWED, 'application no longer permits this webhook');
        }
        const [count, perApplication] = await Promise.all([
          tx.developerWebhookSubscription.count({ where: { tenantId: actor.tenantId, revokedAt: null } }),
          tx.developerWebhookSubscription.count({ where: { tenantId: actor.tenantId, applicationId: application.id, revokedAt: null } }),
        ]);
        if (count >= policy.maxWebhookSubscriptions || perApplication >= policy.maxWebhookEndpointsPerApplication) {
          throw new DeveloperError(DEVELOPER_ERROR_CODES.POLICY_LIMIT, 'plan webhook subscription or application endpoint limit reached');
        }
      }
      const subscription = await tx.developerWebhookSubscription.create({
        data: {
          tenantId: actor.tenantId,
          applicationId: application.id,
          endpointUrl,
          eventTypes,
          eventVersion,
          environment,
          description: input.description ?? null,
          state: 'ACTIVE',
          secretHash: credentialDigest(secret, this.hmacKey),
          // Retrievable ONLY through the platform crypto infrastructure so the
          // delivery pipeline can sign; never rendered outside signing.
          secretEncrypted: this.cipher.encrypt(secret),
          idempotencyKey: idempotencyKey(
            actor.tenantId,
            'webhook.subscription',
            `${application.id}|${endpointUrl}|${eventTypes.join(',')}`,
          ),
          createdByActorId: actor.actorId,
        },
      });
      await this.audit.record({
        ...actor,
        applicationId: application.id,
        action: 'webhook.created',
        detail: { subscriptionId: subscription.id, endpointUrl, eventTypes, eventVersion },
      }, tx);
      return subscription;
    };
    const subscription = await this.prisma.withTenantRls(actor.tenantId, create);
    // One-time presentation of the endpoint secret.
    return { subscription: publicSubscription(subscription), secret };
  }

  private async loadOwnedSubscription(tenantId: string, subscriptionId: string) {
    const subscription = await this.prisma.withTenantRls(tenantId, (tx) => tx.developerWebhookSubscription.findUnique({
      where: { id: subscriptionId },
    }));
    if (!subscription || subscription.tenantId !== tenantId) {
      throw new NotFoundException('webhook subscription not found');
    }
    return subscription;
  }

  private async mutate<T>(
    actor: DeveloperAuditActor,
    requestKey: string | undefined,
    operation: string,
    subscriptionId: string,
    work: (tx: Prisma.TransactionClient) => Promise<T>,
    audit: { applicationId: string; action: string; detail: Record<string, unknown> },
  ): Promise<T> {
    return this.prisma.withTenantRls(actor.tenantId, async (tx) => {
      if (requestKey) await claimMutationIntent(tx, actor.tenantId, requestKey, operation, subscriptionId);
      const result = await work(tx);
      await this.audit.record({ ...actor, ...audit }, tx);
      return result;
    });
  }

  async update(
    actor: DeveloperAuditActor,
    subscriptionId: string,
    patch: { endpointUrl?: string; eventTypes?: string[]; description?: string },
    requestKey?: string,
  ) {
    const subscription = await this.loadOwnedSubscription(actor.tenantId, subscriptionId);
    if (subscription.revokedAt) {
      throw new DeveloperError(DEVELOPER_ERROR_CODES.VALIDATION, 'revoked subscriptions cannot be updated');
    }
    const endpointUrl = patch.endpointUrl
      ? this.validateEndpoint(patch.endpointUrl, subscription.environment)
      : subscription.endpointUrl;
    const eventTypes = patch.eventTypes
      ? this.validateEventTypes(patch.eventTypes)
      : subscription.eventTypes;
    const updated = await this.mutate(actor, requestKey, 'webhook.update', subscriptionId, async (tx) => {
      const changed = await tx.developerWebhookSubscription.updateMany({
        where: { id: subscription.id, tenantId: actor.tenantId, revokedAt: null },
        data: {
          ...(patch.endpointUrl !== undefined ? { endpointUrl } : {}),
          ...(patch.eventTypes !== undefined ? { eventTypes } : {}),
          ...(patch.description !== undefined ? { description: patch.description } : {}),
        },
      });
      if (changed.count !== 1) throw new DeveloperError(DEVELOPER_ERROR_CODES.VALIDATION, 'subscription changed');
      return tx.developerWebhookSubscription.findUniqueOrThrow({ where: { id: subscription.id } });
    }, { applicationId: subscription.applicationId, action: 'webhook.changed', detail: { subscriptionId, fields: Object.keys(patch) } });
    return publicSubscription(updated);
  }

  async pause(actor: DeveloperAuditActor, subscriptionId: string, reason?: string, requestKey?: string) {
    const subscription = await this.loadOwnedSubscription(actor.tenantId, subscriptionId);
    if (subscription.state !== 'ACTIVE') {
      throw new DeveloperError(DEVELOPER_ERROR_CODES.INVALID_TRANSITION, 'only ACTIVE subscriptions can pause');
    }
    const updated = await this.mutate(actor, requestKey, 'webhook.pause', subscriptionId, async (tx) => {
      const changed = await tx.developerWebhookSubscription.updateMany({
        where: { id: subscription.id, tenantId: actor.tenantId, state: 'ACTIVE', revokedAt: null },
        data: { state: 'PAUSED' },
      });
      if (changed.count !== 1) throw new DeveloperError(DEVELOPER_ERROR_CODES.INVALID_TRANSITION, 'subscription changed');
      return tx.developerWebhookSubscription.findUniqueOrThrow({ where: { id: subscription.id } });
    }, { applicationId: subscription.applicationId, action: 'webhook.paused', detail: { subscriptionId, reason: reason ?? null } });
    return publicSubscription(updated);
  }

  async resume(actor: DeveloperAuditActor, subscriptionId: string, reason?: string, requestKey?: string) {
    const subscription = await this.loadOwnedSubscription(actor.tenantId, subscriptionId);
    if (subscription.state !== 'PAUSED') {
      throw new DeveloperError(DEVELOPER_ERROR_CODES.INVALID_TRANSITION, 'only PAUSED subscriptions can resume');
    }
    const updated = await this.mutate(actor, requestKey, 'webhook.resume', subscriptionId, async (tx) => {
      const changed = await tx.developerWebhookSubscription.updateMany({
        where: { id: subscription.id, tenantId: actor.tenantId, state: 'PAUSED', revokedAt: null },
        data: { state: 'ACTIVE' },
      });
      if (changed.count !== 1) throw new DeveloperError(DEVELOPER_ERROR_CODES.INVALID_TRANSITION, 'subscription changed');
      return tx.developerWebhookSubscription.findUniqueOrThrow({ where: { id: subscription.id } });
    }, { applicationId: subscription.applicationId, action: 'webhook.resumed', detail: { subscriptionId, reason: reason ?? null } });
    return publicSubscription(updated);
  }

  async revoke(actor: DeveloperAuditActor, subscriptionId: string, reason?: string, requestKey?: string) {
    const subscription = await this.loadOwnedSubscription(actor.tenantId, subscriptionId);
    await this.mutate(actor, requestKey, 'webhook.revoke', subscriptionId, async (tx) => {
      await tx.developerWebhookSubscription.updateMany({
        where: { id: subscription.id, tenantId: actor.tenantId, revokedAt: null },
        data: { state: 'REVOKED', revokedAt: new Date() },
      });
    }, { applicationId: subscription.applicationId, action: 'webhook.revoked', detail: { subscriptionId, reason: reason ?? null } });
  }

  /** Rotates the endpoint secret; new secret shown once. */
  async rotateSecret(actor: DeveloperAuditActor, subscriptionId: string, requestKey?: string): Promise<{ secret: string }> {
    const subscription = await this.loadOwnedSubscription(actor.tenantId, subscriptionId);
    if (subscription.revokedAt) {
      throw new DeveloperError(DEVELOPER_ERROR_CODES.VALIDATION, 'revoked subscriptions cannot rotate secrets');
    }
    const secret = this.signing.newSecret();
    await this.mutate(actor, requestKey, 'webhook.rotate_secret', subscriptionId, async (tx) => {
      // Compare-and-set prevents two concurrent rotations from showing two
      // secrets when only the last one would still work.
      const changed = await tx.developerWebhookSubscription.updateMany({
        where: { id: subscription.id, tenantId: actor.tenantId, revokedAt: null, secretHash: subscription.secretHash },
        data: { secretHash: credentialDigest(secret, this.hmacKey), secretEncrypted: this.cipher.encrypt(secret) },
      });
      if (changed.count !== 1) throw new DeveloperError(DEVELOPER_ERROR_CODES.VALIDATION, 'subscription changed');
    }, { applicationId: subscription.applicationId, action: 'webhook.secret_rotated', detail: { subscriptionId } });
    return { secret };
  }

  /** Digest comparison used by the delivery pipeline (never exposes it). */
  async secretMatches(subscriptionId: string, tenantId: string, secret: string): Promise<boolean> {
    const subscription = await this.loadOwnedSubscription(tenantId, subscriptionId);
    return constantTimeEqual(credentialDigest(secret, this.hmacKey), subscription.secretHash);
  }

  /** Delivery-time event filter (CHECK 41) + subscription liveness. */
  async acceptsEvent(subscriptionId: string, tenantId: string, eventType: string, environment: string) {
    const subscription = await this.loadOwnedSubscription(tenantId, subscriptionId);
    if (subscription.revokedAt || subscription.state !== 'ACTIVE') {
      throw new DeveloperError(DEVELOPER_ERROR_CODES.EVENT_NOT_SUBSCRIBED, 'subscription is not active');
    }
    if (!subscription.eventTypes.includes(eventType)) {
      throw new DeveloperError(DEVELOPER_ERROR_CODES.EVENT_NOT_SUBSCRIBED, `event '${eventType}' is not subscribed`);
    }
    if (subscription.environment !== environment) {
      throw new DeveloperError(DEVELOPER_ERROR_CODES.ENVIRONMENT_MISMATCH, 'event environment does not match subscription');
    }
    return subscription;
  }

  async list(tenantId: string, query: { applicationId?: string; status?: string; limit?: number; cursor?: string }) {
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
    return this.prisma.withTenantRls(tenantId, async (tx) => {
      const where = {
        tenantId,
        ...(query.applicationId ? { applicationId: query.applicationId } : {}),
        ...(query.status ? { state: query.status } : {}),
      };
      if (query.cursor && (!isUUID(query.cursor) || !await tx.developerWebhookSubscription.findFirst({
        where: { ...where, id: query.cursor }, select: { id: true },
      }))) throw new BadRequestException('invalid webhook cursor');
      const rows = await tx.developerWebhookSubscription.findMany({
        where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: limit + 1,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      });
      const page = rows.slice(0, limit);
      return { rows: page.map(publicSubscription), nextCursor: rows.length > limit ? page[page.length - 1].id : null };
    });
  }
}
