import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { JOB_NAMES, QUEUE_NAMES } from '@wlct/config';
import { AuditAction, AuditActorType, AuditOutcome } from '@wlct/shared-types';

import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { QueueService } from '../queue/queue.service';
import { ConflictException, ValidationException } from '../../common/errors/app.exception';
import {
  ARCHIVE_CONFIRMATION,
  DATASET_ARCHIVE_FROM,
  DATASET_INFLIGHT_ROLLUPS,
  DATASET_QUARANTINE_FROM,
} from './datasets.constants';
import { DatasetRegistryService } from './dataset-registry.service';
import type { DatasetCommandAcceptedView } from './datasets.types';
import type { ArchiveDatasetVersionDto, QuarantineDatasetVersionDto } from './dto/datasets.dto';

/**
 * Dataset version lifecycle: quarantine and archive. Both move a version OUT
 * of use. Neither touches a payload.
 *
 * The vocabulary matters here. These operations do NOT:
 *
 *   * delete files - quarantined evidence is preserved on purpose, so an
 *     operator investigating a bad capture has the bytes that produced it;
 *   * rewrite a manifest or version row's payload fields - status columns
 *     change, nothing else does, and the schema offers no route by which
 *     the API could rewrite content even if someone added one;
 *   * take effect only in the database - the storage-side status.json is a
 *     separate authority for readers, so a command here also enqueues a
 *     SYNC job the worker applies. Between the DB transition and the file
 *     sync, a backtest submission is ALREADY refused (the API gate reads the
 *     database) and a worker-internal replay may still see the old file
 *     status briefly; the direction of that window is deliberate:
 *     enforcement instant, file metadata eventually consistent.
 *
 * Transitions are tables in datasets.constants - the same shape the Python
 * registry enforces file-side, asserted equal by the spec test rather than
 * trusted to stay in sync by review.
 */
