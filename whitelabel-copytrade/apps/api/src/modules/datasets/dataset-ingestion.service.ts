import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';
import { JOB_NAMES, QUEUE_NAMES } from '@wlct/config';
import { AuditAction, AuditActorType, AuditOutcome } from '@wlct/shared-types';
import type { PaginatedResult } from '@wlct/shared-types';
import { buildPaginationMeta, normalisePagination } from '@wlct/utils';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { QueueService } from '../queue/queue.service';
import { AppConfigService } from '../../config/app-config.service';
import {
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
  ValidationException,
} from '../../common/errors/app.exception';
import { CREDENTIAL_KEY_PATTERN } from './datasets.constants';
import type {
  ListIngestionRunsDto,
  RequestDatasetIngestionDto,
  RequestDatasetValidationDto,
} from './dto/datasets.dto';
import { toIngestionRunView, type DatasetIngestionRunRow } from './datasets.mapper';
import type { DatasetCommandAcceptedView, IngestionRunView } from './datasets.types';
import { DatasetRegistryService } from './dataset-registry.service';

/**
 * Dataset ingestion: accept the intent, queue the work, stay out of the way.
 *
 * This service creates a run row and enqueues the job. It does not fetch,
 * compress, hash or validate anything - that is the dataset worker's job,
 * and the split is the same one Part 6 drew between API and strategy worker:
 * an HTTP request must not grow into a batch job, and a batch job must not
 * live behind an HTTP handler that can be killed halfway.
 *
 * The safety rules this service enforces:
 *
 * 1. `HISTORICAL_INGESTION_ENABLED=false` (the default) is a
 *    ConflictException, not a queue-and-see: a deployment that did not opt
 *    in should not accumulate jobs it never agreed to run.
 * 2. Parameters are scanned for credential shapes BEFORE the queue, the
 *    database and the storage layer see them. The worker refuses them too;
 *    the boundary double-check is the point - the secret that reaches a
 *    manifest is the one some other component forgot.
 * 3. A queue outage FAILS THE RUN LOUDLY (`FAILED` + `errorText`) rather
 *    than leaving a PENDING row that will never be picked up, then throws
 *    503. A stuck job that looks scheduled is worse than a failed one.
 * 4. Window validation is the reader's rule stated early (end > start,
 *    sane ranges) because an ingestion that can only produce an empty
 *    dataset should say so at request time, not after 40 GiB of download.
 *
 * Nothing on this path can place an order. Ingestion reads public archives;
 * the dataset it produces is input to BACKTEST, and the paper/live paths do
 * not consume it - see the module map and the datasets spec test.
 */
@Injectable()
export class DatasetIngestionService {
  private static readonly RUN_SELECT = {
    id: true,
    datasetId: true,
    datasetKeyHint: true,
    version: true,
    status: true,
    stage: true,
    progressJson: true,
    errorText: true,
    stagingKey: true,
    sourceKind: true,
    bytesDownloaded: true,
    eventsWritten: true,
    startedAt: true,
    finishedAt: true,
    createdAt: true,
  } satisfies Prisma.DatasetIngestionRunSelect;

  private static readonly SORTABLE = ['createdAt', 'status'] as const;

