import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  Validate,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
  IsUUID,
} from 'class-validator';

import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import {
  ARCHIVE_CONFIRMATION,
  CHECKSUM_PATTERN,
  CREDENTIAL_KEY_PATTERN,
  DATASET_EVENT_KINDS,
  DATASET_KEY_PATTERN,
  DATASET_STATUSES,
  INGESTION_SOURCE_KINDS,
  MARKET_TYPES,
  MAX_INGESTION_SYMBOLS,
  MAX_PARAM_KEYS,
  MAX_PARAM_VALUE_LENGTH,
  MIN_QUARANTINE_REASON_LENGTH,
  VENUES,
} from '../datasets.constants';

/**
 * Request shapes for the historical dataset API (Part 7).
 *
 * The strategy DTO conventions carry over verbatim, and one of them is
 * enforced harder here than anywhere else in the platform:
 *
 * No field of any dataset request may look like a credential. Historical
 * market data is PUBLIC - the entire design has no reason to accept a key -
 * and an endpoint that "just stores params for the worker" is how secrets
 * end up in manifests, logs and dataset identity hashes. The
 * @NoCredentialKeys constraint runs over every object-typed input and
 * rejects both keys AND string values that resemble them.
 *
 * No DTO accepts a tenantId: tenancy comes from the session, and the dataset
 * projection itself is platform-public metadata.
 */

const BOOLEAN_FROM_QUERY = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? ['1', 'true', 'yes', 'on'].includes(value.toLowerCase()) : value;

/** Canonical-symbol shape as a REGEX (the constants module keeps the string
 *  form for docs and Python-side parity tests; decorators need the literal). */
const SYMBOL_REGEX = /^[A-Z0-9]+-[A-Z0-9]+$/;

/**
 * Year 2100 in epoch microseconds. A microsecond/millisecond mix-up is the
 * single easiest way to specify a "valid" window that means something else
 * entirely, and an upper bound catches it at the door rather than in a
 * quarter-year of downstream ingestion.
 */
const EPOCH_MICROS_CEILING = 4_102_444_800_000_000;

// -----------------------------------------------------------------------------
// The credential-shape guard, once, shared by every object input here.
// -----------------------------------------------------------------------------

function credentialHitsIn(value: unknown, path: string): string[] {
  if (typeof value === 'string') {
    return CREDENTIAL_KEY_PATTERN.test(value) ? [path] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => credentialHitsIn(item, `${path}[${index}]`));
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    return entries.flatMap(([key, inner]) => {
      const keyHit = CREDENTIAL_KEY_PATTERN.test(key) ? [`${path}.${key}`] : [];
      return [...keyHit, ...credentialHitsIn(inner, `${path}.${key}`)];
    });
  }
  return [];
}

@ValidatorConstraint({ name: 'noCredentialKeys', async: false })
export class NoCredentialKeysConstraint implements ValidatorConstraintInterface {
  validate(value: unknown, _args: ValidationArguments): boolean {
    if (value === undefined || value === null) {
      return true;
    }
    if (credentialHitsIn(value, 'params').length > 0) {
      return false;
    }
    // The same constraint bounds what a value may BE, not only what it may
    // look like: long free text smuggled through a "params" bag is how
    // manifests become dumping grounds. Length caps belong on the shape that
    // writes them.
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      const entries = Object.entries(value as Record<string, unknown>);
      if (entries.length > MAX_PARAM_KEYS) {
        return false;
      }
      for (const [, inner] of entries) {
        if (typeof inner === 'string' && inner.length > MAX_PARAM_VALUE_LENGTH) {
          return false;
        }
      }
    }
    return true;
  }

  defaultMessage(args: ValidationArguments): string {
    const hits = credentialHitsIn(args.value, 'params');
    if (hits.length > 0) {
      return (
        'Dataset parameters are stored in manifests and logs and must never ' +
        `contain credential-shaped keys or values (offending paths: ${hits
          .slice(0, 3)
          .join(', ')}). Historical market data is public by design: there is no field ` +
        'this API should receive a secret into.'
      );
    }
    if (
      typeof args.value === 'object' &&
      args.value !== null &&
      Object.keys(args.value as Record<string, unknown>).length > MAX_PARAM_KEYS
    ) {
      return `Dataset parameters are bounded at ${MAX_PARAM_KEYS} keys; a manifest is a record, not a drawer.`;
    }
    return `Dataset parameter values must stay within ${MAX_PARAM_VALUE_LENGTH} characters.`;
  }
}

