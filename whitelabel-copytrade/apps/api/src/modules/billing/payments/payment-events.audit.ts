import { Injectable, Logger } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { AuditAction, AuditActorType, AuditOutcome } from '@wlct/shared-types';
import { AuditService } from '../../audit/audit.service';
import { PaymentProvider, PaymentStatus } from './payment.types';

/**
 * Structured payment audit events for checkout created, payment pending,
 * payment succeeded, payment failed, webhook accepted/rejected, refund,
 * and reconciliation actions without sensitive data.
 *
 * Audit data may include:
 *  - tenant ID
 *  - internal payment ID
 *  - provider
 *  - provider event ID
 *  - plan ID
 *  - safe status
 *  - result
 *  - timestamp
 *
 * Never include:
 *  - card number
 *  - CVV
 *  - private key
 *  - API secret
 *  - provider secret
 *  - exchange API credentials
 *  - raw authorization headers
 */

export const PaymentAuditAction = {
  CHECKOUT_CREATED: 'CHECKOUT_CREATED',
  CHECKOUT_REJECTED: 'CHECKOUT_REJECTED',
  PAYMENT_CREATED: 'PAYMENT_CREATED',
  PAYMENT_PENDING: 'PAYMENT_PENDING',
  PAYMENT_SUCCEEDED: 'PAYMENT_SUCCEEDED',
  PAYMENT_FAILED: 'PAYMENT_FAILED',
  PAYMENT_CANCELLED: 'PAYMENT_CANCELLED',
  PAYMENT_EXPIRED: 'PAYMENT_EXPIRED',
  PAYMENT_REFUNDED: 'PAYMENT_REFUNDED',
  PAYMENT_DUPLICATE: 'PAYMENT_DUPLICATE',
  PAYMENT_TRANSITION_REJECTED: 'PAYMENT_TRANSITION_REJECTED',
  WEBHOOK_RECEIVED: 'WEBHOOK_RECEIVED',
  WEBHOOK_REJECTED: 'WEBHOOK_REJECTED',
  WEBHOOK_DUPLICATE: 'WEBHOOK_DUPLICATE',
  WEBHOOK_PROCESSED: 'WEBHOOK_PROCESSED',
  PAYMENT_RECONCILED: 'PAYMENT_RECONCILED',
  SUBSCRIPTION_ACTIVATED: 'SUBSCRIPTION_ACTIVATED',
  SUBSCRIPTION_RENEWED: 'SUBSCRIPTION_RENEWED',
  SUBSCRIPTION_REFUNDED: 'SUBSCRIPTION_REFUNDED',
  SUBSCRIPTION_PAUSED: 'SUBSCRIPTION_PAUSED',
  SUBSCRIPTION_SYNC_FAILED: 'SUBSCRIPTION_SYNC_FAILED',
  SUBSCRIPTION_SYNC_SKIPPED: 'SUBSCRIPTION_SYNC_SKIPPED',
} as const;