@Injectable()
export class DatasetLifecycleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
    private readonly audit: AuditService,
    private readonly registry: DatasetRegistryService,
    @InjectPinoLogger(DatasetLifecycleService.name) private readonly logger: PinoLogger,
  ) {}

  async quarantine(
    tenantId: string,
    actor: { userId: string; requestId?: string | null },
    datasetIdOrKey: string,
    version: number,
    dto: QuarantineDatasetVersionDto,
  ): Promise<DatasetCommandAcceptedView> {
    const record = await this.registry.resolveVersion(datasetIdOrKey, version);
    this.assertAllowedTransition(record.status, DATASET_QUARANTINE_FROM, 'quarantine', record);
    await this.assertNoInflightRollup(record);

    await this.prisma.$transaction([
      this.prisma.historicalDatasetVersion.update({
        where: { id: record.id },
        data: { status: 'QUARANTINED' },
      }),
      this.prisma.historicalDataset.update({
        where: { id: record.dataset.id },
        data: { status: 'QUARANTINED' },
      }),
    ]);

    const jobId = await this.dispatchSync(actor, 'quarantine', record, dto.reason);

    await this.audit.recordImmediate({
      tenantId,
      actorType: AuditActorType.USER,
      actorId: actor.userId,
      action: AuditAction.DATASET_VERSION_QUARANTINED,
      outcome: AuditOutcome.SUCCESS,
      resourceType: 'historical_dataset_version',
      resourceId: record.id,
      description: dto.reason,
      changes: {
        status: { before: record.status, after: 'QUARANTINED' },
      },
      requestId: actor.requestId ?? null,
    });

    this.logger.warn(
      'dataset version quarantined key=%s version=%d byUser=%s',
      record.dataset.datasetKey,
      version,
      actor.userId,
    );

    return {
      accepted: true,
      action: 'quarantine',
      datasetKey: record.dataset.datasetKey,
      version,
      jobId,
      queue: QUEUE_NAMES.DATASET_CONTROL,
      note:
        'Backtest selection now refuses this version. Payload and validation ' +
        'evidence are preserved; quarantine withdraws trust, it does not ' +
        'destroy data.',
    };
  }

  async archive(
    tenantId: string,
    actor: { userId: string; requestId?: string | null },
    datasetIdOrKey: string,
    version: number,
    dto: ArchiveDatasetVersionDto,
  ): Promise<DatasetCommandAcceptedView> {
    if (dto.confirm !== ARCHIVE_CONFIRMATION) {
      // belt-and-braces over the DTO regex; the exact-phrase rule lives in
      // one constant and this service re-checks it because "an archived
      // version silently vanishing from coverage" is exactly what a safety
      // check forgot to be wired up would cause.
      throw new ValidationException(
        [
          {
            field: 'confirm',
            constraint: 'exactPhrase',
            message: `confirm must be exactly "${ARCHIVE_CONFIRMATION}".`,
          },
        ],
      );
    }
    const record = await this.registry.resolveVersion(datasetIdOrKey, version);
    this.assertAllowedTransition(record.status, DATASET_ARCHIVE_FROM, 'archive', record);
    await this.assertNoInflightRollup(record);

    await this.prisma.historicalDatasetVersion.update({
      where: { id: record.id },
      data: { status: 'ARCHIVED' },
    });
    await this.recomputeDatasetRollup(record.dataset.id);

    const jobId = await this.dispatchSync(actor, 'archive', record, dto.reason);

    await this.audit.recordImmediate({
      tenantId,
      actorType: AuditActorType.USER,
      actorId: actor.userId,
      action: AuditAction.DATASET_VERSION_ARCHIVED,
      outcome: AuditOutcome.SUCCESS,
      resourceType: 'historical_dataset_version',
      resourceId: record.id,
      description: dto.reason,
      changes: {
        status: { before: record.status, after: 'ARCHIVED' },
      },
      requestId: actor.requestId ?? null,
    });

    this.logger.info(
      'dataset version archived key=%s version=%d byUser=%s',
      record.dataset.datasetKey,
      version,
      actor.userId,
    );

    return {
      accepted: true,
      action: 'archive',
      datasetKey: record.dataset.datasetKey,
      version,
      jobId,
      queue: QUEUE_NAMES.DATASET_CONTROL,
      note:
        'Archived, not deleted: the version remains readable and auditable ' +
        'forever; it simply no longer counts as coverage.',
    };
  }

  // -- internals -----------------------------------------------------------------

  private assertAllowedTransition(
    current: string,
    allowed: readonly string[],
    action: 'quarantine' | 'archive',
    record: { status: string; version: number; dataset: { datasetKey: string } },
  ): void {
    if (!allowed.includes(current)) {
      throw new ConflictException(
        `Dataset version ${record.dataset.datasetKey}@v${record.version} is ${current}; the ` +
          `${action} transition accepts ${allowed.join(' or ')}. Status transitions are a ` +
          'table, not a judgement call - the table refuses this.',
        { currentStatus: current, allowedFrom: allowed },
      );
    }
  }

  /**
   * Refuse lifecycle actions while the DATASET row still carries an in-flight
   * rollup (a sibling version being finalised right now). Without this, a
   * quarantine racing a worker's own rollup update could be silently
   * overwritten the instant the worker finishes writing its "VALID" summary.
   * The transaction-level fix would be row locks; the race is worth an
   * explicit refusal, not a lock on a control-plane table.
   */
  private async assertNoInflightRollup(record: {
    version: number;
    dataset: { id: string; datasetKey: string };
  }): Promise<void> {
    const dataset = await this.prisma.historicalDataset.findUniqueOrThrow({
      where: { id: record.dataset.id },
      select: { status: true },
    });
    if (DATASET_INFLIGHT_ROLLUPS.includes(String(dataset.status))) {
      throw new ConflictException(
        `Dataset ${record.dataset.datasetKey} has a version being finalised (rollup status ` +
          `${String(dataset.status)}); retry the lifecycle action once the ingestion run ` +
          'settles, so a status flip cannot race a rollup write.',
        { datasetStatus: String(dataset.status) },
      );
    }
  }

  /** The rollup on the dataset row points at the newest VALID version when
   *  one exists, else at the newest version's status: a quarantine of a
   *  superseded version must not mislabel the dataset as a whole. */
  private async recomputeDatasetRollup(datasetId: string): Promise<void> {
    const [latestUsable, latest] = await Promise.all([
      this.prisma.historicalDatasetVersion.findFirst({
        where: { datasetId, status: 'VALID' },
        orderBy: { version: 'desc' },
        select: { status: true, version: true },
      }),
      this.prisma.historicalDatasetVersion.findFirst({
        where: { datasetId },
        orderBy: { version: 'desc' },
        select: { status: true, version: true },
      }),
    ]);
    await this.prisma.historicalDataset.update({
      where: { id: datasetId },
      data: {
        status: (latestUsable?.status ?? latest?.status ?? 'CREATED') as never,
        latestVersion: latest?.version ?? null,
      },
    });
  }

  private async dispatchSync(
    actor: { userId: string; requestId?: string | null },
    action: 'quarantine' | 'archive',
    record: { id: string; version: number; dataset: { id: string; datasetKey: string } },
    reason: string,
  ): Promise<string> {
    try {
      return await this.queue.enqueueOrThrow(
        QUEUE_NAMES.DATASET_CONTROL,
        JOB_NAMES.SYNC_DATASET_STATUS,
        {
          action,
          versionId: record.id,
          version: record.version,
          datasetKey: record.dataset.datasetKey,
          actorId: actor.userId,
          reason,
        },
        { attempts: 5, backoff: { type: 'exponential', delay: 15_000 }, removeOnComplete: true },
      );
    } catch (error) {
      // The database transition has ALREADY happened and IS the enforcing
      // one; the queue outage delays the file-side mirror only. Logging
      // loudly and answering "accepted, sync pending" is the honest contract
      // here - a 503 would imply the quarantine failed, which is the worse
      // misstatement. A scheduled sweep re-drives the mirror.
      this.logger.error(
        'dataset status sync enqueue failed; database transition stands, file mirror ' +
          'pending key=%s version=%d action=%s error=%s',
        record.dataset.datasetKey,
        record.version,
        action,
        error instanceof Error ? error.message : String(error),
      );
      return 'sync-pending';
    }
  }
}
