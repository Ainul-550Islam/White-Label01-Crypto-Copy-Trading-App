/**
 * Shared literals for the datasets module.
 *
 * The event-kind names mirror wlct_trading's MarketEventKind and the Prisma
 * DatasetEventKind enum. One list, imported everywhere, so a route, a query
 * filter and the database enum cannot drift into three slightly different
 * spellings of the same five things.
 */

export const DATASET_EVENT_KINDS = [
  'TICKER',
  'TRADE',
  'BOOK_SNAPSHOT',
  'BOOK_DELTA',
  'CANDLE',
] as const;

export type DatasetEventKindName = (typeof DATASET_EVENT_KINDS)[number];

export const DATASET_STATUSES = [
  'CREATED',
  'INGESTING',
  'VALIDATING',
  'VALID',
  'INVALID',
  'QUARANTINED',
  'ARCHIVED',
] as const;

export const INGESTION_SOURCE_KINDS = ['BINANCE_PUBLIC_DATA', 'LOCAL_FILES'] as const;
export type IngestionSourceKindName = (typeof INGESTION_SOURCE_KINDS)[number];

export const VENUES = ['BINANCE', 'BYBIT', 'OKX', 'KRAKEN'] as const;
export const MARKET_TYPES = ['SPOT', 'MARGIN', 'FUTURES_USDT', 'FUTURES_COIN'] as const;

/**
 * The typed confirmation for withdrawing a published version's availability.
 * Archive (not delete - archive; the payload always survives) is an
 * availability decision other tenants may still be citing in results, so it
 * gets the same friction as arming live trading: a phrase, typed, exact.
 */
export const ARCHIVE_CONFIRMATION = 'ARCHIVE DATASET VERSION' as const;

/** Dataset ids are derived digests, not names: one pattern, every surface. */
export const DATASET_KEY_PATTERN = '^hst-[0-9a-f]{32}$' as const;
export const CHECKSUM_PATTERN = '^[0-9a-f]{64}$' as const;

/** Canonical symbols, matching the mobile/admin rule already in the repo. */
export const SYMBOL_PATTERN = '^[A-Z0-9]+-[A-Z0-9]+$' as const;

/**
 * Names whose presence in a request means someone is trying to thread a
 * credential through a public-data API. Mirrored from the Python side's
 * FORBIDDEN_PARAMETER_PATTERN; both ends refuse, and the two patterns are
 * asserted equal by a test on each side.
 */
export const CREDENTIAL_KEY_PATTERN =
  /(secret|password|passwd|api[_-]?key|private[_-]?key|token|credential|passphrase)/i;

export const MAX_INGESTION_SYMBOLS = 8;
export const MAX_PARAM_KEYS = 24;
export const MAX_PARAM_VALUE_LENGTH = 200;
export const MIN_QUARANTINE_REASON_LENGTH = 10;


/**
 * The status pairs the lifecycle service accepts. These mirror the Python
 * registry's transition table EXACTLY (VALID/INVALID can be quarantined;
 * QUARANTINED can be archived or - for audit parity - re-quarantined never;
 * ARCHIVED is terminal). Two implementations of one rule is already one too
 * many, so the values below are asserted to match the Python table by the
 * datasets spec test rather than trusted by adjacency in a review.
 *
 * Why the table refuses "quarantine an INGESTING version": no version row
 * exists mid-ingestion - versions are born at finalisation - so the only
 * honest way to stop an in-flight job is to disable HISTORICAL_INGESTION_
 * ENABLED (which stops NEW submissions immediately) and let the running job
 * finish or fail on its own; its staging area is disposable by design and
 * never becomes visible without validation.
 */
export const DATASET_QUARANTINE_FROM: readonly string[] = Object.freeze(['VALID', 'INVALID']);
export const DATASET_ARCHIVE_FROM: readonly string[] = Object.freeze([
  'VALID',
  'QUARANTINED',
]);

/** Version states that still count as "a live availability decision" - i.e.
 *  statuses a run may occupy while a lifecycle action on ITS version (not
 *  the run) would race the worker. Used by the lifecycle service to refuse
 *  actions on versions whose dataset row carries a non-terminal rollup. */
export const DATASET_INFLIGHT_ROLLUPS: readonly string[] = Object.freeze([
  'CREATED',
  'INGESTING',
  'VALIDATING',
]);
