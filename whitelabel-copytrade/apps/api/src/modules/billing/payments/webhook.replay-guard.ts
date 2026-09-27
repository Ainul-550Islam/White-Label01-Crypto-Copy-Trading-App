import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { CacheService } from '../../../infrastructure/redis/cache.service';
import { PaymentProvider } from './payment.types';
import type { WebhookEventRecord, WebhookReplayCheck, NormalizedWebhookEvent } from './webhook.types';
import { WebhookProcessingStatus } from './webhook.types';

/**
 * Replay/idempotency protection for webhook events using provider event ID,
 * event hash, timestamps, and persistent processing state.
 *
 * Webhook replay prevention must support:
 *  - provider
 *  - provider event ID
 *  - event hash where appropriate
 *  - received timestamp
 *  - first-seen timestamp
 *  - processing status
 *  - successful/failed processing result
 *
 * Same provider event received twice must not apply the subscription transition twice.
 */

@Injectable()
export class WebhookReplayGuard {
  private readonly logger = new Logger(WebhookReplayGuard.name);
  private readonly CACHE_TTL_SECONDS = 24 * 60 * 60;
  private readonly PROCESSED_EVENT_TTL = 7 * 24 * 60 * 60;

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  async checkReplay(event: NormalizedWebhookEvent): Promise<WebhookReplayCheck> {
    const provider = event.provider;
    const providerEventId = event.providerEventId;

    if (!providerEventId) {
      return {
        isDuplicate: false,
        isReplay: false,
        shouldProcess: true,
        reason: 'No provider event ID - cannot deduplicate',
      };
    }

    // Step 1: Check Redis cache for recently processed events (fast path)
    const cacheKey = `webhook:processed:${provider}:${providerEventId}`;
    const cached = await this.cache.get(cacheKey);

    if (cached) {
      this.logger.log(`Webhook replay detected (cache): ${provider}:${providerEventId} already processed`);

      return {
        isDuplicate: true,
        isReplay: true,
        shouldProcess: false,
        reason: `Event ${providerEventId} already processed (cached)`,
      };
    }

    // Step 2: Check database for existing event record
    try {
      const existingRecord = await this.findExistingEvent(provider, providerEventId);

      if (existingRecord) {
        // Event already exists - check if it was successfully processed
        if (existingRecord.processingStatus === WebhookProcessingStatus.PROCESSED) {
          this.logger.log(`Webhook duplicate detected (DB): ${provider}:${providerEventId} already processed at ${existingRecord.processedAt}`);

          return {
            isDuplicate: true,
            isReplay: true,
            existingRecord,
            shouldProcess: false,
            reason: `Event ${providerEventId} already processed successfully`,
          };
        }

        if (existingRecord.processingStatus === WebhookProcessingStatus.PROCESSING) {
          // Event is currently being processed - possible concurrent delivery
          const processingAge = Date.now() - existingRecord.updatedAt.getTime();
          const processingTimeout = 5 * 60 * 1000; // 5 minutes

          if (processingAge < processingTimeout) {
            this.logger.log(`Webhook concurrent processing detected: ${provider}:${providerEventId} is being processed`);

            return {
              isDuplicate: false,
              isReplay: true,
              existingRecord,
              shouldProcess: false,
              reason: `Event ${providerEventId} is currently being processed`,
            };
          }

          // Processing timed out - allow retry
          this.logger.log(`Webhook processing timeout for ${provider}:${providerEventId}, allowing retry`);
        }

        // For FAILED status, allow retry
        if (existingRecord.processingStatus === WebhookProcessingStatus.FAILED) {
          this.logger.log(`Webhook previous failure for ${provider}:${providerEventId}, allowing retry (attempt ${existingRecord.processingAttempts + 1})`);

          return {
            isDuplicate: false,
            isReplay: false,
            existingRecord,
            shouldProcess: true,
            reason: `Retrying failed event ${providerEventId}`,
          };
        }
      }
    } catch (error) {
      this.logger.warn(`Failed to check existing webhook event: ${(error as Error).message}`);
      // On DB failure, allow processing but log warning
    }

    // Step 3: Check event age for replay window
    const replayWindowSeconds = 24 * 60 * 60; // 24 hours
    const eventAgeSeconds = (Date.now() - event.providerCreatedAt.getTime()) / 1000;

    if (eventAgeSeconds > replayWindowSeconds) {
      this.logger.warn(`Webhook event too old: ${provider}:${providerEventId} age ${eventAgeSeconds}s exceeds window ${replayWindowSeconds}s`);

      return {
        isDuplicate: false,
        isReplay: true,
        shouldProcess: false,
        reason: `Event too old: ${eventAgeSeconds}s old, window is ${replayWindowSeconds}s`,
      };
    }

    // Event is new and should be processed
    return {
      isDuplicate: false,
      isReplay: false,
      shouldProcess: true,
      reason: `New event ${providerEventId} should be processed`,
    };
  }

