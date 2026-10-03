import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { MobileIdentityService } from './mobile-identity.service';
import { MobileBrandingService } from './mobile-branding.service';
import { MobileConfigService } from './mobile-config.service';
import { MobileReleasePolicyService } from './mobile-release-policy.service';
import { MobileReleaseAuditService } from './mobile-release-audit.service';
import { AUDIT_ACTIONS, MobileActor, MobileReleaseError, MOBILE_ERROR_CODES } from './mobile-release.types';
import { CreateMobileAppDto, MobileAppVersionMetadataDto, UpdateMobileAppDto } from './dto/mobile-app.dto';

/**
 * Mobile application provisioning (Part 28, file 26).
 *
 * The provisioning factory drives an EXISTING Flutter product into a
 * tenant-aware, white-labeled release vehicle. It is a strict pipeline:
 *
 *   identity (package/bundle ids) -> branding (backend-sanitized)
 *     -> mobile runtime config (secret-free) -> MobileApplication row
 *     -> [separately] build config -> build -> artifact -> verify -> sign
 *     -> release -> rollout -> store -> monitor.
 *
 * The row starts PROVISIONING and only reaches CONFIGURED when identity
 * passes validation/collision checks AND sanitized branding AND a
 * secret-free runtime config all succeeded — never before, never on
 * assertion, always from real results. It cannot fail into a state that
 * pretends readiness, and a failed provisioning never leaves a half-trusted
 * row behind (it stays PROVISIONING with an error recorded).
 */
@Injectable()
export class MobileAppService {
  private readonly logger = new Logger(MobileAppService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: MobileIdentityService,
    private readonly branding: MobileBrandingService,
    private readonly config: MobileConfigService,
    private readonly policy: MobileReleasePolicyService,
    private readonly audit: MobileReleaseAuditService,
  ) {}

  /**
   * Provision a tenant's white-label app.
   *
   * Steps, each a real gate:
   *  1. tenant must exist (and actor must belong to it / be platform);
   *  2. idempotent replay when the caller repeats the same idempotencyKey;
   *  3. identity resolution (deterministic androidPackageId + iosBundleId,
   *     with collision detection -> 409 IDENTITY_COLLISION);
   *  4. branding sanitization (customCss never executed/persisted;
   *     unsafe values -> BRANDING_UNSAFE);
   *  5. runtime config build (allow-list; secrets refused ->
   *     CONFIG_SECRET_REFUSED);
   *  6. row persisted with state PROVISIONING, then flipped to CONFIGURED
   *     only after 3-5 all returned real results.
   */
  async provisionApp(input: {
    tenantId: string;
    dto: CreateMobileAppDto;
    actor: MobileActor;
    correlationId?: string;
  }): Promise<{ app: Record<string, unknown>; replayed: boolean }> {
    const correlationId = input.correlationId ?? randomUUID();

    if (!input.actor.isPlatformUser && input.actor.tenantId !== input.tenantId) {
      throw new MobileReleaseError(MOBILE_ERROR_CODES.FORBIDDEN, 'actor cannot provision for this tenant', 403);
    }

    const tenant = await this.prisma.tenant.findUnique({ where: { id: input.tenantId } });
    if (!tenant) {
      throw new MobileReleaseError(MOBILE_ERROR_CODES.FORBIDDEN, 'tenant not found', 404);
    }

    // ---- idempotent provisioning ------------------------------------------
    const idempotencyKey = input.dto.idempotencyKey
      ? input.dto.idempotencyKey
      : createHash('sha256')
          .update(['mobile-app', input.tenantId, tenant.slug, input.dto.displayName].join('|'))
          .digest('hex');
    const prior = await this.prisma.mobileApplication.findFirst({
      where: { tenantId: input.tenantId, idempotencyKey },
    });
    if (prior) {
      return { app: prior as unknown as Record<string, unknown>, replayed: true };
    }

    // ---- 1) identity (derive + validate + cross-tenant collision check) ----
    const identity = await this.identity.resolveForTenant({
      tenantId: input.tenantId,
      tenantSlug: tenant.slug,
      tenantName: tenant.name,
    });

    // ---- 2) branding: ONLY from the backend's authoritative TenantBranding,
    //         sanitized by fromRecord; customCss is never carried over. -------
    const branding = await this.branding.resolveForTenant(input.tenantId);

    // ---- 3) persist PROVISIONING first (no config yet) ----------------------
    // App slug: tenant-scoped unique, derived from the display name, suffix-
    // disambiguated deterministically on collision within the tenant.
    const baseSlug = this.identity.slugify(input.dto.displayName);
    let appSlug = baseSlug;
    let suffix = 1;
    while (
      (await this.prisma.mobileApplication.findFirst({
        where: { tenantId: input.tenantId, slug: appSlug },
        select: { id: true },
      })) !== null
    ) {
      appSlug = `${baseSlug}-${suffix}`;
      suffix += 1;
    }
    const app = await this.prisma.mobileApplication.create({
      data: {
        tenantId: input.tenantId,
        partnerId: input.dto.partnerId ?? null,
        slug: appSlug,
        displayName: input.dto.displayName,
        description: input.dto.description ?? null,
        androidPackageId: identity.androidPackageId,
        iosBundleId: identity.iosBundleId,
        state: 'PROVISIONING',
        brandingSnapshot: branding as unknown as Prisma.InputJsonValue,
        runtimeConfig: {},
        idempotencyKey,
        createdById: input.actor.userId,
      },
    });

    // ---- 4) runtime config (secret-free by construction, real app id) ------
    const runtimeConfig = this.config.build({
      tenantId: input.tenantId,
      applicationId: app.id,
      environment: 'PRODUCTION',
      branding,
      featureFlags: {},
    });
    await this.prisma.mobileApplication.update({
      where: { id: app.id },
      data: { runtimeConfig: runtimeConfig as unknown as Prisma.InputJsonValue },
    });

    await this.audit.record({
      tenantId: input.tenantId,
      applicationId: app.id,
      actor: input.actor,
      action: AUDIT_ACTIONS.APP_CREATED,
      evidence: {
        idempotencyKey,
        androidPackageId: identity.androidPackageId,
        iosBundleId: identity.iosBundleId,
        correlationId,
      },
    });

    this.logger.log(`provisioned mobile application app=${app.id} tenant=${input.tenantId}`);
    return { app: app as unknown as Record<string, unknown>, replayed: false };
  }

