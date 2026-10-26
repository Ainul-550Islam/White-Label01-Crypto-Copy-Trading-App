// # Responsibility: validates tenant-scoped statement generation targets and exclusive period boundaries.
import { IsBoolean, IsDateString, IsOptional, IsUUID } from 'class-validator';
export class GenerateProfitShareStatementDto {
  @IsUUID() followerUserId!: string;
  @IsUUID() traderUserId!: string;
  @IsDateString() periodStart!: string;
  @IsDateString() periodEnd!: string;
  @IsOptional() @IsBoolean() correction?: boolean;
}
