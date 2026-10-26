// # Validates the follower's global active-copy budget: exact decimal strings, non-negative, bounded by the tenant ceiling.
import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

/**
 * A money limit is a decimal STRING, never a number.
 *
 * `@Matches` is used rather than a numeric coercion for the same reason the
 * whole money path is string-based: `100000.10` through a JSON number is
 * already 100000.09999999999 before this DTO sees it. The pattern admits at
 * most 18 fractional digits - enough for any quote asset, narrow enough to
 * reject scientific notation, `NaN`, `Infinity`, leading `+`, and the empty
 * string, all of which would otherwise reach the budget arithmetic.
 */
const DECIMAL_STRING = /^\d{1,30}(?:\.\d{1,18})?$/;
const CURRENCY = /^[A-Z0-9]{2,12}$/;

export class UpsertCopyBudgetDto {
  /** Total quote-asset capital this follower may have in active copies. */
  @IsString()
  @Matches(DECIMAL_STRING, { message: 'maxActiveExposure must be a plain decimal string with at most 18 decimal places' })
  @MaxLength(48)
  maxActiveExposure!: string;

  /** Optional tighter cap per individual trader. */
  @IsOptional()
  @IsString()
  @Matches(DECIMAL_STRING, { message: 'perTraderCap must be a plain decimal string with at most 18 decimal places' })
  @MaxLength(48)
  perTraderCap?: string | null;

  /** Quote asset of both limits. Defaults to the tenant's configured budget currency. */
  @IsOptional()
  @IsString()
  @Matches(CURRENCY, { message: 'currency must be an upper-case asset code such as USDT' })
  @MaxLength(12)
  currency?: string | null;
}
