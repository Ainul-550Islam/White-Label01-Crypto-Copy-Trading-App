import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import type { AuthenticatedActor } from '@wlct/shared-types';
import { Permission } from '@wlct/shared-types';

import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PlatformOnly, RequirePermissions } from '../../common/decorators/permissions.decorator';
import type { AppRequest } from '../../common/types/request.types';
import { MobileAppService } from './mobile-app.service';
import { MobileReleaseApprovalService } from './mobile-release-approval.service';
import { MobileReleaseAuditService } from './mobile-release-audit.service';
import { MobileArtifactVerificationService } from './mobile-artifact-verification.service';
import { MobileBuildService } from './mobile-build.service';
import { MobileCrashService } from './mobile-crash.service';
import { MobileReleaseMonitorService } from './mobile-release-monitor.service';
import { MobileReconciliationService } from './mobile-reconciliation.service';
import { MobileReleaseService } from './mobile-release.service';
import { MobileRollbackService } from './mobile-rollback.service';
import { MobileRolloutService } from './mobile-rollout.service';
import { MobileSecurityScanService } from './mobile-security-scan.service';
import { MobileStoreService } from './mobile-store.service';
import { MobileStoreHealthService } from './mobile-store-health.service';
import { MobileReleasePolicyService } from './mobile-release-policy.service';
import type { MobileActor } from './mobile-release.types';
import {
  CreateMobileAppDto,
  MobileAppVersionMetadataDto,
  UpdateMobileAppDto,
} from './dto/mobile-app.dto';
import { CreateMobileBuildDto, ScanArtifactDto, VerifyArtifactDto } from './dto/mobile-build.dto';
import {
  ApproveReleaseDto,
  CreateMobileReleaseDto,
  RejectReleaseDto,
  RollbackDto,
  StoreStatusDto,
  StoreSubmitDto,
} from './dto/mobile-release-action.dto';
import {
  MobileAppQueryDto,
  MobileBuildQueryDto,
  MobileCrashQueryDto,
  MobileReleaseQueryDto,
  MobileReconciliationQueryDto,
} from './dto/mobile-query.dto';

/**
 * AuthenticatedActor (JWT) -> MobileActor (release domain identity).
 * Kept explicit so the domain never imports the HTTP layer's types.
 */
function toMobileActor(actor: AuthenticatedActor): MobileActor {
  return {
    userId: actor.userId,
    tenantId: actor.tenantId,
    roles: actor.roles,
    isPlatformUser: actor.isPlatformUser,
  };
}

@ApiTags('mobile-release')
@Controller('mobile')
export class MobileReleaseController {
  constructor(
    private readonly apps: MobileAppService,
    private readonly builds: MobileBuildService,
    private readonly verification: MobileArtifactVerificationService,
    private readonly scans: MobileSecurityScanService,
    private readonly releases: MobileReleaseService,
    private readonly approvals: MobileReleaseApprovalService,
    private readonly store: MobileStoreService,
    private readonly storeHealth: MobileStoreHealthService,
    private readonly rollouts: MobileRolloutService,
    private readonly rollback: MobileRollbackService,
    private readonly monitor: MobileReleaseMonitorService,
    private readonly crashes: MobileCrashService,
    private readonly reconciliation: MobileReconciliationService,
    private readonly audit: MobileReleaseAuditService,
    private readonly policy: MobileReleasePolicyService,
  ) {}

  // ------------------------------------------------------------------
  // Applications (tenant-scoped white-label provisioning)
  // ------------------------------------------------------------------

  @Post('apps')
  @RequirePermissions(Permission.TENANT_UPDATE)
  @ApiOperation({ summary: 'Provision a tenant white-label app (identity+branding+config gates)' })
  async provisionApp(
    @CurrentUser() actor: AuthenticatedActor,
    @CurrentTenant() tenant: { tenantId: string },
    @Body() dto: CreateMobileAppDto,
    @Req() request: AppRequest,
  ) {
    return this.apps.provisionApp({
      tenantId: tenant.tenantId,
      dto,
      actor: toMobileActor(actor),
      correlationId: request.correlationId,
    });
  }