/** Reusable decoration: object inputs on this module all carry it. */
function NoCredentialKeys(): PropertyDecorator {
  return Validate(NoCredentialKeysConstraint);
}

// -----------------------------------------------------------------------------
// Queries
// -----------------------------------------------------------------------------

export class ListDatasetsDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: VENUES })
  @IsOptional()
  @IsIn(VENUES as unknown as string[])
  venue?: string;

  @ApiPropertyOptional({ example: 'BTC-USDT' })
  @IsOptional()
  @IsString()
  @Matches(SYMBOL_REGEX, { message: 'symbol must be canonical, e.g. BTC-USDT' })
  @MaxLength(32)
  symbol?: string;

  @ApiPropertyOptional({ enum: DATASET_STATUSES })
  @IsOptional()
  @IsIn(DATASET_STATUSES as unknown as string[])
  status?: string;

  @ApiPropertyOptional({ enum: DATASET_EVENT_KINDS })
  @IsOptional()
  @IsIn(DATASET_EVENT_KINDS as unknown as string[])
  kind?: string;
}

export class ListDatasetVersionsDto {
  @ApiPropertyOptional({ enum: DATASET_STATUSES })
  @IsOptional()
  @IsIn(DATASET_STATUSES as unknown as string[])
  status?: string;

  @ApiPropertyOptional({
    description: 'Only versions that a backtest is permitted to replay (status VALID).',
  })
  @IsOptional()
  @Transform(BOOLEAN_FROM_QUERY)
  @IsBoolean()
  usableOnly?: boolean;
}

export class ListDatasetFilesDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: DATASET_EVENT_KINDS })
  @IsOptional()
  @IsIn(DATASET_EVENT_KINDS as unknown as string[])
  kind?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(32)
  symbol?: string;
}

export class ReplayRangesQueryDto {
  @ApiProperty({ enum: VENUES })
  @IsIn(VENUES as unknown as string[])
  venue!: string;

  @ApiProperty({ example: 'BTC-USDT' })
  @IsString()
  @Matches(SYMBOL_REGEX, { message: 'symbol must be canonical, e.g. BTC-USDT' })
  @MaxLength(32)
  symbol!: string;

  @ApiPropertyOptional({ enum: MARKET_TYPES, default: 'SPOT' })
  @IsOptional()
  @IsIn(MARKET_TYPES as unknown as string[])
  marketType?: string;

  @ApiPropertyOptional({ enum: DATASET_EVENT_KINDS })
  @IsOptional()
  @IsIn(DATASET_EVENT_KINDS as unknown as string[])
  kind?: string;

