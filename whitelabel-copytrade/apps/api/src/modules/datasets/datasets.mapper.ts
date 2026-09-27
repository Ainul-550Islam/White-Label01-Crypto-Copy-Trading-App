import type { Prisma } from '@prisma/client';

import type {
  DatasetFileView,
  DatasetValidationView,
  DatasetView,
  DatasetVersionView,
  IngestionRunView,
  ReplayRangeView,
} from './datasets.types';
import type { DatasetEventKindName } from './datasets.constants';

/**
 * Row-to-view mapping for the datasets projection.
 *
 * Same discipline as the strategy mapper, and for the same reasons: BigInt
 * becomes a decimal string (a 16-digit microsecond value does not fit a
 * double), Json columns pass through only after an explicit object check
 * (never spread), and there is no code path here that could invent a
 * missing number - nulls stay null, they do not become zero.
 */

const text = (value: bigint | null | undefined): string | null =>
  value === null || value === undefined ? null : value.toString();

const required = (value: bigint): string => value.toString();

const asRecord = (value: Prisma.JsonValue): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

export type HistoricalDatasetRow = {
  id: string;
  datasetKey: string;
  name: string;
  venue: string;
  marketType: string;
  symbols: string[];
  eventKinds: readonly DatasetEventKindName[];
  granularity: string | null;
  startMicros: bigint;
  endMicros: bigint;
  status: string;
  latestVersion: number | null;
  schemaVersion: number;
  canonicalSchemaVersion: number;
  createdAt: Date;
  updatedAt: Date;
};

export type HistoricalDatasetVersionRow = {
  id: string;
  datasetId: string;
  version: number;
  status: string;
  contentChecksum: string;
  manifestChecksum: string | null;
  storageUri: string;
  compression: string | null;
  fileCount: number;
  eventCount: number;
  totalBytes: bigint;
  startMicros: bigint;
  endMicros: bigint;
  completeness: string;
  sourceKind: string;
  sourceLabel: string;
  manifestJson: Prisma.JsonValue;
  qualityJson: Prisma.JsonValue;
  validatedAt: Date | null;
  finalizedAt: Date | null;
  creatorJobId: string | null;
  createdAt: Date;
  updatedAt: Date;
  dataset: { datasetKey: string };
};

export type HistoricalDatasetFileRow = {
  id: string;
  versionId: string;
  partitionPath: string;
  symbol: string;
  eventKind: DatasetEventKindName;
  events: number;
  bytes: bigint;
  sha256: string;
  firstTsMicros: bigint;
  lastTsMicros: bigint;
  compression: string | null;
};

export type HistoricalDatasetValidationRow = {
  id: string;
  versionId: string;
  status: string;
  infoCount: number;
  warningCount: number;
  errorCount: number;
  fatalCount: number;
  countsByRule: Prisma.JsonValue;
  reportUri: string | null;
  reportSha256: string | null;
  policyDigest: string | null;
  durationMicros: bigint | null;
  startedAt: Date;
  finishedAt: Date | null;
};

export type DatasetIngestionRunRow = {
  id: string;
  datasetId: string | null;
  datasetKeyHint: string | null;
  version: number | null;
  status: string;
  stage: string | null;
  progressJson: Prisma.JsonValue;
  errorText: string | null;
  stagingKey: string;
  sourceKind: string;
  bytesDownloaded: bigint;
  eventsWritten: number;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
};

