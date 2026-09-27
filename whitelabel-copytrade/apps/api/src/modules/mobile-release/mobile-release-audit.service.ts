import { Inject, Injectable, Optional } from '@nestjs/common';
import { randomUUID } from 'crypto';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import {
  looksLikeSecret,
  MobileActor,
  MobileReleaseError,
  MOBILE_ERROR_CODES,
  redactSecrets,
} from './mobile-release.types';

/**
 * Port to the existing Notifications infrastructure. The real implementation
 * is wired in the module (NotificationsService.enqueueTransactional); specs
 * inject fakes. Kept as a narrow port so this module depends on a two-method
 * surface instead of the whole notification stack.
 */
/** DI tokens so the module can wire the real infrastructure ports. */
export const MOBILE_NOTIFICATION_PORT = Symbol('MOBILE_NOTIFICATION_PORT');
export const MOBILE_OPERATIONS_PORT = Symbol('MOBILE_OPERATIONS_PORT');

export interface MobileNotificationPort {
  enqueueTransactional(job: {
    tenantId: string;
    userId: string;
    type: string;
    locale: string;
    data: Record<string, unknown>;
    requestId?: string;
  }): Promise<void>;
}

/**
 * Port to the existing Operations incident engine (IncidentService). Mobile
 * release incidents are operational incidents — this module creates none of
 * its own incident machinery.
 */
export interface MobileOperationsPort {
  createIncident(params: {
    tenantId?: string | null;
    type: string;
    severity: string;
    title: string;
    summary: string;
    source: string;
    affectedComponent: string;
    affectedCapability?: string | null;
    evidence: Record<string, unknown>;
    correlationId?: string | null;
    actorId?: string | null;
  }): Promise<unknown>;
}

export interface MobileAuditEntry {
  tenantId?: string | null;
  applicationId?: string | null;
  buildId?: string | null;
  artifactId?: string | null;
  releaseId?: string | null;
  actor: MobileActor | null;
  action: string;
  environment?: string | null;
  platform?: string | null;
  version?: string | null;
  commitSha?: string | null;
  artifactSha256?: string | null;
  correlationId?: string | null;
  evidence?: Record<string, unknown>;
}

/**
 * Append-only release audit.
 *
 * Every record is written once and never updated or deleted by this module —
 * there are no update/delete methods, and the database row exists precisely
 * so a post-incident review can replay who did what to which artifact.
 * Evidence passes through the module-wide secret redactor at WRITE time, so a
 * future reader cannot leak what was never stored.
 *
 * The service also fans out to Notifications and Operations through the
 * ports above when they are wired (module does); without ports it reports
 * SKIPPED_NO_PORT honestly rather than pretending delivery happened.
 */
@Injectable()
export class MobileReleaseAuditService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional()
    @Inject(MOBILE_NOTIFICATION_PORT)
    private readonly notifications?: MobileNotificationPort,
    @Optional()
    @Inject(MOBILE_OPERATIONS_PORT)
    private readonly operations?: MobileOperationsPort,
  ) {}

  correlationId(): string {
    return randomUUID();
  }

  async record(entry: MobileAuditEntry): Promise<Record<string, unknown>> {
    if (!entry.action) {
      throw new MobileReleaseError(MOBILE_ERROR_CODES.AUDIT_REQUIRED, 'audit entry requires an action');
    }
    const correlationId = entry.correlationId || this.correlationId();
    const evidence = redactSecrets(entry.evidence ?? {});
    const row = await this.prisma.mobileReleaseAudit.create({
      data: {
        tenantId: entry.tenantId ?? null,
        applicationId: entry.applicationId ?? null,
        buildId: entry.buildId ?? null,
        artifactId: entry.artifactId ?? null,
        releaseId: entry.releaseId ?? null,
        actorId: entry.actor?.userId ?? null,
        actorType: entry.actor?.isPlatformUser ? 'PLATFORM' : 'USER',
        actorRole: entry.actor?.roles?.[0] ?? null,
        action: entry.action,
        environment: entry.environment ?? null,
        platform: entry.platform ?? null,
        version: entry.version ?? null,
        commitSha: entry.commitSha ?? null,
        artifactSha256: entry.artifactSha256 ?? null,
        correlationId,
        evidence: evidence as object,
      },
    });
    return row as unknown as Record<string, unknown>;
  }

  /**
   * Emits a release lifecycle notification through the existing
   * Notifications infrastructure. Data payloads carry identifiers and display
   * values only — never tokens or secrets.
   */
  async notify(input: {
    tenantId: string;
    userId: string;
    type: string;
    data: Record<string, unknown>;
    correlationId?: string;
  }): Promise<'EMITTED' | 'SKIPPED_NO_PORT'> {
    if (!this.notifications) return 'SKIPPED_NO_PORT';
    await this.notifications.enqueueTransactional({
      tenantId: input.tenantId,
      userId: input.userId,
      type: input.type,
      locale: 'en',
      data: redactSecrets(input.data) as Record<string, unknown>,
      requestId: input.correlationId,
    });
    return 'EMITTED';
  }

  /**
   * Raises an operational incident through the existing Operations engine for
   * build/signing/store/rollout failures. Severity is chosen by the caller
   * from explicit policy/evidence — never by hidden scoring here.
   */
  async raiseIncident(input: {
    tenantId?: string | null;
    type: string;
    severity: 'INFO' | 'WARNING' | 'CRITICAL';
    title: string;
    summary: string;
    evidence: Record<string, unknown>;
    correlationId?: string;
  }): Promise<'EMITTED' | 'SKIPPED_NO_PORT'> {
    if (!this.operations) return 'SKIPPED_NO_PORT';
    await this.operations.createIncident({
      tenantId: input.tenantId ?? null,
      type: input.type,
      severity: input.severity,
      title: input.title,
      summary: input.summary,
      source: 'mobile-release',
      affectedComponent: 'mobile-release',
      evidence: redactSecrets(input.evidence) as Record<string, unknown>,
      correlationId: input.correlationId ?? null,
    });
    return 'EMITTED';
  }

  /** Read-only listing for the audit surface; no mutations exist here. */
  async listForTenant(tenantId: string, limit = 100): Promise<Array<Record<string, unknown>>> {
    const rows = await this.prisma.mobileReleaseAudit.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 500),
    });
    return rows as unknown as Array<Record<string, unknown>>;
  }

  /** True when the key/value pair would be redacted (used by specs + UI hints). */
  wouldRedact(key: string, value: unknown): boolean {
    return looksLikeSecret(key, value);
  }
}