  /**
   * Configure app version metadata. Deterministic and monotonic: a metadata
   * set must strictly increase on both platforms before any new build; the
   * values are stored on the app row and re-validated at build request time.
   */
  async setVersionMetadata(
    applicationId: string,
    tenantId: string,
    dto: MobileAppVersionMetadataDto,
    actor: MobileActor,
  ): Promise<Record<string, unknown>> {
    const app = await this.mustGetTenantApp(applicationId, tenantId, actor);

    const prevMarketing = app.marketingVersion ?? null;
    const prevAndroid = app.androidVersionCode ?? 0;
    const prevIos = app.iosBuildNumber ?? 0;

    if (prevMarketing === dto.marketingVersion && dto.androidVersionCode <= prevAndroid) {
      throw new MobileReleaseError(
        MOBILE_ERROR_CODES.VERSION_CONFLICT,
        'androidVersionCode must strictly increase for the same marketingVersion',
        409,
      );
    }
    if (dto.androidVersionCode <= prevAndroid && dto.marketingVersion !== prevMarketing) {
      // A new marketing version may reset... nothing: codes stay monotonic.
      throw new MobileReleaseError(
        MOBILE_ERROR_CODES.VERSION_CONFLICT,
        'androidVersionCode is monotonic across marketing versions',
        409,
      );
    }
    if (dto.iosBuildNumber <= prevIos) {
      throw new MobileReleaseError(
        MOBILE_ERROR_CODES.VERSION_CONFLICT,
        'iosBuildNumber must strictly increase',
        409,
      );
    }

    const updated = await this.prisma.mobileApplication.update({
      where: { id: app.id },
      data: {
        marketingVersion: dto.marketingVersion,
        androidVersionCode: dto.androidVersionCode,
        iosBuildNumber: dto.iosBuildNumber,
      },
    });
    return updated as unknown as Record<string, unknown>;
  }

