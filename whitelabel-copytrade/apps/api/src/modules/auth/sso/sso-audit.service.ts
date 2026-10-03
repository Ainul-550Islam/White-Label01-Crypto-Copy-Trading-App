import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { Prisma, type SsoProviderType } from '@prisma/client';

import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { MetricsRegistry } from '../../../infrastructure/metrics/metrics.registry';
import { SecurityAuditService } from '../../security/security-audit.service';
import {
  SsoAuditEventCode,
  type SsoAuditOutcome,
  type SsoFailureStage,
  type SsoLoginResult,
  SsoReasonCode,
  auditEventForReason,
  failureStageForReason,
} from '../../security/sso-flow.types';

export interface SsoAuditInput {
  tenantId: string;
  correlationId: string;
  eventCode: SsoAuditEventCode;
  outcome: SsoAuditOutcome;
  providerType?: SsoProviderType | null;
  configurationId?: string | null;
  transactionId?: string | null;
  userId?: string | null;
  reasonCode?: SsoReasonCode | null;
  ipHash?: string | null;
  metadata?: Record<string, string | number | boolean | null>;
}

/**
 * Metadata keys that could carry credential material. A value under such a key
 * is dropped, whatever the caller intended; the audit trail must never hold a
 * code, token, assertion, nonce, verifier, state, secret or session credential.
 */
const FORBIDDEN_METADATA_KEY =
  /(token|code|nonce|assertion|saml|secret|verifier|state|password|session|cookie|binding|handoff|key)/i;

/** Metric families owned by the SSO flow (registered in metrics.registry.provider.ts). */
export const SSO_LOGINS_METRIC = 'wlct_sso_logins_total';
export const SSO_FAILURES_METRIC = 'wlct_sso_failures_total';

/**
 * Durable SSO audit trail (sso_audit_events) plus metrics.
 *
 * - `record` awaits the insert and lets a failure propagate. The login flow
 *   writes its success events with it, so a login whose evidence cannot be
 *   persisted does not complete.
 * - `recordRejection` never masks the refusal it documents: a failed insert
 *   is logged and the caller still throws the original refusal.
 *
 * Metric labels are closed sets (result / stage). Tenant, user, provider
 * reference and every credential stay out of labels.
 */
@Injectable()
export class SsoAuditService {
  private readonly logger = new Logger(SsoAuditService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly securityAudit: SecurityAuditService,
    @Optional() @Inject(MetricsRegistry) private readonly metrics?: MetricsRegistry,
  ) {}

  async record(input: SsoAuditInput): Promise<void> {
    await this.prisma.ssoAuditEvent.create({
      data: {
        tenantId: input.tenantId,
        correlationId: input.correlationId,
        eventCode: input.eventCode,
        outcome: input.outcome,
        providerType: input.providerType ?? null,
        configurationId: input.configurationId ?? null,
        transactionId: input.transactionId ?? null,
        userId: input.userId ?? null,
        reasonCode: input.reasonCode ?? null,
        ipHash: input.ipHash ?? null,
        safeMetadata: this.safeMetadata(input.metadata) as Prisma.InputJsonValue,
      },
    });
    this.logger.log(
      `sso.audit event=${input.eventCode} outcome=${input.outcome} tenant=${input.tenantId} correlation=${input.correlationId}` +
        (input.reasonCode ? ` reason=${input.reasonCode}` : ''),
    );
  }

  /**
   * Records a refusal: the specific event for the reason, the generic
   * SSO_LOGIN_REJECTED event, the legacy security-audit category and the
   * metrics. Never throws.
   */
  async recordRejection(
    input: Omit<SsoAuditInput, 'eventCode' | 'outcome'> & { reasonCode: SsoReasonCode },
  ): Promise<void> {
    const specific = auditEventForReason(input.reasonCode);
    const stage = failureStageForReason(input.reasonCode);
    this.countFailure(stage);
    this.countLogin('denied');
    try {
      if (specific !== SsoAuditEventCode.LOGIN_REJECTED) {
        await this.record({ ...input, eventCode: specific, outcome: 'FAILURE' });
      }
      await this.record({
        ...input,
        eventCode: SsoAuditEventCode.LOGIN_REJECTED,
        outcome: 'FAILURE',
      });
    } catch (error) {
      this.logger.error(
        `sso.audit_write_failed event=${specific} tenant=${input.tenantId} correlation=${input.correlationId}: ${(error as Error).name}`,
      );
    }
    try {
      await this.securityAudit.record({
        tenantId: input.tenantId,
        userId: input.userId ?? undefined,
        actorId: input.userId ?? undefined,
        event: 'SSO_LOGIN_FAILURE',
        result: 'FAILURE',
        targetType: 'SsoAuthTransaction',
        targetId: input.transactionId ?? undefined,
        safeMetadata: {
          reasonCode: input.reasonCode,
          correlationId: input.correlationId,
          providerType: input.providerType ?? null,
        },
        ipHash: input.ipHash ?? undefined,
        requestId: input.correlationId,
      });
    } catch {
      // SecurityAuditService is best-effort by design; the durable SSO row above is the evidence.
    }
  }

  /** Mirrors a successful SSO login into the existing security-audit category. Never throws. */
  async mirrorSuccess(input: {
    tenantId: string;
    userId: string;
    correlationId: string;
    providerType: SsoProviderType;
    ipHash?: string | null;
  }): Promise<void> {
    try {
      await this.securityAudit.record({
        tenantId: input.tenantId,
        userId: input.userId,
        actorId: input.userId,
        event: 'SSO_LOGIN_SUCCESS',
        result: 'SUCCESS',
        targetType: 'User',
        targetId: input.userId,
        safeMetadata: { correlationId: input.correlationId, providerType: input.providerType },
        ipHash: input.ipHash ?? undefined,
        requestId: input.correlationId,
      });
    } catch {
      // Best-effort mirror; the durable SSO row is the evidence.
    }
  }

  countLogin(result: SsoLoginResult): void {
    this.metrics?.inc(SSO_LOGINS_METRIC, { result });
  }

  countFailure(stage: SsoFailureStage): void {
    this.metrics?.inc(SSO_FAILURES_METRIC, { stage });
  }

  private safeMetadata(
    metadata: SsoAuditInput['metadata'],
  ): Record<string, string | number | boolean | null> {
    const out: Record<string, string | number | boolean | null> = {};
    if (!metadata) return out;
    for (const [key, value] of Object.entries(metadata)) {
      if (FORBIDDEN_METADATA_KEY.test(key)) continue;
      if (value === null || typeof value === 'number' || typeof value === 'boolean') {
        out[key] = value;
      } else if (typeof value === 'string') {
        out[key] = value.slice(0, 200);
      }
    }
    return out;
  }
}