  async recordEventReceived(event: NormalizedWebhookEvent, rawPayload?: any, signature?: string): Promise<WebhookEventRecord> {
    const eventHash = this.computeEventHash(event);

    try {
      const record = await (this.prisma as any).webhookEvent?.create({
        data: {
          id: this.generateId(),
          provider: event.provider,
          providerEventId: event.providerEventId,
          eventType: event.eventType,
          eventCategory: event.eventCategory,
          providerPaymentId: event.providerPaymentId || null,
          providerCheckoutId: event.providerCheckoutId || null,
          eventHash,
          payload: rawPayload ? this.sanitizePayload(rawPayload) : null,
          signature: signature ? '***REDACTED***' : null,
          processingStatus: WebhookProcessingStatus.RECEIVED,
          processingAttempts: 0,
          paymentId: null,
          tenantId: event.metadata?.tenantId || null,
          receivedAt: event.receivedAt,
          firstSeenAt: new Date(),
        },
      });

      if (record) {
        return this.mapToRecord(record);
      }

      return this.createFallbackRecord(event, eventHash);
    } catch (error) {
      this.logger.warn(`Failed to record webhook event received: ${(error as Error).message}`);
      return this.createFallbackRecord(event, eventHash);
    }
  }

  async markEventVerified(provider: PaymentProvider, providerEventId: string): Promise<void> {
    try {
      await (this.prisma as any).webhookEvent?.updateMany({
        where: { provider, providerEventId },
        data: {
          processingStatus: WebhookProcessingStatus.VERIFIED,
          updatedAt: new Date(),
        },
      });
    } catch (error) {
      this.logger.warn(`Failed to mark event verified: ${(error as Error).message}`);
    }
  }

  async markEventProcessing(provider: PaymentProvider, providerEventId: string): Promise<void> {
    try {
      await (this.prisma as any).webhookEvent?.updateMany({
        where: { provider, providerEventId },
        data: {
          processingStatus: WebhookProcessingStatus.PROCESSING,
          processingAttempts: { increment: 1 },
          updatedAt: new Date(),
        },
      });
    } catch (error) {
      this.logger.warn(`Failed to mark event processing: ${(error as Error).message}`);
    }
  }

  async markEventProcessed(provider: PaymentProvider, providerEventId: string, paymentId?: string, tenantId?: string): Promise<void> {
    try {
      await (this.prisma as any).webhookEvent?.updateMany({
        where: { provider, providerEventId },
        data: {
          processingStatus: WebhookProcessingStatus.PROCESSED,
          processedAt: new Date(),
          paymentId: paymentId || undefined,
          tenantId: tenantId || undefined,
          updatedAt: new Date(),
        },
      });

      // Cache processed event for fast replay detection
      const cacheKey = `webhook:processed:${provider}:${providerEventId}`;
      await this.cache.set(cacheKey, { processedAt: new Date().toISOString(), paymentId }, this.PROCESSED_EVENT_TTL);
    } catch (error) {
      this.logger.warn(`Failed to mark event processed: ${(error as Error).message}`);
    }
  }

  async markEventFailed(provider: PaymentProvider, providerEventId: string, errorMessage: string): Promise<void> {
    try {
      await (this.prisma as any).webhookEvent?.updateMany({
        where: { provider, providerEventId },
        data: {
          processingStatus: WebhookProcessingStatus.FAILED,
          lastProcessingError: errorMessage.substring(0, 1000),
          updatedAt: new Date(),
        },
      });
    } catch (error) {
      this.logger.warn(`Failed to mark event failed: ${(error as Error).message}`);
    }
  }

  async markEventDuplicate(provider: PaymentProvider, providerEventId: string): Promise<void> {
    try {
      await (this.prisma as any).webhookEvent?.updateMany({
        where: { provider, providerEventId },
        data: {
          processingStatus: WebhookProcessingStatus.DUPLICATE,
          processedAt: new Date(),
          updatedAt: new Date(),
        },
      });

      const cacheKey = `webhook:processed:${provider}:${providerEventId}`;
      await this.cache.set(cacheKey, { processedAt: new Date().toISOString(), duplicate: true }, this.PROCESSED_EVENT_TTL);
    } catch (error) {
      this.logger.warn(`Failed to mark event duplicate: ${(error as Error).message}`);
    }
  }

