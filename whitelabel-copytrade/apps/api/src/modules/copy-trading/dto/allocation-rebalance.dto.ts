// # Responsibility: validates preview-only allocation rebalance input while preserving decimal strings and bounded payload size.

import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateNested } from 'class-validator';

export class RebalanceAllocationDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  traderId!: string;

  @IsString()
  @Matches(/^\d+(?:\.\d{1,12})?$/, { message: 'currentValue must be a non-negative decimal string with at most 12 decimal places' })
  @MaxLength(80)
  currentValue!: string;

  @IsInt()
  @Min(0)
  @Max(10000)
  targetWeightBps!: number;

  @IsBoolean()
  priceAvailable!: boolean;
}

export class AllocationRebalancePreviewDto {
  /**
   * Optional, and supplying it selects the client-supplied path: the arithmetic is exact but the
   * starting figure is the caller's claim, so the response says CLIENT_SUPPLIED_UNVERIFIED.
   * Omit it and the total is read from the tenant's own persisted positions instead.
   */
  @IsOptional()
  @IsString()
  @Matches(/^\d+(?:\.\d{1,12})?$/, { message: 'totalValue must be a positive decimal string with at most 12 decimal places' })
  @MaxLength(80)
  totalValue?: string;

  /** Required when totalValue is omitted: the persisted valuation of this one quote asset is used. */
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9]{2,16}$/, { message: 'quoteAsset must be two to sixteen letters or digits, for example USDT' })
  quoteAsset?: string;

  /** Optional: narrow the persisted read to a single trading account of the same tenant. */
  @IsOptional()
  @IsUUID()
  accountId?: string;

  /** Optional: include positions created from simulated fills in the persisted total. Defaults to false. */
  @IsOptional()
  @IsIn(['true', 'false'], { message: 'includeSimulated must be true or false' })
  includeSimulated?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => RebalanceAllocationDto)
  allocations!: RebalanceAllocationDto[];
}
