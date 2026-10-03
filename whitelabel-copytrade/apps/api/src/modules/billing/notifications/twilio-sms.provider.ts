import { Logger } from '@nestjs/common';
import { NotificationChannel } from './billing-notification.types';
import {
  INotificationProvider,
  ProviderDeliveryResultType,
  SendNotificationInput,
  SendNotificationResult,
} from './notification-provider.interface';

/**
 * Twilio Programmable Messaging SMS adapter (plain REST, no SDK).
 *
 * Configuration (all required unless noted):
 *  - TWILIO_ACCOUNT_SID   AC...
 *  - TWILIO_AUTH_TOKEN    or TWILIO_API_KEY_SID (SK...) + TWILIO_API_KEY_SECRET
 *  - TWILIO_MESSAGING_SERVICE_SID (MG...)  or  TWILIO_FROM_NUMBER (E.164)
 *  - TWILIO_STATUS_CALLBACK_URL (optional, https only)
 *
 * Fail-closed rules:
 *  - incomplete configuration -> isAvailable() false and send() throws, so
 *    NotificationDeliveryService records PROVIDER_NOT_CONFIGURED; nothing is
 *    reported as delivered;
 *  - the recipient must be an E.164 number; anything else is a permanent
 *    failure (never retried);
 *  - "accepted" means Twilio queued the message (status queued/accepted/
 *    sending/sent) - that is what Twilio's create call can prove; handset
 *    delivery arrives later on the status callback;
 *  - 429 and 5xx are retryable, other 4xx are permanent; the credentials
 *    never appear in a result or a log line, and phone numbers are masked.
 */

const E164 = /^\+[1-9]\d{6,14}$/;
const MAX_SMS_BODY = 1600;

export type SmsFetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<any>;
}>;

export interface TwilioSmsOptions {
  accountSid?: string;
  authToken?: string;
  apiKeySid?: string;
  apiKeySecret?: string;
  messagingServiceSid?: string;
  fromNumber?: string;
  statusCallbackUrl?: string;
  apiBase?: string;
  fetchImpl?: SmsFetchLike;
}

export function maskPhone(phone: string | undefined): string {
  if (!phone) return '(none)';
  return phone.length <= 4 ? '****' : `${phone.slice(0, 3)}****${phone.slice(-2)}`;
}

export class TwilioSmsProvider implements INotificationProvider {
  readonly providerName = 'twilio';
  readonly supportedChannels = [NotificationChannel.SMS] as NotificationChannel[];
  private readonly logger = new Logger(TwilioSmsProvider.name);
  private readonly accountSid: string;
  private readonly username: string;
  private readonly password: string;
  private readonly messagingServiceSid: string;
  private readonly fromNumber: string;
  private readonly statusCallbackUrl: string;
  private readonly apiBase: string;
  private readonly fetchImpl: SmsFetchLike | undefined;

  constructor(options: TwilioSmsOptions = {}) {
    const env = process.env;
    this.accountSid = (options.accountSid ?? env.TWILIO_ACCOUNT_SID ?? '').trim();
    const apiKeySid = (options.apiKeySid ?? env.TWILIO_API_KEY_SID ?? '').trim();
    const apiKeySecret = (options.apiKeySecret ?? env.TWILIO_API_KEY_SECRET ?? '').trim();
    const authToken = (options.authToken ?? env.TWILIO_AUTH_TOKEN ?? '').trim();
    // Prefer a revocable API key over the account auth token.
    if (apiKeySid && apiKeySecret) {
      this.username = apiKeySid;
      this.password = apiKeySecret;
    } else {
      this.username = this.accountSid;
      this.password = authToken;
    }
    this.messagingServiceSid = (
      options.messagingServiceSid ??
      env.TWILIO_MESSAGING_SERVICE_SID ??
      ''
    ).trim();
    this.fromNumber = (options.fromNumber ?? env.TWILIO_FROM_NUMBER ?? '').trim();
    this.statusCallbackUrl = (
      options.statusCallbackUrl ??
      env.TWILIO_STATUS_CALLBACK_URL ??
      ''
    ).trim();
    this.apiBase = (options.apiBase ?? env.TWILIO_API_BASE ?? 'https://api.twilio.com').replace(
      /\/+$/,
      '',
    );
    this.fetchImpl =
      options.fetchImpl ??
      (typeof fetch === 'function' ? (fetch as unknown as SmsFetchLike) : undefined);
  }

  isAvailable(): boolean {
    return this.configurationProblems().length === 0;
  }

