import { IsBoolean, IsEnum, IsOptional, IsString, IsArray, IsNotEmpty, MaxLength, IsUrl, ArrayMinSize, Matches } from 'class-validator';
import { BillingNotificationEventKey } from '../billing-notification.types';

export class CreateWebhookSubscriptionDto {
  @IsUrl({ require_protocol: true })
  @IsNotEmpty()
  @MaxLength(2048)
  endpointUrl!: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsEnum(BillingNotificationEventKey, { each: true })
  eventTypes!: BillingNotificationEventKey[];

  @IsOptional()
  @IsBoolean()
  enabled?: boolean = true;

  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  secret!: string;
}

export class UpdateWebhookSubscriptionDto {
  @IsOptional()
  @IsUrl({ require_protocol: true })
  @MaxLength(2048)
  endpointUrl?: string;

  @IsOptional()
  @IsArray()
  @IsEnum(BillingNotificationEventKey, { each: true })
  eventTypes?: BillingNotificationEventKey[];

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;
}

export class RotateWebhookSecretDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  newSecret!: string;
}

export class WebhookSubscriptionResponseDto {
  id!: string;
  tenantId!: string;
  endpointUrl!: string;
  eventTypes!: BillingNotificationEventKey[];
  enabled!: boolean;
  secretMasked!: string;
  lastDeliveryAt!: string | null;
  lastDeliveryStatus!: string | null;
  failureCount!: number;
  createdAt!: string;
  updatedAt!: string;
}

export class WebhookDeliveryAttemptDto {
  id!: string;
  subscriptionId!: string;
  tenantId!: string;
  eventId!: string;
  eventType!: BillingNotificationEventKey;
  endpointUrl!: string;
  status!: string;
  attempt!: number;
  providerReference?: string | null;
  failureReason?: string | null;
  nextAttemptAt?: string | null;
  createdAt!: string;
}
