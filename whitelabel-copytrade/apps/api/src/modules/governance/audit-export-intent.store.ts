// # Durable, tenant-scoped idempotency for synchronous and queued audit exports.
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type { AuditExport, AuditExportJobPayload, AuditExportQueued } from './governance-audit-export.service';

export type ExportResponse = AuditExport | AuditExportQueued;
interface IntentRow { requestHash: string; response: ExportResponse | null; queuedResult: AuditExport | null; }
export interface StoredQueuedIntent { keyHash: string; requestHash: string; response: AuditExportQueued; queuedResult: AuditExport | null; jobPayload: AuditExportJobPayload | null; }
@Injectable()
export class AuditExportIntentStore {
  constructor(private readonly prisma: PrismaService) {}
  async execute(tenantId: string, key: string, requestHash: string,
    operation: (tx: Prisma.TransactionClient, keyHash: string) => Promise<ExportResponse>): Promise<ExportResponse> {
    if (!/^[A-Za-z0-9._:-]{8,128}$/.test(key)) throw new BadRequestException('A valid idempotency key is required');
    const keyHash = createHash('sha256').update(key).digest('hex');
    return this.transaction(tenantId, async (tx) => {
      // Reuse only this expired key here; the bounded relay cleans up other expired rows.
      await tx.$executeRaw`DELETE FROM governance_audit_export_intents WHERE tenant_id=${tenantId}::uuid AND key_hash=${keyHash} AND expires_at<CURRENT_TIMESTAMP`;
      await tx.$executeRaw`INSERT INTO governance_audit_export_intents (tenant_id,key_hash,request_hash) VALUES (${tenantId}::uuid,${keyHash},${requestHash}) ON CONFLICT (tenant_id,key_hash) DO NOTHING`;
      const [row] = await tx.$queryRaw<IntentRow[]>`SELECT request_hash AS "requestHash",response,queued_result AS "queuedResult" FROM governance_audit_export_intents WHERE tenant_id=${tenantId}::uuid AND key_hash=${keyHash} FOR UPDATE`;
      if (!row || row.requestHash !== requestHash) throw new ConflictException('Request key was already used for a different export');
      if (row.response) return row.response;
      const result = await operation(tx, keyHash);
      const value = JSON.stringify(result);
      await tx.$executeRaw`UPDATE governance_audit_export_intents SET response=${value}::jsonb WHERE tenant_id=${tenantId}::uuid AND key_hash=${keyHash}`;
      return result;
    });
  }
  async stageQueued(tx: Prisma.TransactionClient, tenantId: string, keyHash: string, payload: AuditExportJobPayload): Promise<void> {
    const value = JSON.stringify(payload);
    const count = await tx.$executeRaw`UPDATE governance_audit_export_intents SET job_payload=${value}::jsonb WHERE tenant_id=${tenantId}::uuid AND key_hash=${keyHash}`;
    if (count !== 1) throw new Error('Audit export intent could not be staged');
  }
  async executeQueued(tenantId: string, keyHash: string, requestHash: string, jobId: string,
    operation: (tx: Prisma.TransactionClient) => Promise<AuditExport>): Promise<AuditExport> {
    if (!/^[a-f0-9]{64}$/.test(keyHash) || !/^[a-f0-9]{64}$/.test(requestHash) || !/^audit-[a-f0-9]{64}$/.test(jobId)) throw new NotFoundException('Audit export intent not found');
    return this.transaction(tenantId, async (tx) => {
      const [row] = await tx.$queryRaw<IntentRow[]>`SELECT request_hash AS "requestHash",response,queued_result AS "queuedResult" FROM governance_audit_export_intents WHERE tenant_id=${tenantId}::uuid AND key_hash=${keyHash} AND expires_at>CURRENT_TIMESTAMP FOR UPDATE`;
      if (!row || row.requestHash !== requestHash || !row.response || !('status' in row.response) || row.response.id !== jobId) throw new NotFoundException('Audit export intent not found');
      if (row.queuedResult) return row.queuedResult;
      const result = await operation(tx);
      const value = JSON.stringify(result);
      await tx.$executeRaw`UPDATE governance_audit_export_intents SET queued_result=${value}::jsonb WHERE tenant_id=${tenantId}::uuid AND key_hash=${keyHash}`;
      return result;
    });
  }
  async findQueued(tenantId: string, id: string): Promise<StoredQueuedIntent | null> {
    return this.transaction(tenantId, async (tx) => {
      const [row] = await tx.$queryRaw<StoredQueuedIntent[]>`SELECT key_hash AS "keyHash", request_hash AS "requestHash", response, queued_result AS "queuedResult", job_payload AS "jobPayload"
        FROM governance_audit_export_intents WHERE tenant_id=${tenantId}::uuid AND response->>'status'='QUEUED' AND response->>'id'=${id} AND expires_at>CURRENT_TIMESTAMP LIMIT 1`;
      return row ?? null;
    });
  }
  async pending(tenantId: string, limit: number): Promise<StoredQueuedIntent[]> {
    return this.transaction(tenantId, async (tx) => {
      // Also expire results in tenants that no longer request exports. Use
      // SKIP LOCKED so cleanup never stalls an in-flight worker transaction.
      await tx.$executeRaw`DELETE FROM governance_audit_export_intents WHERE ctid IN (
        SELECT ctid FROM governance_audit_export_intents WHERE tenant_id=${tenantId}::uuid AND expires_at<CURRENT_TIMESTAMP LIMIT 50 FOR UPDATE SKIP LOCKED
      )`;
      return tx.$queryRaw<StoredQueuedIntent[]>`SELECT key_hash AS "keyHash", request_hash AS "requestHash", response, queued_result AS "queuedResult", job_payload AS "jobPayload"
        FROM governance_audit_export_intents WHERE tenant_id=${tenantId}::uuid AND job_payload IS NOT NULL AND queued_result IS NULL AND expires_at>CURRENT_TIMESTAMP
        ORDER BY queue_checked_at ASC NULLS FIRST, created_at ASC LIMIT ${limit}`;
    });
  }
  async markQueueChecked(tenantId: string, keyHash: string): Promise<void> {
    await this.transaction(tenantId, (tx) => tx.$executeRaw`UPDATE governance_audit_export_intents SET queue_checked_at=CURRENT_TIMESTAMP WHERE tenant_id=${tenantId}::uuid AND key_hash=${keyHash}`.then(() => undefined));
  }
  async tenantPage(after: string | undefined, take: number): Promise<string[]> {
    const rows = await this.prisma.tenant.findMany({ where: { deletedAt: null, ...(after ? { id: { gt: after } } : {}) }, orderBy: { id: 'asc' }, take, select: { id: true } });
    return rows.map((row) => row.id);
  }
  private async transaction<T>(tenantId: string, work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(tenantId)) throw new BadRequestException('Invalid tenant');
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
      return work(tx);
    }, { timeout: 30_000, maxWait: 10_000 });
  }
}
