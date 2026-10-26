// # Responsibility: implements the Batch 04 commercial domain behavior for this capability.
// # Issues short-lived one-use download tokens in Redis and releases only a tenant/user-scoped export manifest.
import { createHash, randomBytes } from 'node:crypto';
import { BadRequestException, GoneException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { RedisService } from '../../infrastructure/redis/redis.service';

const TOKEN_TTL_MS = 5 * 60 * 1000;
interface TokenRecord { tenantId: string; userId: string; requestId: string; exportId: string; expiresAt: string; }
export interface DownloadManifest { id: string; requestId: string; exportVersion: string; dataAsOf: string; generatedAt: string; dataCategories: string[]; sourceReferences: string[]; recordCount: number; fileHash: string | null; methodology: string; policyVersion: string; }

@Injectable()
export class PrivacyExportDownloadService {
  constructor(private readonly prisma: PrismaService, private readonly redis: RedisService) {}

  async issue(tenantId: string, userId: string, requestId: string): Promise<{ token: string; expiresAt: string }> {
    if (!tenantId || !userId || !requestId) throw new BadRequestException('Authenticated tenant, user, and request are required');
    const exportRecord = await this.prisma.privacyExport.findFirst({ where: { tenantId, subjectUserId: userId, requestId }, orderBy: { generatedAt: 'desc' } });
    if (!exportRecord) throw new NotFoundException('Ready export not found');
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + TOKEN_TTL_MS).toISOString();
    const tokenRecord: TokenRecord = { tenantId, userId, requestId, exportId: exportRecord.id, expiresAt };
    const saved = await this.redis.client.set(this.key(token), JSON.stringify(tokenRecord), 'PX', TOKEN_TTL_MS, 'NX');
    if (saved !== 'OK') throw new ServiceUnavailableException('One-time download token could not be securely issued');
    return { token, expiresAt };
  }

  async consume(tenantId: string, userId: string, token: string): Promise<DownloadManifest> {
    if (!tenantId || !userId || !token || token.length < 32 || token.length > 128) throw new BadRequestException('Valid one-time download token required');
    let raw: unknown;
    try { raw = await this.redis.client.call('GETDEL', this.key(token)); }
    catch { throw new ServiceUnavailableException('One-time download service is unavailable'); }
    if (typeof raw !== 'string') throw new GoneException('Download token is expired or already consumed');
    let record: TokenRecord;
    try { record = JSON.parse(raw) as TokenRecord; }
    catch { throw new GoneException('Download token record is invalid'); }
    if (record.tenantId !== tenantId || record.userId !== userId) throw new NotFoundException('Export not found');
    if (Date.parse(record.expiresAt) <= Date.now()) throw new GoneException('Download token expired');
    const exportRecord = await this.prisma.privacyExport.findFirst({ where: { id: record.exportId, tenantId, subjectUserId: userId, requestId: record.requestId } });
    if (!exportRecord) throw new NotFoundException('Export not found');
    return {
      id: exportRecord.id, requestId: exportRecord.requestId, exportVersion: exportRecord.exportVersion,
      dataAsOf: exportRecord.dataAsOf.toISOString(), generatedAt: exportRecord.generatedAt.toISOString(),
      dataCategories: exportRecord.dataCategories, sourceReferences: exportRecord.sourceReferences,
      recordCount: exportRecord.recordCount, fileHash: exportRecord.fileHash, methodology: exportRecord.methodology,
      policyVersion: exportRecord.policyVersion,
    };
  }

  private key(token: string): string {
    return `privacy-export-download:${createHash('sha256').update(token, 'utf8').digest('hex')}`;
  }
}