  @Get('apps')
  @RequirePermissions(Permission.TENANT_READ)
  async listApps(
    @CurrentUser() actor: AuthenticatedActor,
    @CurrentTenant() tenant: { tenantId: string },
    @Query() q: MobileAppQueryDto,
  ) {
    return this.apps.listApps(tenant.tenantId, toMobileActor(actor), q.page, q.pageSize);
  }

  @Get('apps/:applicationId')
  @RequirePermissions(Permission.TENANT_READ)
  async getApp(
    @CurrentUser() actor: AuthenticatedActor,
    @CurrentTenant() tenant: { tenantId: string },
    @Param('applicationId') applicationId: string,
  ) {
    return this.apps.getApp(applicationId, tenant.tenantId, toMobileActor(actor));
  }

  @Put('apps/:applicationId')
  @RequirePermissions(Permission.TENANT_UPDATE)
  async updateApp(
    @CurrentUser() actor: AuthenticatedActor,
    @CurrentTenant() tenant: { tenantId: string },
    @Param('applicationId') applicationId: string,
    @Body() dto: UpdateMobileAppDto,
  ) {
    return this.apps.updateApp(applicationId, tenant.tenantId, dto, toMobileActor(actor));
  }

  @Put('apps/:applicationId/version-metadata')
  @RequirePermissions(Permission.TENANT_UPDATE)
  async setVersionMetadata(
    @CurrentUser() actor: AuthenticatedActor,
    @CurrentTenant() tenant: { tenantId: string },
    @Param('applicationId') applicationId: string,
    @Body() dto: MobileAppVersionMetadataDto,
  ) {
    return this.apps.setVersionMetadata(applicationId, tenant.tenantId, dto, toMobileActor(actor));
  }

  @Post('apps/:applicationId/configure')
  @RequirePermissions(Permission.TENANT_UPDATE)
  async markConfigured(
    @CurrentUser() actor: AuthenticatedActor,
    @CurrentTenant() tenant: { tenantId: string },
    @Param('applicationId') applicationId: string,
  ) {
    return this.apps.markConfigured(applicationId, tenant.tenantId, toMobileActor(actor));
  }

  // ------------------------------------------------------------------
  // Builds -> artifacts -> verification -> security scan
  // ------------------------------------------------------------------

  @Post('apps/:applicationId/builds')
  @RequirePermissions(Permission.TENANT_UPDATE)
  async requestBuild(
    @CurrentUser() actor: AuthenticatedActor,
    @CurrentTenant() tenant: { tenantId: string },
    @Param('applicationId') applicationId: string,
    @Body() dto: CreateMobileBuildDto,
    @Req() request: AppRequest,
  ) {
    return this.builds.requestBuild({
      applicationId,
      tenantId: tenant.tenantId,
      platform: dto.platform,
      environment: dto.environment,
      buildMode: dto.buildMode,
      versionName: dto.versionName,
      versionCode: dto.versionCode,
      iosBuildNumber: dto.iosBuildNumber ?? null,
      commitSha: dto.commitSha ?? null,
      actor: toMobileActor(actor),
      correlationId: request.correlationId,
    });
  }

  @Get('builds')
  @RequirePermissions(Permission.TENANT_READ)
  async listBuilds(
    @CurrentTenant() tenant: { tenantId: string },
    @Query() q: MobileBuildQueryDto,
  ) {
    return this.builds.listBuilds(tenant.tenantId, q);
  }

  @Post('artifacts/:artifactId/verify')
  @RequirePermissions(Permission.TENANT_UPDATE)
  async verifyArtifact(
    @CurrentUser() actor: AuthenticatedActor,
    @CurrentTenant() tenant: { tenantId: string },
    @Param('artifactId') artifactId: string,
    @Body() dto: VerifyArtifactDto,
    @Req() request: AppRequest,
  ) {
    void dto;
    return this.verification.verify({
      artifactId,
      tenantId: tenant.tenantId,
      actor: toMobileActor(actor),
      correlationId: request.correlationId,
      signingRequired: this.policy
        .resolve()
        .signingRequiredEnvironments.includes('PRODUCTION'),
    });
  }

