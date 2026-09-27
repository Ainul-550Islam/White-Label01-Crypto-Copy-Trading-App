import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { AuditAction, AuditActorType, AuditOutcome } from '@wlct/shared-types';
import type { PaginatedResult } from '@wlct/shared-types';
import { buildPaginationMeta, normalisePagination } from '@wlct/utils';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CREDENTIAL_KEY_PATTERN } from './datasets.constants';
import type { RegisterDatasetVersionDto } from './dto/datasets.dto';
import {
  toDatasetFileView,
  toDatasetValidationView,
  toDatasetVersionView,
  toDatasetView,
  toReplayRangeView,
} from './datasets.mapper';
import type {
  DatasetFileView,
  DatasetValidationView,
  DatasetView,
  DatasetVersionView,
  ReplayRangeView,
} from './datasets.types';
import { ConflictException, NotFoundException, ValidationException } from '../../common/errors/app.exception';

/**
 * The dataset registry: metadata reads, and the guarded metadata writes the
 * ingestion worker uses to publish what storage already holds.
 *
 * Read side first:
 *
 *   - lists and details are platform metadata over public market data; every
 *     route needs `dataset:read`; there is nothing tenant-specific to isolate
 *     IN the data, and pretending otherwise with a per-tenant copy would
 *     store the same tape N times for the privilege of a fake isolation;
 *   - `usableOnly`/`replay-ranges` answer "what can a backtest actually use"
 *     and consult only VALID versions - INVALID and QUARANTINED rows remain
 *     readable (the audit trail of a withdrawal matters more than the
 *     withdrawal) but never appear as available.
 *
 * Write side: `registerVersion` is the ONLY way a version row appears, and
 * it can create rows, never change payload fields of existing ones:
 *
 *   - (datasetKey, version) is unique at the database level; re-registering
 *     the same pair with different content is a ConflictException, not an
 *     overwrite - the immutability contract enforced where metadata is born;
 *   - the manifest is stored as received but never *reinterpreted*: the
 *     columns the registry projects are the ones it validated, and replay
 *     verification reads the manifest bytes in storage, not this copy;
 *   - every string on the way in is scanned with the same credential pattern
 *     the Python side uses. The scan is redundant by design - the worker
 *     already refused those strings - and redundancy at the boundary between
 *     two components is exactly where redundancy earns its cost.
 *
 * The route is permission-gated (`dataset:ingest` / `dataset:validate`) and
 * audited, because a compromised pipeline should not be able to silently
 * mint "registered" datasets without a human's credentials and an audit
 * entry carrying their id.
 */
@Injectable()
export class DatasetRegistryService {
  private static readonly DATASET_SELECT = {
    id: true,
    datasetKey: true,
    name: true,
    venue: true,
    marketType: true,
    symbols: true,
    eventKinds: true,
    granularity: true,
    startMicros: true,
    endMicros: true,
    status: true,
    latestVersion: true,
    schemaVersion: true,
    canonicalSchemaVersion: true,
    createdAt: true,
    updatedAt: true,
  } satisfies Prisma.HistoricalDatasetSelect;

  private static readonly VERSION_SELECT = {
    id: true,
    datasetId: true,
    version: true,
    status: true,
    contentChecksum: true,
    manifestChecksum: true,
    storageUri: true,
    compression: true,
    fileCount: true,
    eventCount: true,
    totalBytes: true,
    startMicros: true,
    endMicros: true,
    completeness: true,
    sourceKind: true,
    sourceLabel: true,
    manifestJson: true,
    qualityJson: true,
    validatedAt: true,
    finalizedAt: true,
    creatorJobId: true,
    createdAt: true,
    updatedAt: true,
    dataset: { select: { datasetKey: true } },
  } satisfies Prisma.HistoricalDatasetVersionSelect;

  private static readonly FILE_SELECT = {
    id: true,
    versionId: true,
    partitionPath: true,
    symbol: true,
    eventKind: true,
    events: true,
    bytes: true,
    sha256: true,
    firstTsMicros: true,
    lastTsMicros: true,
    compression: true,
  } satisfies Prisma.HistoricalDatasetFileSelect;

