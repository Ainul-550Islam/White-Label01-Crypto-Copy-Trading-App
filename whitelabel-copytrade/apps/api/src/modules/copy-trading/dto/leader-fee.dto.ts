// # Responsibility: validates tenant-admin changes to a trader's disclosed, effective-dated profit-share policy.

import { IsDateString, IsEnum, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { LeadTraderHighWaterMarkScope } from '@prisma/client';

const SUPPORTED_FEE_CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'BTC', 'ETH', 'USDT', 'USDC'] as const;

export class SetLeaderFeePolicyDto {
  @IsString()
  @Matches(/^[A-Za-z0-9][A-Za-z0-9._:-]{7,254}$/)
  idempotencyKey!: string;

  @IsString()
  @Matches(/^(USD|EUR|GBP|JPY|CAD|AUD|BTC|ETH|USDT|USDC)$/)
  currency!: (typeof SUPPORTED_FEE_CURRENCIES)[number];

  @IsInt()
  @Min(0)
  @Max(10000)
  profitShareBps!: number;

  @IsEnum(LeadTraderHighWaterMarkScope)
  highWaterMarkScope!: LeadTraderHighWaterMarkScope;

  @IsOptional()
  @IsDateString({ strict: true })
  @MaxLength(40)
  effectiveFrom?: string;
}
