// # Responsibility: validates fee schedule publication inputs without accepting client-derived prices or currencies.
import { IsDateString, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
export class PublishFeeScheduleDto {
  @IsOptional() @IsUUID() tenantId?: string;
  @IsDateString() effectiveFrom!: string;
  @IsString() @Matches(/^(0|[1-9][0-9]*)(\.[0-9]+)?$/) @MaxLength(64) managementFeeRate!: string;
  @IsString() @Matches(/^(0|[1-9][0-9]*)(\.[0-9]+)?$/) @MaxLength(64) profitShareRate!: string;
  @IsString() @Matches(/^[A-Z]{3}$/) currency!: string;
}
