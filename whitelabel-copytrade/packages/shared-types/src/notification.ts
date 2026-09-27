import type { ISODateString, UUID } from './common';

export enum NotificationChannel {
  IN_APP = 'IN_APP',
  EMAIL = 'EMAIL',
  PUSH = 'PUSH',
  SMS = 'SMS',
  WEBHOOK = 'WEBHOOK',
  TELEGRAM = 'TELEGRAM',
}

export enum NotificationCategory {
  ACCOUNT = 'account',
  SECURITY = 'security',
  BILLING = 'billing',
  TRADING = 'trading',
  GENERAL = 'general',
}

export interface NotificationDto {
  id: UUID;
  tenantId: UUID;
  userId: UUID;
  channel: NotificationChannel;
  type: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  readAt: ISODateString | null;
  deliveredAt: ISODateString | null;
  createdAt: ISODateString;
}

export interface NotificationPreferenceDto {
  id: UUID;
  userId: UUID;
  category: string;
  channel: NotificationChannel;
  enabled: boolean;
  updatedAt: ISODateString;
}

/** Payload published on the notification queue. */
export interface TransactionalNotificationJob {
  tenantId: UUID;
  userId: UUID;
  type: string;
  locale: string;
  data: Record<string, unknown>;
  /** Optional explicit channel restriction; defaults to the template fan-out. */
  channels?: NotificationChannel[];
  requestId?: string;
}

/** Payload published on the email queue for the notification-service worker. */
export interface EmailJob {
  tenantId: UUID;
  userId: UUID | null;
  to: string;
  locale: string;
  subject: string;
  body: string;
  templateType: string;
  /** Branding snapshot so the worker never needs a database round-trip. */
  branding: {
    appName: string;
    logoUrl: string | null;
    primaryColor: string;
    supportEmail: string | null;
  };
  data: Record<string, unknown>;
}
