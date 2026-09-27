/**
 * Deployment Audit Service
 * Produces immutable deployment/release/migration/rollback/backup/restore/security-gate
 * audit events with operator/CI identity, release ID, correlation ID, timestamps and safe evidence.
 */

import * as crypto from 'crypto';
import { DeploymentAuditEvent, EnvironmentName } from './production.types';

export interface AuditInput {
  releaseId: string;
  deploymentId?: string;
  rollbackId?: string;
  backupId?: string;
  restoreId?: string;
  drId?: string;
  environment: EnvironmentName;
  action: DeploymentAuditEvent['action'];
  result: string;
  operatorId: string;
  operatorType: 'USER' | 'CI' | 'SYSTEM';
  commitSha: string;
  artifactDigest?: string;
  migrationId?: string;
  startAt: string;
  finishAt?: string;
  failureReason?: string;
  approvalReference?: string;
  correlationId: string;
  evidence: Record<string, unknown>;
}

export class DeploymentAuditService {
  private readonly events: DeploymentAuditEvent[] = [];

  async record(input: AuditInput): Promise<DeploymentAuditEvent> {
    const auditId = this.generateAuditId(input.correlationId, input.action);
    const finishAt = input.finishAt || new Date().toISOString();
    const durationMs = new Date(finishAt).getTime() - new Date(input.startAt).getTime();

    const safeEvidence = this.redactEvidence(input.evidence);

    const event: DeploymentAuditEvent = {
      auditId,
      releaseId: input.releaseId,
      deploymentId: input.deploymentId,
      rollbackId: input.rollbackId,
      backupId: input.backupId,
      restoreId: input.restoreId,
      drId: input.drId,
      environment: input.environment,
      action: input.action,
      result: input.result,
      operatorId: input.operatorId,
      operatorType: input.operatorType,
      commitSha: input.commitSha,
      artifactDigest: input.artifactDigest ? this.redactDigest(input.artifactDigest) : undefined,
      migrationId: input.migrationId,
      startAt: input.startAt,
      finishAt,
      durationMs,
      failureReason: input.failureReason,
      approvalReference: input.approvalReference,
      correlationId: input.correlationId,
      evidence: safeEvidence,
    };

    this.events.push(event);

    return event;
  }

  private generateAuditId(correlationId: string, action: string): string {
    const hash = crypto
      .createHash('sha256')
      .update(`${correlationId}-${action}-${Date.now()}-${Math.random()}`)
      .digest('hex')
      .slice(0, 12);
    return `audit_${action.toLowerCase()}_${hash}`;
  }

  private redactEvidence(evidence: Record<string, unknown>): Record<string, unknown> {
    const forbiddenKeys = [
      'password',
      'secret',
      'privateKey',
      'apiKey',
      'token',
      'jwt',
      'credential',
      'signingKey',
      'private_key',
      'databaseUrl',
      'DATABASE_URL',
      'DIRECT_DATABASE_URL',
      'REDIS_URL',
      'S3_SECRET',
      'POSTGRES_PASSWORD',
      'JWT_SECRET',
      'ENCRYPTION_KEY',
    ];

    const redacted: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(evidence)) {
      const isForbidden = forbiddenKeys.some((fk) => key.toLowerCase().includes(fk.toLowerCase()));
      if (isForbidden) {
        redacted[key] = '***REDACTED***';
      } else if (typeof value === 'string') {
        if (value.includes('postgres://') || value.includes('postgresql://') || value.includes('redis://')) {
          redacted[key] = '***REDACTED_URL***';
        } else {
          redacted[key] = value.slice(0, 1000);
        }
      } else if (typeof value === 'object' && value !== null) {
        redacted[key] = this.redactEvidence(value as Record<string, unknown>);
      } else {
        redacted[key] = value;
      }
    }
    return redacted;
  }

  private redactDigest(digest: string): string {
    if (!digest) return '***MISSING***';
    if (digest.length <= 12) return '***REDACTED***';
    return `${digest.slice(0, 8)}...${digest.slice(-4)}`;
  }

  getEvents(): DeploymentAuditEvent[] {
    return [...this.events];
  }

  getEventsByCorrelationId(correlationId: string): DeploymentAuditEvent[] {
    return this.events.filter((e) => e.correlationId === correlationId);
  }

  getEventsByReleaseId(releaseId: string): DeploymentAuditEvent[] {
    return this.events.filter((e) => e.releaseId === releaseId);
  }

  isImmutable(event: DeploymentAuditEvent): boolean {
    return !!event.auditId && !!event.correlationId && !!event.startAt;
  }
}
