/**
 * View models for the historical dataset registry (Part 7).
 *
 * Everything here is METADATA about a dataset - identity, checksums, counts,
 * verdicts, coverage. Two absences are deliberate and total:
 *
 * 1. There is no view that carries event rows. The API cannot serve dataset
 *    payloads because it does not read dataset payloads; the storage layer
 *    serves replay, this projection serves *decisions about* replay.
 * 2. There is no view that carries credentials or signed URLs. The ingestion
 *    adapters accept none, the manifest validation rejects credential-shaped
 *    strings, and these interfaces have no field a mistake could land in.
 *
 * BigInt values cross as strings, exactly as the strategy mapper does: a
 * microsecond timestamp is 16 digits and a JavaScript number would quietly
 * lose the low ones.
 */

import type { DatasetEventKindName } from './datasets.constants';

export interface DatasetView {
  id: string;
  datasetKey: string;
  name: string;
  venue: string;
  marketType: string;
  symbols: string[];
  eventKinds: DatasetEventKindName[];
  granularity: string | null;
  startMicros: string;
  endMicros: string;
  status: string;
  latestVersion: number | null;
  schemaVersion: number;
  canonicalSchemaVersion: number;
  createdAt: string;
  updatedAt: string;
}

export interface DatasetVersionView {
  id: string;
  datasetId: string;
  datasetKey: string;
  version: number;
  status: string;
  contentChecksum: string;
  manifestChecksum: string | null;
  /** Relative manifest location in dataset storage. Never absolute, never
   *  containing credentials - the storage layer enforces both on write. */
  storageUri: string;
  compression: string | null;
  fileCount: number;
  eventCount: number;
  totalBytes: string;
  startMicros: string;
  endMicros: string;
  completeness: string;
  sourceKind: string;
  sourceLabel: string;
  /** The registered manifest JSON, verbatim. Consumers recompute the derived
   *  key from it; the registry never rewrites it. */
  manifest: Record<string, unknown>;
  quality: Record<string, unknown> | null;
  validatedAt: string | null;
  finalizedAt: string | null;
  creatorJobId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DatasetFileView {
  id: string;
  versionId: string;
  partitionPath: string;
  symbol: string;
  eventKind: DatasetEventKindName;
  events: number;
  bytes: string;
  sha256: string;
  firstTsMicros: string;
  lastTsMicros: string;
  compression: string | null;
}

export interface DatasetValidationView {
  id: string;
  versionId: string;
  status: string;
  infoCount: number;
  warningCount: number;
  errorCount: number;
  fatalCount: number;
  countsByRule: Record<string, number> | null;
  reportUri: string | null;
  reportSha256: string | null;
  policyDigest: string | null;
  durationMicros: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface IngestionRunView {
  id: string;
  datasetId: string | null;
  datasetKeyHint: string | null;
  version: number | null;
  status: string;
  stage: string | null;
  progress: Record<string, unknown>;
  /** Redacted operator text: exception class and message, never a body. */
  errorText: string | null;
  stagingKey: string;
  sourceKind: string;
  bytesDownloaded: string;
  eventsWritten: number;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

export interface ReplayRangeView {
  datasetKey: string;
  version: number;
  venue: string;
  symbol: string;
  marketType: string;
  eventKinds: DatasetEventKindName[];
  startMicros: string;
  endMicros: string;
  eventCount: number;
  contentChecksum: string;
  completeness: string;
}

export interface DatasetCommandAcceptedView {
  accepted: true;
  action: 'ingest' | 'validate' | 'quarantine' | 'archive';
  datasetKey?: string;
  version?: number;
  runId?: string;
  jobId: string;
  queue: string;
  note: string;
}

/**
 * The disclaimer dataset views carry. Datasets exist to make backtests
 * reproducible, and a number from a reproducible backtest is still only a
 * number from a backtest.
 */
export const DATASET_DISCLAIMER: string =
  'Historical datasets are frozen public market data used to replay ' +
  'strategies in simulation. Their existence, validity or coverage implies ' +
  'nothing about future returns, and backtests over them guarantee nothing ' +
  'about live execution quality.';
