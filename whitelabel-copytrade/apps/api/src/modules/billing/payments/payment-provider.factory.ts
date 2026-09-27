import { Injectable, Logger } from '@nestjs/common';
import { PaymentProvider } from './payment.types';
import type { IPaymentProvider } from './payment-provider.interface';
import { PaymentConfigService } from './payment.config';
import { StripeAdapter } from './stripe.adapter';
import { NowPaymentsAdapter } from './nowpayments.adapter';
import { AppException } from '../../../common/errors/app.exception';
import { ErrorCode } from '@wlct/shared-types';

/**
 * Selects the configured payment provider and returns the correct adapter
 * using the existing BILLING_PROVIDER configuration.
 *
 * This factory is the single entry point for obtaining a payment provider
 * instance. It ensures:
 *  - No hardcoded provider selection
 *  - Provider enablement checked from config
 *  - Unsupported providers rejected with clear error
 *  - Secrets never exposed through factory
 */

@Injectable()
export class PaymentProviderFactory {
  private readonly logger = new Logger(PaymentProviderFactory.name);

  constructor(
    private readonly config: PaymentConfigService,
    private readonly stripeAdapter: StripeAdapter,
    private readonly nowpaymentsAdapter: NowPaymentsAdapter,
  ) {}

  getProvider(provider?: PaymentProvider): IPaymentProvider {
    const targetProvider = provider ?? this.config.provider;

    if (targetProvider === PaymentProvider.NONE) {
      throw new AppException({
        code: ErrorCode.VALIDATION_ERROR,
        message: 'Payment provider not configured. Set BILLING_PROVIDER to stripe or nowpayments.',
        context: { provider: targetProvider },
      });
    }

    if (!this.config.isProviderEnabled(targetProvider)) {
      throw new AppException({
        code: ErrorCode.VALIDATION_ERROR,
        message: `Payment provider ${targetProvider} is not enabled or missing credentials.`,
        context: { provider: targetProvider },
      });
    }

    switch (targetProvider) {
      case PaymentProvider.STRIPE:
        this.logger.log(`Selected payment provider: ${targetProvider}`);
        return this.stripeAdapter;

      case PaymentProvider.NOWPAYMENTS:
        this.logger.log(`Selected payment provider: ${targetProvider}`);
        return this.nowpaymentsAdapter;

      default:
        throw new AppException({
          code: ErrorCode.VALIDATION_ERROR,
          message: `Unsupported payment provider: ${targetProvider}`,
          context: { provider: targetProvider, supported: [PaymentProvider.STRIPE, PaymentProvider.NOWPAYMENTS] },
        });
    }
  }

  getDefaultProvider(): IPaymentProvider {
    return this.getProvider();
  }

  getStripeProvider(): IPaymentProvider {
    return this.getProvider(PaymentProvider.STRIPE);
  }

  getNowPaymentsProvider(): IPaymentProvider {
    return this.getProvider(PaymentProvider.NOWPAYMENTS);
  }

  isProviderAvailable(provider: PaymentProvider): boolean {
    try {
      return this.config.isProviderEnabled(provider);
    } catch {
      return false;
    }
  }

  getAvailableProviders(): PaymentProvider[] {
    const available: PaymentProvider[] = [];
    if (this.isProviderAvailable(PaymentProvider.STRIPE)) {
      available.push(PaymentProvider.STRIPE);
    }
    if (this.isProviderAvailable(PaymentProvider.NOWPAYMENTS)) {
      available.push(PaymentProvider.NOWPAYMENTS);
    }
    return available;
  }

  validateProvider(provider: PaymentProvider): void {
    if (provider === PaymentProvider.NONE) {
      throw new AppException({
        code: ErrorCode.VALIDATION_ERROR,
        message: 'Payment provider must be specified',
      });
    }

    if (!Object.values(PaymentProvider).includes(provider)) {
      throw new AppException({
        code: ErrorCode.VALIDATION_ERROR,
        message: `Invalid payment provider: ${provider}`,
        context: { validProviders: [PaymentProvider.STRIPE, PaymentProvider.NOWPAYMENTS] },
      });
    }

    if (!this.isProviderAvailable(provider)) {
      throw new AppException({
        code: ErrorCode.VALIDATION_ERROR,
        message: `Payment provider ${provider} is not configured or enabled`,
      });
    }
  }
}