  /** Names of missing/invalid settings (never their values). */
  configurationProblems(): string[] {
    const problems: string[] = [];
    if (!/^AC[0-9a-fA-F]{32}$/.test(this.accountSid)) problems.push('TWILIO_ACCOUNT_SID');
    if (!this.password)
      problems.push('TWILIO_AUTH_TOKEN or TWILIO_API_KEY_SID/TWILIO_API_KEY_SECRET');
    if (!/^MG[0-9a-fA-F]{32}$/.test(this.messagingServiceSid) && !E164.test(this.fromNumber)) {
      problems.push('TWILIO_MESSAGING_SERVICE_SID or TWILIO_FROM_NUMBER (E.164)');
    }
    if (this.statusCallbackUrl && !/^https:\/\//.test(this.statusCallbackUrl))
      problems.push('TWILIO_STATUS_CALLBACK_URL (https)');
    if (!this.fetchImpl) problems.push('fetch runtime');
    return problems;
  }

  async send(input: SendNotificationInput): Promise<SendNotificationResult> {
    const problems = this.configurationProblems();
    if (problems.length > 0) {
      throw new Error(
        `SMS provider twilio not configured (missing: ${problems.join(', ')}). No fake success allowed.`,
      );
    }

    const to = (input.recipientPhone || '').replace(/[\s().-]/g, '');
    if (!E164.test(to)) {
      return {
        accepted: false,
        providerReference: null,
        resultType: ProviderDeliveryResultType.PERMANENT_FAILURE,
        retryable: false,
        errorCode: 'SMS_INVALID_RECIPIENT',
        failureReason: 'Recipient phone number missing or not in E.164 format',
      };
    }

    const text = (input.body || input.subject || '').trim();
    if (!text) {
      return {
        accepted: false,
        providerReference: null,
        resultType: ProviderDeliveryResultType.PERMANENT_FAILURE,
        retryable: false,
        errorCode: 'SMS_EMPTY_BODY',
        failureReason: 'SMS body is empty',
      };
    }

    const form = new URLSearchParams();
    form.set('To', to);
    form.set('Body', text.length > MAX_SMS_BODY ? `${text.slice(0, MAX_SMS_BODY - 1)}…` : text);
    if (/^MG[0-9a-fA-F]{32}$/.test(this.messagingServiceSid))
      form.set('MessagingServiceSid', this.messagingServiceSid);
    else form.set('From', this.fromNumber);
    if (this.statusCallbackUrl) form.set('StatusCallback', this.statusCallbackUrl);

    const url = `${this.apiBase}/2010-04-01/Accounts/${encodeURIComponent(this.accountSid)}/Messages.json`;
    const auth = Buffer.from(`${this.username}:${this.password}`).toString('base64');
    let response: Awaited<ReturnType<SmsFetchLike>>;
    try {
      response = await this.fetchImpl!(url, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
          // Twilio honours this header for safe retries of message creation.
          'I-Twilio-Idempotency-Token': input.idempotencyKey.slice(0, 64),
        },
        body: form.toString(),
      });
    } catch (err: any) {
      this.logger.warn(
        `Twilio request failed to=${maskPhone(to)} tenant=${input.tenantId}: ${err?.message ?? 'network error'}`,
      );
      return {
        accepted: false,
        providerReference: null,
        resultType: ProviderDeliveryResultType.TEMPORARY_FAILURE,
        retryable: true,
        errorCode: 'SMS_NETWORK_ERROR',
        failureReason: 'Could not reach Twilio',
      };
    }

    let payload: any = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    if (!response.ok) {
      const retryable = response.status === 429 || response.status >= 500;
      const code = payload?.code ? `TWILIO_${payload.code}` : `TWILIO_HTTP_${response.status}`;
      this.logger.warn(
        `Twilio rejected SMS to=${maskPhone(to)} tenant=${input.tenantId} status=${response.status} code=${code}`,
      );
      return {
        accepted: false,
        providerReference: null,
        resultType: retryable
          ? ProviderDeliveryResultType.TEMPORARY_FAILURE
          : ProviderDeliveryResultType.PERMANENT_FAILURE,
        retryable,
        errorCode: code,
        failureReason: payload?.message
          ? String(payload.message)
          : `Twilio HTTP ${response.status}`,
      };
    }

    const sid = typeof payload?.sid === 'string' ? payload.sid : null;
    const status = String(payload?.status ?? '').toLowerCase();
    if (!sid || (!sid.startsWith('SM') && !sid.startsWith('MM'))) {
      return {
        accepted: false,
        providerReference: null,
        resultType: ProviderDeliveryResultType.TEMPORARY_FAILURE,
        retryable: true,
        errorCode: 'SMS_UNEXPECTED_RESPONSE',
        failureReason: 'Twilio response did not contain a message sid',
      };
    }
    if (status === 'failed' || status === 'undelivered' || status === 'canceled') {
      return {
        accepted: false,
        providerReference: sid,
        resultType: ProviderDeliveryResultType.PERMANENT_FAILURE,
        retryable: false,
        errorCode: payload?.error_code ? `TWILIO_${payload.error_code}` : 'SMS_REJECTED',
        failureReason: payload?.error_message
          ? String(payload.error_message)
          : `Twilio status ${status}`,
      };
    }

    this.logger.log(
      `SMS queued via Twilio sid=${sid} to=${maskPhone(to)} template=${input.templateKey} tenant=${input.tenantId}`,
    );
    return {
      accepted: true,
      providerReference: sid,
      resultType: ProviderDeliveryResultType.ACCEPTED,
      retryable: false,
      rawResponse: { sid, status, numSegments: payload?.num_segments ?? null },
    };
  }

  async getDeliveryStatus(
    providerReference: string,
  ): Promise<{ delivered: boolean; status: string }> {
    if (!this.isAvailable()) throw new Error('SMS provider twilio not configured');
    if (!/^(SM|MM)[0-9a-fA-F]{32}$/.test(providerReference))
      throw new Error('Not a Twilio message sid');
    const url = `${this.apiBase}/2010-04-01/Accounts/${encodeURIComponent(this.accountSid)}/Messages/${providerReference}.json`;
    const auth = Buffer.from(`${this.username}:${this.password}`).toString('base64');
    const response = await this.fetchImpl!(url, {
      method: 'GET',
      headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' },
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(`Twilio status lookup failed (HTTP ${response.status})`);
    const status = String(payload?.status ?? 'unknown').toLowerCase();
    return { delivered: status === 'delivered', status };
  }
}
