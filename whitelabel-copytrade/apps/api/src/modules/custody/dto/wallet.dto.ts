import { IsString, IsOptional, IsEnum, IsBoolean, IsObject, IsNumber } from 'class-validator';

export class CreateWalletDto {
  @IsString()
  tenantId!: string;

  @IsOptional()
  @IsString()
  clientProfileId?: string | null;

  @IsOptional()
  @IsString()
  accountId?: string | null;

  @IsOptional()
  @IsString()
  walletType?: string;

  @IsOptional()
  @IsString()
  scope?: string;

  @IsString()
  assetId!: string;

  @IsString()
  networkId!: string;

  @IsOptional()
  @IsString()
  provider?: string | null;

  @IsOptional()
  @IsString()
  ownerId?: string | null;

  @IsOptional()
  @IsString()
  ownerType?: string | null;

  @IsOptional()
  @IsString()
  operatorId?: string | null;

  @IsOptional()
  @IsString()
  correlationId?: string | null;

  @IsOptional()
  @IsObject()
  metadata?: any;
}

export class TransitionWalletDto {
  @IsString()
  walletId!: string;

  @IsEnum(['PENDING', 'ACTIVE', 'RESTRICTED', 'SUSPENDED', 'CLOSURE_PENDING', 'CLOSED'])
  toState!: string;

  @IsOptional()
  @IsString()
  operatorId?: string | null;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsString()
  correlationId?: string | null;
}

export class CreateWalletAddressDto {
  @IsString()
  walletId!: string;

  @IsString()
  assetId!: string;

  @IsString()
  networkId!: string;

  @IsString()
  address!: string;

  @IsOptional()
  @IsString()
  providerReference?: string | null;

  @IsOptional()
  @IsString()
  creationSource?: string | null;

  @IsOptional()
  @IsString()
  label?: string | null;

  @IsOptional()
  @IsBoolean()
  isDepositAddress?: boolean;

  @IsOptional()
  @IsString()
  clientProfileId?: string | null;

  @IsOptional()
  @IsString()
  accountId?: string | null;

  @IsOptional()
  @IsString()
  operatorId?: string | null;

  @IsOptional()
  @IsString()
  correlationId?: string | null;

  @IsOptional()
  @IsObject()
  metadata?: any;
}

export class GetOrCreateDepositAddressDto {
  @IsString()
  walletId!: string;

  @IsString()
  assetId!: string;

  @IsString()
  networkId!: string;

  @IsOptional()
  @IsString()
  clientProfileId?: string | null;

  @IsOptional()
  @IsString()
  accountId?: string | null;

  @IsOptional()
  @IsString()
  operatorId?: string | null;

  @IsOptional()
  @IsString()
  correlationId?: string | null;

  @IsOptional()
  @IsString()
  label?: string | null;
}

export class ListWalletsDto {
  @IsOptional()
  @IsString()
  clientProfileId?: string;

  @IsOptional()
  @IsString()
  accountId?: string;

  @IsOptional()
  @IsString()
  assetId?: string;

  @IsOptional()
  @IsString()
  networkId?: string;

  @IsOptional()
  @IsString()
  state?: string;

  @IsOptional()
  @IsNumber()
  page?: number;

  @IsOptional()
  @IsNumber()
  limit?: number;
}
