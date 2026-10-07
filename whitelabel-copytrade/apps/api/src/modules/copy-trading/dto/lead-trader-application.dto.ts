// # Responsibility: validates applicant declarations and administrator decisions for the lead-trader qualification workflow.

import {
  ArrayMaxSize,
  ArrayUnique,
  Equals,
  IsArray,
  IsEnum,
  IsInt,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { LeadTraderApplicationStatus } from '@prisma/client';

const SUPPORTED_MARKETS = ['SPOT', 'USDT_PERPETUAL', 'COIN_PERPETUAL'] as const;

export class SubmitLeadTraderApplicationDto {
  @IsString()
  @Matches(/^[A-Za-z0-9][A-Za-z0-9._:-]{7,254}$/)
  idempotencyKey!: string;

  @IsInt()
  @Min(0)
  @Max(50)
  yearsExperience!: number;

  @IsArray()
  @ArrayMaxSize(3)
  @ArrayUnique()
  @IsIn(SUPPORTED_MARKETS, { each: true })
  markets!: string[];

  @IsString()
  @IsNotEmpty()
  @MinLength(50)
  @MaxLength(1000)
  strategySummary!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsString({ each: true })
  @Matches(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/, { each: true })
  evidenceReferences?: string[];

  @Equals(true)
  riskAcknowledged!: true;
}

export enum LeadTraderReviewDecision {
  APPROVE = 'APPROVE',
  REJECT = 'REJECT',
}

export class ReviewLeadTraderApplicationDto {
  @IsEnum(LeadTraderReviewDecision)
  decision!: LeadTraderReviewDecision;

  @IsOptional()
  @IsString()
  @MinLength(20)
  @MaxLength(1000)
  decisionReason?: string;
}

export class LeadTraderApplicationQueueQueryDto {
  @IsOptional()
  @IsEnum(LeadTraderApplicationStatus)
  status?: LeadTraderApplicationStatus;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
