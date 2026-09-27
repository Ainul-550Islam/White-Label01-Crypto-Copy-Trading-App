import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BillingInterval } from '@wlct/shared-types';

export class PortalAvailablePlanDto {
  @ApiProperty() id: string;
  @ApiProperty() code: string;
  @ApiProperty() name: string;
  @ApiPropertyOptional() description: string | null;
  @ApiProperty() price: string;
  @ApiProperty() currency: string;
  @ApiProperty({ enum: BillingInterval }) interval: BillingInterval;
  @ApiProperty() trialDays: number;
  @ApiProperty() limits: Record<string, any>;
  @ApiProperty() features: string[];
  @ApiProperty() isActive: boolean;
  @ApiProperty() sortOrder: number;
  @ApiProperty() isCurrent: boolean;
  @ApiProperty() upgradeEligible: boolean;
  @ApiProperty() downgradeEligible: boolean;
  @ApiProperty() intervalChangeEligible: boolean;
}

export class PortalFeatureMatrixRowDto {
  @ApiProperty() featureKey: string;
  @ApiProperty() label: string;
  @ApiProperty() plans: Record<string, boolean>;
}

export class PortalLimitMatrixRowDto {
  @ApiProperty() limitKey: string;
  @ApiProperty() label: string;
  @ApiProperty() plans: Record<string, number | null>;
}

export class PlanComparisonResponseDto {
  @ApiProperty() tenantId: string;
  @ApiPropertyOptional() currentPlanId: string | null;
  @ApiProperty({ type: [PortalAvailablePlanDto] }) plans: PortalAvailablePlanDto[];
  @ApiProperty({ type: [PortalFeatureMatrixRowDto] }) featuresMatrix: PortalFeatureMatrixRowDto[];
  @ApiProperty({ type: [PortalLimitMatrixRowDto] }) limitsMatrix: PortalLimitMatrixRowDto[];
  @ApiProperty() fetchedAt: string;
}
