import { IsBoolean, IsEnum, IsOptional, IsString, IsArray, IsNotEmpty, MaxLength, IsLocale, ValidateIf } from 'class-validator';
import { BillingNotificationEventKey, NotificationChannel } from '../billing-notification.types';

export enum NotificationPreferenceCategory {
  BILLING = 'billing',
  DUNNING = 'dunning',
  USAGE = 'usage',
  SUBSCRIPTION = 'subscription',
  SAAS_ADMIN = 'saas_admin',
  FEE = 'fee',
  PAYOUT = 'payout',
}

export class UpdateNotificationPreferenceDto {
  @IsOptional()
  @IsEnum(BillingNotificationEventKey)
  eventKey?: BillingNotificationEventKey;

  @IsEnum(NotificationChannel)
  @IsNotEmpty()
  channel!: NotificationChannel;

  @IsBoolean()
  @IsNotEmpty()
  enabled!: boolean;

  @IsOptional()
  @IsEnum(NotificationPreferenceCategory)
  category?: NotificationPreferenceCategory;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  locale?: string;
}

export class BulkUpdateNotificationPreferencesDto {
  @IsArray()
  preferences!: UpdateNotificationPreferenceDto[];
}

export class GetNotificationPreferencesDto {
  @IsOptional()
  @IsString()
  userId?: string;

  @IsOptional()
  @IsEnum(NotificationPreferenceCategory)
  category?: NotificationPreferenceCategory;

  @IsOptional()
  @IsEnum(BillingNotificationEventKey)
  eventKey?: BillingNotificationEventKey;
}

export class NotificationPreferenceResponseDto {
  id!: string;
  tenantId!: string;
  userId?: string;
  eventKey?: BillingNotificationEventKey;
  channel!: NotificationChannel;
  enabled!: boolean;
  category!: string;
  isMandatory!: boolean;
  locale!: string;
  createdAt!: string;
  updatedAt!: string;
}
