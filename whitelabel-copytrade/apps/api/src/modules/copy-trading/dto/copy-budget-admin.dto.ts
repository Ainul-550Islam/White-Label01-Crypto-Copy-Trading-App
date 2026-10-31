// # Responsibility: validates platform/tenant-operator copy-budget administration input — default caps as exact decimal strings, a bounded page, and nothing a client could use to name another tenant.
//
// WHY EVERY MONEY FIELD IS A STRING
// ---------------------------------
// The budget engine compares caps with `copy-budget.service.ts`'s exact decimal
// arithmetic, and that service accepts only `^\d{1,40}(\.\d{1,18})?$` strings. A
// `number` field would be parsed by JavaScript's float machinery before it ever
// reached the validator, so `0.1 + 0.2` style drift would enter a limit that
// then blocks or admits real orders. The DTO therefore takes strings, bounds the
// digits, and refuses exponents, signs and whitespace at the edge.
//
// WHY THERE IS NO tenantId FIELD
// ------------------------------
// The tenant is the caller's own, resolved from the JWT (`TenantId()`), never a
// body field. A `tenantId` here would be an option to write another
// organisation's ceiling, and `forbidNonWhitelisted` on the global pipe turns an
// attempt to send one into a 422 instead of a silently ignored property.
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

const DECIMAL = /^\d{1,40}(\.\d{1,18})?$/;
const CURRENCY = /^[A-Z0-9]{2,12}$/;

/**
 * One exact decimal amount. `null` clears an optional cap; it is a distinct
 * input from `"0"`, because "no per-trader cap" and "a per-trader cap of zero"
 * are different policies.
 */
export class ExactDecimalFieldDto {
  @IsString()
  @Matches(DECIMAL, {
    message: 'must be a decimal string such as "2500.50" (no sign, no exponent, at most 40 whole and 18 fractional digits)',
  })
  @MaxLength(64)
  amount!: string;
}

/** The tenant-wide ceiling every follower cap is resolved against. */
export class SetCopyBudgetDefaultCapsDto {
  @IsString()
  @Matches(DECIMAL, {
    message: 'maxActiveExposure must be a decimal string such as "2500.50" (no sign, no exponent)',
  })
  @MaxLength(64)
  maxActiveExposure!: string;

  /**
   * Optional per-trader ceiling applied to every follower unless they have
   * their own tighter one. Omitted and `null` both mean "no tenant default".
   */
  @IsOptional()
  @IsString()
  @Matches(DECIMAL, { message: 'perTraderCap must be a decimal string such as "500.00", or omitted' })
  @MaxLength(64)
  perTraderCap?: string | null;

  @IsString()
  @Matches(CURRENCY, { message: 'currency must be 2-12 upper-case letters or digits, e.g. USDT' })
  @MaxLength(12)
  currency!: string;
}

/** `GET admin/copy-trading/budget/over-cap` paging. */
export class OverCapUsersQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'page must be an integer' })
  @Min(1, { message: 'page must be at least 1' })
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limit must be an integer' })
  @Min(1, { message: 'limit must be at least 1' })
  @Max(200, { message: 'limit must not exceed 200' })
  limit?: number;

  /** Restrict the answer to followers at or above this share of their effective cap. */
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'utilisationBps must be an integer' })
  @Min(0, { message: 'utilisationBps must be at least 0' })
  @Max(100_000, { message: 'utilisationBps must not exceed 100000 (1000%)' })
  utilisationBps?: number;

  /** `OVER` (above the cap) or `NEAR` (at or above the utilisation threshold and not over). */
  @IsOptional()
  @IsIn(['OVER', 'NEAR'], { message: 'status must be OVER or NEAR' })
  status?: 'OVER' | 'NEAR';
}

/** Nested form of the caps, for a client that wants to send one object. */
export class SetCopyBudgetDefaultCapsEnvelopeDto {
  @ValidateNested()
  @Type(() => SetCopyBudgetDefaultCapsDto)
  caps!: SetCopyBudgetDefaultCapsDto;
}