export interface PaymentAuditEvent {
  tenantId: string;
  paymentId?: string;
  provider: PaymentProvider;
  action: keyof typeof PaymentAuditAction | string;
  status?: PaymentStatus | string;
  result?: string;
  planId?: string;
  subscriptionId?: string;
  amount?: string;
  currency?: string;
  providerEventId?: string;
  eventType?: string;
  actorId?: string;
  ipHash?: string;
  requestId?: string;
  error?: string;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class PaymentEventsAuditService {
  private readonly logger = new Logger(PaymentEventsAuditService.name);

  constructor(
    private readonly audit: AuditService,
    @InjectPinoLogger(PaymentEventsAuditService.name) private readonly pinoLogger: PinoLogger,
  ) {}

  async logPaymentEvent(event: PaymentAuditEvent): Promise<void> {
    try {
      const safeMetadata = this.sanitizeMetadata(event.metadata);

      await this.audit.record({
        tenantId: event.tenantId,
        actorType: AuditActorType.SYSTEM,
        actorId: event.actorId || 'system',
        action: event.action as AuditAction,
        outcome: this.mapActionToOutcome(event.action),
        resourceType: 'payment',
        resourceId: event.paymentId || event.providerEventId,
        description: this.buildDescription(event),
        metadata: {
          provider: event.provider,
          paymentId: event.paymentId,
          providerEventId: event.providerEventId,
          eventType: event.eventType,
          status: event.status,
          result: event.result,
          planId: event.planId,
          subscriptionId: event.subscriptionId,
          amount: event.amount,
          currency: event.currency,
          error: event.error ? this.sanitizeError(event.error) : undefined,
          ...safeMetadata,
        },
        ipHash: event.ipHash,
        requestId: event.requestId,
      });

      this.pinoLogger.info(
        {
          event: 'payment.audit',
          tenantId: event.tenantId,
          paymentId: event.paymentId,
          provider: event.provider,
          action: event.action,
          status: event.status,
          providerEventId: event.providerEventId,
        },
        `Payment audit: ${event.action}`,
      );
    } catch (error) {
      this.logger.error(`Failed to log payment audit event: ${(error as Error).message}`);
    }
  }

  async logWebhookEvent(event: {
    provider: PaymentProvider;
    providerEventId: string;
    action: string;
    result: string;
    eventType?: string;
    paymentId?: string;
    tenantId?: string;
    status?: PaymentStatus | string;
    error?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    try {
      const safeMetadata = this.sanitizeMetadata(event.metadata);

      await this.audit.record({
        tenantId: event.tenantId || 'system',
        actorType: AuditActorType.SYSTEM,
        actorId: 'webhook',
        action: event.action as AuditAction,
        outcome: this.mapActionToOutcome(event.action),
        resourceType: 'webhook',
        resourceId: event.providerEventId,
        description: `Webhook ${event.action}: ${event.provider} ${event.providerEventId}`,
        metadata: {
          provider: event.provider,
          providerEventId: event.providerEventId,
          eventType: event.eventType,
          paymentId: event.paymentId,
          status: event.status,
          result: event.result,
          error: event.error ? this.sanitizeError(event.error) : undefined,
          ...safeMetadata,
        },
      });

      this.pinoLogger.info(
        {
          event: 'webhook.audit',
          provider: event.provider,
          providerEventId: event.providerEventId,
          action: event.action,
          result: event.result,
        },
        `Webhook audit: ${event.action}`,
      );
    } catch (error) {
      this.logger.error(`Failed to log webhook audit event: ${(error as Error).message}`);
    }
  }

  async logCheckoutEvent(event: {
    tenantId: string;
    checkoutId?: string;
    paymentId?: string;
    provider: PaymentProvider;
    action: string;
    status?: string;
    planId?: string;
    amount?: string;
    currency?: string;
    actorId?: string;
    ipHash?: string;
    requestId?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    try {
      const safeMetadata = this.sanitizeMetadata(event.metadata);

      await this.audit.record({
        tenantId: event.tenantId,
        actorType: AuditActorType.USER,
        actorId: event.actorId || 'system',
        action: event.action as AuditAction,
        outcome: this.mapActionToOutcome(event.action),
        resourceType: 'checkout',
        resourceId: event.checkoutId || event.paymentId,
        description: `Checkout ${event.action}: ${event.provider} plan ${event.planId}`,
        metadata: {
          provider: event.provider,
          checkoutId: event.checkoutId,
          paymentId: event.paymentId,
          status: event.status,
          planId: event.planId,
          amount: event.amount,
          currency: event.currency,
          ...safeMetadata,
        },
        ipHash: event.ipHash,
        requestId: event.requestId,
      });
    } catch (error) {
      this.logger.error(`Failed to log checkout audit event: ${(error as Error).message}`);
    }
  }

  private mapActionToOutcome(action: string): any {
    const successActions = [
      'CHECKOUT_CREATED',
      'PAYMENT_CREATED',
      'PAYMENT_PENDING',
      'PAYMENT_SUCCEEDED',
      'WEBHOOK_RECEIVED',
      'WEBHOOK_PROCESSED',
      'PAYMENT_RECONCILED',
      'SUBSCRIPTION_ACTIVATED',
      'SUBSCRIPTION_RENEWED',
    ];

    const deniedActions = [
      'CHECKOUT_REJECTED',
      'PAYMENT_FAILED',
      'PAYMENT_CANCELLED',
      'PAYMENT_EXPIRED',
      'WEBHOOK_REJECTED',
    ];

    if (successActions.includes(action)) {
      return AuditOutcome.SUCCESS;
    }
    if (deniedActions.includes(action)) {
      return AuditOutcome.FAILURE;
    }
    return AuditOutcome.SUCCESS;
  }

  private buildDescription(event: PaymentAuditEvent): string {
    switch (event.action) {
      case 'CHECKOUT_CREATED':
        return `Checkout created for plan ${event.planId} via ${event.provider}`;
      case 'CHECKOUT_REJECTED':
        return `Checkout rejected for plan ${event.planId}: ${event.error || 'validation failed'}`;
      case 'PAYMENT_CREATED':
        return `Payment ${event.paymentId} created via ${event.provider}`;
      case 'PAYMENT_PENDING':
        return `Payment ${event.paymentId} pending via ${event.provider}`;
      case 'PAYMENT_SUCCEEDED':
        return `Payment ${event.paymentId} succeeded via ${event.provider}`;
      case 'PAYMENT_FAILED':
        return `Payment ${event.paymentId} failed via ${event.provider}: ${event.error || ''}`;
      case 'PAYMENT_CANCELLED':
        return `Payment ${event.paymentId} cancelled`;
      case 'PAYMENT_EXPIRED':
        return `Payment ${event.paymentId} expired`;
      case 'PAYMENT_REFUNDED':
        return `Payment ${event.paymentId} refunded`;
      case 'WEBHOOK_RECEIVED':
        return `Webhook received: ${event.provider} ${event.providerEventId}`;
      case 'WEBHOOK_REJECTED':
        return `Webhook rejected: ${event.provider} ${event.providerEventId}: ${event.error || ''}`;
      case 'WEBHOOK_DUPLICATE':
        return `Webhook duplicate: ${event.provider} ${event.providerEventId}`;
      case 'WEBHOOK_PROCESSED':
        return `Webhook processed: ${event.provider} ${event.providerEventId} → payment ${event.paymentId}`;
      case 'PAYMENT_RECONCILED':
        return `Payment ${event.paymentId} reconciled: ${event.status}`;
      default:
        return `${event.action}: payment ${event.paymentId || ''} provider ${event.provider}`;
    }
  }

  private sanitizeMetadata(metadata: Record<string, unknown> | undefined): Record<string, unknown> {
    if (!metadata) return {};

    const sanitized: Record<string, unknown> = {};
    const sensitiveKeys = [
      'card',
      'cvv',
      'cvc',
      'number',
      'secret',
      'api_key',
      'private_key',
      'credential',
      'password',
      'token',
      'authorization',
      'x-api-key',
      'stripe-signature',
    ];

    for (const [key, value] of Object.entries(metadata)) {
      const lowerKey = key.toLowerCase();
      const isSensitive = sensitiveKeys.some((s) => lowerKey.includes(s));

      if (isSensitive) {
        sanitized[key] = '***REDACTED***';
      } else if (typeof value === 'string' && value.length > 1000) {
        sanitized[key] = value.substring(0, 1000) + '...[truncated]';
      } else if (typeof value === 'object' && value !== null) {
        // Recursively sanitize nested objects, but limit depth
        try {
          sanitized[key] = JSON.parse(JSON.stringify(value));
          // Remove sensitive from nested
          if (typeof sanitized[key] === 'object') {
            const nested = sanitized[key] as any;
            for (const nestedKey of Object.keys(nested)) {
              if (sensitiveKeys.some((s) => nestedKey.toLowerCase().includes(s))) {
                nested[nestedKey] = '***REDACTED***';
              }
            }
          }
        } catch {
          sanitized[key] = '[unserializable]';
        }
      } else {
        sanitized[key] = value;
      }
    }

    return sanitized;
  }

  private sanitizeError(error: string): string {
    if (!error) return '';
    // Remove potential secrets from error messages
    let sanitized = error;

    // Redact anything that looks like a key
    sanitized = sanitized.replace(/sk_[a-zA-Z0-9_]+/g, 'sk_***REDACTED***');
    sanitized = sanitized.replace(/whsec_[a-zA-Z0-9_]+/g, 'whsec_***REDACTED***');
    sanitized = sanitized.replace(/api_key=[a-zA-Z0-9_]+/gi, 'api_key=***REDACTED***');

    if (sanitized.length > 500) {
      sanitized = sanitized.substring(0, 500) + '...[truncated]';
    }

    return sanitized;
  }
}
