/**
 * Provider-neutral outbound notification contract.
 * No secrets outside implementation, normalized results.
 */

import { NotificationChannel } from './billing-notification.types';

export enum ProviderDeliveryResultType {
  ACCEPTED = 'ACCEPTED',
  TEMPORARY_FAILURE = 'TEMPORARY_FAILURE',
  PERMANENT_FAILURE = 'PERMANENT_FAILURE',
}

export interface SendNotificationInput {
  recipientEmail?: string;
  recipientUserId?: string;
  tenantId: string;
  subject: string;
  body: string;
  htmlBody?: string;
  channel: NotificationChannel;
  templateKey: string;
  safePayload: Record<string, unknown>;
  idempotencyKey: string;
  priority?: string;
  locale?: string;
}

export interface SendNotificationResult {
  accepted: boolean;
  providerReference: string | null;
  resultType: ProviderDeliveryResultType;
  retryable: boolean;
  errorCode?: string;
  failureReason?: string;
  rawResponse?: unknown;
  deliveredAt?: string;
}

export interface SendWebhookInput {
  endpointUrl: string;
  eventId: string;
  eventType: string;
  timestamp: string;
  payload: Record<string, unknown>;
  signature: string;
  idempotencyKey: string;
  tenantId: string;
}

export interface SendWebhookResult {
  accepted: boolean;
  providerReference: string | null;
  resultType: ProviderDeliveryResultType;
  retryable: boolean;
  httpStatus?: number;
  failureReason?: string;
  rawResponse?: unknown;
}

export interface INotificationProvider {
  readonly providerName: string;
  readonly supportedChannels: NotificationChannel[];

  send(input: SendNotificationInput): Promise<SendNotificationResult>;

  sendWebhook?(input: SendWebhookInput): Promise<SendWebhookResult>;

  getDeliveryStatus?(providerReference: string): Promise<{ delivered: boolean; status: string }>;

  isAvailable(): boolean;
}
