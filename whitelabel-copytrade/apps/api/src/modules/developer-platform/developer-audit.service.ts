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


/** Canonicalize recursively after JSON normalization, including nested keys. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

@Injectable()
export class DeveloperAuditService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Appends one audit record. The chain hash is computed over
   * (tenantId, previousHash, action, canonical detail, correlationId) so any
   * later tampering with content OR ordering breaks verification.
   */
  async record(input: AuditRecordInput, transaction?: Prisma.TransactionClient): Promise<{ id: string; chainHash: string }> {
    const append = async (tx: Prisma.TransactionClient) => {
      // One lock per tenant prevents independent writers from reading the same
      // chain head. It is held through commit, including the caller's mutation.
      await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${`developer-audit:${input.tenantId}`}, 0))`;
      const previous = await tx.developerAudit.findFirst({
        where: { tenantId: input.tenantId },
        orderBy: { sequence: 'desc' },
        select: { chainHash: true, sequence: true },
      });
      const safeDetail = JSON.parse(JSON.stringify(redactRecord(input.detail))) as Prisma.InputJsonValue;
      const detailJson = canonicalJson(safeDetail);
      const sequence = (previous?.sequence ?? 0) + 1;
      const chainHash = sha256Hex(
        [input.tenantId, previous?.chainHash ?? 'GENESIS', String(sequence), input.action, detailJson, input.correlationId].join('|'),
      );
      const row = await tx.developerAudit.create({
        data: {
          tenantId: input.tenantId,
          applicationId: input.applicationId ?? null,
          actorType: input.actorType,
          actorId: input.actorId,
          correlationId: input.correlationId,
          action: input.action,
          detail: safeDetail,
          sequence,
          previousHash: previous?.chainHash ?? 'GENESIS',
          chainHash,
          hashVersion: 2,
        },
      });
      return { id: row.id, chainHash: row.chainHash };
    };
    return transaction ? append(transaction) : this.prisma.withTenantRls(input.tenantId, append);
  }

  async verifyChain(tenantId: string): Promise<{ ok: boolean; brokenAtSequence?: number }> {
    return this.prisma.withTenantRls(tenantId, async (tx) => {
      const rows = await tx.developerAudit.findMany({ where: { tenantId }, orderBy: { sequence: 'asc' } });
      let previousHash = 'GENESIS';
      for (const row of rows) {
        const detailJson = row.hashVersion === 2 ? canonicalJson(row.detail) : JSON.stringify(row.detail);
        const expected = sha256Hex(
          [row.tenantId, previousHash, String(row.sequence), row.action, detailJson, row.correlationId].join('|'),
        );
        if (row.previousHash !== previousHash || row.chainHash !== expected) {
          return { ok: false, brokenAtSequence: row.sequence };
        }
        previousHash = row.chainHash;
      }
      return { ok: true };
    });
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
    const rows = await this.prisma.withTenantRls(tenantId, (tx) => tx.developerAudit.findMany({
      where: {
        tenantId,
        ...(query.applicationId ? { applicationId: query.applicationId } : {}),
        ...(query.action ? { action: query.action } : {}),
        ...(query.cursor ? { sequence: { lt: Number.parseInt(query.cursor, 10) } } : {}),
      },
      orderBy: { sequence: 'desc' },
      take: limit + 1,
    }));
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
