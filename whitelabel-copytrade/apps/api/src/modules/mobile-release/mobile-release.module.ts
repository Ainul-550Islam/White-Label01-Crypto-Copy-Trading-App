import { Module, type Provider } from '@nestjs/common';

import { NotificationsModule } from '../notifications/notifications.module';
import { NotificationsService } from '../notifications/notifications.service';
import { OperationsModule } from '../operations/operations.module';
import { IncidentService } from '../operations/incident.service';

import { MobileReleasePolicyService, MOBILE_RELEASE_ENV } from './mobile-release-policy.service';
import { MobileIdentityService } from './mobile-identity.service';
import { MobileBrandingService } from './mobile-branding.service';
import { MobileConfigService } from './mobile-config.service';
import { MobileBuildValidationService } from './mobile-build-validation.service';
import { FlutterCliBuildRunner, MOBILE_BUILD_RUNNER, MobileBuildService } from './mobile-build.service';
import { MobileArtifactService } from './mobile-artifact.service';
import { MobileArtifactVerificationService } from './mobile-artifact-verification.service';
import { MOBILE_SIGNING_ADAPTER, MobileSigningService, UnavailableSigningAdapter } from './mobile-signing.service';
import { MobileSecurityScanService } from './mobile-security-scan.service';
import {
  MOBILE_NOTIFICATION_PORT,
  MOBILE_OPERATIONS_PORT,
  MobileReleaseAuditService,
} from './mobile-release-audit.service';
import { MobileReleaseService } from './mobile-release.service';
import { MobileReleaseApprovalService } from './mobile-release-approval.service';
import { MobileRolloutService } from './mobile-rollout.service';
import { MobileStoreService } from './mobile-store.service';
import { MobileStoreHealthService } from './mobile-store-health.service';
import { MobileCrashService } from './mobile-crash.service';
import { MobileReleaseMonitorService } from './mobile-release-monitor.service';
import { MobileRollbackService } from './mobile-rollback.service';
import { MobileReconciliationService } from './mobile-reconciliation.service';
import { MobileAppService } from './mobile-app.service';
import { MobileReleaseController } from './mobile-release.controller';

/**
 * Environment reader backed by the real process environment. Injected through
 * the MOBILE_RELEASE_ENV symbol so every service stays pure in specs (they
 * provide a static reader instead).
 */
const mobileEnvProvider: Provider = {
  provide: MOBILE_RELEASE_ENV,
  useValue: { get: (key: string) => process.env[key] },
};

/** Real build runner for wired deployments; specs override the token. */
const buildRunnerProvider: Provider = {
  provide: MOBILE_BUILD_RUNNER,
  useClass: FlutterCliBuildRunner,
};

/**
 * Default signing adapter: none. This platform ships without a signing host;
 * deployments that have one replace this token with a real implementation.
 * The service reports SIGNING_UNAVAILABLE until then — never a fake success.
 */
const signingAdapterProvider: Provider = {
  provide: MOBILE_SIGNING_ADAPTER,
  useClass: UnavailableSigningAdapter,
};

/**
 * Notification port over the EXISTING notifications infrastructure
 * (NotificationsService.enqueueTransactional). Mobile release notifications
 * are transactional: template fan-out, persisted job, worker retry — no new
 * notification machinery in this module.
 */
const notificationPortProvider: Provider = {
  provide: MOBILE_NOTIFICATION_PORT,
  useFactory: (notifications: NotificationsService) => ({
    enqueueTransactional: (job: Parameters<NotificationsService['enqueueTransactional']>[0]) =>
      notifications.enqueueTransactional(job),
  }),
  inject: [NotificationsService],
};

/**
 * Operations port over the EXISTING incident engine
 * (IncidentService.createIncident). Mobile build/signing/store/rollout
 * failures become operational incidents with the module's evidence — the
 * dedup and escalation rules of the incident engine apply unchanged.
 */
const operationsPortProvider: Provider = {
  provide: MOBILE_OPERATIONS_PORT,
  useFactory: (incidents: IncidentService) => ({
    createIncident: (params: Parameters<IncidentService['createIncident']>[0]) =>
      incidents.createIncident(params),
  }),
  inject: [IncidentService],
};

/**
 * Tenant-aware mobile release factory for the EXISTING Flutter product.
 *
 * Pipeline wiring mirrors the evidence chain:
 *   app config -> identity -> branding -> runtime config
 *     -> build (validation -> runner) -> artifact (immutable sha256)
 *     -> verification (re-digest) -> signing (adapter) -> security scan
 *     -> release -> approval -> store submission -> staged rollout
 *     -> monitoring -> rollback/halt -> reconciliation.
 *
 * Every trusted state transition lives in a service that owns real evidence;
 * nothing in the HTTP layer can fabricate a build, signature, scan pass,
 * store publication, rollout percentage or crash metric.
 */
@Module({
  imports: [NotificationsModule, OperationsModule],
  controllers: [MobileReleaseController],
  providers: [
    mobileEnvProvider,
    buildRunnerProvider,
    signingAdapterProvider,
    notificationPortProvider,
    operationsPortProvider,
    MobileReleasePolicyService,
    MobileIdentityService,
    MobileBrandingService,
    MobileConfigService,
    MobileBuildValidationService,
    MobileBuildService,
    MobileArtifactService,
    MobileArtifactVerificationService,
    MobileSigningService,
    MobileSecurityScanService,
    MobileReleaseAuditService,
    MobileReleaseService,
    MobileReleaseApprovalService,
    MobileRolloutService,
    MobileStoreService,
    MobileStoreHealthService,
    MobileCrashService,
    MobileReleaseMonitorService,
    MobileRollbackService,
    MobileReconciliationService,
    MobileAppService,
  ],
  exports: [
    MobileReleasePolicyService,
    MobileBuildService,
    MobileArtifactService,
    MobileArtifactVerificationService,
    MobileSigningService,
    MobileSecurityScanService,
    MobileReleaseAuditService,
    MobileReleaseService,
    MobileReleaseApprovalService,
    MobileRolloutService,
    MobileStoreService,
    MobileStoreHealthService,
    MobileCrashService,
    MobileReleaseMonitorService,
    MobileRollbackService,
    MobileReconciliationService,
    MobileAppService,
  ],
})
export class MobileReleaseModule {}