  @Post('artifacts/:artifactId/scan')
  @RequirePermissions(Permission.TENANT_UPDATE)
  async scanArtifact(
    @CurrentUser() actor: AuthenticatedActor,
    @CurrentTenant() tenant: { tenantId: string },
    @Param('artifactId') artifactId: string,
    @Body() dto: ScanArtifactDto,
    @Req() request: AppRequest,
  ) {
    void dto;
    return this.scans.scanArtifact({
      artifactId,
      tenantId: tenant.tenantId,
      actor: toMobileActor(actor),
      correlationId: request.correlationId,
    });
  }

  // ------------------------------------------------------------------
  // Releases: create -> approve/reject/rework -> store -> rollout
  // ------------------------------------------------------------------

  @Post('apps/:applicationId/releases')
  @RequirePermissions(Permission.TENANT_UPDATE)
  async createRelease(
    @CurrentUser() actor: AuthenticatedActor,
    @CurrentTenant() tenant: { tenantId: string },
    @Param('applicationId') applicationId: string,
    @Body() dto: CreateMobileReleaseDto,
    @Req() request: AppRequest,
  ) {
    return this.releases.createRelease({
      applicationId,
      tenantId: tenant.tenantId,
      artifactId: dto.artifactId,
      releaseNotes: dto.releaseNotes ?? null,
      actor: toMobileActor(actor),
      correlationId: request.correlationId,
    });
  }

  @Get('releases')
  @RequirePermissions(Permission.TENANT_READ)
  async listReleases(@CurrentTenant() tenant: { tenantId: string }, @Query() q: MobileReleaseQueryDto) {
    return this.releases.listForTenant(tenant.tenantId, q);
  }

  @Get('releases/:releaseId')
  @RequirePermissions(Permission.TENANT_READ)
  async getRelease(
    @CurrentTenant() tenant: { tenantId: string },
    @Param('releaseId') releaseId: string,
  ) {
    return this.releases.mustGet(releaseId, tenant.tenantId);
  }

  @Post('releases/:releaseId/approve')
  @RequirePermissions(Permission.TENANT_UPDATE)
  async approveRelease(
    @CurrentUser() actor: AuthenticatedActor,
    @Param('releaseId') releaseId: string,
    @Body() dto: ApproveReleaseDto,
    @Req() request: AppRequest,
  ) {
    return this.approvals.approve({
      releaseId,
      actor: toMobileActor(actor),
      reason: dto.reason ?? null,
      correlationId: request.correlationId,
    });
  }

  @Post('releases/:releaseId/reject')
  @RequirePermissions(Permission.TENANT_UPDATE)
  async rejectRelease(
    @CurrentUser() actor: AuthenticatedActor,
    @Param('releaseId') releaseId: string,
    @Body() dto: RejectReleaseDto,
    @Req() request: AppRequest,
  ) {
    return this.approvals.reject({
      releaseId,
      actor: toMobileActor(actor),
      reason: dto.reason,
      correlationId: request.correlationId,
    });
  }

  @Post('releases/:releaseId/rework')
  @RequirePermissions(Permission.TENANT_UPDATE)
  async requestRework(
    @CurrentUser() actor: AuthenticatedActor,
    @Param('releaseId') releaseId: string,
    @Body() dto: RejectReleaseDto,
    @Req() request: AppRequest,
  ) {
    return this.approvals.requestRework({
      releaseId,
      actor: toMobileActor(actor),
      reason: dto.reason,
      correlationId: request.correlationId,
    });
  }

  // ------------------------------------------------------------------
  // Store distribution
  // ------------------------------------------------------------------

  @Post('releases/:releaseId/store-submissions')
  @RequirePermissions(Permission.TENANT_UPDATE)
  async submitToStore(
    @CurrentUser() actor: AuthenticatedActor,
    @CurrentTenant() tenant: { tenantId: string },
    @Param('releaseId') releaseId: string,
    @Body() dto: StoreSubmitDto,
    @Req() request: AppRequest,
  ) {
    return this.store.submit({
      releaseId,
      tenantId: tenant.tenantId,
      provider: dto.provider as Parameters<MobileStoreService['submit']>[0]['provider'],
      track: dto.track,
      actor: toMobileActor(actor),
      correlationId: request.correlationId,
    });
  }