  private static readonly VALIDATION_SELECT = {
    id: true,
    versionId: true,
    status: true,
    infoCount: true,
    warningCount: true,
    errorCount: true,
    fatalCount: true,
    countsByRule: true,
    reportUri: true,
    reportSha256: true,
    policyDigest: true,
    durationMicros: true,
    startedAt: true,
    finishedAt: true,
  } satisfies Prisma.HistoricalDatasetValidationSelect;

  private static readonly SORTABLE = ['createdAt', 'name', 'startMicros', 'status'] as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @InjectPinoLogger(DatasetRegistryService.name) private readonly logger: PinoLogger,
  ) {}

  // -- reads -------------------------------------------------------------------

  async listDatasets(filter: {
    venue?: string;
    symbol?: string;
    status?: string;
    kind?: string;
    page?: number;
    limit?: number;
    sortBy?: string;
    sortOrder?: string;
    search?: string;
  }): Promise<PaginatedResult<DatasetView>> {
    const pagination = normalisePagination(filter, DatasetRegistryService.SORTABLE);
    const where: Prisma.HistoricalDatasetWhereInput = {
      ...(filter.venue ? { venue: filter.venue as never } : {}),
      ...(filter.symbol ? { symbols: { has: filter.symbol } } : {}),
      ...(filter.status ? { status: filter.status as never } : {}),
      ...(filter.kind ? { eventKinds: { has: filter.kind as never } } : {}),
      ...(pagination.search ? { name: { contains: pagination.search, mode: 'insensitive' } } : {}),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.historicalDataset.findMany({
        where,
        select: DatasetRegistryService.DATASET_SELECT,
        orderBy: this.orderBy(pagination.sortBy, pagination.sortOrder),
        skip: pagination.skip,
        take: pagination.take,
      }),
      this.prisma.historicalDataset.count({ where }),
    ]);

    return {
      items: rows.map(toDatasetView),
      pagination: buildPaginationMeta(pagination.page, pagination.take, total),
    };
  }

  async getDataset(idOrKey: string): Promise<DatasetView> {
    const row = await this.prisma.historicalDataset.findFirst({
      where: this.idOrKeyWhere(idOrKey),
      select: DatasetRegistryService.DATASET_SELECT,
    });
    if (!row) {
      throw new NotFoundException('Historical dataset', idOrKey);
    }
    return toDatasetView(row);
  }

  async listVersions(
    idOrKey: string,
    filter: { status?: string; usableOnly?: boolean },
  ): Promise<DatasetVersionView[]> {
    const dataset = await this.resolveDataset(idOrKey);
    const rows = await this.prisma.historicalDatasetVersion.findMany({
      where: {
        datasetId: dataset.id,
        ...(filter.status ? { status: filter.status as never } : {}),
        ...(filter.usableOnly ? { status: 'VALID' } : {}),
      },
      select: DatasetRegistryService.VERSION_SELECT,
      orderBy: { version: 'desc' },
    });
    return rows.map(toDatasetVersionView);
  }

  async getVersion(idOrKey: string, version: number): Promise<DatasetVersionView> {
    const dataset = await this.resolveDataset(idOrKey);
    const row = await this.prisma.historicalDatasetVersion.findFirst({
      where: { datasetId: dataset.id, version },
      select: DatasetRegistryService.VERSION_SELECT,
    });
    if (!row) {
      throw new NotFoundException('Dataset version', `${idOrKey}@v${version}`);
    }
    return toDatasetVersionView(row);
  }

  async listFiles(
    idOrKey: string,
    version: number,
    filter: { kind?: string; symbol?: string; page?: number; limit?: number },
  ): Promise<PaginatedResult<DatasetFileView>> {
    const pagination = normalisePagination(filter, ['partitionPath']);
    const record = await this.resolveVersion(idOrKey, version);
    const where: Prisma.HistoricalDatasetFileWhereInput = {
      versionId: record.id,
      ...(filter.kind ? { eventKind: filter.kind as never } : {}),
      ...(filter.symbol ? { symbol: filter.symbol } : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.historicalDatasetFile.findMany({
        where,
        select: DatasetRegistryService.FILE_SELECT,
        orderBy: { partitionPath: 'asc' },
        skip: pagination.skip,
        take: pagination.take,
      }),
      this.prisma.historicalDatasetFile.count({ where }),
    ]);
    return {
      items: rows.map(toDatasetFileView),
      pagination: buildPaginationMeta(pagination.page, pagination.take, total),
    };
  }

  async latestValidation(idOrKey: string, version: number): Promise<DatasetValidationView | null> {
    const record = await this.resolveVersion(idOrKey, version);
    const row = await this.prisma.historicalDatasetValidation.findFirst({
      where: { versionId: record.id },
      select: DatasetRegistryService.VALIDATION_SELECT,
      orderBy: { startedAt: 'desc' },
    });
    return row ? toDatasetValidationView(row) : null;
  }

  /**
   * Merged coverage for a symbol, from VALID versions only.
   *
   * "What can I replay for BTC-USDT between X and Y" answers with the
   * exact dataset-version citations a submission can use; a range from a
   * quarantined version is not coverage, it is a warning, and warnings
   * belong in the dataset list, not in an availability query.
   */
  async replayRanges(query: {
    venue: string;
    symbol: string;
    marketType?: string;
    kind?: string;
    startMicros?: number;
    endMicros?: number;
  }): Promise<ReplayRangeView[]> {
    const where: Prisma.HistoricalDatasetVersionWhereInput = {
      status: 'VALID',
      dataset: {
        venue: query.venue as never,
        marketType: (query.marketType ?? 'SPOT') as never,
        symbols: { has: query.symbol },
        ...(query.kind ? { eventKinds: { has: query.kind as never } } : {}),
      },
      ...(query.startMicros !== undefined || query.endMicros !== undefined
        ? {
            ...(query.endMicros !== undefined ? { startMicros: { lte: BigInt(query.endMicros) } } : {}),
            ...(query.startMicros !== undefined ? { endMicros: { gte: BigInt(query.startMicros) } } : {}),
          }
        : {}),
    };
    const rows = await this.prisma.historicalDatasetVersion.findMany({
      where,
      select: {
        version: true,
        startMicros: true,
        endMicros: true,
        eventCount: true,
        contentChecksum: true,
        completeness: true,
        dataset: {
          select: { datasetKey: true, venue: true, marketType: true, eventKinds: true },
        },
      },
      orderBy: [{ startMicros: 'asc' }, { dataset: { datasetKey: 'asc' } }, { version: 'desc' }],
    });
    return rows.map((row) => toReplayRangeView(row, query.symbol));
  }

  // -- worker-facing metadata writes --------------------------------------------

  /**
   * Publish metadata for a version the pipeline finalised in storage.
   *
   * Idempotent for the SAME content (a retried registration returns the
   * existing row rather than failing) and conflicting for DIFFERENT content
   * under the same (key, version) - which is the immutability rule written
   * down where metadata is created: the same address never describes two
   * byte streams.
   */
  async registerVersion(
    actor: { userId: string; requestId?: string | null; tenantId?: string | null },
    input: RegisterDatasetVersionDto,
  ): Promise<DatasetVersionView> {
    this.assertCredentialFree(input);

    const dataset = await this.prisma.historicalDataset.upsert({
      where: { datasetKey: input.datasetKey },
      create: {
        datasetKey: input.datasetKey,
        name: input.name,
        venue: input.venue as never,
        marketType: input.marketType as never,
        symbols: input.symbols,
        eventKinds: input.eventKinds as never,
        granularity: input.granularity ?? null,
        startMicros: BigInt(input.startMicros),
        endMicros: BigInt(input.endMicros),
        status: 'VALIDATING',
        schemaVersion: 1,
        canonicalSchemaVersion: 1,
      },
      update: {},
      select: { id: true },
    });

    const existing = await this.prisma.historicalDatasetVersion.findFirst({
      where: { datasetId: dataset.id, version: input.version },
      select: { id: true, contentChecksum: true, status: true },
    });
    if (existing) {
      if (existing.contentChecksum !== input.contentChecksum) {
        throw new ConflictException(
          `Dataset version ${input.datasetKey}@v${input.version} is already registered with a ` +
            'different content checksum. A validated dataset version is immutable: ingesting ' +
            'new data creates a new version, and re-registering an old address never does.',
          { existingChecksum: existing.contentChecksum },
        );
      }
      const row = await this.prisma.historicalDatasetVersion.findFirstOrThrow({
        where: { id: existing.id },
        select: DatasetRegistryService.VERSION_SELECT,
      });
      await this.audit.recordImmediate({
        tenantId: actor.tenantId ?? null,
        actorType: AuditActorType.USER,
        actorId: actor.userId,
        action: AuditAction.DATASET_VERSION_REGISTERED,
        outcome: AuditOutcome.SUCCESS,
        resourceType: 'historical_dataset_version',
        resourceId: existing.id,
        requestId: actor.requestId ?? undefined,
        metadata: { datasetKey: input.datasetKey, version: input.version, idempotent: true },
      });
      return toDatasetVersionView(row);
    }

    const files: Prisma.HistoricalDatasetFileCreateWithoutVersionInput[] = input.files.map(
      (file) => ({
        partitionPath: file.partitionPath,
        symbol: file.symbol,
        eventKind: file.eventKind as never,
        events: file.events,
        bytes: BigInt(file.bytes),
        sha256: file.sha256,
        firstTsMicros: BigInt(file.firstTsMicros),
        lastTsMicros: BigInt(file.lastTsMicros),
        compression: file.compression ?? null,
      }),
    );

    const created = await this.prisma.historicalDatasetVersion.create({
      data: {
        datasetId: dataset.id,
        version: input.version,
        status: 'VALID',
        contentChecksum: input.contentChecksum,
        manifestChecksum: input.manifestChecksum ?? null,
        storageUri: input.storageUri,
        compression: input.compression ?? null,
        fileCount: input.fileCount,
        eventCount: input.eventCount,
        totalBytes: BigInt(input.totalBytes),
        startMicros: BigInt(input.startMicros),
        endMicros: BigInt(input.endMicros),
        completeness: input.completeness as never,
        sourceKind: input.sourceKind as never,
        sourceLabel: input.sourceLabel,
        manifestJson: input.manifest as Prisma.InputJsonValue,
        qualityJson: (input.quality ?? undefined) as Prisma.InputJsonValue | undefined,
        validatedAt: new Date(),
        finalizedAt: new Date(),
        creatorJobId: input.creatorJobId ?? null,
        createdByUserId: actor.userId,
        files: { create: files },
      },
      select: DatasetRegistryService.VERSION_SELECT,
    });

    // The dataset row's rollup follows its newest version - list pages read
    // the rollup, decisions read the version. Both are updated in this one
    // write path, which is the only place a version is born.
    await this.prisma.historicalDataset.update({
      where: { id: dataset.id },
      data: { status: 'VALID', latestVersion: input.version },
    });

    await this.audit.recordImmediate({
      tenantId: actor.tenantId ?? null,
      actorType: AuditActorType.USER,
      actorId: actor.userId,
      action: AuditAction.DATASET_VERSION_REGISTERED,
      outcome: AuditOutcome.SUCCESS,
      resourceType: 'historical_dataset_version',
      resourceId: created.id,
      requestId: actor.requestId ?? undefined,
      metadata: {
        datasetKey: input.datasetKey,
        version: input.version,
        contentChecksum: input.contentChecksum.slice(0, 16),
        files: input.files.length,
        events: input.eventCount,
      },
    });

    this.logger.info(
      'dataset version registered key=%s version=%d files=%d',
      input.datasetKey,
      input.version,
      input.files.length,
    );

    return toDatasetVersionView(created);
  }

  async recordValidation(
    actor: { userId: string; requestId?: string | null },
    idOrKey: string,
    version: number,
    input: {
      status: string;
      infoCount: number;
      warningCount: number;
      errorCount: number;
      fatalCount: number;
      countsByRule?: Record<string, number>;
      reportUri?: string;
      reportSha256?: string;
      policyDigest?: string;
      durationMicros?: number;
    },
  ): Promise<DatasetValidationView> {
    const record = await this.resolveVersion(idOrKey, version);
    const created = await this.prisma.historicalDatasetValidation.create({
      data: {
        versionId: record.id,
        status: input.status as never,
        infoCount: input.infoCount,
        warningCount: input.warningCount,
        errorCount: input.errorCount,
        fatalCount: input.fatalCount,
        countsByRule: (input.countsByRule ?? undefined) as Prisma.InputJsonValue | undefined,
        reportUri: input.reportUri ?? null,
        reportSha256: input.reportSha256 ?? null,
        policyDigest: input.policyDigest ?? null,
        durationMicros:
          input.durationMicros !== undefined ? BigInt(input.durationMicros) : null,
        finishedAt: new Date(),
      },
      select: DatasetRegistryService.VALIDATION_SELECT,
    });
    await this.audit.recordImmediate({
      tenantId: null,
      actorType: AuditActorType.USER,
      actorId: actor.userId,
      action: AuditAction.DATASET_VALIDATION_REQUESTED,
      outcome: input.status === 'PASSED' ? AuditOutcome.SUCCESS : AuditOutcome.FAILURE,
      resourceType: 'historical_dataset_version',
      resourceId: record.id,
      requestId: actor.requestId ?? undefined,
      metadata: {
        datasetKey: record.dataset.datasetKey,
        version,
        verdict: input.status,
      },
    });
    return toDatasetValidationView(created);
  }

  // -- helpers --------------------------------------------------------------------

  private assertCredentialFree(value: unknown, path = 'payload'): void {
    const hits: string[] = [];
    const walk = (node: unknown, trail: string): void => {
      if (typeof node === 'string') {
        if (CREDENTIAL_KEY_PATTERN.test(node)) hits.push(trail);
        return;
      }
      if (Array.isArray(node)) {
        node.forEach((item, index) => walk(item, `${trail}[${index}]`));
        return;
      }
      if (node !== null && typeof node === 'object') {
        for (const [key, inner] of Object.entries(node as Record<string, unknown>)) {
          if (CREDENTIAL_KEY_PATTERN.test(key)) hits.push(`${trail}.${key}`);
          walk(inner, `${trail}.${key}`);
        }
      }
    };
    walk(value, path);
    if (hits.length > 0) {
      throw new ValidationException(
        hits.slice(0, 5).map((hit) => ({
          field: hit,
          constraint: 'noCredentialKeys',
          message:
            'Dataset metadata must never contain credential-shaped keys or values; ' +
            'historical market data is public and this API has no field a secret belongs in.',
        })),
      );
    }
  }

  async resolveDataset(idOrKey: string): Promise<{ id: string; datasetKey: string }> {
    const row = await this.prisma.historicalDataset.findFirst({
      where: this.idOrKeyWhere(idOrKey),
      select: { id: true, datasetKey: true },
    });
    if (!row) {
      throw new NotFoundException('Historical dataset', idOrKey);
    }
    return row;
  }

  async resolveVersion(idOrKey: string, version: number): Promise<{
    id: string;
    status: string;
    version: number;
    dataset: { id: string; datasetKey: string };
  }> {
    const dataset = await this.resolveDataset(idOrKey);
    const row = await this.prisma.historicalDatasetVersion.findFirst({
      where: { datasetId: dataset.id, version },
      select: {
        id: true,
        status: true,
        version: true,
        dataset: { select: { id: true, datasetKey: true } },
      },
    });
    if (!row) {
      throw new NotFoundException('Dataset version', `${idOrKey}@v${version}`);
    }
    return row;
  }

  private idOrKeyWhere(idOrKey: string): Prisma.HistoricalDatasetWhereInput {
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrKey);
    return isUuid ? { id: idOrKey } : { datasetKey: idOrKey };
  }

  private orderBy(
    sortBy: string | undefined,
    sortOrder: string,
  ): Prisma.HistoricalDatasetOrderByWithRelationInput {
    switch (sortBy) {
      case 'name':
        return { name: sortOrder as 'asc' | 'desc' };
      case 'startMicros':
        return { startMicros: sortOrder as 'asc' | 'desc' };
      case 'status':
        return { status: sortOrder as 'asc' | 'desc' };
      default:
        return { createdAt: sortOrder as 'asc' | 'desc' };
    }
  }

  /** Exposed for the metrics surface: counts by status, one aggregate. */
  async statusCounts(): Promise<Record<string, number>> {
    const grouped = await this.prisma.historicalDataset.groupBy({
      by: ['status'],
      _count: { _all: true },
    });
    const out: Record<string, number> = {};
    for (const row of grouped) {
      out[String(row.status)] = row._count._all;
    }
    return out;
  }

}
