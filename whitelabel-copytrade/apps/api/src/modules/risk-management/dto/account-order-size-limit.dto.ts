// # Responsibility: validates owner-scoped per-order decimal ceilings and bounded account pagination.
import { IsOptional, IsString, IsUUID, Matches } from 'class-validator';

export class AccountOrderSizeListDto {
  @IsOptional()
  @IsString()
  @Matches(/^[1-9]\d{0,5}$/)
  page?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[1-9]\d?$/)
  limit?: string;
}

export class UpdateAccountOrderSizeLimitDto {
  @IsOptional()
  @IsUUID()
  expectedRevision?: string | null;

  @IsOptional()
  @IsString()
  @Matches(/^(?:0|[1-9]\d{0,15})(?:\.\d{1,12})?$/)
  maxBaseQuantity?: string | null;

  @IsOptional()
  @IsString()
  @Matches(/^(?:0|[1-9]\d{0,15})(?:\.\d{1,12})?$/)
  maxOrderNotional?: string | null;

  @IsOptional()
  @IsString()
  @Matches(/^[A-Z0-9]{2,16}$/)
  notionalCurrency?: string | null;
}