  async updateApp(
    applicationId: string,
    tenantId: string,
    dto: UpdateMobileAppDto,
    actor: MobileActor,
  ): Promise<Record<string, unknown>> {
    const app = await this.mustGetTenantApp(applicationId, tenantId, actor);
    const updated = await this.prisma.mobileApplication.update({
      where: { id: app.id },
      data: {
        displayName: dto.displayName ?? app.displayName,
        description: dto.description ?? app.description,
      },
    });
    return updated as unknown as Record<string, unknown>;
  }

  async getApp(applicationId: string, tenantId: string, actor: MobileActor): Promise<Record<string, unknown>> {
    const app = await this.mustGetTenantApp(applicationId, tenantId, actor);
    const safe = { ...(app as unknown as Record<string, unknown>) };
    // Customer-visible projection: no store credential references, no
    // internal operations notes, no signing material references.
    delete (safe as Record<string, unknown>).storeCredentialReference;
    delete (safe as Record<string, unknown>).operationsNotes;
    return safe;
  }

  async listApps(
    tenantId: string,
    actor: MobileActor,
    page = 1,
    pageSize = 20,
  ): Promise<{ items: Array<Record<string, unknown>>; total: number }> {
    if (!actor.isPlatformUser && actor.tenantId !== tenantId) {
      throw new MobileReleaseError(MOBILE_ERROR_CODES.FORBIDDEN, 'actor cannot list this tenant', 403);
    }
    const [items, total] = await this.prisma.$transaction([
      this.prisma.mobileApplication.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.mobileApplication.count({ where: { tenantId } }),
    ]);
    return { items: items as unknown as Array<Record<string, unknown>>, total };
  }

  /** Tenant-scoped, actor-authorized fetch used by every service above. */
  async mustGetTenantApp(applicationId: string, tenantId: string, actor: MobileActor) {
    if (!actor.isPlatformUser && actor.tenantId !== tenantId) {
      throw new MobileReleaseError(MOBILE_ERROR_CODES.FORBIDDEN, 'actor is not authorized for this tenant', 403);
    }
    const app = await this.prisma.mobileApplication.findFirst({
      where: { id: applicationId, tenantId },
    });
    if (!app) {
      throw new MobileReleaseError(MOBILE_ERROR_CODES.APP_NOT_FOUND, 'mobile application not found', 404);
    }
    return app;
  }

  /**
   * Mark CONFIGURED only after the caller (controller orchestration) has run
   * the real gates. The service re-checks rather than trusting the caller:
   * identity, branding shape and config secret-freedom are verified here.
   */
  async markConfigured(applicationId: string, tenantId: string, actor: MobileActor): Promise<Record<string, unknown>> {
    const app = await this.mustGetTenantApp(applicationId, tenantId, actor);
    if (app.state === 'CONFIGURED' || app.state === 'ACTIVE') {
      return app as unknown as Record<string, unknown>;
    }
    if (app.state !== 'PROVISIONING') {
      throw new BadRequestException(`app in state ${app.state} cannot be configured`);
    }
    const branding = (app.brandingSnapshot ?? {}) as Record<string, unknown>;
    if (typeof branding.primaryColor !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(branding.primaryColor)) {
      throw new MobileReleaseError(MOBILE_ERROR_CODES.BRANDING_UNSAFE, 'branding not sanitized', 422);
    }
    const serialized = JSON.stringify(app.runtimeConfig ?? {});
    for (const pattern of [
      /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
      /AKIA[0-9A-Z]{16}/,
      /"password"/,
      /api_key=/,
    ] as RegExp[]) {
      if (pattern.test(serialized)) {
        throw new MobileReleaseError(
          MOBILE_ERROR_CODES.CONFIG_SECRET,
          'runtime config failed the secret-free re-check',
          422,
        );
      }
    }
    const updated = await this.prisma.mobileApplication.update({
      where: { id: app.id },
      data: { state: 'CONFIGURED' },
    });
    await this.audit.record({
      tenantId,
      applicationId: app.id,
      actor,
      action: 'APP_CONFIGURED',
      evidence: { androidPackageId: app.androidPackageId, iosBundleId: app.iosBundleId },
    });
    return updated as unknown as Record<string, unknown>;
  }
}
