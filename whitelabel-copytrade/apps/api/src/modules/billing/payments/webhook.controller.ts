import {
  Controller,
  Post,
  Req,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiExcludeEndpoint } from '@nestjs/swagger';
import { WebhookService } from './webhook.service';
import { PaymentProvider } from './payment.types';
import type { WebhookPayload } from './webhook.types';
import { ApiStandardResponses } from '../../../common/decorators/api-standard-responses.decorator';

/**
 * Public webhook endpoints for Stripe and NowPayments using raw request-body
 * / signature-safe handling and existing API routing conventions.
 *
 * Webhook endpoints must be public only where required by provider callbacks,
 * while all provider authenticity and replay checks must occur before processing.
 *
 * Security:
 *  - Raw body preserved for signature verification
 *  - Signature verification before any processing
 *  - Replay protection via provider event ID
 *  - No secrets logged
 */

@ApiTags('Billing - webhooks')
@Controller({ path: 'billing/webhooks', version: '1' })
@ApiStandardResponses()
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);

  constructor(private readonly webhookService: WebhookService) {}

  @Post('stripe')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Stripe webhook endpoint',
    description: 'Receives and processes Stripe webhook events. Verifies signature using STRIPE_WEBHOOK_SECRET, checks replay protection, and syncs payment to subscription.',
  })
  @ApiExcludeEndpoint(false)
  async handleStripeWebhook(
    @Req() req: any,
    @Headers('stripe-signature') signature: string,
  ): Promise<{ received: boolean; eventId?: string }> {
    this.logger.log('Stripe webhook received');

    if (!signature) {
      this.logger.warn('Stripe webhook missing signature header');
      return { received: false };
    }

    // Raw body should be available via middleware that preserves raw body
    // In NestJS, you need to configure raw body parser for webhook routes
    const rawBody = req.rawBody || req.body;

    if (!rawBody) {
      this.logger.warn('Stripe webhook missing raw body');
      return { received: false };
    }

    const payload: WebhookPayload = {
      provider: PaymentProvider.STRIPE,
      rawBody: Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(typeof rawBody === 'string' ? rawBody : JSON.stringify(rawBody)),
      signature,
      headers: req.headers,
    };

    try {
      const result = await this.webhookService.processWebhook(payload);

      this.logger.log(`Stripe webhook processed: ${result.providerEventId} status ${result.processingStatus}`);

      return {
        received: true,
        eventId: result.providerEventId,
      };
    } catch (error) {
      // For webhooks, we still return 200 to prevent provider retries for invalid signatures
      // But log the error for investigation
      const isAuthError = (error as any).code === 'UNAUTHORIZED' || (error as Error).message.includes('signature');

      if (isAuthError) {
        this.logger.warn(`Stripe webhook signature verification failed: ${(error as Error).message}`);
        return { received: false };
      }

      this.logger.error(`Stripe webhook processing failed: ${(error as Error).message}`);

      // Return received true to prevent infinite retries for processing errors
      // Failed events can be retried via replay guard
      return { received: true };
    }
  }

  @Post('nowpayments')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'NowPayments IPN webhook endpoint',
    description: 'Receives and processes NowPayments IPN callbacks. Verifies authenticity via IPN secret, checks replay protection, and syncs payment to subscription.',
  })
  @ApiExcludeEndpoint(false)
  async handleNowPaymentsWebhook(
    @Req() req: any,
    @Headers('x-nowpayments-sig') signature?: string,
    @Headers('x-api-key') apiKey?: string,
  ): Promise<{ received: boolean; eventId?: string }> {
    this.logger.log('NowPayments webhook received');

    const rawBody = req.rawBody || req.body;

    if (!rawBody) {
      this.logger.warn('NowPayments webhook missing raw body');
      return { received: false };
    }

    // NowPayments uses IPN secret for HMAC verification, signature may be in header
    const effectiveSignature = signature || apiKey || '';

    const payload: WebhookPayload = {
      provider: PaymentProvider.NOWPAYMENTS,
      rawBody: Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(typeof rawBody === 'string' ? rawBody : JSON.stringify(rawBody)),
      signature: effectiveSignature,
      headers: req.headers,
    };

    try {
      const result = await this.webhookService.processWebhook(payload);

      this.logger.log(`NowPayments webhook processed: ${result.providerEventId} status ${result.processingStatus}`);

      return {
        received: true,
        eventId: result.providerEventId,
      };
    } catch (error) {
      const isAuthError = (error as any).code === 'UNAUTHORIZED' || (error as Error).message.includes('signature');

      if (isAuthError) {
        this.logger.warn(`NowPayments webhook verification failed: ${(error as Error).message}`);
        return { received: false };
      }

      this.logger.error(`NowPayments webhook processing failed: ${(error as Error).message}`);

      return { received: true };
    }
  }

  @Post('stripe/test')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Stripe webhook test endpoint (development only)',
    description: 'Test endpoint for Stripe webhook verification without signature check - only enabled in development',
  })
  @ApiExcludeEndpoint(true)
  async handleStripeTestWebhook(@Req() req: any): Promise<{ received: boolean; eventId?: string; warning: string }> {
    if (process.env.NODE_ENV === 'production') {
      return { received: false, warning: 'Test endpoint disabled in production' } as any;
    }

    const rawBody = req.rawBody || req.body;

    // For testing, we bypass signature verification but still process
    this.logger.warn('Stripe TEST webhook received - bypassing signature verification');

    const payload: WebhookPayload = {
      provider: PaymentProvider.STRIPE,
      rawBody: Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(JSON.stringify(rawBody)),
      signature: 'test_signature',
      headers: req.headers,
    };

    try {
      // In test mode, we directly try to normalize without signature verification
      const result = await this.webhookService.processWebhook(payload);

      return {
        received: true,
        eventId: result.providerEventId,
        warning: 'TEST MODE - signature verification bypassed',
      };
    } catch (error) {
      this.logger.error(`Stripe test webhook failed: ${(error as Error).message}`);
      return {
        received: false,
        warning: `Test failed: ${(error as Error).message}`,
      } as any;
    }
  }
}