  /** Guards a request-rate sanity bound, not a security claim: 40 in-flight
   *  ingestion jobs means somebody is automating this endpoint against our
   *  own storage, not backfilling one symbol's history. */
  private static readonly MAX_ACTIVE_RUNS = 40;

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
    private readonly audit: AuditService,
    private readonly config: AppConfigService,
    private readonly registry: DatasetRegistryService,
    @InjectPinoLogger(DatasetIngestionService.name) private readonly logger: PinoLogger,
  ) {}

  async requestIngestion(
    tenantId: string,
    actor: { userId: string; requestId?: string | null },
    input: RequestDatasetIngestionDto,
  ): Promise<DatasetCommandAcceptedView> {
    if (!this.config.historicalIngestionEnabled) {
      throw new ConflictException(
        'Historical dataset ingestion is disabled in this deployment ' +
          '(HISTORICAL_INGESTION_ENABLED=false). This switch is deliberate: a ' +
          'backfill is a storage and bandwidth decision, and it does not get ' +
          'made implicitly by a request.',
        { historicalIngestionEnabled: false },
      );
    }

    this.assertCredentialFree(input.params ?? {});

    if (input.endMicros <= input.startMicros) {
      throw new ValidationException(
        [
          {
            field: 'endMicros',
            constraint: 'greaterThanStart',
            message: 'endMicros must be greater than startMicros.',
          },
        ],
        'The ingestion window is empty as given.',
      );
    }
    const spanDays = (input.endMicros - input.startMicros) / 86_400_000_000;
    if (spanDays > 366) {
      throw new ValidationException([
        {
          field: 'startMicros',
          constraint: 'maxWindow',
          message:
            'One ingestion job covers at most 366 days. Larger windows are ' +
            'planned as multiple jobs, each producing its own dataset version - ' +
            'that is what keeps a failed backfill resumable per chunk of the ' +
            'range instead of all-or-nothing across a year.',
        },
      ]);
    }

    const active = await this.prisma.datasetIngestionRun.count({
      where: { status: { in: ['PENDING', 'RUNNING', 'VALIDATING', 'FINALIZING'] } },
    });
    if (active >= DatasetIngestionService.MAX_ACTIVE_RUNS) {
      throw new ConflictException(
        `Too many ingestion jobs are already in flight (${active}). Wait for the backlog to ` +
          'drain; queued-forever metadata jobs are how storage fills up twice over.',
        { active },
      );
    }

    const stagingKey = `ing-${randomUUID()}`;
    const run = await this.prisma.datasetIngestionRun.create({
      data: {
        stagingKey,
        status: 'PENDING',
        sourceKind: input.sourceKind as never,
        paramsJson: {
          venue: input.venue,
          marketType: input.marketType ?? 'SPOT',
          symbols: input.symbols,
          eventKinds: input.eventKinds,
          startMicros: input.startMicros,
          endMicros: input.endMicros,
          name: input.name ?? null,
          extra: input.params ?? {},
        } as Prisma.InputJsonValue,
        requestedByUserId: actor.userId,
      },
      select: DatasetIngestionService.RUN_SELECT,
    });

    try {
      const jobId = await this.queue.enqueueOrThrow(
        QUEUE_NAMES.DATASET_CONTROL,
        JOB_NAMES.INGEST_HISTORICAL_DATASET,
        {
          runId: run.id,
          stagingKey,
          tenantId,
          requestedByUserId: actor.userId,
          requestedAt: new Date().toISOString(),
        },
        {
          // Bounded retries: a fetch failure that survives three attempts is
          // an operator problem, not a transient one, and retrying forever
          // against a rate limit is how a small outage becomes a big one.
          attempts: 3,
          backoff: { type: 'exponential', delay: 30_000 },
          removeOnComplete: 1000,
          removeOnFail: false,
        },
      );

      await this.audit.recordImmediate({
        tenantId,
        actorType: AuditActorType.USER,
        actorId: actor.userId,
        action: AuditAction.DATASET_INGESTION_REQUESTED,
        outcome: AuditOutcome.SUCCESS,
        resourceType: 'dataset_ingestion_run',
        resourceId: run.id,
        description: input.reason ?? null,
        metadata: {
          sourceKind: input.sourceKind,
          venue: input.venue,
          symbols: input.symbols,
          eventKinds: input.eventKinds,
          startMicros: input.startMicros,
          endMicros: input.endMicros,
          stagingKey,
        },
        requestId: actor.requestId ?? null,
      });

      this.logger.info(
        'dataset ingestion enqueued runId=%s stagingKey=%s venue=%s symbols=%s',
        run.id,
        stagingKey,
        input.venue,
        input.symbols.join(','),
      );

      return {
        accepted: true,
        action: 'ingest',
        runId: run.id,
        jobId,
        queue: QUEUE_NAMES.DATASET_CONTROL,
        note:
          'The worker downloads public data, validates and finalises a dataset ' +
          'version, then registers its metadata here. Progress: GET ' +
          `/datasets/ingestion-runs/${run.id}. The API performs none of that work.`,
      };
    } catch (error) {
      // The run never enters a PENDING-forever state. Mark FAILED, record
      // why, and answer 503 - the same contract as the strategy control
      // surface, for the same reason: an accepted command with no consumer
      // is a promise silently broken.
      await this.prisma.datasetIngestionRun
        .update({
          where: { id: run.id },
          data: {
            status: 'FAILED',
            errorText: `queue unavailable: ${error instanceof Error ? error.message : 'unknown'}`.slice(
              0,
              2000,
            ),
            finishedAt: new Date(),
          },
        })
        .catch(() => undefined);
      await this.audit
        .recordImmediate({
          tenantId,
          actorType: AuditActorType.USER,
          actorId: actor.userId,
          action: AuditAction.DATASET_INGESTION_REQUESTED,
          outcome: AuditOutcome.FAILURE,
          resourceType: 'dataset_ingestion_run',
          resourceId: run.id,
          description: 'Queue unavailable; run failed at request time.',
          requestId: actor.requestId ?? null,
        })
        .catch(() => undefined);
      throw new ServiceUnavailableException('Queue', error);
    }
  }

  /**
   * Queue a re-validation of a REGISTERED version.
   *
   * Validation is a read-only pass over frozen bytes, so the job is safe to
   * run any time - but it is still a job: a multi-gigabyte re-hash in an
   * HTTP request would be the exact "API turned into a worker" failure mode
   * the module layout exists to prevent. The verdict itself is recorded by
   * the worker through POST .../validations; this method only dispatches.
   */
  async requestValidation(
    tenantId: string,
    actor: { userId: string; requestId?: string | null },
    datasetIdOrKey: string,
    version: number,
    dto: RequestDatasetValidationDto,
  ): Promise<DatasetCommandAcceptedView> {
    const record = await this.registry.resolveVersion(datasetIdOrKey, version);
    const jobId = await this.queue.enqueueOrThrow(
      QUEUE_NAMES.DATASET_CONTROL,
      JOB_NAMES.VALIDATE_DATASET_VERSION,
      {
        versionId: record.id,
        datasetKey: record.dataset.datasetKey,
        version: record.version,
        tenantId,
        requestedByUserId: actor.userId,
        reason: dto.reason,
      },
      { attempts: 2, backoff: { type: 'fixed', delay: 60_000 }, removeOnComplete: true },
    );
    await this.audit.recordImmediate({
      tenantId,
      actorType: AuditActorType.USER,
      actorId: actor.userId,
      action: AuditAction.DATASET_VALIDATION_REQUESTED,
      outcome: AuditOutcome.SUCCESS,
      resourceType: 'historical_dataset_version',
      resourceId: record.id,
      description: dto.reason,
      requestId: actor.requestId ?? null,
    });
    return {
      accepted: true,
      action: 'validate',
      datasetKey: record.dataset.datasetKey,
      version: record.version,
      jobId,
      queue: QUEUE_NAMES.DATASET_CONTROL,
      note:
        'The worker re-hashes every partition against the manifest and runs ' +
        'the validator over the merged stream. The version keeps its current ' +
        'status until the verdict is recorded; a passing re-validation changes ' +
        'nothing about its bytes, which is the point.',
    };
  }

  async listRuns(
    filter: ListIngestionRunsDto,
  ): Promise<PaginatedResult<IngestionRunView>> {
    const pagination = normalisePagination(filter, DatasetIngestionService.SORTABLE);
    const where: Prisma.DatasetIngestionRunWhereInput = {
      ...(filter.status ? { status: filter.status as never } : {}),
      ...(filter.datasetId ? { datasetId: filter.datasetId } : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.datasetIngestionRun.findMany({
        where,
        select: DatasetIngestionService.RUN_SELECT,
        orderBy: { createdAt: pagination.sortOrder as 'asc' | 'desc' },
        skip: pagination.skip,
        take: pagination.take,
      }),
      this.prisma.datasetIngestionRun.count({ where }),
    ]);
    return {
      items: rows.map((row: DatasetIngestionRunRow) => toIngestionRunView(row)),
      pagination: buildPaginationMeta(pagination.page, pagination.take, total),
    };
  }

  async getRun(id: string): Promise<IngestionRunView> {
    const row = await this.prisma.datasetIngestionRun.findFirst({
      where: { id },
      select: DatasetIngestionService.RUN_SELECT,
    });
    if (!row) {
      throw new NotFoundException('Ingestion run', id);
    }
    return toIngestionRunView(row as DatasetIngestionRunRow);
  }

  /** Local copy of the credential scan, deliberately not shared code: the
   *  DTO decorator already guards requests; this guards any internal caller,
   *  and the two implementations failing open together requires someone to
   *  delete both on purpose. */
  private assertCredentialFree(value: unknown, trail = 'params'): void {
    if (typeof value === 'string') {
      if (CREDENTIAL_KEY_PATTERN.test(value)) {
        throw new ValidationException(
          [
            {
              field: trail,
              constraint: 'noCredentialKeys',
              message: 'Dataset parameters must never carry credential-shaped values.',
            },
          ],
          'Credential-shaped input on a public-data API.',
        );
      }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((item, index) => this.assertCredentialFree(item, `${trail}[${index}]`));
      return;
    }
    if (value !== null && typeof value === 'object') {
      for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
        if (CREDENTIAL_KEY_PATTERN.test(key)) {
          throw new ValidationException(
            [
              {
                field: `${trail}.${key}`,
                constraint: 'noCredentialKeys',
                message:
                  'Dataset parameter keys must never look like credentials. Historical ' +
                  'market data is public; this API has no field a secret belongs in.',
              },
            ],
          );
        }
        this.assertCredentialFree(inner, `${trail}.${key}`);
      }
    }
  }
}