  @Post('releases/:releaseId/store-status')
  @RequirePermissions(Permission.TENANT_UPDATE)
  async refreshStoreStatus(
    @CurrentUser() actor: AuthenticatedActor,
    @CurrentTenant() tenant: { tenantId: string },
    @Param('releaseId') releaseId: string,
    @Body() dto: StoreStatusDto,
    @Req() request: AppRequest,
  ) {
    return this.store.refreshStatus({
      releaseId,
      tenantId: tenant.tenantId,
      provider: dto.provider as Parameters<MobileStoreService['refreshStatus']>[0]['provider'],
      actor: toMobileActor(actor),
      correlationId: request.correlationId,
    });
  }

  @Get('releases/:releaseId/store')
  @RequirePermissions(Permission.TENANT_READ)
  async storeSubmission(
    @CurrentTenant() tenant: { tenantId: string },
    @Param('releaseId') releaseId: string,
  ) {
    return this.store.tenantSafeSubmission(releaseId, tenant.tenantId);
  }

  // ------------------------------------------------------------------
  // Staged rollout (evidence-driven; halt requires explicit reason)
  // ------------------------------------------------------------------

  @Post('releases/:releaseId/rollouts')
  @RequirePermissions(Permission.TENANT_UPDATE)
  async startRollout(
    @CurrentUser() actor: AuthenticatedActor,
    @CurrentTenant() tenant: { tenantId: string },
    @Param('releaseId') releaseId: string,
    @Req() request: AppRequest,
  ) {
    return this.rollouts.start({
      releaseId,
      tenantId: tenant.tenantId,
      actor: toMobileActor(actor),
      correlationId: request.correlationId,
    });
  }

  @Post('rollouts/:rolloutId/begin')
  @RequirePermissions(Permission.TENANT_UPDATE)
  async beginRollout(
    @CurrentUser() actor: AuthenticatedActor,
    @CurrentTenant() tenant: { tenantId: string },
    @Param('rolloutId') rolloutId: string,
    @Body() body: { evidence: Parameters<MobileRolloutService['begin']>[2] },
  ) {
    return this.rollouts.begin(rolloutId, tenant.tenantId, body.evidence);
  }

  @Post('rollouts/:rolloutId/advance')
  @RequirePermissions(Permission.TENANT_UPDATE)
  async advanceRollout(
    @CurrentUser() actor: AuthenticatedActor,
    @CurrentTenant() tenant: { tenantId: string },
    @Param('rolloutId') rolloutId: string,
    @Body() body: { evidence: Parameters<MobileRolloutService['advance']>[0]['evidence'] },
    @Req() request: AppRequest,
  ) {
    return this.rollouts.advance({
      rolloutId,
      tenantId: tenant.tenantId,
      actor: toMobileActor(actor),
      evidence: body.evidence,
      correlationId: request.correlationId,
    });
  }

  @Post('rollouts/:rolloutId/complete')
  @RequirePermissions(Permission.TENANT_UPDATE)
  async completeRollout(
    @CurrentUser() actor: AuthenticatedActor,
    @CurrentTenant() tenant: { tenantId: string },
    @Param('rolloutId') rolloutId: string,
    @Body() body: { evidence: Parameters<MobileRolloutService['complete']>[0]['evidence'] },
    @Req() request: AppRequest,
  ) {
    return this.rollouts.complete({
      rolloutId,
      tenantId: tenant.tenantId,
      actor: toMobileActor(actor),
      evidence: body.evidence,
      correlationId: request.correlationId,
    });
  }

  @Post('rollouts/:rolloutId/halt')
  @RequirePermissions(Permission.TENANT_UPDATE)
  async haltRollout(
    @CurrentUser() actor: AuthenticatedActor,
    @CurrentTenant() tenant: { tenantId: string },
    @Param('rolloutId') rolloutId: string,
    @Body() body: { reason: string },
    @Req() request: AppRequest,
  ) {
    return this.rollouts.halt({
      rolloutId,
      tenantId: tenant.tenantId,
      actor: toMobileActor(actor),
      reason: body.reason,
      correlationId: request.correlationId,
    });
  }

