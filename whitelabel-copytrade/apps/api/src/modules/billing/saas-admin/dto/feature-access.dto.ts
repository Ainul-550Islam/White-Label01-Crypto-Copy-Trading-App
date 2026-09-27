import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class FeatureAccessItemDto {
  @ApiProperty() featureKey: string;
  @ApiProperty() enabled: boolean;
  @ApiProperty() source: string;
  @ApiPropertyOptional() planCode: string | null;
  @ApiPropertyOptional() subscriptionStatus: string | null;
  @ApiPropertyOptional() reason: string | null;
}

export class LimitAccessItemDto {
  @ApiProperty() limitKey: string;
  @ApiPropertyOptional() configuredLimit: number | null;
  @ApiProperty() currentUsage: number;
  @ApiPropertyOptional() remaining: number | null;
  @ApiProperty() unlimited: boolean;
  @ApiPropertyOptional() percentageUsed: number | null;
  @ApiProperty() source: string;
}

export class FeatureAccessResponseDto {
  @ApiProperty() tenantId: string;
  @ApiProperty({ type: [FeatureAccessItemDto] }) features: FeatureAccessItemDto[];
  @ApiProperty({ type: [LimitAccessItemDto] }) limits: LimitAccessItemDto[];
  @ApiProperty() fetchedAt: string;
}

export class SingleFeatureCheckResponseDto {
  @ApiProperty() tenantId: string;
  @ApiProperty() featureKey: string;
  @ApiProperty() allowed: boolean;
  @ApiPropertyOptional() reason: string | null;
  @ApiPropertyOptional() planCode: string | null;
  @ApiPropertyOptional() subscriptionStatus: string | null;
  @ApiProperty() source: string;
}

export class WhiteLabelStateResponseDto {
  @ApiProperty() tenantId: string;
  @ApiProperty() eligible: boolean;
  @ApiProperty() entitlementAllowed: boolean;
  @ApiPropertyOptional() entitlementReason: string | null;
  @ApiProperty() provisioningState: string;
  @ApiPropertyOptional() requestedAt: string | null;
  @ApiPropertyOptional() enabledAt: string | null;
  @ApiPropertyOptional() configuration: Record<string, unknown> | null;
}

export class WhiteLabelActionRequestDto {
  @ApiPropertyOptional() configuration?: Record<string, unknown>;
  @ApiPropertyOptional() reason?: string;
}
