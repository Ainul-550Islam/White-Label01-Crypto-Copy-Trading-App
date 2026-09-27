import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsBoolean, MaxLength, Matches } from 'class-validator';

export class RegisterDomainRequestDto {
  @ApiProperty({ example: 'app.acme-capital.com' })
  @IsString()
  @MaxLength(253)
  @Matches(/^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/, {
    message: 'Must be valid FQDN',
  })
  domain: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}

export class VerifyDomainRequestDto {
  @ApiProperty({ example: 'app.acme-capital.com' })
  @IsString()
  domain: string;
}

export class RemoveDomainRequestDto {
  @ApiProperty({ example: 'app.acme-capital.com' })
  @IsString()
  domain: string;
}

export class CustomDomainStatusResponseDto {
  @ApiProperty() tenantId: string;
  @ApiPropertyOptional() domain: string | null;
  @ApiProperty() isPrimary: boolean;
  @ApiPropertyOptional() status: string | null;
  @ApiPropertyOptional() verifiedAt: string | null;
  @ApiProperty() verificationRequired: boolean;
  @ApiProperty() entitlementAllowed: boolean;
  @ApiPropertyOptional() entitlementReason: string | null;
}

export class RegisterDomainResponseDto {
  @ApiProperty() id: string;
  @ApiProperty() domain: string;
  @ApiProperty() status: string;
  @ApiProperty() verificationToken: string;
  @ApiProperty() message: string;
}

export class DomainListResponseDto {
  @ApiProperty() tenantId: string;
  @ApiProperty({ type: [Object] }) domains: any[];
  @ApiProperty() total: number;
}

export class VerificationChallengeResponseDto {
  @ApiProperty() domain: string;
  @ApiProperty() token: string;
  @ApiProperty() verificationRecord: string;
  @ApiProperty() verificationType: string;
  @ApiProperty() expiresAt: string;
  @ApiProperty() attempts: number;
  @ApiProperty() maxAttempts: number;
}

export class VerificationResultResponseDto {
  @ApiProperty() domain: string;
  @ApiProperty() status: string;
  @ApiProperty() verified: boolean;
  @ApiPropertyOptional() verifiedAt: string | null;
  @ApiProperty() attempts: number;
  @ApiPropertyOptional() failureReason: string | null;
  @ApiPropertyOptional() challenge: any | null;
}

export class RemoveDomainResponseDto {
  @ApiProperty() removed: boolean;
  @ApiProperty() domain: string;
  @ApiProperty() message: string;
}