  @ApiPropertyOptional({
    description: 'Window start in epoch microseconds. Only whole valid versions are offered.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  startMicros?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  endMicros?: number;
}

// -----------------------------------------------------------------------------
// Commands
// -----------------------------------------------------------------------------

export class RequestDatasetIngestionDto {
  @ApiProperty({
    enum: INGESTION_SOURCE_KINDS,
    description:
      'Which historical source to read. Only public/local sources ship; a source kind ' +
      'that could carry credentials is not accepted, at the type level.',
  })
  @IsIn(INGESTION_SOURCE_KINDS as unknown as string[])
  sourceKind!: (typeof INGESTION_SOURCE_KINDS)[number];

  @ApiProperty({ enum: VENUES })
  @IsIn(VENUES as unknown as string[])
  venue!: string;

  @ApiPropertyOptional({ enum: MARKET_TYPES, default: 'SPOT' })
  @IsOptional()
  @IsIn(MARKET_TYPES as unknown as string[])
  marketType?: string;

  @ApiProperty({ type: [String], description: 'Canonical symbols, 1-8.' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_INGESTION_SYMBOLS)
  @IsString({ each: true })
  @Matches(SYMBOL_REGEX, { each: true, message: 'each symbol must be canonical, e.g. BTC-USDT' })
  symbols!: string[];

  @ApiProperty({ enum: DATASET_EVENT_KINDS, isArray: true })
  @IsArray()
  @ArrayMinSize(1)
  @IsIn(DATASET_EVENT_KINDS as unknown as string[], { each: true })
  eventKinds!: string[];

  @ApiProperty({ description: 'Ingestion window start, epoch microseconds.' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(EPOCH_MICROS_CEILING)
  startMicros!: number;

  @ApiProperty({ description: 'Ingestion window end, epoch microseconds. Must exceed start.' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(EPOCH_MICROS_CEILING)
  endMicros!: number;

  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({
    description:
      'Extra source parameters (labels, dataset paths). Credential-shaped keys or values ' +
      'are rejected outright; these strings land in dataset manifests and identity hashes.',
  })
  @IsOptional()
  @IsObject()
  @NoCredentialKeys()
  params?: Record<string, string>;

  @ApiPropertyOptional({
    description:
      'Requested operator reason, audited alongside the job. Ingestion is a storage and ' +
      'bandwidth decision; "why now" belongs in the record.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class RequestDatasetValidationDto {
  @ApiProperty({ minLength: 10, maxLength: 500 })
  @IsString()
  @MinLength(MIN_QUARANTINE_REASON_LENGTH)
  @MaxLength(500)
  reason!: string;
}

export class QuarantineDatasetVersionDto {
  @ApiProperty({
    minLength: 10,
    maxLength: 500,
    description:
      'Why the version is being withdrawn from replay use. Stored verbatim in the audit ' +
      'record and mirrored to dataset storage; never truncated in the DB copy.',
  })
  @IsString()
  @MinLength(MIN_QUARANTINE_REASON_LENGTH)
  @MaxLength(500)
  reason!: string;
}

export class ArchiveDatasetVersionDto {
  @ApiProperty({
    minLength: 10,
    maxLength: 500,
    description: 'Why the version is being retired. Archiving never deletes payload data.',
  })
  @IsString()
  @MinLength(MIN_QUARANTINE_REASON_LENGTH)
  @MaxLength(500)
  reason!: string;

  @ApiProperty({
    example: ARCHIVE_CONFIRMATION,
    description:
      'Typed confirmation, exact. Archiving removes a reproducibility resource other ' +
      'teams may still be citing in results; the phrase makes that unmissable.',
  })
  @IsString()
  @Matches(new RegExp(`^${ARCHIVE_CONFIRMATION}$`), {
    message: `confirm must be exactly "${ARCHIVE_CONFIRMATION}"`,
  })
  confirm!: string;
}

/**
 * Shape accepted by the (worker-facing, guarded) metadata upsert route.
 * The worker owns storage; this DTO only lets it report what storage already
 * contains - every checksum here is re-checkable against the manifest, and
 * nothing in this shape carries bytes or paths outside the dataset tree.
 */
export class DatasetFileReceiptDto {
  @ApiProperty({ description: 'Manifest-relative partition path.' })
  @IsString()
  @MaxLength(400)
  partitionPath!: string;

  @ApiProperty()
  @IsString()
  @Matches(SYMBOL_REGEX)
  symbol!: string;

  @ApiProperty({ enum: DATASET_EVENT_KINDS })
  @IsIn(DATASET_EVENT_KINDS as unknown as string[])
  eventKind!: string;

  @ApiProperty()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  events!: number;

  @ApiProperty({ description: 'Stored file size, decimal string.' })
  @IsString()
  @Matches(/^\d+$/)
  bytes!: string;

  @ApiProperty({ description: 'SHA-256 hex of the stored (compressed) file.' })
  @IsString()
  @Matches(new RegExp(CHECKSUM_PATTERN))
  sha256!: string;

  @ApiProperty()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  firstTsMicros!: number;

  @ApiProperty()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  lastTsMicros!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(16)
  compression?: string;
}

export class RegisterDatasetVersionDto {
  @ApiProperty({ description: 'Derived dataset key, hst-<32 hex>.' })
  @IsString()
  @Matches(new RegExp(DATASET_KEY_PATTERN))
  datasetKey!: string;

  @ApiProperty()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  version!: number;

  @ApiProperty({ maxLength: 120 })
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  name!: string;

  @ApiProperty({ enum: VENUES })
  @IsIn(VENUES as unknown as string[])
  venue!: string;

  @ApiProperty({ enum: MARKET_TYPES })
  @IsIn(MARKET_TYPES as unknown as string[])
  marketType!: string;

  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  symbols!: string[];

  @ApiProperty({ type: [String], enum: DATASET_EVENT_KINDS, isArray: true })
  @IsArray()
  @ArrayMinSize(1)
  @IsIn(DATASET_EVENT_KINDS as unknown as string[], { each: true })
  eventKinds!: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(20)
  granularity?: string;

  @ApiProperty()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  startMicros!: number;

  @ApiProperty()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  endMicros!: number;

  @ApiProperty()
  @IsString()
  @Matches(new RegExp(CHECKSUM_PATTERN))
  contentChecksum!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(new RegExp(CHECKSUM_PATTERN))
  manifestChecksum?: string;

  @ApiProperty({ description: 'Relative manifest location, e.g. hst-.../v1/manifest.json' })
  @IsString()
  @MaxLength(500)
  storageUri!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(16)
  compression?: string;

  @ApiProperty()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  eventCount!: number;

  @ApiProperty()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  fileCount!: number;

  @ApiProperty({ description: 'Total stored bytes, decimal string.' })
  @IsString()
  @Matches(/^\d+$/)
  totalBytes!: string;

  @ApiProperty({ enum: ['COMPLETE', 'PARTIAL', 'UNKNOWN'] })
  @IsIn(['COMPLETE', 'PARTIAL', 'UNKNOWN'])
  completeness!: string;

  @ApiProperty({ enum: INGESTION_SOURCE_KINDS })
  @IsIn(INGESTION_SOURCE_KINDS as unknown as string[])
  sourceKind!: string;

  @ApiProperty({ maxLength: 200 })
  @IsString()
  @MaxLength(200)
  sourceLabel!: string;

  @ApiProperty({ description: 'The registered manifest JSON, verbatim.' })
  @IsObject()
  @NoCredentialKeys()
  manifest!: Record<string, unknown>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  @NoCredentialKeys()
  quality?: Record<string, unknown>;

  @ApiProperty({ type: [DatasetFileReceiptDto] })
  @IsArray()
  @ArrayMinSize(1)
  @Type(() => DatasetFileReceiptDto)
  files!: DatasetFileReceiptDto[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  creatorJobId?: string;
}

export class RecordDatasetValidationDto {
  @ApiProperty({ enum: ['PASSED', 'FAILED', 'ERROR'] })
  @IsIn(['PASSED', 'FAILED', 'ERROR'])
  status!: string;

  @ApiProperty()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  infoCount!: number;

  @ApiProperty()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  warningCount!: number;

  @ApiProperty()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  errorCount!: number;

  @ApiProperty()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  fatalCount!: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  countsByRule?: Record<string, number>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reportUri?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(new RegExp(CHECKSUM_PATTERN))
  reportSha256?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Matches(new RegExp(CHECKSUM_PATTERN))
  policyDigest?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  durationMicros?: number;
}

export class ListIngestionRunsDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ['PENDING', 'RUNNING', 'VALIDATING', 'FINALIZING', 'SUCCEEDED', 'FAILED', 'QUARANTINED'] })
  @IsOptional()
  @IsIn(['PENDING', 'RUNNING', 'VALIDATING', 'FINALIZING', 'SUCCEEDED', 'FAILED', 'QUARANTINED'])
  status?: string;

  @ApiPropertyOptional({ description: 'Filter by dataset id (UUID).' })
  @IsOptional()
  @IsUUID()
  datasetId?: string;
}
