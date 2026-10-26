// # Responsibility: Prisma adapters for public share links and for the trader/strategy facts a share may project - the only two places that read these tables.
//
// Both adapters are deliberately thin and dumb. All the rules that matter (the
// signature, the expiry, the field allow-list, the tenant scope of a revoke) live
// in `PublicShareService`, so they are exercised by the unit suite rather than
// implied by a query. What is left here is the part that needs a database:
//
//   * `findByTokenId` is the one truly public query in this module. It is keyed by
//     the opaque token id from a signature that has already been verified, and it
//     deliberately does not filter by tenant - the tenant comes FROM the row,
//     because a public visitor has no tenant context to filter with.
//   * `revoke` filters by tenant and owner in the WHERE clause. Ownership is part
//     of the update, not a read-then-write, so a concurrent request cannot slip
//     between the check and the update.
//   * `load` for a subject filters by the row's own tenant, which is what stops a
//     share from one tenant ever projecting a trader in another.
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import type {
  PublicShareLinkRecord,
  PublicShareRepository,
  ShareSubjectPort,
  ShareSubjectType,
  ShareableField,
} from './public-share.service';

interface PublicShareLinkRow {
  id: string;
  tenantId: string;
  ownerUserId: string;
  subjectType: string;
  subjectId: string;
  tokenId: string;
  expiresAt: Date;
  revokedAt: Date | null;
  fieldsJson: Prisma.JsonValue;
}

function toRecord(row: PublicShareLinkRow): PublicShareLinkRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    ownerUserId: row.ownerUserId,
    subjectType: row.subjectType as ShareSubjectType,
    subjectId: row.subjectId,
    tokenId: row.tokenId,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    fieldsJson: row.fieldsJson,
  };
}

@Injectable()
export class PrismaPublicShareRepository implements PublicShareRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: {
    tenantId: string;
    ownerUserId: string;
    subjectType: ShareSubjectType;
    subjectId: string;
    tokenId: string;
    expiresAt: Date;
    fields: ShareableField[];
  }): Promise<PublicShareLinkRecord> {
    const row = await this.prisma.publicShareLink.create({
      data: {
        tenantId: input.tenantId,
        ownerUserId: input.ownerUserId,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        tokenId: input.tokenId,
        expiresAt: input.expiresAt,
        // The allow-list is already filtered by the service; storing it as-is keeps
        // what the customer agreed to share as the record of truth for the link.
        fieldsJson: input.fields as unknown as Prisma.InputJsonValue,
      },
    });
    return toRecord(row as PublicShareLinkRow);
  }

  async findByTokenId(tokenId: string): Promise<PublicShareLinkRecord | null> {
    const row = await this.prisma.publicShareLink.findUnique({ where: { tokenId } });
    return row ? toRecord(row as PublicShareLinkRow) : null;
  }

  async revoke(input: {
    tenantId: string;
    ownerUserId: string;
    id: string;
    at: Date;
  }): Promise<PublicShareLinkRecord | null> {
    // updateMany carries the ownership predicate into the UPDATE itself; a count of
    // zero is the "not yours / not found" answer, which the service renders as
    // revoked: false without revealing which of the two it was.
    const { count } = await this.prisma.publicShareLink.updateMany({
      where: {
        id: input.id,
        tenantId: input.tenantId,
        ownerUserId: input.ownerUserId,
        revokedAt: null,
      },
      data: { revokedAt: input.at },
    });
    if (count === 0) return null;
    const row = await this.prisma.publicShareLink.findUnique({ where: { id: input.id } });
    return row ? toRecord(row as PublicShareLinkRow) : null;
  }

  async listForOwner(input: {
    tenantId: string;
    ownerUserId: string;
    subjectType?: ShareSubjectType;
    subjectId?: string;
  }): Promise<PublicShareLinkRecord[]> {
    const rows = await this.prisma.publicShareLink.findMany({
      where: {
        tenantId: input.tenantId,
        ownerUserId: input.ownerUserId,
        ...(input.subjectType ? { subjectType: input.subjectType } : {}),
        ...(input.subjectId ? { subjectId: input.subjectId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return rows.map((row) => toRecord(row as PublicShareLinkRow));
  }
}

/**
 * Reads the shareable facts.
 *
 * Only allow-listed columns are selected, so a projection bug cannot publish a
 * follower count or a balance - the query never fetches them. Performance figures
 * are NOT read here: they are derived by `TraderPerformanceService` from the
 * accounting records, and only the owner-visible profile facts are published by a
 * share link. A field the owner asked to share that this adapter cannot
 * substantiate is omitted from the projection rather than filled with a guess.
 *
 * `isIndexable` answers with the trader's existing public-listing flag, and a
 * strategy borrows its owning trader's flag: a share link is noindex unless the
 * trader is already listed publicly, so sharing never quietly exposes someone who
 * has not opted into being found.
 */
@Injectable()
export class PrismaShareSubjectAdapter implements ShareSubjectPort {
  constructor(private readonly prisma: PrismaService) {}

  async load(input: {
    tenantId: string;
    subjectType: ShareSubjectType;
    subjectId: string;
  }): Promise<Record<string, unknown> | null> {
    if (input.subjectType === 'STRATEGY') {
      const strategy = await this.prisma.traderStrategy.findFirst({
        where: { id: input.subjectId, tenantId: input.tenantId, deletedAt: null },
        select: {
          name: true,
          description: true,
          publishedAt: true,
          createdAt: true,
        },
      });
      if (!strategy) return null;
      return {
        strategyName: strategy.name,
        headline: strategy.description,
        startedAt: (strategy.publishedAt ?? strategy.createdAt).toISOString(),
      };
    }

    const profile = await this.prisma.traderProfile.findFirst({
      where: { id: input.subjectId, tenantId: input.tenantId, deletedAt: null },
      select: {
        displayName: true,
        bio: true,
        avatarUrl: true,
        createdAt: true,
      },
    });
    if (!profile) return null;
    return {
      displayName: profile.displayName,
      headline: profile.bio,
      avatarUrl: profile.avatarUrl,
      startedAt: profile.createdAt.toISOString(),
    };
  }

  async isIndexable(input: {
    tenantId: string;
    subjectType: ShareSubjectType;
    subjectId: string;
  }): Promise<boolean> {
    if (input.subjectType === 'STRATEGY') {
      const strategy = await this.prisma.traderStrategy.findFirst({
        where: { id: input.subjectId, tenantId: input.tenantId, deletedAt: null },
        select: { trader: { select: { isPublic: true, verificationState: true } } },
      });
      return Boolean(strategy?.trader?.isPublic) && strategy?.trader?.verificationState === 'VERIFIED';
    }
    const profile = await this.prisma.traderProfile.findFirst({
      where: { id: input.subjectId, tenantId: input.tenantId, deletedAt: null },
      select: { isPublic: true, verificationState: true },
    });
    return Boolean(profile?.isPublic) && profile?.verificationState === 'VERIFIED';
  }
}
