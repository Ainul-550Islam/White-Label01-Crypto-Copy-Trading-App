// # Responsibility: validates preview-only allocation rebalance input while preserving decimal strings and bounded payload size.

import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsInt, IsNotEmpty, IsString, Matches, Max, MaxLength, Min, ValidateNested } from 'class-validator';

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
  @IsString()
  @Matches(/^\d+(?:\.\d{1,12})?$/, { message: 'totalValue must be a positive decimal string with at most 12 decimal places' })
  @MaxLength(80)
  totalValue!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => RebalanceAllocationDto)
  allocations!: RebalanceAllocationDto[];
}
