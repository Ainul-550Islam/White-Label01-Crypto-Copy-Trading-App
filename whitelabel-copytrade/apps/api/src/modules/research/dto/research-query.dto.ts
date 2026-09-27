import { IsString, IsOptional, IsEnum, IsNumberString, IsArray, IsBooleanString } from 'class-validator';
import { ResearchStatus, ResearchDatasetStatus, ResearchStrategyVersionStatus, ResearchBacktestStatus, ResearchPaperSessionStatus, ResearchSignalState, ResearchPromotionState } from '../research.types';

export class ResearchDatasetFilterDto {
  @IsOptional()
  @IsString()
  venue?: string;

  @IsOptional()
  @IsString()
  symbol?: string;

  @IsOptional()
  @IsString()
  timeframe?: string;

  @IsOptional()
  @IsEnum(ResearchDatasetStatus)
  status?: ResearchDatasetStatus;

  @IsOptional()
  @IsNumberString()
  page?: string;

  @IsOptional()
  @IsNumberString()
  limit?: string;
}

export class ResearchStrategyVersionFilterDto {
  @IsOptional()
  @IsString()
  strategyId?: string;

  @IsOptional()
  @IsString()
  traderStrategyId?: string;

  @IsOptional()
  @IsEnum(ResearchStrategyVersionStatus)
  status?: ResearchStrategyVersionStatus;

  @IsOptional()
  @IsNumberString()
  page?: string;

  @IsOptional()
  @IsNumberString()
  limit?: string;
}

export class ResearchBacktestFilterDto {
  @IsOptional()
  @IsString()
  strategyVersionId?: string;

  @IsOptional()
  @IsEnum(ResearchBacktestStatus)
  status?: ResearchBacktestStatus;

  @IsOptional()
  @IsString()
  symbol?: string;

  @IsOptional()
  @IsNumberString()
  page?: string;

  @IsOptional()
  @IsNumberString()
  limit?: string;
}

export class ResearchPaperSessionFilterDto {
  @IsOptional()
  @IsString()
  strategyVersionId?: string;

  @IsOptional()
  @IsEnum(ResearchPaperSessionStatus)
  status?: ResearchPaperSessionStatus;

  @IsOptional()
  @IsNumberString()
  page?: string;

  @IsOptional()
  @IsNumberString()
  limit?: string;
}

export class ResearchSignalFilterDto {
  @IsOptional()
  @IsString()
  strategyVersionId?: string;

  @IsOptional()
  @IsEnum(ResearchSignalState)
  state?: ResearchSignalState;

  @IsOptional()
  @IsString()
  symbol?: string;

  @IsOptional()
  @IsString()
  side?: string;

  @IsOptional()
  @IsNumberString()
  page?: string;

  @IsOptional()
  @IsNumberString()
  limit?: string;
}

export class ResearchPromotionFilterDto {
  @IsOptional()
  @IsString()
  strategyVersionId?: string;

  @IsOptional()
  @IsEnum(ResearchPromotionState)
  state?: ResearchPromotionState;

  @IsOptional()
  @IsNumberString()
  page?: string;

  @IsOptional()
  @IsNumberString()
  limit?: string;
}

export class ResearchQueryDto {
  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  startTime?: string;

  @IsOptional()
  @IsString()
  endTime?: string;

  @IsOptional()
  @IsNumberString()
  page?: string;

  @IsOptional()
  @IsNumberString()
  limit?: string;

  @IsOptional()
  @IsString()
  sortBy?: string;

  @IsOptional()
  @IsString()
  sortOrder?: string;
}

export class DateRangeDto {
  @IsString()
  startTime!: string;

  @IsString()
  endTime!: string;
}
