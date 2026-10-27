// # Validates the follower's global active-copy budget: exact decimal strings, non-negative, bounded by the tenant ceiling.
import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

/**
 * A money limit is a decimal STRING, never a number.
 *
 * `@Matches` is used rather than a numeric coercion for the same reason the
 * whole money path is string-based: `100000.10` through a JSON number is
 * already 100000.09999999999 before this DTO sees it. Match the actual
 * DECIMAL(28,12) database column exactly so PostgreSQL never silently rounds
 * a requested ceiling. Scientific notation, signs and empty strings fail.
 */
const DECIMAL_STRING = /^\d{1,16}(?:\.\d{1,12})?$/;
const CURRENCY = /^[A-Z0-9]{2,12}$/;

/** A self-service reduction is exact at the database's DECIMAL(28,12) scale. */
export class ReduceCopyBudgetDto {
  @IsString()
  @Matches(/^\d{1,16}(?:\.\d{1,12})?$/, { message: 'maxActiveExposure must be an exact non-negative decimal with at most 16 whole and 12 fractional digits' })
  @MaxLength(29)
  maxActiveExposure!: string;

  /** The currency seen by the client; a stale/mismatched form must not commit. */
  @IsString()
  @Matches(CURRENCY, { message: 'currency must be an upper-case asset code' })
  @MaxLength(12)
  currency!: string;
}

export class UpsertCopyBudgetDto {
  /** Total quote-asset capital this follower may have in active copies. */
  @IsString()
  @Matches(DECIMAL_STRING, { message: 'maxActiveExposure must be an exact decimal string with at most 16 whole and 12 fractional digits' })
  @MaxLength(48)
  maxActiveExposure!: string;

  /** Optional tighter cap per individual trader. */
  @IsOptional()
  @IsString()
  @Matches(DECIMAL_STRING, { message: 'perTraderCap must be an exact decimal string with at most 16 whole and 12 fractional digits' })
  @MaxLength(48)
  perTraderCap?: string | null;

  /** Quote asset of both limits. Defaults to the tenant's configured budget currency. */
  @IsOptional()
  @IsString()
  @Matches(CURRENCY, { message: 'currency must be an upper-case asset code such as USDT' })
  @MaxLength(12)
  currency?: string | null;
}
