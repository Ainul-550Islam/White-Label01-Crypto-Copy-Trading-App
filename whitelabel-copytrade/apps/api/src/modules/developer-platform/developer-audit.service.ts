/**
 * Immutable, hash-chained audit trail for every privileged developer
 * action. Each record commits to the previous record's hash inside its
 * tenant scope, so silent removal or reordering of history is detectable.
 * Free-form detail is redacted before persistence; credential material
 * never enters this service at all.
 */

import type { Prisma } from '@prisma/client';
import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { redactRecord, redactSecrets, sha256Hex } from './developer.types';

export interface DeveloperAuditActor {
  tenantId: string;
  actorType: 'USER' | 'SERVICE' | 'PLATFORM';
  actorId: string;
  correlationId: string;
}

export interface AuditRecordInput extends DeveloperAuditActor {
  applicationId?: string | null;
  action: string;
  detail: Record<string, unknown>;
}

export interface AuditListPage<T> {
  rows: T[];
  nextCursor: string | null;
}

@Injectable()
export class DeveloperAuditService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Appends one audit record. The chain hash is computed over
   * (tenantId, previousHash, action, canonical detail, correlationId) so any
   * later tampering with content OR ordering breaks verification.
   */
  async record(input: AuditRecordInput): Promise<{ id: string; chainHash: string }> {
    const previous = await this.prisma.developerAudit.findFirst({
      where: { tenantId: input.tenantId },
      orderBy: { sequence: 'desc' },
      select: { chainHash: true, sequence: true },
    });
    const safeDetail = redactRecord(input.detail);
    const detailJson = JSON.stringify(safeDetail);
    const sequence = (previous?.sequence ?? 0) + 1;
    const chainHash = sha256Hex(
      [
        input.tenantId,
        previous?.chainHash ?? 'GENESIS',
        String(sequence),
        input.action,
        detailJson,
        input.correlationId,
      ].join('|'),
    );
    const row = await this.prisma.developerAudit.create({
      data: {
        tenantId: input.tenantId,
        applicationId: input.applicationId ?? null,
        actorType: input.actorType,
        actorId: input.actorId,
        correlationId: input.correlationId,
        action: input.action,
        detail: JSON.parse(detailJson) as Prisma.InputJsonValue,
        sequence,
        previousHash: previous?.chainHash ?? 'GENESIS',
        chainHash,
      },
    });
    return { id: row.id, chainHash: row.chainHash };
  }

  async verifyChain(tenantId: string): Promise<{ ok: boolean; brokenAtSequence?: number }> {
    const rows = await this.prisma.developerAudit.findMany({
      where: { tenantId },
      orderBy: { sequence: 'asc' },
    });
    let previousHash = 'GENESIS';
    for (const row of rows) {
      const detailJson = JSON.stringify(row.detail);
      const expected = sha256Hex(
        [row.tenantId, previousHash, String(row.sequence), row.action, detailJson, row.correlationId].join('|'),
      );
      if (row.previousHash !== previousHash || row.chainHash !== expected) {
        return { ok: false, brokenAtSequence: row.sequence };
      }
      previousHash = row.chainHash;
    }
    return { ok: true };
  }

  async list(
    tenantId: string,
    query: { applicationId?: string; action?: string; limit?: number; cursor?: string },
  ): Promise<AuditListPage<{
    id: string;
    sequence: number;
    applicationId: string | null;
    actorType: string;
    actorId: string;
    correlationId: string;
    action: string;
    detail: Record<string, unknown>;
    createdAt: Date;
  }>> {
    const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
    const rows = await this.prisma.developerAudit.findMany({
      where: {
        tenantId,
        ...(query.applicationId ? { applicationId: query.applicationId } : {}),
        ...(query.action ? { action: query.action } : {}),
        ...(query.cursor ? { sequence: { lt: Number.parseInt(query.cursor, 10) } } : {}),
      },
      orderBy: { sequence: 'desc' },
      take: limit + 1,
    });
    const page = rows.slice(0, limit);
    const nextCursor = rows.length > limit ? String(page[page.length - 1].sequence) : null;
    return {
      rows: page.map((row: { id: string; sequence: number; applicationId: string | null; actorType: string; actorId: string; correlationId: string; action: string; detail: unknown; createdAt: Date }) => ({
        id: row.id,
        sequence: row.sequence,
        applicationId: row.applicationId,
        actorType: row.actorType,
        actorId: row.actorId,
        correlationId: row.correlationId,
        action: row.action,
        detail: (row.detail ?? {}) as Record<string, unknown>,
        createdAt: row.createdAt,
      })),
      nextCursor,
    };
  }

  /** Free-form text destined for audit notes is scrubbed defensively. */
  scrub(text: string): string {
    return redactSecrets(text);
  }
}