  // ------------------------------------------------------------------
  // Monitoring, crash evidence, rollback
  // ------------------------------------------------------------------

  @Get('releases/:releaseId/health')
  @RequirePermissions(Permission.TENANT_READ)
  async releaseHealth(
    @CurrentTenant() tenant: { tenantId: string },
    @Param('releaseId') releaseId: string,
  ) {
    return this.monitor.releaseHealth({ releaseId, tenantId: tenant.tenantId });
  }

  @Post('releases/:releaseId/evaluate-halt')
  @RequirePermissions(Permission.TENANT_UPDATE)
  async evaluateHalt(
    @CurrentTenant() tenant: { tenantId: string },
    @Param('releaseId') releaseId: string,
  ) {
    return this.monitor.evaluateAutomaticHalt({ releaseId, tenantId: tenant.tenantId });
  }

  @Get('releases/:releaseId/crashes')
  @RequirePermissions(Permission.TENANT_READ)
  async crashEvidence(
    @CurrentTenant() tenant: { tenantId: string },
    @Param('releaseId') releaseId: string,
    @Query() q: MobileCrashQueryDto,
  ) {
    return this.crashes.releaseCrashEvidence({
      releaseId,
      tenantId: tenant.tenantId,
      windowMinutes: q.windowMinutes,
    });
  }

  @Post('crashes/ingest')
  @RequirePermissions(Permission.TENANT_UPDATE)
  async ingestCrash(
    @CurrentUser() actor: AuthenticatedActor,
    @CurrentTenant() tenant: { tenantId: string },
    @Body() body: Parameters<MobileCrashService['ingest']>[0],
    @Req() request: AppRequest,
  ) {
    return this.crashes.ingest({
      ...body,
      tenantId: tenant.tenantId,
      actor: toMobileActor(actor),
      correlationId: request.correlationId,
    });
  }

  @Post('apps/:applicationId/rollback')
  @RequirePermissions(Permission.TENANT_UPDATE)
  async rollbackApp(
    @CurrentUser() actor: AuthenticatedActor,
    @CurrentTenant() tenant: { tenantId: string },
    @Param('applicationId') applicationId: string,
    @Body() dto: RollbackDto,
    @Req() request: AppRequest,
  ) {
    return this.rollback.rollback({
      applicationId,
      tenantId: tenant.tenantId,
      targetReleaseId: dto.targetReleaseId ?? null,
      actor: toMobileActor(actor),
      correlationId: request.correlationId,
    });
  }

  @Get('apps/:applicationId/rollback-history')
  @RequirePermissions(Permission.TENANT_READ)
  async rollbackHistory(
    @CurrentTenant() tenant: { tenantId: string },
    @Param('applicationId') applicationId: string,
  ) {
    return this.rollback.history(applicationId, tenant.tenantId);
  }

  @Get('audit')
  @RequirePermissions(Permission.TENANT_READ)
  async auditTrail(
    @CurrentTenant() tenant: { tenantId: string },
    @Query('limit') limit?: string,
  ) {
    const parsed = Number.parseInt(limit ?? '100', 10);
    const safe = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 200) : 100;
    return this.audit.listForTenant(tenant.tenantId, safe);
  }

  // ------------------------------------------------------------------
  // Platform operations (platform RBAC; cross-tenant reconciliation)
  // ------------------------------------------------------------------

  @Post('platform/reconciliation/run')
  @PlatformOnly()
  @RequirePermissions(Permission.PLATFORM_MANAGE)
  async runReconciliation(@Body() dto: MobileReconciliationQueryDto) {
    return this.reconciliation.run({
      runId: dto.runId,
      tenantId: dto.tenantId ?? null,
    });
  }

  @Post('platform/store-health/check')
  @PlatformOnly()
  @RequirePermissions(Permission.PLATFORM_MANAGE)
  async checkStoreHealth() {
    return this.storeHealth.checkAll();
  }
}