  async markEventRejected(provider: PaymentProvider, providerEventId: string, reason: string): Promise<void> {
    try {
      await (this.prisma as any).webhookEvent?.create({
        data: {
          id: this.generateId(),
          provider,
          providerEventId,
          eventType: 'REJECTED',
          eventCategory: 'UNKNOWN',
          eventHash: this.computeSimpleHash(`${provider}:${providerEventId}:${reason}`),
          processingStatus: WebhookProcessingStatus.REJECTED,
          lastProcessingError: reason.substring(0, 1000),
          receivedAt: new Date(),
          firstSeenAt: new Date(),
        },
      });
    } catch (error) {
      this.logger.warn(`Failed to mark event rejected: ${(error as Error).message}`);
    }
  }

  private async findExistingEvent(provider: PaymentProvider, providerEventId: string): Promise<WebhookEventRecord | null> {
    try {
      const record = await (this.prisma as any).webhookEvent?.findFirst({
        where: { provider, providerEventId },
        orderBy: { createdAt: 'desc' },
      });

      if (record) {
        return this.mapToRecord(record);
      }
      return null;
    } catch {
      return null;
    }
  }

  private computeEventHash(event: NormalizedWebhookEvent): string {
    try {
      const crypto = require('crypto');
      const data = `${event.provider}:${event.providerEventId}:${event.eventType}:${event.providerPaymentId || ''}:${JSON.stringify(event.amount || {})}`;
      return crypto.createHash('sha256').update(data).digest('hex');
    } catch {
      return this.computeSimpleHash(`${event.provider}:${event.providerEventId}:${event.eventType}`);
    }
  }

  private computeSimpleHash(data: string): string {
    try {
      const crypto = require('crypto');
      return crypto.createHash('sha256').update(data).digest('hex');
    } catch {
      return data.substring(0, 64);
    }
  }

  private sanitizePayload(payload: any): any {
    if (!payload) return null;
    try {
      const sanitized = JSON.parse(JSON.stringify(payload));
      // Remove sensitive fields
      const sensitiveFields = ['card', 'source', 'payment_method', 'api_key', 'secret', 'cvv', 'cvc', 'number'];
      const removeSensitive = (obj: any) => {
        if (typeof obj !== 'object' || obj === null) return;
        for (const key of Object.keys(obj)) {
          if (sensitiveFields.some((s) => key.toLowerCase().includes(s))) {
            obj[key] = '***REDACTED***';
          } else if (typeof obj[key] === 'object') {
            removeSensitive(obj[key]);
          }
        }
      };
      removeSensitive(sanitized);
      return sanitized;
    } catch {
      return { sanitized: true };
    }
  }

  private mapToRecord(prismaRecord: any): WebhookEventRecord {
    return {
      id: prismaRecord.id,
      provider: prismaRecord.provider as PaymentProvider,
      providerEventId: prismaRecord.providerEventId,
      eventType: prismaRecord.eventType,
      eventCategory: prismaRecord.eventCategory as any,
      providerPaymentId: prismaRecord.providerPaymentId || null,
      providerCheckoutId: prismaRecord.providerCheckoutId || null,
      eventHash: prismaRecord.eventHash,
      payload: prismaRecord.payload || null,
      signature: prismaRecord.signature || null,
      processingStatus: prismaRecord.processingStatus as WebhookProcessingStatus,
      processingAttempts: prismaRecord.processingAttempts,
      lastProcessingError: prismaRecord.lastProcessingError || null,
      processedAt: prismaRecord.processedAt || null,
      paymentId: prismaRecord.paymentId || null,
      tenantId: prismaRecord.tenantId || null,
      receivedAt: prismaRecord.receivedAt,
      firstSeenAt: prismaRecord.firstSeenAt,
      createdAt: prismaRecord.createdAt,
      updatedAt: prismaRecord.updatedAt,
    };
  }

  private createFallbackRecord(event: NormalizedWebhookEvent, eventHash: string): WebhookEventRecord {
    const now = new Date();
    return {
      id: this.generateId(),
      provider: event.provider,
      providerEventId: event.providerEventId,
      eventType: event.eventType,
      eventCategory: event.eventCategory,
      providerPaymentId: event.providerPaymentId || null,
      providerCheckoutId: event.providerCheckoutId || null,
      eventHash,
      payload: null,
      signature: null,
      processingStatus: WebhookProcessingStatus.RECEIVED,
      processingAttempts: 0,
      lastProcessingError: null,
      processedAt: null,
      paymentId: null,
      tenantId: event.metadata?.tenantId || null,
      receivedAt: event.receivedAt,
      firstSeenAt: now,
      createdAt: now,
      updatedAt: now,
    };
  }

  private generateId(): string {
    try {
      const { randomUUID } = require('crypto');
      return randomUUID();
    } catch {
      return `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
    }
  }
}