export function toDatasetView(row: HistoricalDatasetRow): DatasetView {
  return {
    id: row.id,
    datasetKey: row.datasetKey,
    name: row.name,
    venue: row.venue,
    marketType: row.marketType,
    symbols: [...row.symbols],
    eventKinds: [...row.eventKinds],
    granularity: row.granularity,
    startMicros: required(row.startMicros),
    endMicros: required(row.endMicros),
    status: row.status,
    latestVersion: row.latestVersion,
    schemaVersion: row.schemaVersion,
    canonicalSchemaVersion: row.canonicalSchemaVersion,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toDatasetVersionView(row: HistoricalDatasetVersionRow): DatasetVersionView {
  return {
    id: row.id,
    datasetId: row.datasetId,
    datasetKey: row.dataset.datasetKey,
    version: row.version,
    status: row.status,
    contentChecksum: row.contentChecksum,
    manifestChecksum: row.manifestChecksum,
    storageUri: row.storageUri,
    compression: row.compression,
    fileCount: row.fileCount,
    eventCount: row.eventCount,
    totalBytes: required(row.totalBytes),
    startMicros: required(row.startMicros),
    endMicros: required(row.endMicros),
    completeness: row.completeness,
    sourceKind: row.sourceKind,
    sourceLabel: row.sourceLabel,
    manifest: asRecord(row.manifestJson),
    quality: row.qualityJson === null ? null : asRecord(row.qualityJson),
    validatedAt: row.validatedAt ? row.validatedAt.toISOString() : null,
    finalizedAt: row.finalizedAt ? row.finalizedAt.toISOString() : null,
    creatorJobId: row.creatorJobId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toDatasetFileView(row: HistoricalDatasetFileRow): DatasetFileView {
  return {
    id: row.id,
    versionId: row.versionId,
    partitionPath: row.partitionPath,
    symbol: row.symbol,
    eventKind: row.eventKind,
    events: row.events,
    bytes: required(row.bytes),
    sha256: row.sha256,
    firstTsMicros: required(row.firstTsMicros),
    lastTsMicros: required(row.lastTsMicros),
    compression: row.compression,
  };
}

export function toDatasetValidationView(
  row: HistoricalDatasetValidationRow,
): DatasetValidationView {
  const countsByRule =
    row.countsByRule !== null && typeof row.countsByRule === 'object' && !Array.isArray(row.countsByRule)
      ? (row.countsByRule as Record<string, number>)
      : null;
  return {
    id: row.id,
    versionId: row.versionId,
    status: row.status,
    infoCount: row.infoCount,
    warningCount: row.warningCount,
    errorCount: row.errorCount,
    fatalCount: row.fatalCount,
    countsByRule,
    reportUri: row.reportUri,
    reportSha256: row.reportSha256,
    policyDigest: row.policyDigest,
    durationMicros: text(row.durationMicros),
    startedAt: row.startedAt.toISOString(),
    finishedAt: row.finishedAt ? row.finishedAt.toISOString() : null,
  };
}

export function toIngestionRunView(row: DatasetIngestionRunRow): IngestionRunView {
  return {
    id: row.id,
    datasetId: row.datasetId,
    datasetKeyHint: row.datasetKeyHint,
    version: row.version,
    status: row.status,
    stage: row.stage,
    progress: asRecord(row.progressJson),
    errorText: row.errorText,
    stagingKey: row.stagingKey,
    sourceKind: row.sourceKind,
    bytesDownloaded: required(row.bytesDownloaded),
    eventsWritten: row.eventsWritten,
    startedAt: row.startedAt ? row.startedAt.toISOString() : null,
    finishedAt: row.finishedAt ? row.finishedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toReplayRangeView(
  row: {
    dataset: {
      datasetKey: string;
      venue: string;
      marketType: string;
      eventKinds: readonly DatasetEventKindName[];
    };
    version: number;
    startMicros: bigint;
    endMicros: bigint;
    eventCount: number;
    contentChecksum: string;
    completeness: string;
  },
  symbol: string,
): ReplayRangeView {
  // The caller passes the symbol the query was for: a dataset version may
  // cover several, and coverage is answered per symbol because that is how
  // it is consumed - "what can I replay for BTC-USDT" - not as a list of
  // everything any version happens to touch.
  return {
    datasetKey: row.dataset.datasetKey,
    version: row.version,
    venue: row.dataset.venue,
    symbol,
    marketType: row.dataset.marketType,
    eventKinds: [...row.dataset.eventKinds],
    startMicros: required(row.startMicros),
    endMicros: required(row.endMicros),
    eventCount: row.eventCount,
    contentChecksum: row.contentChecksum,
    completeness: row.completeness,
  };
}
